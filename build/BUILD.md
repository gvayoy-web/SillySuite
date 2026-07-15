# Build SillyQuiz (Zero Config)

Script de empaquetado para generar un `.exe` portable de SillyQuiz y su instalador.

## 1. PyInstaller (un solo .exe)

```powershell
pip install pyinstaller
pyinstaller build/pyinstaller.spec
```

- Entrada: `interno/launcher.pyw`.
- Salida: `dist/SillyQuiz.exe` (modo onefile).
- Los datos runtime (`config.json`, `silly.json`, `themes/`, `sounds/`, `static/`, `frontend/`, `modo_templates/`, `scripts/`) se incluyen en el bundle y se resuelven vía `sys._MEIPASS` (patrón ya usado por el launcher).
- Si falta `sillyquiz.ico` en la raíz, el build sigue funcionando sin icono.

## 2. Instalador (Inno Setup)

1. Instala [Inno Setup 6](https://jrsoftware.org/isdl.php).
2. Compila:

```powershell
iscc build/installer.iss
```

- Toma `dist\SillyQuiz\*` y lo instala en `{autopf}\SillyQuiz`.
- Crea accesos directo en Menú Inicio y Escritorio.
- Ejecuta SillyQuiz al terminar.

## 3. Auto-actualizador (`build/auto_update.py`)

Solo usa la biblioteca estándar de Python (sin dependencias de terceros).

```powershell
# Comprobar si hay actualizacion
python build/auto_update.py --check

# Descargar, verificar SHA256 y aplicar
python build/auto_update.py --apply
```

- `--url URL` sobreescribe `update_url` de `version.json`.
- `--check` compara `version` (major.minor) y `build` (int).
- `--apply` descarga el zip, verifica `sha256` si el remoto lo incluye, extrae a un staging y reemplaza archivos locales con `shutil.move`. Nunca borra el exe en ejecución; genera `restart_helper.bat` para reiniciar limpio.
- El launcher NO invoca el updater: es una herramienta CLI separada.
