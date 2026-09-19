/**
 * scratch-drawing.js — Sistema de dibujo, formas y pintura en el Infinity Canvas
 *
 * Permite a los desarrolladores crear herramientas de pintura avanzadas y graficación
 * vectorial usando la arquitectura de bloques de Scratch para control total de la lógica.
 *
 * Características:
 *   - Pintura vectorial con trazado de puntos y spline cúbico
 *   - Sistema de capas con fusión/transparencia y reordenamiento
 *   - Formas geométricas (rectángulo, círculo, elipse, polígono, triángulo, estrella, rombo)
 *   - Transformaciones (rotar, escalar, mover, reflejar) por selección
 *   - Pinceles con gradiente, opacidad y efectos
 *   - Trazado de ecuaciones paramétricas, lissajous y ondas
 *   - Editor de texto con fuentes y alineación
 *   - Zoom y paneo infinito continuo
 *   - Cuadrícula con ajuste (snap) configurable
 *   - Selección, copiar, pegar y duplicar
 *   - Gestos multi-touch (zoom/paneo) en dispositivos móviles
 *   - Exportación PNG/SVG con espera real + guardado de estado JSON
 *
 * API:
 *   Drawing.init(canvasElement, opts) -> PaintingSystem
 *   PaintingSystem.clear(color)
 *   PaintingSystem.beginPath(type, opts)
 *   PaintingSystem.moveTo(x, y)
 *   PaintingSystem.lineTo(x, y)
 *   PaintingSystem.quadraticCurveTo(cp1x, cp1y, cp2x, cp2y, x, y)
 *   PaintingSystem.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y)
 *   PaintingSystem.arcTo(x, y, radius)
 *   PaintingSystem.circle(x, y, radius, opts)
 *   PaintingSystem.rect(x, y, w, h, opts)
 *   PaintingSystem.polygon(points, opts)
 *   PaintingSystem.gradient(x0, y0, x1, y1, stops)
 *   PaintingSystem.pattern(url, opts)
 *   PaintingSystem.fill(color | gradient | pattern)
 *   PaintingSystem.stroke(color, width)
 *   PaintingSystem.setText(text, opts)
 *   PaintingSystem.setTransform(transform)
 *   PaintingSystem.getTransform()
 *   PaintingSystem.saveState()
 *   PaintingSystem.restoreState(step)
 *   PaintingSystem.undo() / redo()
 *   PaintingSystem.exportPNG(dpi) -> Promise<dataURL>
 *   PaintingSystem.exportSVG() -> Promise<svgString>
 *   PaintingSystem.importSVG(svg)
 *   PaintingSystem.exportJSON()
 *   PaintingSystem.importJSON(data)
 *   PaintingSystem.updateOptions(options)
 *   PaintingSystem.getActiveLayer() / setActiveLayer(index)
 *   PaintingSystem.addLayer / removeLayer / mergeLayer / duplicateLayer / reorderLayer / getLayers
 *   Drawing.isAvailable() -> boolean
 */

(function (global) {
  'use strict';

  const ScratchBlocks = global.ScratchBlocks || (typeof require !== 'undefined' ? require('./scratch-blocks.js').ScratchBlocks : null);
  const ScratchRuntime = global.ScratchRuntime || (typeof require !== 'undefined' ? require('./scratch-runtime.js').ScratchRuntime : null);

  /* ===================== Utilidades ===================== */

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  function uid(prefix) {
    return (prefix || '') + Math.random().toString(36).substr(2, 9);
  }

  function deepClone(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    return JSON.parse(JSON.stringify(obj));
  }

  /* ===================== Sistema de pintura ===================== */

  class PaintingSystem {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.id = uid('ps_');

      this.opts = Object.assign({
        defaultStrokeWidth: 3,
        defaultStrokeStyle: '#0a0a0a',
        defaultFillStyle: 'rgba(0,0,0,0)',
        antialias: true,
        pixelated: false,
        highQuality: true,
        enableLayers: true,
        enableSelection: true,
        enableTransform: true,
        enableGrid: true,
        gridSize: 24,
        snapToGrid: false,
        maxHistory: 80,
        background: '#ffffff'
      }, opts);

      // Estado global
      this.state = {
        history: [],
        historyIndex: -1,
        currentLayer: 0,
        isDrawing: false,
        zoom: 1,
        panX: 0,
        panY: 0,
        selection: null,
        copiedShapes: null,
        gridVisible: this.opts.enableGrid,
        snapToGrid: this.opts.snapToGrid,
        tool: 'pen',
        toolOptions: {
          stroke: this.opts.defaultStrokeStyle,
          fill: this.opts.defaultFillStyle,
          strokeWidth: this.opts.defaultStrokeWidth,
          shape: 'rect',
          fontSize: 28,
          fontFamily: 'Arial, sans-serif',
          text: 'Texto'
        }
      };

      // Capas: cada una contiene una lista de comandos de dibujo (shapes)
      this.layers = [];

      // Dibujado actual (shape en construcción)
      this.pathData = null;

      // Recursos compartidos
      this.brushes = new Map();
      this.gradients = new Map();
      this.patterns = new Map();
      this.palettes = new Map();

      this._setupCanvas();
      this._setupEventHandlers();

      if (this.opts.enableLayers) {
        this._createInitialLayers();
      } else {
        this.layers = [this._createLayer('Fondo', { visible: true })];
      }

      // Pintar fondo inicial y guardar estado
      this._paintBackground();
      this.saveState();
    }

    /* ---------- Configuración ---------- */

    _setupCanvas() {
      const ctx = this.ctx;
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();

      this.dpr = dpr;
      this.cssWidth = Math.max(1, Math.round(rect.width));
      this.cssHeight = Math.max(1, Math.round(rect.height));
      this.canvas.width = Math.round(this.cssWidth * dpr);
      this.canvas.height = Math.round(this.cssHeight * dpr);

      if (this.opts.antialias) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = this.opts.highQuality ? 'high' : 'medium';
      } else {
        ctx.imageSmoothingEnabled = false;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 10;
    }

    _setupEventHandlers() {
      const canvas = this.canvas;

      canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
      canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
      window.addEventListener('mouseup', (e) => this._onMouseUp(e));
      canvas.addEventListener('mouseout', (e) => this._onMouseOut(e));
      canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

      canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
      canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
      canvas.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });

      document.addEventListener('keydown', (e) => this._onKeyDown(e));
    }

    _createInitialLayers() {
      this.layers = [
        this._createLayer('Fondo', { visible: true, opacity: 1, blendMode: 'source-over', locked: false }),
        this._createLayer('Dibujo', { visible: true, opacity: 1, blendMode: 'source-over', locked: false })
      ];
      this.state.currentLayer = 1;
    }

    _createLayer(name, options = {}) {
      return Object.assign({
        id: uid('ly_'),
        name: name,
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        shapes: []
      }, options);
    }

    /* ---------- Conversión de coordenadas ---------- */

    _screenToWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = (clientX - rect.left);
      const sy = (clientY - rect.top);
      const x = (sx - this.state.panX) / this.state.zoom;
      const y = (sy - this.state.panY) / this.state.zoom;
      return { x, y };
    }

    _getMousePoint(e) {
      const p = this._screenToWorld(e.clientX, e.clientY);
      return this._applySnap(p);
    }

    _getTouchPoint(touch) {
      const p = this._screenToWorld(touch.clientX, touch.clientY);
      return this._applySnap(p);
    }

    _applySnap(p) {
      if (this.state.snapToGrid) {
        const g = this.opts.gridSize;
        return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
      }
      return p;
    }

    /* ---------- Render principal ---------- */

    _paintBackground() {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

      // Fondo (en coordenadas de pantalla, no afectado por pan/zoom del contenido)
      ctx.fillStyle = this.opts.background;
      ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    }

    redraw() {
      this._paintBackground();

      const ctx = this.ctx;
      const z = this.state.zoom;

      // Aplicar transformación de mundo (pan + zoom) en píxeles físicos
      ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.state.panX * this.dpr, this.state.panY * this.dpr);

      for (const layer of this.layers) {
        if (!layer.visible || layer.locked && layer._skipRenderWhenLocked) continue;
        if (!layer.visible) continue;
        ctx.save();
        if (layer.opacity < 1) ctx.globalAlpha = layer.opacity;
        if (layer.blendMode && layer.blendMode !== 'source-over') {
          ctx.globalCompositeOperation = layer.blendMode;
        }
        for (const shape of layer.shapes) {
          this._renderShape(ctx, shape);
        }
        ctx.restore();
      }

      // Dibujo en vivo (shape en construcción)
      if (this.pathData && this.state.isDrawing) {
        ctx.save();
        this._renderShape(ctx, this.pathData);
        ctx.restore();
      }

      if (this.state.tool === 'select' && this.state.selection) {
        this._drawSelectionOverlay(ctx);
      }

      if (this.state.gridVisible) {
        this._drawGrid(ctx);
      }

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _drawGrid(ctx) {
      const g = this.opts.gridSize;
      const z = this.state.zoom;
      // Calcular límites visibles en coordenadas de mundo
      const left = -this.state.panX / z;
      const top = -this.state.panY / z;
      const right = (this.cssWidth - this.state.panX) / z;
      const bottom = (this.cssHeight - this.state.panY) / z;

      ctx.save();
      ctx.lineWidth = 1 / z;
      ctx.strokeStyle = 'rgba(10,10,10,0.08)';
      ctx.beginPath();
      for (let x = Math.floor(left / g) * g; x < right; x += g) {
        ctx.moveTo(x, top); ctx.lineTo(x, bottom);
      }
      for (let y = Math.floor(top / g) * g; y < bottom; y += g) {
        ctx.moveTo(left, y); ctx.lineTo(right, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    _drawSelectionOverlay(ctx) {
      const sel = this.state.selection;
      const b = sel.bounds;
      if (!b) return;
      ctx.save();
      ctx.lineWidth = 1.5 / this.state.zoom;
      ctx.strokeStyle = '#FF5E3A';
      ctx.setLineDash([6 / this.state.zoom, 4 / this.state.zoom]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      // Asas de redimensionado
      const handles = this._selectionHandles(b);
      ctx.fillStyle = '#FF5E3A';
      for (const h of handles) {
        ctx.fillRect(h.x - 4 / this.state.zoom, h.y - 4 / this.state.zoom, 8 / this.state.zoom, 8 / this.state.zoom);
      }
      ctx.restore();
    }

    _selectionHandles(b) {
      const s = 0;
      return [
        { x: b.x, y: b.y, c: 'nw' },
        { x: b.x + b.w / 2, y: b.y, c: 'n' },
        { x: b.x + b.w, y: b.y, c: 'ne' },
        { x: b.x + b.w, y: b.y + b.h / 2, c: 'e' },
        { x: b.x + b.w, y: b.y + b.h, c: 'se' },
        { x: b.x + b.w / 2, y: b.y + b.h, c: 's' },
        { x: b.x, y: b.y + b.h, c: 'sw' },
        { x: b.x, y: b.y + b.h / 2, c: 'w' }
      ];
    }

    /* ---------- Construcción de shapes ---------- */

    _defaultShape(type, opts) {
      const t = this.state.toolOptions;
      return {
        id: uid('sh_'),
        type,
        points: [],
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        options: Object.assign({
          stroke: t.stroke,
          fill: t.fill,
          strokeWidth: t.strokeWidth,
          lineCap: 'round',
          lineJoin: 'round',
          tension: 0.5,
          font: `${t.fontSize}px ${t.fontFamily}`
        }, opts || {})
      };
    }

    beginPath(type = 'free', opts = {}) {
      const shape = this._defaultShape(type, opts);
      if (type === 'text') {
        shape.text = (opts.text != null ? opts.text : this.state.toolOptions.text) || 'Texto';
      }
      if (type === 'shape') {
        shape.shape = opts.shape || this.state.toolOptions.shape || 'rect';
      }
      this.pathData = shape;
      this.state.isDrawing = true;
      return shape;
    }

    _commitShape(shape) {
      const layer = this.layers[this.state.currentLayer];
      if (!layer || layer.locked) {
        // si la capa está bloqueada, usar la primera visible no bloqueada
        const alt = this.layers.find(l => l.visible && !l.locked);
        if (alt) {
          this.state.currentLayer = this.layers.indexOf(alt);
          layer = alt;
        } else {
          return;
        }
      }
      shape.bounds = this._computeBounds(shape);
      layer.shapes.push(shape);
      this.pathData = null;
      this.state.isDrawing = false;
      this.saveState();
      this.redraw();
    }

    moveTo(x, y) {
      if (!this.pathData) this.beginPath('free');
      this.pathData.points[0] = { x, y, t: Date.now() };
      this.redraw();
    }

    lineTo(x, y) {
      if (!this.pathData) return;
      this.pathData.points.push({ x, y, t: Date.now() });
      this.redraw();
    }

    quadraticCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
      if (!this.pathData) this.beginPath('curve');
      this.pathData.points.push(
        { x: cp1x, y: cp1y, t: Date.now() },
        { x: cp2x, y: cp2y, t: Date.now() },
        { x, y, t: Date.now() }
      );
      this.redraw();
    }

    bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
      if (!this.pathData) this.beginPath('curve');
      this.pathData.points.push(
        { x: cp1x, y: cp1y, t: Date.now() },
        { x: cp2x, y: cp2y, t: Date.now() },
        { x, y, t: Date.now() }
      );
      this.redraw();
    }

    arcTo(x, y, radius) {
      const last = this.pathData && this.pathData.points[this.pathData.points.length - 1];
      const cx = last ? (last.x + x) / 2 : x;
      const cy = last ? (last.y + y) / 2 : y;
      this.circle(cx, cy, radius, {});
    }

    circle(x, y, radius, opts = {}) {
      const shape = this.beginPath('circle', opts);
      shape.points = [{ x, y, t: Date.now() }, { x: x + radius, y, t: Date.now() }];
      this._commitShape(shape);
    }

    ellipse(x, y, rx, ry, opts = {}) {
      const shape = this.beginPath('ellipse', opts);
      shape.points = [{ x, y, t: Date.now() }, { x: x + rx, y: y + ry, t: Date.now() }];
      this._commitShape(shape);
    }

    rect(x, y, width, height, opts = {}) {
      const shape = this.beginPath('shape', Object.assign({ shape: 'rect' }, opts));
      shape.points = [
        { x, y, t: Date.now() },
        { x: x + width, y, t: Date.now() },
        { x: x + width, y: y + height, t: Date.now() },
        { x, y: y + height, t: Date.now() }
      ];
      this._commitShape(shape);
    }

    roundRect(x, y, width, height, radius, opts = {}) {
      const shape = this.beginPath('shape', Object.assign({ shape: 'round_rect', radius: radius || 16 }, opts));
      shape.points = [
        { x, y, t: Date.now() },
        { x: x + width, y, t: Date.now() },
        { x: x + width, y: y + height, t: Date.now() },
        { x, y: y + height, t: Date.now() }
      ];
      this._commitShape(shape);
    }

    polygon(points, opts = {}) {
      const shape = this.beginPath('polygon', opts);
      shape.points = points.map(p => ({ x: p.x, y: p.y, t: Date.now() }));
      this._commitShape(shape);
    }

    triangle(x1, y1, x2, y2, x3, y3, opts = {}) {
      this.polygon([{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }], opts);
    }

    star(cx, cy, outerR, innerR, pointsCount, opts = {}) {
      const shape = this.beginPath('shape', Object.assign({ shape: 'star', points: pointsCount || 5 }, opts));
      shape.points = [
        { x: cx, y: cy, t: Date.now() },
        { x: cx + outerR, y: cy, t: Date.now() },
        { x: cx + (innerR || outerR / 2), y: cy, t: Date.now() }
      ];
      this._commitShape(shape);
    }

    diamond(cx, cy, rx, ry, opts = {}) {
      this.polygon([
        { x: cx, y: cy - ry }, { x: cx + rx, y: cy },
        { x: cx, y: cy + ry }, { x: cx - rx, y: cy }
      ], opts);
    }

    setText(text, opts = {}) {
      if (this.pathData && this.pathData.type === 'text') {
        this.pathData.text = text;
        Object.assign(this.pathData.options, opts);
        this.redraw();
      } else {
        const p = this._lastPoint || { x: 100, y: 100 };
        const shape = this.beginPath('text', opts);
        shape.text = text;
        shape.points = [{ x: p.x, y: p.y, t: Date.now() }];
        this._commitShape(shape);
      }
    }

    /* ---------- Gradientes y patrones ---------- */

    gradient(x0, y0, x1, y1, stops, name = 'current') {
      const grad = this.ctx.createLinearGradient(x0, y0, x1, y1);
      (stops || []).forEach(stop => grad.addColorStop(clamp(stop.offset, 0, 1), stop.color));
      this.gradients.set(name, grad);
      return grad;
    }

    radialGradient(x0, y0, r0, x1, y1, r1, stops, name = 'current') {
      const grad = this.ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
      (stops || []).forEach(stop => grad.addColorStop(clamp(stop.offset, 0, 1), stop.color));
      this.gradients.set(name, grad);
      return grad;
    }

    pattern(url, opts = {}, name = 'current') {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const pat = this.ctx.createPattern(img, opts.repeat || 'repeat');
          this.patterns.set(name, pat);
          resolve(pat);
        };
        img.onerror = reject;
        img.src = url;
      });
    }

    fill(fillStyle = null) {
      const target = this.pathData || (this.state.selection && this._selectedShape());
      if (!target) return;
      if (fillStyle === 'gradient' || fillStyle === 'pattern') {
        target.options.fill = this.gradients.get('current') || this.patterns.get('current') || this.opts.defaultFillStyle;
      } else if (fillStyle) {
        target.options.fill = fillStyle;
      }
      if (this.pathData) {
        this._commitShape(this.pathData);
      } else {
        this.saveState();
        this.redraw();
      }
    }

    stroke(strokeStyle = null, width = null) {
      const target = this.pathData || (this.state.selection && this._selectedShape());
      if (!target) return;
      if (strokeStyle) target.options.stroke = strokeStyle;
      if (width != null) target.options.strokeWidth = width;
      if (this.pathData) {
        this._commitShape(this.pathData);
      } else {
        this.saveState();
        this.redraw();
      }
    }

    /* ---------- Render de un shape ---------- */

    _renderShape(ctx, shape) {
      if (!shape || !shape.type) return;
      const o = shape.options || {};
      ctx.save();

      // Transformación de la forma
      const tf = shape.transform || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      ctx.transform(tf.a, tf.b, tf.c, tf.d, tf.e, tf.f);

      ctx.lineCap = o.lineCap || 'round';
      ctx.lineJoin = o.lineJoin || 'round';
      if (o.strokeWidth) ctx.lineWidth = o.strokeWidth;
      if (o.stroke) ctx.strokeStyle = o.stroke;
      if (o.fill) ctx.fillStyle = o.fill;
      if (this.opts.antialias) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = this.opts.highQuality ? 'high' : 'medium';
      }

      switch (shape.type) {
        case 'free': this._drawFree(ctx, shape); break;
        case 'line': this._drawLine(ctx, shape); break;
        case 'curve': this._drawCurve(ctx, shape); break;
        case 'circle': this._drawCircle(ctx, shape); break;
        case 'ellipse': this._drawEllipse(ctx, shape); break;
        case 'polygon': this._drawPolygon(ctx, shape); break;
        case 'shape': this._drawShape(ctx, shape); break;
        case 'text': this._drawText(ctx, shape); break;
        case 'lissajous': this._drawParametric(ctx, shape, 'lissajous'); break;
        case 'wave': this._drawParametric(ctx, shape, 'wave'); break;
        default: this._drawFree(ctx, shape);
      }
      ctx.restore();
    }

    _buildPath(ctx, shape) {
      const pts = shape.points;
      if (!pts || pts.length < 1) return false;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      return true;
    }

    _drawFree(ctx, shape) {
      const pts = shape.points;
      if (!pts || pts.length < 2) return;
      if (!this._buildPath(ctx, shape)) return;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (shape.options.tension && i > 1) {
          const prev = pts[i - 1];
          const prevPrev = pts[i - 2];
          ctx.quadraticCurveTo(prevPrev.x, prevPrev.y, prev.x, prev.y);
        }
        ctx.lineTo(p.x, p.y);
      }
      if (shape.options.fill && shape.options.fill !== 'rgba(0,0,0,0)') ctx.fill();
      ctx.stroke();
    }

    _drawLine(ctx, shape) {
      const pts = shape.points;
      if (!pts || pts.length < 2) return;
      if (!this._buildPath(ctx, shape)) return;
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    _drawCurve(ctx, shape) {
      const pts = shape.points;
      if (!pts || pts.length < 2) return;
      if (!this._buildPath(ctx, shape)) return;
      for (let i = 1; i + 2 < pts.length; i += 3) {
        ctx.bezierCurveTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, pts[i + 2].x, pts[i + 2].y);
      }
      if (shape.options.fill && shape.options.fill !== 'rgba(0,0,0,0)') ctx.fill();
      ctx.stroke();
    }

    _drawCircle(ctx, shape) {
      const pts = shape.points;
      if (!pts || pts.length < 2) return;
      const c = pts[0];
      const rx = Math.abs(pts[1].x - c.x);
      const ry = Math.abs(pts[1].y - c.y);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
      if (shape.options.fill && shape.options.fill !== 'rgba(0,0,0,0)') ctx.fill();
      ctx.stroke();
    }

    _drawEllipse(ctx, shape) {
      const pts = shape.points;
      if (!pts || pts.length < 2) return;
      const c = pts[0];
      const rx = Math.abs(pts[1].x - c.x);
      const ry = Math.abs(pts[1].y - c.y);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
      if (shape.options.fill && shape.options.fill !== 'rgba(0,0,0,0)') ctx.fill();
      ctx.stroke();
    }

    _drawPolygon(ctx, shape) {
      const pts = shape.points;
      if (!pts || pts.length < 2) return;
      if (!this._buildPath(ctx, shape)) return;
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      if (shape.options.fill && shape.options.fill !== 'rgba(0,0,0,0)') ctx.fill();
      ctx.stroke();
    }

    _drawShape(ctx, shape) {
      const pts = shape.points;
      if (!shape.shape || !pts || pts.length < 1) return;
      const o = shape.options || {};
      ctx.beginPath();
      switch (shape.shape) {
        case 'rect': {
          if (pts.length < 2) return;
          const x = pts[0].x, y = pts[0].y;
          const w = pts[1].x - x, h = pts[1].y - y;
          ctx.rect(x, y, w, h);
          break;
        }
        case 'round_rect': {
          if (pts.length < 2) return;
          const x = pts[0].x, y = pts[0].y;
          const w = pts[1].x - x, h = pts[1].y - y;
          const r = Math.min(o.radius || 16, Math.abs(w) / 2, Math.abs(h) / 2);
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + w, y, x + w, y + h, r);
          ctx.arcTo(x + w, y + h, x, y + h, r);
          ctx.arcTo(x, y + h, x, y, r);
          ctx.arcTo(x, y, x + w, y, r);
          ctx.closePath();
          break;
        }
        case 'ellipse': {
          if (pts.length < 2) return;
          const c = pts[0];
          ctx.ellipse(c.x, c.y, Math.max(0.1, Math.abs(pts[1].x - c.x)), Math.max(0.1, Math.abs(pts[1].y - c.y)), 0, 0, Math.PI * 2);
          break;
        }
        case 'triangle': {
          if (pts.length < 3) return;
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.lineTo(pts[2].x, pts[2].y);
          ctx.closePath();
          break;
        }
        case 'diamond': {
          if (pts.length < 2) return;
          const c = pts[0];
          const rx = Math.abs(pts[1].x - c.x), ry = Math.abs(pts[1].y - c.y);
          ctx.moveTo(c.x, c.y - ry);
          ctx.lineTo(c.x + rx, c.y);
          ctx.lineTo(c.x, c.y + ry);
          ctx.lineTo(c.x - rx, c.y);
          ctx.closePath();
          break;
        }
        case 'star': {
          const c = pts[0];
          const outerR = pts[1] ? Math.hypot(pts[1].x - c.x, pts[1].y - c.y) : 50;
          const innerR = pts[2] ? Math.hypot(pts[2].x - c.x, pts[2].y - c.y) : outerR / 2;
          const n = o.points || 5;
          for (let i = 0; i <= n * 2; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const a = (Math.PI * i) / n - Math.PI / 2;
            const x = c.x + r * Math.cos(a);
            const y = c.y + r * Math.sin(a);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          break;
        }
        default:
          if (pts.length >= 2) {
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(pts[1].x, pts[1].y);
          }
      }
      if (shape.options.fill && shape.options.fill !== 'rgba(0,0,0,0)') ctx.fill();
      ctx.stroke();
    }

    _drawText(ctx, shape) {
      if (!shape.text) return;
      const o = shape.options || {};
      const p = shape.points[0] || { x: 0, y: 0 };
      ctx.font = o.font || '28px Arial, sans-serif';
      ctx.fillStyle = o.stroke || this.opts.defaultStrokeStyle;
      ctx.textAlign = o.textAlign || 'start';
      ctx.textBaseline = o.textBaseline || 'top';
      if (o.fill && o.fill !== 'rgba(0,0,0,0)') {
        ctx.fillStyle = o.fill;
        ctx.fillText(shape.text, p.x, p.y);
      } else {
        ctx.fillText(shape.text, p.x, p.y);
      }
    }

    _drawParametric(ctx, shape, kind) {
      const o = shape.options || {};
      const c = shape.points[0] || { x: 0, y: 0 };
      const scale = o.scale || 100;
      const a = o.a || 3, b = o.b || 2, delta = o.delta || Math.PI / 2;
      const steps = o.steps || 200;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        let x, y;
        if (kind === 'lissajous') {
          x = c.x + scale * Math.sin(a * t + delta);
          y = c.y + scale * Math.sin(b * t);
        } else {
          x = c.x + scale * t / (Math.PI) * 2 - scale;
          y = c.y - scale * Math.sin(a * t + delta);
        }
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    lissajous(cx, cy, opts = {}) {
      const shape = this.beginPath('lissajous', opts);
      shape.points = [{ x: cx, y: cy, t: Date.now() }];
      this._commitShape(shape);
    }

    wave(cx, cy, opts = {}) {
      const shape = this.beginPath('wave', opts);
      shape.points = [{ x: cx, y: cy, t: Date.now() }];
      this._commitShape(shape);
    }

    /* ---------- Bounds ---------- */

    _computeBounds(shape) {
      const pts = shape.points || [];
      if (shape.type === 'text') {
        const p = pts[0] || { x: 0, y: 0 };
        const fs = parseInt((shape.options.font || '28px').replace('px', ''), 10) || 28;
        const w = (shape.text || '').length * fs * 0.55;
        return { x: p.x, y: p.y, w: w || 50, h: fs };
      }
      if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    /* ---------- Eventos de puntero ---------- */

    _onMouseDown(e) {
      e.preventDefault();
      const p = this._getMousePoint(e);
      this._lastPoint = p;

      if (this.state.tool === 'select') {
        const hit = this._hitTest(p.x, p.y);
        if (hit) {
          this.state.selection = { shapeId: hit.id, layerIndex: hit.layerIndex, bounds: this._computeBounds(hit) };
          this._dragStart = { x: p.x, y: p.y, mode: 'move', shape: hit };
        } else {
          this.state.selection = null;
        }
        this.redraw();
        return;
      }

      if (this.state.tool === 'pan') {
        this._panStart = { x: e.clientX, y: e.clientY, panX: this.state.panX, panY: this.state.panY };
        return;
      }

      // Herramientas de dibujo
      if (this.state.tool === 'text') {
        const shape = this.beginPath('text', { text: this.state.toolOptions.text });
        shape.points = [{ x: p.x, y: p.y, t: Date.now() }];
        this._commitShape(shape);
        return;
      }

      if (this.state.tool === 'shape') {
        const shape = this.beginPath('shape', { shape: this.state.toolOptions.shape });
        shape.points = [{ x: p.x, y: p.y, t: Date.now() }];
        this._shapeStart = { x: p.x, y: p.y };
        return;
      }

      if (this.state.tool === 'circle' || this.state.tool === 'ellipse') {
        const shape = this.beginPath(this.state.tool);
        shape.points = [{ x: p.x, y: p.y, t: Date.now() }, { x: p.x, y: p.y, t: Date.now() }];
        this._shapeStart = { x: p.x, y: p.y };
        return;
      }

      // Pluma / línea libre
      this.beginPath(this.state.tool === 'line' ? 'line' : 'free');
      this.pathData.points = [{ x: p.x, y: p.y, t: Date.now() }];
      this.redraw();
    }

    _onMouseMove(e) {
      const p = this._getMousePoint(e);
      this._lastPoint = p;

      if (this._panStart) {
        this.state.panX = this._panStart.panX + (e.clientX - this._panStart.x);
        this.state.panY = this._panStart.panY + (e.clientY - this._panStart.y);
        this.redraw();
        return;
      }

      if (this.state.tool === 'select' && this._dragStart && this.state.selection) {
        const dx = p.x - this._dragStart.x;
        const dy = p.y - this._dragStart.y;
        const sh = this._dragStart.shape;
        if (this._dragStart.mode === 'move') {
          for (const pt of sh.points) { pt.x += dx; pt.y += dy; }
          if (sh.type === 'text') { sh.points[0].x += dx; sh.points[0].y += dy; }
          this._dragStart.x = p.x; this._dragStart.y = p.y;
          this.state.selection.bounds = this._computeBounds(sh);
        }
        this.redraw();
        return;
      }

      if (this.state.isDrawing && this.pathData) {
        if (this.state.tool === 'shape' || this.state.tool === 'circle' || this.state.tool === 'ellipse') {
          const s = this._shapeStart;
          if (s) {
            this.pathData.points = [
              { x: s.x, y: s.y, t: Date.now() },
              { x: p.x, y: p.y, t: Date.now() }
            ];
          }
        } else {
          this.pathData.points.push({ x: p.x, y: p.y, t: Date.now() });
        }
        this.redraw();
      }
    }

    _onMouseUp(e) {
      if (this._panStart) { this._panStart = null; return; }
      if (this.state.tool === 'select') { this._dragStart = null; return; }

      if (this.state.isDrawing && this.pathData) {
        // Formas de un solo arrastre
        if ((this.state.tool === 'shape' || this.state.tool === 'circle' || this.state.tool === 'ellipse') && this.pathData.points.length < 2) {
          this.pathData = null;
          this.state.isDrawing = false;
          this.redraw();
          return;
        }
        this._commitShape(this.pathData);
      }
    }

    _onMouseOut(e) {
      if (this.state.isDrawing && this.pathData &&
          this.state.tool !== 'shape' && this.state.tool !== 'circle' && this.state.tool !== 'ellipse') {
        this._commitShape(this.pathData);
      }
      this._panStart = null;
      this._dragStart = null;
    }

    _onWheel(e) {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = clamp(this.state.zoom * factor, 0.1, 16);

      // Zoom centrado en el cursor
      this.state.panX = mx - (mx - this.state.panX) * (newZoom / this.state.zoom);
      this.state.panY = my - (my - this.state.panY) * (newZoom / this.state.zoom);
      this.state.zoom = newZoom;
      this.redraw();
    }

    /* ---------- Touch / multi-touch ---------- */

    _onTouchStart(e) {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this._onMouseDown({ preventDefault() {}, clientX: t.clientX, clientY: t.clientY });
        this._touchMode = 'draw';
      } else if (e.touches.length === 2) {
        this._touchMode = 'gesture';
        this._gestureStart = this._gestureState(e);
      }
    }

    _onTouchMove(e) {
      e.preventDefault();
      if (this._touchMode === 'gesture' && e.touches.length === 2) {
        const cur = this._gestureState(e);
        const rect = this.canvas.getBoundingClientRect();
        const mx = cur.cx - rect.left, my = cur.cy - rect.top;
        const newZoom = clamp(this.state.zoom * (cur.dist / this._gestureStart.dist), 0.1, 16);
        this.state.panX = mx - (mx - this.state.panX) * (newZoom / this.state.zoom);
        this.state.panY = my - (my - this.state.panY) * (newZoom / this.state.zoom);
        this.state.zoom = newZoom;
        this.state.panX += (cur.cx - this._gestureStart.cx);
        this.state.panY += (cur.cy - this._gestureStart.cy);
        this._gestureStart = cur;
        this.redraw();
      } else if (this._touchMode === 'draw' && e.touches.length === 1) {
        const t = e.touches[0];
        this._onMouseMove({ preventDefault() {}, clientX: t.clientX, clientY: t.clientY });
      }
    }

    _onTouchEnd(e) {
      e.preventDefault();
      if (this._touchMode === 'draw') {
        this._onMouseUp({ preventDefault() {} });
      }
      this._touchMode = null;
    }

    _gestureState(e) {
      const a = e.touches[0], b = e.touches[1];
      const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
      return {
        dist: Math.hypot(dx, dy) || 1,
        cx: (a.clientX + b.clientX) / 2,
        cy: (a.clientY + b.clientY) / 2
      };
    }

    /* ---------- Teclado ---------- */

    _onKeyDown(e) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const meta = e.ctrlKey || e.metaKey;
      switch (e.key) {
        case 'Escape':
          if (this.state.selection) { this.state.selection = null; this.redraw(); }
          break;
        case 'Delete':
        case 'Backspace':
          if (this.state.selection) { e.preventDefault(); this._deleteSelection(); }
          break;
        case 'c': case 'C':
          if (meta) { this._copySelection(); }
          break;
        case 'v': case 'V':
          if (meta) { this._pasteSelection(); }
          break;
        case 'd': case 'D':
          if (meta) { e.preventDefault(); this._duplicateSelection(); }
          break;
        case 'z': case 'Z':
          if (meta && e.shiftKey) this.redo();
          else if (meta) { e.preventDefault(); this.undo(); }
          break;
        case '=':
          if (meta) { this.state.zoom = clamp(this.state.zoom * 1.1, 0.1, 16); this.redraw(); }
          break;
        case '-':
          if (meta) { this.state.zoom = clamp(this.state.zoom * 0.9, 0.1, 16); this.redraw(); }
          break;
        case '0':
          if (meta) { this.state.zoom = 1; this.state.panX = 0; this.state.panY = 0; this.redraw(); }
          break;
      }
    }

    /* ---------- Hit testing y selección ---------- */

    _hitTest(x, y) {
      for (let li = this.layers.length - 1; li >= 0; li--) {
        const layer = this.layers[li];
        if (!layer.visible || layer.locked) continue;
        for (let i = layer.shapes.length - 1; i >= 0; i--) {
          const sh = layer.shapes[i];
          const b = this._computeBounds(sh);
          if (x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) {
            return { id: sh.id, layerIndex: li };
          }
        }
      }
      return null;
    }

    _selectedShape() {
      const sel = this.state.selection;
      if (!sel) return null;
      const layer = this.layers[sel.layerIndex];
      if (!layer) return null;
      return layer.shapes.find(s => s.id === sel.shapeId) || null;
    }

    _deleteSelection() {
      const sel = this.state.selection;
      if (!sel) return;
      const layer = this.layers[sel.layerIndex];
      if (layer && !layer.locked) {
        const idx = layer.shapes.findIndex(s => s.id === sel.shapeId);
        if (idx >= 0) {
          this.saveState();
          layer.shapes.splice(idx, 1);
          this.state.selection = null;
          this.redraw();
        }
      }
    }

    _copySelection() {
      const sh = this._selectedShape();
      if (sh) this.state.copiedShapes = deepClone(sh);
    }

    _pasteSelection() {
      if (!this.state.copiedShapes) return;
      const clone = deepClone(this.state.copiedShapes);
      clone.id = uid('sh_');
      for (const pt of clone.points) { pt.x += 20; pt.y += 20; }
      if (clone.type === 'text' && clone.points[0]) { clone.points[0].x += 20; clone.points[0].y += 20; }
      this.saveState();
      this.layers[this.state.currentLayer].shapes.push(clone);
      this.state.selection = { shapeId: clone.id, layerIndex: this.state.currentLayer, bounds: this._computeBounds(clone) };
      this.redraw();
    }

    _duplicateSelection() {
      this._copySelection();
      this._pasteSelection();
    }

    /* ---------- Transformaciones ---------- */

    setTransform(transform) {
      const sh = this._selectedShape();
      if (sh) {
        sh.transform = Object.assign({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, transform);
        this.saveState();
        this.redraw();
      } else {
        // Transformación de vista (zoom/pan)
        if (typeof transform.zoom === 'number') this.state.zoom = clamp(transform.zoom, 0.1, 16);
        if (typeof transform.panX === 'number') this.state.panX = transform.panX;
        if (typeof transform.panY === 'number') this.state.panY = transform.panY;
        this.redraw();
      }
    }

    getTransform() {
      const sh = this._selectedShape();
      if (sh) return Object.assign({}, sh.transform);
      return { zoom: this.state.zoom, panX: this.state.panX, panY: this.state.panY };
    }

    rotateSelection(deg) {
      const sh = this._selectedShape();
      if (!sh) return;
      const rad = deg * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const tf = sh.transform || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      sh.transform = {
        a: tf.a * cos - tf.b * sin,
        b: tf.a * sin + tf.b * cos,
        c: tf.c * cos - tf.d * sin,
        d: tf.c * sin + tf.d * cos,
        e: tf.e, f: tf.f
      };
      this.saveState();
      this.redraw();
    }

    scaleSelection(sx, sy) {
      const sh = this._selectedShape();
      if (!sh) return;
      const tf = sh.transform || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      sh.transform = { a: tf.a * sx, b: tf.b * sy, c: tf.c * sx, d: tf.d * sy, e: tf.e, f: tf.f };
      this.saveState();
      this.redraw();
    }

    flipSelection(axis) {
      const sh = this._selectedShape();
      if (!sh) return;
      const tf = sh.transform || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      if (axis === 'x') sh.transform = { a: -tf.a, b: -tf.b, c: tf.c, d: tf.d, e: tf.e, f: tf.f };
      else sh.transform = { a: tf.a, b: tf.b, c: -tf.c, d: -tf.d, e: tf.e, f: tf.f };
      this.saveState();
      this.redraw();
    }

    setTool(tool, options) {
      this.state.tool = tool;
      if (options) Object.assign(this.state.toolOptions, options);
      this.redraw();
    }

    setGridVisible(v) { this.state.gridVisible = !!v; this.redraw(); }
    setSnap(v) { this.state.snapToGrid = !!v; }
    zoomTo(z) { this.state.zoom = clamp(z, 0.1, 16); this.redraw(); }
    resetView() { this.state.zoom = 1; this.state.panX = 0; this.state.panY = 0; this.redraw(); }

    /* ---------- Historial ---------- */

    saveState() {
      const snapshot = {
        layers: deepClone(this.layers),
        currentLayer: this.state.currentLayer,
        zoom: this.state.zoom,
        panX: this.state.panX,
        panY: this.state.panY
      };
      // Truncar redo
      if (this.state.historyIndex < this.state.history.length - 1) {
        this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
      }
      this.state.history.push(snapshot);
      this.state.historyIndex = this.state.history.length - 1;
      if (this.state.history.length > this.opts.maxHistory) {
        this.state.history.shift();
        this.state.historyIndex--;
      }
    }

    restoreState(step = -1) {
      if (step === 0) return;
      const target = this.state.historyIndex + step;
      if (target < 0 || target >= this.state.history.length) return;
      const snap = this.state.history[target];
      this.state.historyIndex = target;
      this.layers = deepClone(snap.layers);
      this.state.currentLayer = snap.currentLayer;
      this.state.zoom = snap.zoom;
      this.state.panX = snap.panX;
      this.state.panY = snap.panY;
      this.state.selection = null;
      this.redraw();
    }

    undo() { this.restoreState(-1); }
    redo() { this.restoreState(1); }

    clear(color = '#ffffff') {
      this.saveState();
      this.opts.background = color || '#ffffff';
      for (const layer of this.layers) {
        if (!layer.locked) layer.shapes = [];
      }
      this.state.selection = null;
      this.redraw();
    }

    /* ---------- Capas ---------- */

    getActiveLayer() { return this.layers[this.state.currentLayer]; }

    setActiveLayer(index) {
      if (index >= 0 && index < this.layers.length) {
        this.state.currentLayer = index;
        this.redraw();
      }
    }

    addLayer(name, opts = {}) {
      const layer = this._createLayer(name || ('Capa ' + (this.layers.length + 1)), opts);
      this.layers.push(layer);
      this.state.currentLayer = this.layers.length - 1;
      this.saveState();
      this.redraw();
      return layer.id;
    }

    removeLayer(index) {
      if (this.layers.length <= 1) return;
      if (index >= 0 && index < this.layers.length) {
        this.saveState();
        this.layers.splice(index, 1);
        if (this.state.currentLayer >= this.layers.length) {
          this.state.currentLayer = this.layers.length - 1;
        }
        this.redraw();
      }
    }

    mergeLayer(index) {
      if (index >= 0 && index < this.layers.length && this.layers.length > 1) {
        this.saveState();
        const src = this.layers[index];
        const tgtIdx = Math.min(index + 1, this.layers.length - 1);
        const tgt = this.layers[tgtIdx];
        tgt.shapes = tgt.shapes.concat(src.shapes);
        this.layers.splice(index, 1);
        if (this.state.currentLayer === index) {
          this.state.currentLayer = Math.min(index, this.layers.length - 1);
        }
        this.redraw();
      }
    }

    duplicateLayer(index) {
      if (index >= 0 && index < this.layers.length) {
        this.saveState();
        const src = this.layers[index];
        const copy = deepClone(src);
        copy.id = uid('ly_');
        copy.name = src.name + ' (copia)';
        this.layers.splice(index + 1, 0, copy);
        this.state.currentLayer = index + 1;
        this.redraw();
        return copy.id;
      }
    }

    reorderLayer(from, to) {
      if (from === to) return;
      if (from >= 0 && from < this.layers.length && to >= 0 && to < this.layers.length) {
        this.saveState();
        const [layer] = this.layers.splice(from, 1);
        this.layers.splice(to, 0, layer);
        if (this.state.currentLayer === from) this.state.currentLayer = to;
        else if (from < to && this.state.currentLayer > from && this.state.currentLayer <= to) this.state.currentLayer--;
        else if (from > to && this.state.currentLayer >= to && this.state.currentLayer < from) this.state.currentLayer++;
        this.redraw();
      }
    }

    getLayers() {
      return this.layers.map((l, i) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        locked: l.locked,
        opacity: l.opacity,
        blendMode: l.blendMode,
        index: i,
        shapeCount: l.shapes.length
      }));
    }

    toggleLayerVisibility(index) {
      if (this.layers[index]) { this.layers[index].visible = !this.layers[index].visible; this.redraw(); }
    }

    toggleLayerLock(index) {
      if (this.layers[index]) { this.layers[index].locked = !this.layers[index].locked; this.redraw(); }
    }

    setLayerOpacity(index, o) {
      if (this.layers[index]) { this.layers[index].opacity = clamp(o, 0, 1); this.redraw(); }
    }

    setLayerBlendMode(index, mode) {
      if (this.layers[index]) { this.layers[index].blendMode = mode; this.redraw(); }
    }

    /* ---------- Exportación / Importación ---------- */

    async exportPNG(dpi = 72) {
      const scale = dpi / 96;
      const w = Math.round(this.cssWidth * scale);
      const h = Math.round(this.cssHeight * scale);
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d');
      octx.scale(scale, scale);

      // Fondo
      octx.fillStyle = this.opts.background;
      octx.fillRect(0, 0, this.cssWidth, this.cssHeight);

      // Dibujar en coordenadas de mundo
      octx.save();
      octx.setTransform(scale, 0, 0, scale, 0, 0);
      octx.scale(this.state.zoom, this.state.zoom);
      octx.translate(this.state.panX, this.state.panY);

      for (const layer of this.layers) {
        if (!layer.visible) continue;
        octx.save();
        if (layer.opacity < 1) octx.globalAlpha = layer.opacity;
        if (layer.blendMode && layer.blendMode !== 'source-over') octx.globalCompositeOperation = layer.blendMode;
        for (const shape of layer.shapes) {
          const prev = this.ctx;
          this.ctx = octx;
          this._renderShape(octx, shape);
          this.ctx = prev;
        }
        octx.restore();
      }
      octx.restore();
      return off.toDataURL('image/png');
    }

    async exportSVG() {
      const w = this.cssWidth, h = this.cssHeight;
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
      svg += `<rect width="${w}" height="${h}" fill="${this.opts.background}"/>`;
      const vb = `translate(${this.state.panX} ${this.state.panY}) scale(${this.state.zoom})`;
      for (const layer of this.layers) {
        if (!layer.visible) continue;
        svg += `<g opacity="${layer.opacity}"${layer.blendMode !== 'source-over' ? ` style="mix-blend-mode:${layer.blendMode}"` : ''} transform="${vb}">`;
        for (const shape of layer.shapes) {
          svg += this._shapeToSVG(shape);
        }
        svg += `</g>`;
      }
      svg += `</svg>`;
      return svg;
    }

    _shapeToSVG(shape) {
      const o = shape.options || {};
      const stroke = o.stroke || 'none';
      const fill = (o.fill && o.fill !== 'rgba(0,0,0,0)') ? o.fill : 'none';
      const sw = o.strokeWidth || 1;
      const tf = shape.transform || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      const tfAttr = (tf.a !== 1 || tf.b !== 0 || tf.c !== 0 || tf.d !== 1 || tf.e !== 0 || tf.f !== 0)
        ? ` transform="matrix(${tf.a} ${tf.b} ${tf.c} ${tf.d} ${tf.e} ${tf.f})"` : '';
      const pts = shape.points;

      if (shape.type === 'text') {
        const p = pts[0] || { x: 0, y: 0 };
        return `<text x="${p.x}" y="${p.y}" font-family="${(o.font || 'Arial').replace(/^\d+px /, '')}" font-size="${(o.font || '28px').match(/\d+/) || 28}" fill="${stroke}"${tfAttr}>${(shape.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
      }

      if (!pts || pts.length === 0) return '';

      if (shape.type === 'circle' || shape.type === 'ellipse') {
        const c = pts[0];
        const rx = Math.max(0.1, Math.abs((pts[1] || c).x - c.x));
        const ry = Math.max(0.1, Math.abs((pts[1] || c).y - c.y));
        return `<ellipse cx="${c.x}" cy="${c.y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${tfAttr}/>`;
      }

      if (shape.type === 'polygon' || shape.type === 'shape') {
        if (shape.shape === 'star') {
          const c = pts[0];
          const outerR = pts[1] ? Math.hypot(pts[1].x - c.x, pts[1].y - c.y) : 50;
          const innerR = pts[2] ? Math.hypot(pts[2].x - c.x, pts[2].y - c.y) : outerR / 2;
          const n = o.points || 5;
          let d = '';
          for (let i = 0; i <= n * 2; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const a = (Math.PI * i) / n - Math.PI / 2;
            const x = c.x + r * Math.cos(a), y = c.y + r * Math.sin(a);
            d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
          }
          return `<path d="${d}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${tfAttr}/>`;
        }
        if (shape.shape === 'rect') {
          const x = pts[0].x, y = pts[0].y, w = (pts[1] || pts[0]).x - x, h = (pts[1] || pts[0]).y - y;
          return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${tfAttr}/>`;
        }
        if (shape.shape === 'round_rect') {
          const x = pts[0].x, y = pts[0].y, w = (pts[1] || pts[0]).x - x, h = (pts[1] || pts[0]).y - y;
          const r = Math.min(o.radius || 16, Math.abs(w) / 2, Math.abs(h) / 2);
          const d = `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;
          return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${tfAttr}/>`;
        }
        // polígono genérico
        let d = '';
        for (let i = 0; i < pts.length; i++) {
          d += (i === 0 ? 'M' : 'L') + pts[i].x.toFixed(2) + ' ' + pts[i].y.toFixed(2) + ' ';
        }
        return `<path d="${d}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${tfAttr}/>`;
      }

      // paths libres / curvas / líneas
      let d = 'M' + pts[0].x.toFixed(2) + ' ' + pts[0].y.toFixed(2) + ' ';
      for (let i = 1; i < pts.length; i++) d += 'L' + pts[i].x.toFixed(2) + ' ' + pts[i].y.toFixed(2) + ' ';
      return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${tfAttr}/>`;
    }

    importSVG(svgString) {
      this.saveState();
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgString, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (!svg) return;

      // Limpiar y crear una capa nueva para el SVG importado
      this.clear(this.opts.background);
      const layer = this._createLayer('SVG importado', { visible: true });
      this.layers.push(layer);
      this.state.currentLayer = this.layers.length - 1;

      const shapes = [];
      svg.querySelectorAll('path, rect, ellipse, circle, polygon, polyline, line, text').forEach(el => {
        const sh = this._svgElementToShape(el);
        if (sh) shapes.push(sh);
      });
      layer.shapes = shapes;
      this.redraw();
    }

    _svgElementToShape(el) {
      const o = {};
      const stroke = el.getAttribute('stroke') || '#0a0a0a';
      const fill = el.getAttribute('fill') || 'none';
      o.stroke = stroke === 'none' ? 'rgba(0,0,0,0)' : stroke;
      o.fill = fill === 'none' ? 'rgba(0,0,0,0)' : fill;
      o.strokeWidth = parseFloat(el.getAttribute('stroke-width')) || 2;

      const base = { id: uid('sh_'), transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, options: o };

      switch (el.tagName.toLowerCase()) {
        case 'rect':
          return Object.assign(base, {
            type: 'shape', shape: 'rect',
            points: [
              { x: parseFloat(el.getAttribute('x')) || 0, y: parseFloat(el.getAttribute('y')) || 0 },
              { x: (parseFloat(el.getAttribute('x')) || 0) + (parseFloat(el.getAttribute('width')) || 0),
                y: (parseFloat(el.getAttribute('y')) || 0) + (parseFloat(el.getAttribute('height')) || 0) }
            ]
          });
        case 'ellipse':
        case 'circle': {
          const cx = parseFloat(el.getAttribute('cx')) || 0;
          const cy = parseFloat(el.getAttribute('cy')) || 0;
          const rx = parseFloat(el.getAttribute('rx')) || parseFloat(el.getAttribute('r')) || 10;
          const ry = parseFloat(el.getAttribute('ry')) || parseFloat(el.getAttribute('r')) || 10;
          return Object.assign(base, {
            type: 'ellipse',
            points: [{ x: cx, y: cy }, { x: cx + rx, y: cy + ry }]
          });
        }
        case 'text': {
          const sh = Object.assign(base, { type: 'text', text: el.textContent || '' });
          sh.points = [{ x: parseFloat(el.getAttribute('x')) || 0, y: parseFloat(el.getAttribute('y')) || 0 }];
          return sh;
        }
        default: {
          // path / polygon / polyline / line -> convertir a puntos
          const d = el.getAttribute('d');
          const pts = [];
          if (d) {
            const re = /[ML]\s*([-\d.]+)\s+([-\d.]+)/g;
            let m;
            while ((m = re.exec(d))) pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), t: Date.now() });
          } else {
            // polygon/polyline con puntos
            const pAttr = el.getAttribute('points');
            if (pAttr) {
              const pairs = pAttr.trim().split(/[\s,]+/);
              for (let i = 0; i + 1 < pairs.length; i += 2) {
                pts.push({ x: parseFloat(pairs[i]), y: parseFloat(pairs[i + 1]), t: Date.now() });
              }
            }
          }
          if (!pts.length) return null;
          return Object.assign(base, { type: 'free', points: pts });
        }
      }
    }

    exportJSON() {
      return JSON.stringify({
        id: this.id,
        background: this.opts.background,
        width: this.cssWidth,
        height: this.cssHeight,
        zoom: this.state.zoom,
        panX: this.state.panX,
        panY: this.state.panY,
        layers: deepClone(this.layers)
      }, null, 2);
    }

    importJSON(jsonData) {
      try {
        const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        if (!data || !Array.isArray(data.layers)) throw new Error('Formato JSON inválido');
        this.saveState();
        if (data.background) this.opts.background = data.background;
        this.layers = deepClone(data.layers);
        if (data.zoom) this.state.zoom = data.zoom;
        if (typeof data.panX === 'number') this.state.panX = data.panX;
        if (typeof data.panY === 'number') this.state.panY = data.panY;
        this.state.currentLayer = Math.min(this.state.currentLayer, this.layers.length - 1);
        this.redraw();
      } catch (e) {
        console.error('[PaintingSystem] importJSON error:', e);
      }
    }

    updateOptions(options) {
      Object.assign(this.opts, options);
      this.redraw();
    }

    static isAvailable() {
      return typeof CanvasRenderingContext2D !== 'undefined' &&
        'getContext' in HTMLCanvasElement.prototype;
    }
  }

  // Exportaciones
  const Drawing = { init: (canvas, opts) => new PaintingSystem(canvas, opts), isAvailable: PaintingSystem.isAvailable, PaintingSystem };

  global.Drawing = Drawing;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Drawing, PaintingSystem };
  }
})(typeof window !== 'undefined' ? window : this);
