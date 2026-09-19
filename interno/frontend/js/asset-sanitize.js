/**
 * asset-sanitize.js — Saneo EXTREMO de media subida por el usuario.
 * Expone window.SillyAssetSanitizer. Sin dependencias externas.
 */
(function (global) {
  'use strict';

  const ASSET_REF_PREFIX = '__SB_ASSET__:';

  const ASSET_LIMITS = {
    image: {
      maxBytes: 25 * 1024 * 1024,
      maxW: 8192,
      maxH: 8192,
      allowed: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']
    },
    audio: {
      maxBytes: 50 * 1024 * 1024,
      maxDuration: 600,
      allowed: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/flac']
    }
  };

  function detectImageMime(m) {
    if (m[0] === 0x89 && m[1] === 0x50 && m[2] === 0x4E && m[3] === 0x47) return 'image/png';
    if (m[0] === 0xFF && m[1] === 0xD8 && m[2] === 0xFF) return 'image/jpeg';
    if (m[0] === 0x47 && m[1] === 0x49 && m[2] === 0x46) return 'image/gif';
    if (m[0] === 0x52 && m[1] === 0x49 && m[2] === 0x46 && m[3] === 0x46 &&
        m[8] === 0x57 && m[9] === 0x45 && m[10] === 0x42 && m[11] === 0x50) return 'image/webp';
    if (m[4] === 0x66 && m[5] === 0x74 && m[6] === 0x79 && m[7] === 0x70) {
      const brand = String.fromCharCode(m[8], m[9], m[10], m[11]);
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
    }
    return null;
  }

  function detectAudioMime(m, t) {
    if (m[0] === 0xFF && (m[1] === 0xFB || m[1] === 0xF3 || m[1] === 0xF2 || m[1] === 0xE2)) return 'audio/mpeg';
    if (m[0] === 0x49 && m[1] === 0x44 && m[2] === 0x33) return 'audio/mpeg';
    if (m[0] === 0x52 && m[1] === 0x49 && m[2] === 0x46 && m[3] === 0x46 &&
        m[8] === 0x57 && m[9] === 0x41 && m[10] === 0x56 && m[11] === 0x45) return 'audio/wav';
    if (m[0] === 0x4F && m[1] === 0x67 && m[2] === 0x67 && m[3] === 0x53) return 'audio/ogg';
    if (m[0] === 0x1A && m[1] === 0x45 && m[2] === 0xDF && m[3] === 0xA3) return 'audio/webm';
    if (m[4] === 0x66 && m[5] === 0x74 && m[6] === 0x79 && m[7] === 0x70) {
      const brand = String.fromCharCode(m[8], m[9], m[10], m[11]);
      if (brand === 'M4A ' || brand === 'isom' || brand === 'mp42' || brand === 'M4B ' || brand === 'M4P ') return 'audio/mp4';
      return 'audio/mp4';
    }
    if (t && ASSET_LIMITS.audio.allowed.indexOf(t) !== -1) return t;
    return null;
  }

  function sanitizeAssetName(name) {
    let n = String(name == null ? 'asset' : name);
    const slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf(String.fromCharCode(92)));
    if (slash >= 0) n = n.slice(slash + 1);
    const UNSAFE = [92, 47, 58, 42, 63, 34, 60, 62, 124];
    const out = [];
    for (let i = 0; i < n.length; i++) {
      const c = n.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) { out.push('_'); continue; }
      if (c < 32 || c === 127) continue;
      if (UNSAFE.indexOf(c) !== -1) continue;
      out.push(n[i]);
    }
    n = out.join('');
    if (!n) n = 'asset';
    return n.slice(0, 100);
  }

  function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('lectura fallida'));
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const idx = dataUrl.indexOf(',');
    if (idx === -1) throw new Error('dataUrl invalido');
    const meta = dataUrl.slice(0, idx);
    const b64 = dataUrl.slice(idx + 1);
    const mm = meta.match(/data:([^;]+)/);
    const mime = mm ? mm[1] : 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function isAssetRef(v) {
    return typeof v === 'string' && v.indexOf(ASSET_REF_PREFIX) === 0;
  }

  function assetIdFromRef(v) {
    return v.slice(ASSET_REF_PREFIX.length);
  }

  async function sanitizeImageFile(file) {
    if (!file || !file.size) throw new Error('archivo vacio');
    if (file.size > ASSET_LIMITS.image.maxBytes)
      throw new Error('imagen demasiado grande (max ' + Math.round(ASSET_LIMITS.image.maxBytes / 1048576) + 'MB)');
    const buf = await file.arrayBuffer();
    const magic = new Uint8Array(buf.slice(0, 12));
    const mime = detectImageMime(magic);
    if (!mime || ASSET_LIMITS.image.allowed.indexOf(mime) === -1)
      throw new Error('formato de imagen no permitido');
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([buf], { type: mime }));
    } catch (e) {
      throw new Error('imagen corrupta o no decodificable');
    }
    let w = bitmap.width, h = bitmap.height;
    if (!w || !h) { try { bitmap.close(); } catch (_) {} throw new Error('dimensiones invalidas'); }
    if (w > ASSET_LIMITS.image.maxW || h > ASSET_LIMITS.image.maxH) {
      const scale = Math.min(ASSET_LIMITS.image.maxW / w, ASSET_LIMITS.image.maxH / h, 1);
      w = Math.max(1, Math.floor(w * scale));
      h = Math.max(1, Math.floor(h * scale));
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    try { bitmap.close(); } catch (_) {}
    const blob = await new Promise((res, rej) =>
      canvas.toBlob(b => b ? res(b) : rej(new Error('fallo al re-codificar imagen')), 'image/png'));
    if (!blob) throw new Error('fallo al re-codificar imagen');
    return blob;
  }

  function audioBufferToWav(audioBuffer) {
    const numCh = 1;
    const srcRate = audioBuffer.sampleRate || 44100;
    const targetRate = Math.min(srcRate, 44100);
    const ratio = srcRate / targetRate;
    const length = Math.max(1, Math.floor(audioBuffer.length / ratio));
    const chans = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) chans.push(audioBuffer.getChannelData(c));
    const samples = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const srcIdx = Math.min(audioBuffer.length - 1, Math.floor(i * ratio));
      let s = 0;
      for (let c = 0; c < chans.length; c++) s += chans[c][srcIdx];
      samples[i] = chans.length > 1 ? s / chans.length : s;
    }
    for (let i = 0; i < samples.length; i++) {
      if (samples[i] > 1) samples[i] = 1;
      else if (samples[i] < -1) samples[i] = -1;
    }
    const dataSize = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let o = 0;
    const ws = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i)); };
    const u32 = (v) => { view.setUint32(o, v, true); o += 4; };
    const u16 = (v) => { view.setUint16(o, v, true); o += 2; };
    ws('RIFF'); u32(36 + dataSize); ws('WAVE');
    ws('fmt '); u32(16); u16(1); u16(numCh); u32(targetRate); u32(targetRate * 2); u16(2); u16(16);
    ws('data'); u32(dataSize);
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i] < 0 ? samples[i] * 0x8000 : samples[i] * 0x7FFF;
      view.setInt16(o, s, true); o += 2;
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  async function sanitizeAudioFile(file) {
    if (!file || !file.size) throw new Error('archivo vacio');
    if (file.size > ASSET_LIMITS.audio.maxBytes)
      throw new Error('audio demasiado grande (max ' + Math.round(ASSET_LIMITS.audio.maxBytes / 1048576) + 'MB)');
    const buf = await file.arrayBuffer();
    const magic = new Uint8Array(buf.slice(0, 16));
    const mime = detectAudioMime(magic, file.type);
    if (!mime || ASSET_LIMITS.audio.allowed.indexOf(mime) === -1)
      throw new Error('formato de audio no permitido');
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) throw new Error('audio no soportado por el navegador');
    let audioBuf;
    try {
      audioBuf = await new AC().decodeAudioData(buf.slice(0));
    } catch (e) {
      throw new Error('audio corrupto o no decodificable');
    }
    if (!audioBuf || !audioBuf.length) throw new Error('audio sin datos');
    if (audioBuf.duration > ASSET_LIMITS.audio.maxDuration)
      throw new Error('audio demasiado largo (max ' + ASSET_LIMITS.audio.maxDuration + 's)');
    return audioBufferToWav(audioBuf);
  }

  global.SillyAssetSanitizer = {
    ASSET_REF_PREFIX,
    ASSET_LIMITS,
    isAssetRef,
    assetIdFromRef,
    sanitizeAssetName,
    blobToDataUrl,
    dataUrlToBlob,
    sanitizeImageFile,
    sanitizeAudioFile
  };
})(window);
