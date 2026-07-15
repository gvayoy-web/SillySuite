#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auto_update.py — SillyQuiz auto-updater (SOLO biblioteca estandar).

CLI:
    python auto_update.py --check [--url URL]
    python auto_update.py --apply [--url URL]

Diseno:
  * --check: lee version.json local, descarga el remoto (update_url), compara
    version (string "major.minor") y build (int). Informa "up to date" / "update available".
  * --apply: si hay actualizacion, descarga download_url (zip) a un temp dir,
    verifica sha256 si el remoto lo trae, extrae a un staging dir y reemplaza
    los archivos locales con shutil.move. NUNCA borra el exe en ejecucion;
    se deja un helper de reinicio (restart_helper.bat) para el llamador.

No se auto-ejecuta al importar. Solo main() bajo __main__.
"""
import json
import hashlib
import os
import shutil
import sys
import tempfile
import urllib.request
import urllib.error


DEFAULT_UPDATE_URL = "https://example.com/sillyquiz/version.json"
DEFAULT_DOWNLOAD_URL = "https://example.com/sillyquiz/SillyQuiz-latest.zip"

# Directorio donde vive este script (raiz de la instalacion local).
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))
VERSION_FILE = os.path.join(LOCAL_DIR, "version.json")


def _log(msg):
    print(msg)


def _read_local_version():
    if not os.path.exists(VERSION_FILE):
        return {"version": "0.0", "build": 0}
    try:
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        _log("No se pudo leer version.json local: %s" % e)
        return {"version": "0.0", "build": 0}


def _fetch_json(url, timeout=30):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SillyQuiz-Updater"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
        return json.loads(raw)
    except urllib.error.URLError as e:
        raise RuntimeError("No se pudo descargar %s: %s" % (url, e))
    except ValueError as e:
        raise RuntimeError("JSON invalido en %s: %s" % (url, e))


def _parse_version(v):
    """Devuelve tupla (major, minor) para comparacion semantica simple."""
    try:
        parts = str(v).split(".")
        nums = [int(p) for p in parts if p.isdigit()]
        while len(nums) < 2:
            nums.append(0)
        return tuple(nums[:2])
    except Exception:
        return (0, 0)


def _is_newer(remote, local):
    rv = _parse_version(remote.get("version", "0.0"))
    lv = _parse_version(local.get("version", "0.0"))
    if rv != lv:
        return rv > lv
    return int(remote.get("build", 0)) > int(local.get("build", 0))


def _sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url, dest, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "SillyQuiz-Updater"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    with open(dest, "wb") as f:
        f.write(data)


def cmd_check(url):
    local = _read_local_version()
    remote = _fetch_json(url)
    if _is_newer(remote, local):
        _log("update available: %s (build %s)" % (remote.get("version"), remote.get("build")))
        return 1
    _log("up to date (%s build %s)" % (local.get("version"), local.get("build")))
    return 0


def cmd_apply(url):
    local = _read_local_version()
    remote = _fetch_json(url)
    if not _is_newer(remote, local):
        _log("Ya esta actualizado; nada que hacer.")
        return 0

    download_url = remote.get("download_url") or DEFAULT_DOWNLOAD_URL
    expected_sha = remote.get("sha256")

    tmp = tempfile.mkdtemp(prefix="sillyquiz_update_")
    try:
        zip_path = os.path.join(tmp, "update.zip")
        _log("Descargando actualizacion desde %s ..." % download_url)
        _download(download_url, zip_path)

        if expected_sha:
            actual = _sha256_of(zip_path)
            if actual.lower() != expected_sha.lower():
                raise RuntimeError(
                    "Verificacion SHA256 fallida (esperado %s, obtenido %s)"
                    % (expected_sha, actual)
                )
            _log("SHA256 verificado correctamente.")

        extract_dir = os.path.join(tmp, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        import zipfile
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)

        # Staging: mover de extract_dir a LOCAL_DIR respetando estructura.
        _apply_staging(extract_dir, LOCAL_DIR)

        # Actualizar version.json local con los metadatos remotos.
        _write_local_version(remote)

        _log("Actualizacion aplicada. Version: %s (build %s)"
             % (remote.get("version"), remote.get("build")))
        _write_restart_helper()
        return 0
    except Exception as e:
        _log("ERROR aplicando actualizacion: %s" % e)
        return 2
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _apply_staging(src_root, dst_root):
    """Reemplaza archivos locales por los extraidos, sin borrar el exe activo."""
    for root, dirs, files in os.walk(src_root):
        rel = os.path.relpath(root, src_root)
        target_dir = dst_root if rel == "." else os.path.join(dst_root, rel)
        os.makedirs(target_dir, exist_ok=True)
        for name in files:
            src = os.path.join(root, name)
            dst = os.path.join(target_dir, name)
            # Nunca sobrescribir el ejecutable en ejecucion directamente:
            # se renombra el viejo a .old y se mueve el nuevo; el helper de
            # reinicio se encarga de limpiar.
            if dst.lower().endswith(".exe") and os.path.exists(dst):
                old = dst + ".old"
                try:
                    if os.path.exists(old):
                        os.remove(old)
                    os.rename(dst, old)
                except Exception:
                    pass
            shutil.move(src, dst)


def _write_local_version(remote):
    try:
        data = {
            "version": remote.get("version"),
            "build": remote.get("build"),
            "channel": remote.get("channel", "stable"),
            "display_name": remote.get("display_name", "SillyQuiz"),
            "update_url": remote.get("update_url", DEFAULT_UPDATE_URL),
            "download_url": remote.get("download_url", DEFAULT_DOWNLOAD_URL),
            "sha256": remote.get("sha256", ""),
        }
        with open(VERSION_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        _log("Advertencia: no se pudo escribir version.json: %s" % e)


def _write_restart_helper():
    # Nota: NO matamos ni borramos el exe en ejecucion. El llamador (o este
    # helper) debe cerrar la app y relanzar SillyQuiz.exe. Se deja un .bat
    # para que el usuario/instalador reinicie de forma limpia.
    bat = os.path.join(LOCAL_DIR, "restart_helper.bat")
    try:
        with open(bat, "w", encoding="utf-8") as f:
            f.write("@echo off\n")
            f.write("REM Helper de reinicio generado por auto_update.py\n")
            f.write("timeout /t 2 >nul\n")
            f.write('if exist "SillyQuiz.exe.old" del /q "SillyQuiz.exe.old"\n')
            f.write('start "" "%~dp0SillyQuiz.exe"\n')
        _log("Helper de reinicio escrito: %s" % bat)
    except Exception as e:
        _log("Advertencia: no se pudo escribir restart_helper.bat: %s" % e)


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    url = DEFAULT_UPDATE_URL
    mode = None

    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--check":
            mode = "check"
        elif a == "--apply":
            mode = "apply"
        elif a == "--url":
            i += 1
            if i >= len(argv):
                _log("ERROR: --url requiere un argumento")
                return 2
            url = argv[i]
        elif a in ("-h", "--help"):
            _log("Uso: auto_update.py [--check] [--apply] [--url URL]")
            return 0
        else:
            _log("Argumento desconocido: %s" % a)
            return 2
        i += 1

    if mode is None:
        _log("Uso: auto_update.py [--check] [--apply] [--url URL]")
        return 2

    if mode == "check":
        return cmd_check(url)
    return cmd_apply(url)


if __name__ == "__main__":
    sys.exit(main())
