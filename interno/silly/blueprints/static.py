"""
static.py — Rutas estáticas, media, y generación de QR codes para SillyQuiz
"""
import os
import qrcode
from io import BytesIO
from flask import Blueprint, send_from_directory, jsonify, request

static_bp = Blueprint("static", __name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
VENDOR_DIR = os.path.join(FRONTEND_DIR, "vendor")


@static_bp.route("/css/<path:filename>")
def css(filename):
    resp = send_from_directory(os.path.join(FRONTEND_DIR, "css"), filename)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@static_bp.route("/js/<path:filename>")
def js(filename):
    resp = send_from_directory(os.path.join(FRONTEND_DIR, "js"), filename)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@static_bp.route("/quiz-renderer.js")
def quiz_renderer_js():
    resp = send_from_directory(FRONTEND_DIR, "quiz-renderer.js")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@static_bp.route("/control")
def control():
    resp = send_from_directory(FRONTEND_DIR, "sillycontrol.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


MEDIA_DIR = os.path.join(BASE_DIR, "media")


@static_bp.route("/html/<path:filename>")
def html(filename):
    resp = send_from_directory(os.path.join(FRONTEND_DIR, "html"), filename)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@static_bp.route("/vendor/<path:filename>")
def vendor(filename):
    resp = send_from_directory(VENDOR_DIR, filename)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@static_bp.route("/media/<path:filename>")
def media(filename):
    resp = send_from_directory(MEDIA_DIR, filename)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@static_bp.route("/display")
def display():
    resp = send_from_directory(FRONTEND_DIR, "displaysilly.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@static_bp.route("/displaysilly")
def displaysilly_alias():
    resp = send_from_directory(FRONTEND_DIR, "displaysilly.html")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@static_bp.route("/")
def index():
    import os
    idx = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(idx):
        resp = send_from_directory(BASE_DIR, "index.html")
        resp.headers["Cache-Control"] = "no-cache"
        return resp
    return "<meta charset='utf-8'><style>body{background:#080808;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:20px;margin:0}</style><h1>SILLYQUIZ</h1><div style='display:flex;gap:30px'><a href='/sillycontrol' style='color:#7C3AED'>Panel de Control</a><a href='/display' style='color:#10B981'>Pantalla Display</a><a href='/canva' style='color:#FF6B00'>Canva</a></div>"


# ==================== QR CODE ROUTES ====================

@static_bp.route("/qr")
def qr_index():
    """Página con todos los QR codes de la app"""
    base_url = request.url_root.rstrip('/')
    urls = {
        "Panel de Control (sillycontrol)": f"{base_url}/sillycontrol",
        "Display Principal (displaysilly)": f"{base_url}/displaysilly",
        "Canva / Infinite Canvas": f"{base_url}/canva",
        "Modo Builder (BuildSilly)": f"{base_url}/canva",
        "Play / Jugadores": f"{base_url}/play/",
    }
    return jsonify({
        "app": "SillyQuiz",
        "version": "6.0",
        "urls": urls,
        "qr_endpoints": {name: f"{base_url}/qr/img?url={url}" for name, url in urls.items()}
    })


@static_bp.route("/qr/img")
def qr_image():
    """Genera una imagen QR code para una URL"""
    url = request.args.get("url", "")
    if not url:
        return jsonify({"error": "Parámetro 'url' requerido"}), 400
    
    # Generar QR
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Convertir a bytes
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    
    from flask import send_file
    return send_file(buffer, mimetype="image/png", download_name="qr.png")


@static_bp.route("/qr/page")
def qr_page():
    """Página HTML con todos los QR codes visibles"""
    base_url = request.url_root.rstrip('/')
    urls = {
        "Panel de Control (sillycontrol)": f"{base_url}/sillycontrol",
        "Display Principal (displaysilly)": f"{base_url}/displaysilly",
        "Canva / Infinite Canvas": f"{base_url}/canva",
        "Modo Builder (BuildSilly)": f"{base_url}/canva",
        "Play / Jugadores": f"{base_url}/play/",
    }
    
    html = """
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SillyQuiz - QR Codes</title>
        <style>
            body { font-family: 'Segoe UI', system-ui, sans-serif; background: #ECEAE3; color: #0a0a0a; margin: 0; padding: 20px; }
            .container { max-width: 800px; margin: 0 auto; }
            h1 { text-align: center; color: #0a0a0a; font-family: 'Bangers', cursive; font-size: 3rem; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-top: 30px; }
            .card { background: #fff; border: 3px solid #0a0a0a; padding: 20px; border-radius: 0; box-shadow: 6px 6px 0 #0a0a0a; }
            .card h3 { margin: 0 0 15px; font-size: 1.2rem; color: #0a0a0a; }
            .qr-img { display: block; margin: 0 auto 15px; }
            .url-text { font-family: monospace; font-size: 0.85rem; color: #666; word-break: break-all; margin-bottom: 10px; }
            .btn { display: inline-block; background: #0a0a0a; color: #fff; padding: 10px 20px; border: 3px solid #0a0a0a; text-decoration: none; font-weight: 700; cursor: pointer; transition: all 0.1s; }
            .btn:hover { background: #fff; color: #0a0a0a; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎮 SillyQuiz QR Codes</h1>
            <p style="text-align:center; color:#666;">Escanea para acceder desde el móvil</p>
            <div class="grid">
    """
    
    for name, url in urls.items():
        qr_url = f"{request.url_root}qr/img?url={url}"
        html += f"""
                <div class="card">
                    <h3>{name}</h3>
                    <img class="qr-img" src="{qr_url}" alt="QR para {name}" width="200" height="200">
                    <div class="url-text">{url}</div>
                    <a class="btn" href="{url}" target="_blank">Abrir en navegador</a>
                </div>
        """
    
    html += """
            </div>
        </div>
    </body>
    </html>
    """
    return html


from silly.blueprints._security import add_security_headers
static_bp.after_request(add_security_headers)
