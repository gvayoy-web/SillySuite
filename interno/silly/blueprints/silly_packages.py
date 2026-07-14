"""
silly_packages.py — Import / Export de modos empaquetados (.silly = ZIP).

Estructura .silly:
  proyecto.silly/
  ├── manifest.json          # Metadatos + heads (bloques) + assets index
  ├── assets/
  │   ├── images/            # .png, .jpg, .webp, .gif, .svg, .avif
  │   ├── videos/            # .mp4, .webm, .ogv
  │   ├── audio/             # .mp3, .wav, .ogg, .m4a, .weba
  │   └── fonts/             # .woff2, .woff (opcional)
  └── preview.png            # Thumbnail opcional (512x288)

manifest.json schema:
{
  "version": "1.0",
  "type": "silly-mode",
  "id": "mode-uuid-v4",
  "title": "Mi Modo",
  "description": "Descripción",
  "author": "usuario",
  "created": "2026-07-14T10:30:00Z",
  "tags": ["quiz"],
  "difficulty": "medium",
  "heads": { "event_opcode": [ {opcode, args, next, _id}, ... ] },
  "assets": {
    "bg_main": { "file": "assets/images/bg_main.webp", "kind": "image", "mime": "image/webp", "hash": "sha1", "ref": "set_background_image.SRC" },
    "video_intro": { "file": "assets/videos/intro.mp4", "kind": "video", "mime": "video/mp4", "hash": "sha1", "ref": "show_video.SRC" },
    "sfx_click": { "file": "assets/audio/click.mp3", "kind": "audio", "mime": "audio/mpeg", "hash": "sha1", "ref": "play_sfx.FILE" },
    "font_custom": { "file": "assets/fonts/custom.woff2", "kind": "font", "mime": "font/woff2", "hash": "sha1", "ref": "set_custom_theme.FNT" }
  },
  "settings": { "autoPlayMedia": true, "compressAssets": true, "maxAssetSizeMB": 50 }
}
"""

import os
import io
import time
import zipfile
import hashlib
import shutil
import tempfile
import uuid
import json
from datetime import datetime
from pathlib import Path

from flask import Blueprint, request, jsonify, send_file, current_app
from jsonschema import validate, ValidationError

from silly.template_registry import template_registry, TEMPLATE_SCHEMA
from silly.blueprints.asset_sanitizer import sanitize_and_clean

silly_packages_bp = Blueprint('silly_packages', __name__, url_prefix='/api/silly-packages')

# Rutas base
BASE_DIR = Path(__file__).resolve().parent.parent.parent
MEDIA_ROOT = BASE_DIR / 'media'
IMPORTED_ROOT = MEDIA_ROOT / 'imported'


def _safe_rel(name):
    """Ruta relativa segura: sin '..', sin absolutos, sin backslashes."""
    if not name or name.startswith('/') or '\\' in name or '..' in name.split('/'):
        return None
    return name


def _extract_assets_from_heads(heads):
    """
    Escanea los bloques en heads y extrae referencias a assets (SRC, FILE, etc.)
    Retorna dict: { asset_key: { kind, mime_hint, ref_opcode, ref_arg } }
    """
    assets = {}
    asset_counter = {'image': 0, 'video': 0, 'audio': 0, 'font': 0}

    # Mapeo de opcode+arg -> kind
    OPCODE_ASSET_MAP = {
        ('show_image', 'SRC'): 'image',
        ('show_video', 'SRC'): 'video',
        ('set_background_image', 'SRC'): 'image',
        ('play_bg_music', 'FILE'): 'audio',
        ('play_sfx', 'FILE'): 'audio',
        ('set_custom_theme', 'FNT'): 'font',
        ('set_custom_theme', 'BG'): 'image',  # background image
    }

    for event_name, stacks in (heads or {}).items():
        for stack in stacks if isinstance(stacks, list) else [stacks]:
            cur = stack
            while cur:
                opcode = cur.get('opcode')
                args = cur.get('args', {})
                if opcode and args:
                    for arg_name, arg_val in args.items():
                        if not arg_val or not isinstance(arg_val, str):
                            continue
                        key = (opcode, arg_name)
                        if key in OPCODE_ASSET_MAP:
                            kind = OPCODE_ASSET_MAP[key]
                            asset_counter[kind] += 1
                            asset_key = f'{kind}_{asset_counter[kind]}'
                            # Evitar duplicados por URL
                            if arg_val not in [v.get('url') for v in assets.values()]:
                                assets[asset_key] = {
                                    'kind': kind,
                                    'url': arg_val,
                                    'ref': f'{opcode}.{arg_name}',
                                    'mime_hint': None  # se detectará en import
                                }
                cur = cur.get('next')
    return assets


def _import_package(zf, extract_dir, mode_id):
    """Valida y sanitiza todos los assets. Devuelve (manifest, errores)."""
    errors = []
    names = set(zf.namelist())

    if 'manifest.json' not in names:
        return None, ['falta manifest.json']

    with zf.open('manifest.json') as fh:
        manifest = json.load(fh)

    # Validar contra esquema (extender TEMPLATE_SCHEMA con assets opcional)
    try:
        validate(instance=manifest, schema=TEMPLATE_SCHEMA)
    except ValidationError as e:
        return None, [f'manifest inválido: {e.message}']

    # Validar assets
    assets_in = manifest.get('assets') or {}
    assets_out = {}
    media_dir = IMPORTED_ROOT / mode_id
    media_dir.mkdir(parents=True, exist_ok=True)

    for key, meta in assets_in.items():
        rel = _safe_rel(meta.get('file', ''))
        if not rel or rel not in names:
            errors.append(f'asset "{key}": archivo no encontrado en zip')
            continue

        kind = meta.get('kind', 'image')
        src = extract_dir / rel
        if not src.is_file():
            errors.append(f'asset "{key}": no es archivo')
            continue

        # Sanitizar (valida magic bytes, strip EXIF, ffprobe)
        ok, mime, ext, reason = sanitize_and_clean(str(src), kind)
        if not ok:
            errors.append(f'asset "{key}" rechazado: {reason}')
            continue

        # Leer datos y hashear
        with open(src, 'rb') as f:
            data = f.read()
        h = hashlib.sha1(data).hexdigest()
        dest_name = f'{h}{ext}'
        dest = media_dir / dest_name

        # Escribir atómico
        tmp = dest.with_suffix(dest.suffix + '.tmp')
        tmp.write_bytes(data)
        tmp.replace(dest)

        assets_out[key] = {
            'file': f'/media/imported/{mode_id}/{dest_name}',
            'kind': kind,
            'mime': mime,
            'hash': h,
            'size': len(data),
            'ref': meta.get('ref', ''),
        }

    manifest['assets'] = assets_out
    manifest['id'] = mode_id
    manifest['imported_from_silly'] = True
    manifest['imported_at'] = datetime.utcnow().isoformat() + 'Z'
    manifest['original_filename'] = manifest.get('title', mode_id)

    return manifest, errors


def _build_export_zip(manifest):
    """Construye ZIP en memoria con manifest + assets."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        # manifest.json
        zf.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        # assets
        for key, meta in manifest.get('assets', {}).items():
            rel = meta.get('file', '').replace('/media/imported/', 'assets/')
            if rel and rel.startswith('assets/'):
                full = BASE_DIR / 'media' / 'imported' / rel.replace('assets/', '')
                if full.is_file():
                    zf.write(full, rel)
        # preview.png si existe
        preview = BASE_DIR / 'media' / 'imported' / manifest['id'] / 'preview.png'
        if preview.is_file():
            zf.write(preview, 'preview.png')
    buf.seek(0)
    return buf


@silly_packages_bp.route('/import', methods=['POST'])
def import_silly():
    """Importa un archivo .silly/.zip -> registra en template_registry."""
    uploaded = request.files.get('file')
    if not uploaded:
        return jsonify({'success': False, 'error': 'falta archivo'}), 400

    filename = uploaded.filename or ''
    if not filename.lower().endswith(('.silly', '.zip')):
        return jsonify({'success': False, 'error': 'formato debe ser .silly/.zip'}), 400

    mode_id = f'mode-{uuid.uuid4().hex[:12]}'
    extract_dir = Path(tempfile.gettempdir()) / f'silly_{uuid.uuid4().hex}'
    extract_dir.mkdir(parents=True, exist_ok=True)

    try:
        data = uploaded.read()
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            # Anti zip-slip
            for name in zf.namelist():
                if _safe_rel(name) is None:
                    return jsonify({'success': False, 'error': f'ruta insegura en zip: {name}'}), 400
            zf.extractall(extract_dir)

        # Validar y sanitizar
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            manifest, errors = _import_package(zf, extract_dir, mode_id)

        if errors:
            shutil.rmtree(extract_dir, ignore_errors=True)
            return jsonify({'success': False, 'errors': errors}), 422

        # Registrar en template_registry (community)
        if not template_registry.register_template(manifest, is_community=True):
            shutil.rmtree(extract_dir, ignore_errors=True)
            return jsonify({'success': False, 'error': 'manifest rechazado por esquema'}), 422

        # Generar preview si no existe (usar primera imagen)
        _generate_preview(manifest, mode_id)

        return jsonify({
            'success': True,
            'mode_id': mode_id,
            'assets': len(manifest.get('assets', {})),
            'nombre': manifest.get('nombre') or manifest.get('title') or mode_id,
            'imported_at': manifest.get('imported_at')
        })

    except zipfile.BadZipFile:
        return jsonify({'success': False, 'error': 'zip corrupto'}), 400
    except Exception as e:
        log = current_app.logger
        log.exception('Error importando .silly')
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)


def _generate_preview(manifest, mode_id):
    """Genera preview.png simple desde primera imagen asset."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        assets = manifest.get('assets', {})
        img_meta = next((m for m in assets.values() if m.get('kind') == 'image'), None)
        if not img_meta:
            return
        src = BASE_DIR / 'media' / 'imported' / mode_id / Path(img_meta['file']).name
        if not src.is_file():
            return
        im = Image.open(src)
        im.thumbnail((512, 288))
        # Fondo negro con overlay título
        canvas = Image.new('RGB', (512, 288), '#0b0b0b')
        canvas.paste(im, ((512 - im.width) // 2, (288 - im.height) // 2))
        draw = ImageDraw.Draw(canvas)
        title = manifest.get('title') or manifest.get('nombre') or mode_id
        try:
            font = ImageFont.load_default()
        except Exception:
            font = None
        draw.text((10, 10), title[:60], fill='#FF5E3A', font=font)
        out = BASE_DIR / 'media' / 'imported' / mode_id / 'preview.png'
        canvas.save(out)
    except Exception as e:
        current_app.logger.debug(f'Preview generation failed: {e}')


@silly_packages_bp.route('/<mode_id>/export', methods=['GET'])
def export_silly(mode_id):
    """Exporta un modo como .silly (ZIP)."""
    template = template_registry.get_template(mode_id)
    if not template:
        return jsonify({'success': False, 'error': 'modo no encontrado'}), 404

    # Asegurar assets existen
    media_dir = IMPORTED_ROOT / mode_id
    if not media_dir.is_dir():
        return jsonify({'success': False, 'error': 'assets no encontrados'}), 404

    buf = _build_export_zip(template)
    ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    return send_file(
        buf,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'{mode_id}_{ts}.silly'
    )


@silly_packages_bp.route('/list', methods=['GET'])
def list_imported():
    """Lista proyectos importados (.silly)."""
    templates = template_registry.get_all_templates()
    imported = [
        t for t in templates
        if t.get('imported_from_silly')
    ]
    result = []
    for t in imported:
        assets = t.get('assets', {})
        result.append({
            'id': t.get('id'),
            'title': t.get('title') or t.get('nombre') or t.get('id'),
            'description': t.get('description', ''),
            'author': t.get('author', 'Sistema'),
            'created': t.get('imported_at') or t.get('created', ''),
            'assets_count': len(assets),
            'asset_types': {
                'images': sum(1 for a in assets.values() if a.get('kind') == 'image'),
                'videos': sum(1 for a in assets.values() if a.get('kind') == 'video'),
                'audio': sum(1 for a in assets.values() if a.get('kind') == 'audio'),
                'fonts': sum(1 for a in assets.values() if a.get('kind') == 'font'),
            },
            'preview': f'/media/imported/{t.get("id")}/preview.png',
            'tags': t.get('tags', []),
            'difficulty': t.get('difficulty', 'medium'),
        })
    return jsonify({'success': True, 'projects': result, 'total': len(result)})


@silly_packages_bp.route('/<mode_id>', methods=['DELETE'])
def delete_imported(mode_id):
    """Elimina proyecto importado + assets."""
    template = template_registry.get_template(mode_id)
    if not template or not template.get('imported_from_silly'):
        return jsonify({'success': False, 'error': 'no es un proyecto importado'}), 404

    # Borrar de registry
    template_registry.delete_template(mode_id)

    # Borrar assets
    media_dir = IMPORTED_ROOT / mode_id
    if media_dir.is_dir():
        shutil.rmtree(media_dir, ignore_errors=True)

    return jsonify({'success': True, 'message': 'Proyecto eliminado'})