"""Persistence service — save, backup, and notify logic."""


def guardar_datos(snapshot):
    from silly.globals import container
    import json
    import os
    import tempfile
    dir_name = os.path.dirname(os.path.abspath(container.DATA_FILE)) or "."
    try:
        with tempfile.NamedTemporaryFile("w", dir=dir_name, delete=False, encoding="utf-8", suffix=".tmp") as tf:
            json.dump(snapshot, tf, ensure_ascii=False, indent=4)
            tmp_path = tf.name
        os.replace(tmp_path, container.DATA_FILE)
    except Exception as exc:
        if container.log:
            container.log.error("Fallo al escribir %s: %s", container.DATA_FILE, exc)


def persist():
    from silly.globals import container
    guardar_datos(container.state.datos_persistibles())


def _persist_and_notify():
    persist()
    from silly.globals import container
    from silly.services.sse import EVENT_STATE_PERSIST
    container.event_bus.notify(EVENT_STATE_PERSIST)


def crear_backup():
    from silly.globals import container
    import os
    import shutil
    from datetime import datetime
    MAX_BACKUPS = int(os.getenv("COMP_BACKUPS", "10"))
    if not os.path.exists(container.DATA_FILE):
        return
    backup_dir = os.path.join(container.BASE_DIR, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = os.path.join(backup_dir, f"pym_backup_{ts}.json")
    shutil.copy2(container.DATA_FILE, dest)
    try:
        entries = sorted((e for e in os.scandir(backup_dir) if e.is_file()), key=lambda e: e.stat().st_mtime)
    except OSError:
        entries = []
    while len(entries) > MAX_BACKUPS:
        try:
            os.remove(entries.pop(0).path)
        except OSError:
            if container.log:
                container.log.warning("No se pudo eliminar backup antiguo")
