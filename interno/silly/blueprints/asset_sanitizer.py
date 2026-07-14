"""
asset_sanitizer.py — Validación estricta de archivos de modo (anti-malware).

Comprueba el TIPO REAL por magic bytes (no por extensión) contra una lista
blanca, limita tamaño y rechaza vectores de ejecución (html/svg/js/pdf).
Usado por el import de modos .lkqmode antes de mover nada a /media.
"""

import struct

# Magic bytes -> (mime esperado, extension segura)
MAGIC_RULES = [
    (b'\x89PNG\r\n\x1a\n', 'image/png', '.png'),
    (b'\xff\xd8\xff', 'image/jpeg', '.jpg'),
    (b'RIFF', 'image/webp', '.webp'),  # seguido de 'WEBP' en offset 8
    (b'GIF87a', 'image/gif', '.gif'),
    (b'GIF89a', 'image/gif', '.gif'),
    (b'ID3', 'audio/mpeg', '.mp3'),
    (b'\xff\xfb', 'audio/mpeg', '.mp3'),
    (b'\xff\xf3', 'audio/mpeg', '.mp3'),
    (b'\xff\xf2', 'audio/mpeg', '.mp3'),
    (b'OggS', 'audio/ogg', '.ogg'),
    (b'fLaC', 'audio/flac', '.flac'),
    (b'RIFF', 'audio/wav', '.wav'),  # seguido de 'WAVE' en offset 8
    (b'\x00\x00\x01\xba', 'video/mpeg', '.mpeg'),
    (b'\x00\x00\x00\x1c\x66\x74\x79\x70', 'video/mp4', '.mp4'),
    (b'ftyp', 'video/mp4', '.mp4'),  # variante con offset
]

ALLOWED_MIMES = {
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/wav',
    'video/mpeg', 'video/mp4', 'video/webm',
}

# Tamaños máximos (bytes)
MAX_SIZE = {
    'image': 15 * 1024 * 1024,
    'audio': 30 * 1024 * 1024,
    'video': 200 * 1024 * 1024,
}

# Vectores de ejecución prohibidos (aunque el magic parezca imagen).
FORBIDDEN_MARKERS = [
    b'<script', b'javascript:', b'<?php', b'<%', b'<svg', b'onload='
]


def _detect(path):
    with open(path, 'rb') as f:
        head = f.read(64)
    mime = None
    ext = None
    for magic, m, e in MAGIC_RULES:
        if head.startswith(magic):
            mime, ext = m, e
            break
        # Reglas con marca en offset (WEBP / WAVE / mp4 ftyp)
        if magic in (b'RIFF', b'ftyp') and len(head) >= 12:
            if magic == b'RIFF' and head[8:12] in (b'WEBP', b'WAVE'):
                mime = 'image/webp' if head[8:12] == b'WEBP' else 'audio/wav'
                ext = '.webp' if head[8:12] == b'WEBP' else '.wav'
                break
            if magic == b'ftyp' and head[4:8] in (b'mp4', b'isom', b'M4V', b'avc1'):
                mime, ext = 'video/mp4', '.mp4'
                break
    return mime, ext


def sanitize(path, kind):
    """Valida y devuelve (ok, mime, ext, razon). No modifica el archivo."""
    try:
        import os
        size = os.path.getsize(path)
    except OSError as e:
        return False, None, None, 'no legible: ' + str(e)

    maxb = MAX_SIZE.get(kind, 15 * 1024 * 1024)
    if size > maxb:
        return False, None, None, 'supera tamaño máximo (%d MB)' % (maxb // 1024 // 1024)

    mime, ext = _detect(path)
    if not mime:
        return False, None, None, 'tipo no reconocido por magic bytes'
    if mime not in ALLOWED_MIMES:
        return False, None, None, 'tipo no permitido: ' + mime

    # Rechaza marcadores de ejecución embebidos (polyglots).
    with open(path, 'rb') as f:
        chunk = f.read(1 << 20)
    low = chunk.lower()
    for marker in FORBIDDEN_MARKERS:
        if marker in low:
            return False, None, None, 'marcador prohibido: ' + marker.decode('utf-8', 'ignore')

    return True, mime, ext, ''
