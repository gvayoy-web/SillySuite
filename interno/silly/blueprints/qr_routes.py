"""
qr_routes.py — Generación de QR codes para SillyQuiz
"""
import qrcode
from io import BytesIO
from flask import Blueprint, jsonify, request, send_file

qr_bp = Blueprint("qr", __name__, url_prefix="/api/qr")


@qr_bp.route("/")
def qr_index():
    """Endpoint que devuelve todas las URLs disponibles para generar QR"""
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
        "qr_endpoints": {name: f"{request.url_root}api/qr/img?url={url}" for name, url in urls.items()}
    })


@qr_bp.route("/img")
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
    
    return send_file(buffer, mimetype="image/png", download_name="qr.png")


@qr_bp.route("/page")
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
            <h1>🎮 SillyQuiz - QR Codes</h1>
            <p style="text-align:center; color:#666;">Escanea para acceder desde el móvil</p>
            <div class="grid">
    """
    
    for name, url in urls.items():
        qr_url = f"{request.url_root}api/qr/img?url={url}"
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