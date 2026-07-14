import os, sys, tempfile, io, zipfile
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'interno')))
from silly.blueprints.asset_sanitizer import sanitize

d = tempfile.mkdtemp()
svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
p = os.path.join(d, 'c.svg')
open(p, 'wb').write(svg.encode())
ok, mime, ext, reason = sanitize(p, 'image')
print('SVG rejected:', not ok, '| reason:', reason)

# Construir un .lkqmode valido con PNG y manifest
png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f6b0000000049454e44ae426082')
manifest = {
    'id': 'test_z', 'nombre': 'Test', 'descripcion': '', 'icono': 'X',
    'categoria': 'custom', 'version': '1.0.0', 'template_config': {},
    'componentes': [], 'atributos': {},
    'assets': {'gato': {'file': 'assets/gato.png', 'kind': 'image'}},
}
zp = os.path.join(d, 'm.lkqmode')
with zipfile.ZipFile(zp, 'w') as zf:
    zf.writestr('manifest.json', __import__('json').dumps(manifest))
    zf.writestr('assets/gato.png', png)
    zf.writestr('../escape.png', png)  # zip-slip
print('zip built:', os.path.getsize(zp) > 0)

# Validar zip-slip en import
from silly.blueprints.mode_packages import _safe_rel
print('zip-slip blocked:', _safe_rel('../escape.png') is None)
print('ok rel:', _safe_rel('assets/gato.png'))
