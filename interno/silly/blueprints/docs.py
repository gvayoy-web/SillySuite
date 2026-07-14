"""
Blueprint de documentación estática del constructor de modos (ScratchUI).
Sirve páginas HTML desde frontend/docs/<ruta>.
"""
import os
from flask import Blueprint, send_from_directory, abort

docs_bp = Blueprint("docs", __name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS_DIR = os.path.join(BASE_DIR, "frontend", "docs")


def _resolve(page):
    # page sin extensión -> probar .html o /index.html
    candidates = []
    if page.endswith(".html") or page.endswith(".htm"):
        candidates.append(page)
    else:
        candidates.append(page + ".html")
        candidates.append(os.path.join(page, "index.html"))
    for c in candidates:
        full = os.path.join(DOCS_DIR, c)
        if os.path.isfile(full):
            return c
    return None


@docs_bp.route("/docs/")
@docs_bp.route("/docs/<path:page>")
def docs(page=""):
    rel = _resolve(page)
    if not rel:
        abort(404)
    resp = send_from_directory(DOCS_DIR, rel)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


from silly.blueprints._security import add_security_headers
docs_bp.after_request(add_security_headers)
