"""
control.py — Panel de Control Principal (SILLYQUIZ)

Blueprint que sirve el panel de control completo (SPA) ubicado en
frontend/sillycontrol.html. Todo el contenido (tabs Leaderboard, Preguntas
A/B/C, Pantallas con mapeo/edge-blend, Temas WYSIWYG, Config con export
CSV/HTML/PNG y audio, Preview flotante, y el Modo Builder) vive en el
frontend y se comunica con la API bajo /api.

Estética: brutalista (alto contraste, monoespaciado, sin bordes redondeados)
definida en /css/control.css + /css/control-brutalist.css.
"""

import os

from flask import Blueprint, send_from_directory, redirect, request

control_bp = Blueprint(
    "control",
    __name__,
    url_prefix="/sillycontrol",
    template_folder="../frontend",
)

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend",
)


@control_bp.route("/", defaults={"subpath": ""})
@control_bp.route("/<path:subpath>")
def index(subpath):
    """Sirve el panel de control SPA (sillycontrol.html).

    Cualquier subruta se resuelve en el cliente: el SPA maneja tabs,
    modos y el Modo Builder. Las rutas legacy (/dashboard, /preguntas,
    /modo, /config, /ayuda, /logs) redirigen al panel completo.
    """
    legacy = {"dashboard", "preguntas", "modo", "config", "ayuda", "logs"}
    if subpath in legacy:
        return redirect("/sillycontrol/", code=302)

    resp = send_from_directory(FRONTEND_DIR, "sillycontrol.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


# Alias para mantener compatibilidad con enlaces antiguos que apuntaban a
# /sillycontrol/estado-actual, /sillycontrol/api, etc. La API real vive en /api.
@control_bp.route("/estado-actual", methods=["GET"])
@control_bp.route("/api/<path:subpath>", methods=["GET", "POST", "PUT", "DELETE"])
def _legacy_api_proxy(subpath=None):
    target = request.full_path
    target = target.replace("/sillycontrol/api/", "/api/", 1)
    target = target.replace("/sillycontrol/estado-actual", "/api/estado-actual", 1)
    return redirect(target, code=307)
