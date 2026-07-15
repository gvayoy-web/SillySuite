<#
.SYNOPSIS
    Mejoras automaticas de SillyQuiz en bucle, rotando entre varios modelos de
    opencode mientras duermes. Si un modelo se cuelga o se queda sin tokens
    (mas de 30 min sin respuesta util), se mata y pasa al siguiente.

.DESCRIPCION
    - Rota en bucle infinito: hy3 -> nemotron -> north -> hy3 -> ...
    - Cada modelo recibe el PROMPT y trabaja sobre el disco, asi que parte de
      los cambios del anterior.
    - TIEMPO MAXIMO por modelo (TIMEOUT_MIN, por defecto 30). Si lo supera, se
      considera colgado/sin tokens y se mata para pasar al siguiente.
    - DETECCION de salida vacia: si un modelo termina rapido sin producir
      salida util (probablemente sin tokens), se registra y se sigue.
    - VERIFICACION JS: tras cada modelo se ejecuta 'node --check' sobre los JS
      del frontend. Los errores encontrados se inyectan al PROMPT del model
      siguiente para que los corrija.
    - Parada:
        1) Ctrl+C  -> detiene la cola tras la iteracion actual.
        2) Crear STOP.flag en esta carpeta -> detiene limpio al terminar el
           ciclo en curso (no corta a un modelo a medias).

.USO
    .\mejoras_noche.ps1
#>

# ===================  CONFIGURACION EDITABLE  ===================
$MODELOS = @(
    "opencode/hy3-free"
    "opencode/nemotron-3-ultra-free"
    "opencode/north-mini-code-free"
)

# Tiempo maximo (en minutos) que un modelo puede tardar. Si lo supera,
# se mata y se pasa al siguiente.
$TIMEOUT_MIN = 30

# Numero maximo de ciclos completos (0 = infinito, hasta que pares).
$MAX_CICLOS = 0

# Prompt embebido de respaldo (se usa solo si falta prompt.txt).
$PROMPT_EMBEDDED = @'
Eres un ingeniero senior mejorando el proyecto SillyQuiz, enfocandote en el editor visual SillyBuild:
- HTML: interno/frontend/html/SillyBuild.html
- CSS:  interno/frontend/css/sillybuild.css
- JS:   interno/frontend/js/scratch-ui.js, scratch-blocks.js, scratch-runtime.js y demas scratch-*.js
Trabaja SIEMPRE sobre el codigo actual del disco. Otros modelos pueden haber dejado cambios parciales; revisa el estado real antes de actuar y continua/mejora su trabajo sin romperlo.

Prioridades (aplica todas las que puedas de forma segura):
1. ROBUSTEZ: anade manejo de errores, validacion de entradas, try/catch donde falte, proteccion contra valores nulos/indefinidos, y recuperacion ante fallos del runtime de bloques (scratch-runtime.js). Que un bloque defectuoso no tumbe todo el editor ni la previsualizacion.
2. QUITAR LIMITACIONES: elimina topes artificiales (maximos de bloques, listas, escenas, historial, etc.), amplia capacidades del builder y del motor de ejecucion AOT.
3. ANADIR FUNCIONES utiles: nuevos bloques, atajos de teclado, auto-guardado, exportacion/importacion de proyectos, mejoras de UX, integracion con el backend Flask/WebSocket, panel de errores, deshacer/rehacer mas solido.
4. PULIR LO GRAFICO en SillyBuild al maximo: reorganiza la UI, mejora el CSS usando las variables --sq-*, hazlo responsive y accesible (foco visible, contraste, aria), anade animaciones suaves y un aspecto profesional y pulido. Conserva el estilo brutalist existente.

Reglas:
- Manten convenciones y arquitectura (ES Modules, sin paso de build).
- NO crees documentacion ni README nuevos.
- ANTES de terminar, verifica la sintaxis de los JS que edites con: node --check ruta/al/archivo
- No hagas commit. Solo modifica archivos.
- Deja el proyecto funcional y consistente. Si encuentras errores de sintaxis, corrigelos.
'@

# El prompt real se lee de prompt.txt (para editarlo a mano). Si no existe,
# se usa el embebido de respaldo.
$PROMPT_FILE = Join-Path $ROOT "prompt.txt"
if (Test-Path $PROMPT_FILE) {
    $PROMPT = (Get-Content $PROMPT_FILE -Raw -Encoding UTF8).Trim()
    Log "Prompt cargado desde prompt.txt ($(($PROMPT.Length)) chars)"
} else {
    $PROMPT = $PROMPT_EMBEDDED
    Log "prompt.txt no encontrado; usando prompt embebido de respaldo"
}

# ===============================================================

$ROOT   = Split-Path -Parent $MyInvocation.MyCommand.Path
$STOP   = Join-Path $ROOT "STOP.flag"
$LOG    = Join-Path $ROOT "mejoras_log.txt"
$JS_DIR = Join-Path $ROOT "interno/frontend/js"
$TMPDIR = Join-Path $env:TEMP ("sq_night_" + (Get-Random))
New-Item -ItemType Directory -Path $TMPDIR -Force | Out-Null

# Resuelve el ejecutable real de opencode (es un shim .cmd/.ps1, no un .exe
# directo, por eso no basta con poner "opencode" como FileName del Process).
$OC_EXE = "opencode"
try { $c = Get-Command opencode.cmd -ErrorAction Stop; $OC_EXE = $c.Source } catch {
    try { $c = Get-Command opencode -ErrorAction Stop; $OC_EXE = $c.Source } catch {}
}
Log "Usando opencode en: $OC_EXE"

$cancelled = $false
if (Test-Path $STOP) { Remove-Item $STOP -Force }

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $msg" | Add-Content -Path $LOG
    Write-Host "$ts  $msg"
}

trap {
    $cancelled = $true
    Log ">>> Interrupcion (Ctrl+C). Se detiene tras la iteracion actual."
    break
}

# Comprueba sintaxis de todos los JS del frontend y devuelve errores.
function Verify-JS {
    $errs = @()
    if (-not (Test-Path $JS_DIR)) { return $errs }
    Get-ChildItem $JS_DIR -Filter *.js | ForEach-Object {
        & node --check $_.FullName 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            $out = & node --check $_.FullName 2>&1
            $errs += "$($_.Name): $($out -join ' ')"
        }
    }
    return $errs
}

# Lee lineas nuevas de un archivo temporal y las anade al log.
$script:seen = @{}
function Tail-ToLog($file, $tag) {
    if (-not (Test-Path $file)) { return }
    $lines = Get-Content $file -ErrorAction SilentlyContinue
    $count = $lines.Count
    $prev  = if ($script:seen.ContainsKey($file)) { $script:seen[$file] } else { 0 }
    if ($count -gt $prev) {
        $lines[$prev..($count-1)] | ForEach-Object {
            if ($_ -ne $null -and $_.Trim() -ne "") { Log "[$tag] $_" }
        }
        $script:seen[$file] = $count
    }
}

# Ejecuta un modelo con timeout. Devuelve 'ok' | 'timeout' | 'vacio' | 'error'.
function Invoke-Model {
    param($model, $prompt)
    $base = Join-Path $TMPDIR ($model -replace '[\\/:]', '_')
    $outF = $base + ".out"
    $errF = $base + ".err"
    $script:seen[$outF] = 0
    $script:seen[$errF] = 0

    # Aplana el prompt: los saltos de linea dentro de un argumento de consola
    # pueden romper el arranque. El modelo no necesita saltos de linea.
    $pFlat = $prompt -replace "`r?`n", " "
    $args = 'run --model "' + $model + '" --dir "' + $ROOT + '" --dangerously-skip-permissions "' + $pFlat + '"'
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $OC_EXE
    $psi.Arguments = $args
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    try {
        $p = [System.Diagnostics.Process]::Start($psi)
    } catch {
        Log "!!! No se pudo iniciar opencode para $model : $_"
        return "error"
    }

    $deadline = (Get-Date).AddMinutes($TIMEOUT_MIN)
    $timedOut = $false
    $lastBeat = Get-Date
    while ($p.HasExited -eq $false) {
        if ((Get-Date) -ge $deadline) { $timedOut = $true; break }
        Start-Sleep -Seconds 30
        Tail-ToLog $outF $model
        Tail-ToLog $errF "$model[err]"
        if (((Get-Date) - $lastBeat).TotalMinutes -ge 5) {
            $elap = [math]::Round(((Get-Date) - $p.StartTime).TotalMinutes, 1)
            Log ":: HEARTBEAT $model lleva $elap min activo (no congelado)..."
            $lastBeat = Get-Date
        }
        if (Test-Path $STOP) {
            Log ">>> STOP.flag detectado durante $model. Se aborta este modelo."
            $timedOut = $true; break
        }
    }

    if ($timedOut) {
        try { if (-not $p.HasExited) { $p.Kill() } } catch {}
        try { $p.WaitForExit(5000) } catch {}
        # Limpia procesos huérfanos de opencode por si el Kill no los alcanzó.
        try { Get-Process -Name opencode -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
        Tail-ToLog $outF $model
        Tail-ToLog $errF "$model[err]"
        if (Test-Path $STOP) { return "stop" }
        Log "!!! $model supero el limite de $TIMEOUT_MIN min (colgado/sin tokens). Se mata y se cambia de modelo."
        return "timeout"
    }

    $p.WaitForExit()
    Tail-ToLog $outF $model
    Tail-ToLog $errF "$model[err]"

    $hasOut = $false
    if (Test-Path $outF) { $hasOut = ((Get-Content $outF -Raw -ErrorAction SilentlyContinue) -match '\S') }
    if (-not $hasOut) {
        Log "!!! $model termino sin producir salida util (posiblemente sin tokens). Se cambia de modelo."
        return "vacio"
    }
    return "ok"
}

# -----------------------------  BUCLE  -----------------------------
Log "=== INICIO sesion de mejoras automaticas ==="
Log "Modelos: $($MODELOS -join ', ') | Timeout: $TIMEOUT_MIN min/modelo | Max ciclos: $(if($MAX_CICLOS -eq 0){'infinito'}else{$MAX_CICLOS})"

$ciclo = 0
$errsPrev = @()
while (-not $cancelled) {
    $ciclo++
    Log "----- CICLO #$ciclo -----"
    $skip = @{}   # modelos fallidos se saltan en este ciclo para no encallar

    foreach ($m in $MODELOS) {
        if ($cancelled) { break }
        if (Test-Path $STOP) { Log ">>> STOP.flag. Fin solicitado."; $cancelled = $true; break }
        if ($skip.ContainsKey($m)) { Log ">> Saltando $m (fallo previo en este ciclo)"; continue }

        # Construye el prompt efectivo inyectando errores JS previos.
        $eff = $PROMPT
        if ($errsPrev.Count -gt 0) {
            $eff += "`n`n[CORRECCION OBLIGATORIA] El modelo anterior dejo estos errores de sintaxis JS. DEBES corregirlos antes de anyadir mas cambios:`n"
            $eff += ($errsPrev -join "`n")
        }

        Log ">>> Lanzando modelo: $m"
        $inicio = Get-Date
        try {
            $res = Invoke-Model -model $m -prompt $eff
        } catch {
            Log "!!! Excepcion en $m : $_"
            $res = "error"
        }
        $dur = [math]::Round(((Get-Date) - $inicio).TotalMinutes, 1)

        switch ($res) {
            "ok"     { Log "<<< $m termino OK (${dur} min)" }
            "stop"   { Log "<<< $m abortado por STOP.flag"; $cancelled = $true }
            "timeout"{ Log "<<< $m fuera de tiempo (${dur} min)"; $skip[$m] = $true }
            "vacio"  { Log "<<< $m sin salida (${dur} min)"; $skip[$m] = $true }
            "error"  { Log "<<< $m error de arranque"; $skip[$m] = $true }
        }
        if ($cancelled) { break }

        # Verificacion de sintaxis para alimentar al siguiente modelo.
        $errsPrev = Verify-JS
        if ($errsPrev.Count -gt 0) {
            Log ":: Verificacion JS: $($errsPrev.Count) error(es) detectado(s). Se pasaran al siguiente modelo."
        } else {
            Log ":: Verificacion JS: sin errores de sintaxis."
        }
    }

    if ($cancelled) { break }
    if ($MAX_CICLOS -gt 0 -and $ciclo -ge $MAX_CICLOS) {
        Log ">>> Alcanzado MAX_CICLOS ($MAX_CICLOS). Fin."
        break
    }
    Log "----- Fin CICLO #$ciclo (reiniciando rotacion) -----"
}

try { Remove-Item $TMPDIR -Recurse -Force -ErrorAction SilentlyContinue } catch {}
Log "=== FIN sesion de mejoras automaticas ==="
