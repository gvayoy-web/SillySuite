# -*- mode: python ; coding: utf-8 -*-
"""
pyinstaller.spec — SillyQuiz "Download & Play (Zero Config)" build.

Build a single Windows .exe from interno/launcher.pyw.
Reuses the frozen-asset pattern: launcher uses get_base_dir() -> sys._MEIPASS,
so all runtime data (config.json, silly.json, themes/, sounds/, static/,
frontend/, modo_templates/, scripts/) is bundled at the MEIPASS root.

Run from repo root:
    pyinstaller build/pyinstaller.spec
Output: dist/SillyQuiz.exe  (onefile)
"""
import os

from PyInstaller.utils.hooks import collect_all

# Repo root = parent of the directory that holds this spec (build/)
SPECPATH = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SPECPATH)
INTERNO = os.path.join(REPO_ROOT, "interno")
SCRIPTS = os.path.join(REPO_ROOT, "scripts")
ICON = os.path.join(REPO_ROOT, "sillyquiz.ico")

# ---------------------------------------------------------------------------
# Collect runtime data files by walking interno/ and flattening it into the
# bundle root (so _MEIPASS/silly, _MEIPASS/config.json, _MEIPASS/themes, etc.).
# ---------------------------------------------------------------------------
EXCLUDE_DIRS = {"__pycache__", "backups", "logs", ".git", "migrations", "__pycache__"}
EXCLUDE_FILES = {".instalado", "launcher.log", "server.log", "competencia.log"}

datas = []


def _walk(src_root, rel_root):
    for root, dirs, files in os.walk(src_root):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f.endswith(".pyc") or f in EXCLUDE_FILES:
                continue
            src = os.path.join(root, f)
            rel = os.path.relpath(src, rel_root)
            dst = os.path.dirname(rel)
            datas.append((src, dst))


_walk(INTERNO, INTERNO)   # interno/silly/app.py -> ('...', 'silly')
_walk(SCRIPTS, SCRIPTS)   # scripts/opcodes_gen.py -> ('...', 'scripts')

if os.path.exists(ICON):
    datas.append((ICON, "."))

# ---------------------------------------------------------------------------
# Third-party packages: pull in binaries + submodules robustly.
# ---------------------------------------------------------------------------
binaries = []
hiddenimports = []

for pkg in ["flask", "flask_cors", "waitress", "websockets", "jsonschema",
            "PIL", "pystray", "tkinter", "argon2", "qrcode", "requests",
            "customtkinter"]:
    try:
        ret = collect_all(pkg)
        datas += ret[0]
        binaries += ret[1]
        hiddenimports += ret[2]
    except Exception:
        # Package not installed in this env; keep going (bundled machine has it).
        pass

# Explicit application modules (PyInstaller static scan usually finds these,
# but list them so the build is resilient to import-location changes).
hiddenimports += [
    "silly",
    "silly.app",
    "silly.config_loader",
    "silly.mode_manager",
    "silly.game_state_manager",
    "silly.template_registry",
    "silly.template_engine",
    "silly.communication_manager",
    "silly.globals",
    "silly.models.state",
    "silly.models.cronometro",
    "silly.services.logger",
    "silly.services.sse",
    "silly.services.stats_service",
    "silly.services.theme_service",
    "silly.services.sound_service",
    "silly.services.persistence",
    "silly.services.audit",
    "silly.modes.questions",
    "silly.modes.roulette",
    "silly.modes.hangman",
    "silly.modes.verses",
    "silly.blueprints.static",
    "silly.blueprints.api",
    "silly.blueprints.quiz",
    "silly.blueprints.display",
    "silly.blueprints.timer",
    "silly.blueprints.modes",
    "silly.blueprints.config",
    "silly.blueprints.export",
    "silly.blueprints.themes",
    "silly.blueprints.sounds",
    "silly.blueprints.mode_packages",
    "silly.blueprints.engine",
    "silly.blueprints.play_routes",
    "silly.blueprints.qr_routes",
    "silly.blueprints.templates",
    "silly.blueprints.communication",
    "silly.blueprints.docs",
    "silly.blueprints.control",
    "silly.blueprints.sync_bridge",
    "silly.blueprints._security",
    "silly.blueprints.silly_packages",
    "scripts",
    "scripts.opcodes_gen",
    "websocket_server",
]

a = Analysis(
    [os.path.join(INTERNO, "launcher.pyw")],
    pathex=[REPO_ROOT, INTERNO],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="SillyQuiz",
    debug=False,
    bootloader_ignore_signals=True,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[ICON] if os.path.exists(ICON) else None,
)
