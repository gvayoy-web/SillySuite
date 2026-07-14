"""
mode_packages.py — Import / Export de modos empaquetados (.lkqmode = ZIP).

Import (sanitizado, server-side):
  1. Recibe el .zip, lo extrae en /tmp aislado (anti zip-slip).
  2. Valida manifest.json contra TEMPLATE_SCHEMA (más 'assets').
  3. Por cada asset: magic-bytes -> MIME whitelist, tamaño, sin marcadores de
     ejecución. Se renombra a sha1.ext (inmutable, sin path injection) y se
     hace strip de EXIF en imágenes.
  4. Reescribe las rutas de assets a /media/<modo>/<hash>.ext y registra.

Export:
  Empaqueta manifest.json + /media/<modo>/* en un .lkqmode para descarga.
"""
import os
import io
import time
import zipfile
import hashlib
import shutil
import uuid
import tempfile

from flask import Blueprint, request, jsonify, Response, send_file
from jsonschema import validate, ValidationError

from silly.template_registry import template_registry, TEMPLATE_SCHEMA
from silly.blueprints.asset_sanitizer import sanitize

mode_packages_bp = Blueprint('mode_packages', __name__, url_prefix='/api/mode-packages')

MEDIA_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'media')


def _safe_rel(name):
    """Ruta relativa segura: sin '..', sin absolutos, sin backslashes."""
    if not name or name.startswith('/') or '\\' in name:
        return None
    parts = name.split('/')
    if '..' in parts:
        return None
    return '/'.join(parts)


def _strip_exif(path):
    try:
        from PIL import Image
        from PIL import ImageOps
        im = Image.open(path)
        im = ImageOps.exif_transpose(im)
        clean = Image.new(im.mode, im.size)
        clean.paste(im)
        im.close()
        clean.save(path, format=clean.format or 'PNG')
        clean.close()
    except Exception:
        # Si falla el strip, el archivo ya pasó validación de magic bytes.
        pass


def _import_package(zf, extract_dir, mode_id):
    """Valida y sanita todos los assets. Devuelve (manifest, errores)."""
    errors = []
    names = set(zf.namelist())

    if 'manifest.json' not in names:
        return None, ['falta manifest.json']

    with zf.open('manifest.json') as fh:
        manifest = __import__('json').load(fh)

    # Validar contra esquema (assets es opcional).
    try:
        validate(instance=manifest, schema=TEMPLATE_SCHEMA)
    except ValidationError as e:
        return None, ['manifest inválido: ' + e.message]

    assets_in = manifest.get('assets') or {}
    assets_out = {}
    media_dir = os.path.join(MEDIA_ROOT, mode_id)
    os.makedirs(media_dir, exist_ok=True)

    for key, meta in assets_in.items():
        rel = _safe_rel(meta.get('file', ''))
        if not rel or rel not in names:
            errors.append('asset "%s": archivo no encontrado' % key)
            continue
        kind = meta.get('kind', 'image')
        src = os.path.join(extract_dir, rel.replace('/', os.sep))
        if not os.path.isfile(src):
            errors.append('asset "%s": no es archivo' % key)
            continue
        ok, mime, ext, reason = sanitize(src, kind)
        if not ok:
            errors.append('asset "%s" rechazado: %s' % (key, reason))
            continue
        with open(src, 'rb') as f:
            data = f.read()
        h = hashlib.sha1(data).hexdigest()
        dest_name = h + ext
        dest = os.path.join(media_dir, dest_name)
        tmp = dest + '.tmp'
        with open(tmp, 'wb') as out:
            out.write(data)
        if mime.startswith('image/'):
            _strip_exif(tmp)
        os.replace(tmp, dest)
        assets_out[key] = {
            'file': '/media/%s/%s' % (mode_id, dest_name),
            'kind': kind,
            'mime': mime,
            'hash': h,
        }

    manifest['assets'] = assets_out
    manifest['id'] = mode_id
    return manifest, errors


@mode_packages_bp.route('/import', methods=['POST'])
def import_mode():
    uploaded = request.files.get('file')
    if not uploaded:
        return jsonify({'success': False, 'error': 'falta archivo'}), 400

    if not uploaded.filename or not uploaded.filename.lower().endswith(('.lkqmode', '.zip')):
        return jsonify({'success': False, 'error': 'formato debe ser .lkqmode/.zip'}), 400

    mode_id = 'mode-' + uuid.uuid4().hex[:12]
    extract_dir = os.path.join(tempfile.gettempdir(), 'lkq_%s' % uuid.uuid4().hex)
    os.makedirs(extract_dir, exist_ok=True)
    try:
        data = uploaded.read()
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            # Anti zip-slip: validar cada nombre antes de extraer.
            for name in zf.namelist():
                if _safe_rel(name) is None:
                    return jsonify({'success': False, 'error': 'ruta insegura en el zip: ' + name}), 400
            zf.extractall(extract_dir)

        manifest, errors = _import_package(zipfile.ZipFile(io.BytesIO(data)), extract_dir, mode_id)
        if errors:
            shutil.rmtree(extract_dir, ignore_errors=True)
            return jsonify({'success': False, 'errors': errors}), 422

        # Registrar en comunidad.
        if not template_registry.register_template(manifest, is_community=True):
            # El schema exige id con patron ^[a-z0-9-]+$; mode_id ya cumple.
            return jsonify({'success': False, 'error': 'manifest rechazado por esquema', 'manifest_id': manifest.get('id')}), 422

        return jsonify({
            'success': True,
            'mode_id': mode_id,
            'assets': len(manifest.get('assets', {})),
            'nombre': manifest.get('nombre', mode_id),
        })
    except zipfile.BadZipFile:
        return jsonify({'success': False, 'error': 'zip corrupto'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)


@mode_packages_bp.route('/<mode_id>/export', methods=['GET'])
def export_mode(mode_id):
    template = template_registry.get_template(mode_id)
    if not template:
        return jsonify({'success': False, 'error': 'modo no encontrado'}), 404

    media_dir = os.path.join(MEDIA_ROOT, mode_id)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('manifest.json', __import__('json').dumps(template, ensure_ascii=False, indent=2))
        if os.path.isdir(media_dir):
            for fn in os.listdir(media_dir):
                fp = os.path.join(media_dir, fn)
                if os.path.isfile(fp):
                    zf.write(fp, os.path.join('assets', fn))
    buf.seek(0)
    ts = time.strftime('%Y%m%d_%H%M%S')
    return send_file(
        buf,
        mimetype='application/zip',
        as_attachment=True,
        download_name='%s_%s.lkqmode' % (mode_id, ts),
    )
