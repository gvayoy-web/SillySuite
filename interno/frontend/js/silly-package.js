/**
 * silly-package.js — Formato de proyecto empaquetado `.silly`
 *
 * Un archivo `.silly` es un ZIP que contiene:
 *   - manifest.json : metadatos del proyecto (formato, nombre, fecha, nº assets)
 *   - blocks.json   : estructura de bloques del Modo (heads serializados)
 *   - assets/...    : audios e imágenes saneados, comprimidos
 *
 * El programa lee el ZIP, rehidrata los bloques y vuelve a montar los assets
 * como object URLs seguros y ligeros. Sin dependencias externas (CSP strict).
 *
 * Compresión: usa CompressionStream('deflate-raw') cuando está disponible,
 * con fallback a STORE (sin comprimir) si no.
 */
(function (global) {
  'use strict';

  /* ---------- CRC32 ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- deflate / inflate (raw) ---------- */
  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const w = cs.writable.getWriter();
      w.write(bytes); w.close();
      const ab = await new Response(cs.readable).arrayBuffer();
      return new Uint8Array(ab);
    } catch (e) { return null; }
  }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream no disponible en este navegador');
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    const ab = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(ab);
  }

  /* ---------- helpers de bytes ---------- */
  function u16(n) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n & 0xFFFF, true); return a; }
  function u32(n) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n >>> 0, true); return a; }
  function concat(arrs) {
    let len = 0; for (const a of arrs) len += a.length;
    const out = new Uint8Array(len);
    let off = 0; for (const a of arrs) { out.set(a, off); off += a.length; }
    return out;
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const DOS_TIME = 0, DOS_DATE = 0x21; // 1980-01-01

  /**
   * Crea un Blob .zip a partir de [{ path: string, data: Uint8Array }].
   */
  async function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = encoder.encode(f.path);
      const raw = (f.data instanceof Uint8Array) ? f.data : encoder.encode(String(f.data));
      const comp = await deflateRaw(raw);
      const method = comp ? 8 : 0;
      const data = comp || raw;
      const crc = crc32(raw);
      const localOffset = offset;

      localParts.push(concat([
        u32(0x04034b50), u16(20), u16(0x0800), u16(method),
        u16(DOS_TIME), u16(DOS_DATE), u32(crc),
        u32(data.length), u32(raw.length), u16(nameBytes.length), u16(0),
        nameBytes, data
      ]));

      centralParts.push(concat([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method),
        u16(DOS_TIME), u16(DOS_DATE), u32(crc),
        u32(data.length), u32(raw.length), u16(nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(localOffset),
        nameBytes
      ]));

      offset += localParts[localParts.length - 1].length;
    }

    const centralBuf = concat(centralParts);
    const end = concat([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralBuf.length), u32(offset), u16(0)
    ]);

    return new Blob([concat([concat(localParts), centralBuf, end])], { type: 'application/zip' });
  }

  /**
   * Lee un Blob .zip y devuelve [{ path, data: Uint8Array }].
   */
  async function readZip(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('El archivo no es un .silly/.zip valido');

    const cdOffset = dv.getUint32(eocd + 16, true);
    const count = dv.getUint16(eocd + 10, true);
    const files = [];
    let p = cdOffset;

    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
      const path = decoder.decode(nameBytes);

      const lNameLen = dv.getUint16(localOffset + 26, true);
      const lExtraLen = dv.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      let data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 8) data = await inflateRaw(data);

      files.push({ path: path, data: data });
      p += 46 + nameLen + extraLen + commLen;
    }
    return files;
  }

  /* ---------- Lógica específica de .silly ---------- */

  const SB_ASSET_PREFIX = '__SB_ASSET__:';

  function isSbAssetRef(v) {
    return typeof v === 'string' && v.indexOf(SB_ASSET_PREFIX) === 0;
  }

  function extFromMime(mime) {
    const m = (mime || '').split(';')[0];
    const map = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
      'image/webp': 'webp', 'image/avif': 'avif',
      'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
      'audio/ogg': 'ogg', 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
      'audio/x-m4a': 'm4a'
    };
    return map[m] || 'bin';
  }

  function dataUrlToBytes(dataUrl) {
    const idx = dataUrl.indexOf(',');
    if (idx === -1) return new Uint8Array(0);
    const b64 = dataUrl.slice(idx + 1);
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function readBlobAsDataUrl(blob) {
    return new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => res(null);
      r.readAsDataURL(blob);
    });
  }

  /**
   * Exporta un proyecto a un Blob `.silly`.
   * @param {Object} opts { name, heads (serializado), assets (map id->rec), version }
   */
  async function exportSilly(opts) {
    const heads = opts.heads;
    const assetsIn = opts.assets || {};
    const pathById = {};
    const assetsOut = [];
    const SB = global.ScratchBlocks || null;
    const seen = {};

    async function walk(node) {
      if (!node || typeof node !== 'object') return;
      const def = SB && SB.get ? SB.get(node.opcode) : null;
      if (node.args && typeof node.args === 'object') {
        for (const k in node.args) {
          const v = node.args[k];
          if (isSbAssetRef(v)) {
            const id = v.slice(SB_ASSET_PREFIX.length);
            const rec = assetsIn[id];
            if (rec && rec.dataUrl && !seen[id]) {
              seen[id] = true;
              const ext = extFromMime(rec.mime);
              const path = 'assets/' + id + '.' + ext;
              pathById[id] = path;
              assetsOut.push({ path: path, data: dataUrlToBytes(rec.dataUrl) });
            }
            if (pathById[id]) node.args[k] = pathById[id];
          }
        }
      }
      if (def && def.bodies) {
        def.bodies.forEach(b => {
          const body = node[b];
          const arr = Array.isArray(body) ? body : (body ? [body] : []);
          for (const c of arr) walk(c);
        });
      }
      if (node.next) walk(node.next);
    }

    const cloned = JSON.parse(JSON.stringify(heads));
    await walk(cloned);

    const manifest = {
      format: 'silly', sillyVersion: 1, name: opts.name || 'SillyProject',
      createdAt: new Date().toISOString(), assetCount: assetsOut.length
    };
    const blocksJson = {
      version: opts.version || (global.TemplateMigration && global.TemplateMigration.CURRENT_SCHEMA_VERSION) || 3,
      type: 'scratch-mode', heads: cloned
    };
    const files = [
      { path: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) },
      { path: 'blocks.json', data: encoder.encode(JSON.stringify(blocksJson, null, 2)) }
    ];
    for (const a of assetsOut) files.push(a);
    return createZip(files);
  }

  /**
   * Importa un Blob `.silly` y devuelve { meta, heads, assets, version }.
   * Los assets se reconstruyen como dataUrls y se re-referencian con
   * '__SB_ASSET__:<id>' para que el editor los monte como object URLs.
   */
  async function importSilly(blob) {
    const files = await readZip(blob);
    let blocks = null, manifest = null;
    const assetBlobs = {};
    for (const f of files) {
      if (f.path === 'blocks.json') blocks = JSON.parse(decoder.decode(f.data));
      else if (f.path === 'manifest.json') { try { manifest = JSON.parse(decoder.decode(f.data)); } catch (e) {} }
      else if (f.path.indexOf('assets/') === 0) assetBlobs[f.path] = new Blob([f.data]);
    }
    if (!blocks || !blocks.heads) throw new Error('El .silly no contiene blocks.json valido');

    const SB = global.ScratchBlocks || null;
    const idByPath = {};
    function idFromPath(path) {
      const m = path.match(/^assets\/(.+)\.[^.]+$/);
      return m ? m[1] : path;
    }
    const assetsOut = {};

    function ensureAsset(path) {
      if (idByPath[path] !== undefined) return idByPath[path];
      const id = idFromPath(path);
      idByPath[path] = id;
      const b = assetBlobs[path];
      if (b) assetsOut[id] = { id: id, name: id, mime: b.type, size: b.size, _promise: readBlobAsDataUrl(b) };
      return id;
    }

    function walk(node) {
      if (!node || typeof node !== 'object') return;
      const def = SB && SB.get ? SB.get(node.opcode) : null;
      if (node.args && typeof node.args === 'object') {
        for (const k in node.args) {
          const v = node.args[k];
          if (typeof v === 'string' && v.indexOf('assets/') === 0) {
            const id = ensureAsset(v);
            node.args[k] = SB_ASSET_PREFIX + id;
          }
        }
      }
      if (def && def.bodies) {
        def.bodies.forEach(bd => {
          const body = node[bd];
          const arr = Array.isArray(body) ? body : (body ? [body] : []);
          for (const c of arr) walk(c);
        });
      }
      if (node.next) walk(node.next);
    }
    walk(blocks.heads);

    await Promise.all(Object.keys(assetsOut).map(async (id) => {
      const rec = assetsOut[id];
      if (rec && rec._promise) {
        rec.dataUrl = await rec._promise;
        delete rec._promise;
      }
    }));

    return { meta: manifest, heads: blocks.heads, assets: assetsOut, version: blocks.version };
  }

  global.SillyPackage = { createZip, readZip, exportSilly, importSilly };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createZip, readZip, exportSilly, importSilly };
  }
})(typeof window !== 'undefined' ? window : this);
