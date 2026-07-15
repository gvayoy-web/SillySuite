/**
 * scratch-drawing.js — Sistema de dibujo, formas y pintura en el Infinity Canvas
 *
 * Permite a los desarrollores crear herramientas de pintura avanzadas y graficación vectorial
 * usando la arquitectura de bloques de Scratch para control total de la lógica.
 *
 * Características:
 *   - Pintura vectorial con trazado de puntos y spline cúbico
 *   - Sistema de capas con fusión/transparencia
 *   - Formas geométricas básicas (rectángulo, círculo, polígono)
 *   - Transformaciones interactivas (rotar, escalar, mover, reflejar)
 *   - Pinceles con gradiente, opacidad y efectos
 *   - Desenfoque selectivo y desenfoque gaussiano
 *   - Trazado de ecuaciones paramétricas
 *   - Graficación de lissajous y ondas
 *   - Editor de símbolos (paletas de íconos)
 *   - Ajustes de tamaño de lienzo y zoom infinito continuo
 *   - Exportación/guardado de pinceladas y muestras de color
 *
 * API:
 *   Drawing.init(contextDom, opts) -> PaintingSystem
 *   PaintingSystem.clear(color)
 *   PaintingSystem.beginPath(type, opts)
 *   PaintingSystem.moveTo(x, y)
 *   PaintingSystem.lineTo(x, y)
 *   PaintingSystem.quadraticCurveTo(cp1x, cp1y, cp2x, cp2y, x, y)
 *   PaintingSystem.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y)
 *   PaintingSystem.arcTo(x, y, radius)
 *   PaintingSystem.circle(x, y, radius, opts)
 *   PaintingSystem.rect(x, y, width, height, opts)
 *   PaintingSystem.polygon(points, opts)
 *   PaintingSystem.gradient(x0, y0, x1, y1, stops)
 *   PaintingSystem.pattern(url, opts)
 *   PaintingSystem.fill(color | gradient | pattern)
 *   PaintingSystem.stroke(color, width)
 *   PaintingSystem.setTransform(transform)
 *   PaintingSystem.getTransform()
 *   PaintingSystem.saveState()
 *   PaintingSystem.restoreState()
 *   PaintingSystem.exportPNG(dpi)
 *   PaintingSystem.exportSVG()
 *   PaintingSystem.importSVG(svg)
 *   PaintingSystem.exportJSON()
 *   PaintingSystem.importJSON(data)
 *   PaintingSystem.updateOptions(options)
 *   PaintingSystem.getActiveLayer()
 *   PaintingSystem.setActiveLayer(index)
 *   PaintingSystem.addLayer(name, opts)
 *   PaintingSystem.removeLayer(index)
 *   PaintingSystem.mergeLayer(index)
 *   PaintingSystem.duplicateLayer(index)
 *   PaintingSystem.reorderLayer(from, to)
 *   PaintingSystem.getLayers()
 *   Drawing.isAvailable() -> boolean
 */

(function (global) {
  'use strict';

  const ScratchBlocks = global.ScratchBlocks || (typeof require !== 'undefined' ? require('./scratch-blocks.js').ScratchBlocks : null);
  const ScratchRuntime = global.ScratchRuntime || (typeof require !== 'undefined' ? require('./scratch-runtime.js').ScratchRuntime : null);

  class PaintingSystem {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.id = Math.random().toString(36).substr(2, 9);
      
      // Configuración
      this.opts = Object.assign({
        defaultStrokeWidth: 2,
        defaultStrokeStyle: '#000000',
        defaultFillStyle: '#000000',
        antialias: true,
        pixelated: false,
        highQuality: true,
        enableLayers: true,
        enableSelection: true,
        enableTransform: true,
        maxHistory: 100
      }, opts);
      
      // Estado del dibujo
      this.state = {
        history: [],
        historyIndex: -1,
        currentLayer: 0,
        layers: [],
        activeLayerIndex: 0,
        path: null,
        isDrawing: false,
        zoom: 1,
        panX: 0,
        panY: 0,
        snapToGrid: false,
        gridSize: 20,
        selection: null,
        copiedData: null,
        transform: {
          a: 1, b: 0, c: 0, d: 1, e: 0, f: 0
        }
      };
      
      // Pinceles y estilos
      this.brushes = new Map();
      this.gradients = new Map();
      this.patterns = new Map();
      this.palettes = new Map();
      
      // Dibujado actual
      this.pathData = {
        type: null,
        points: [],
        options: {}
      };
      
      // Configurar canvas
      this._setupCanvas();
      this._setupEventHandlers();
      
      // Crear capa inicial
      if (this.opts.enableLayers) {
        this._createInitialLayers();
      } else {
        this.state.layers = [this._createLayer('Fondo', { visible: true })];
      }
      
      // Guardar estado inicial
      this.saveState();n
      if (typeof module !== 'undefined' && module.exports) {
        module.exports = { PaintingSystem };
      }
    }
    
    _setupCanvas() {
      const ctx = this.ctx;
      
      // Configurar suavizado de bordes
      if (this.opts.antialias) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = this.opts.highQuality ? 'high' : 'medium';
      } else {
        ctx.imageSmoothingEnabled = false;
      }
      
      // Píxeles nítidos para pixel art
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 10;
      
      // Habilitar salida con alta resolución
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      
      // Configurar tamaño para alta resolución
      const width = Math.round(rect.width * dpr);
      const height = Math.round(rect.height * dpr);
      
      // Configurar factor de escala del canvas
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.scale(dpr, dpr);
      
      // Escalar para compensar el tamaño de la fuente
      ctx.translate(0.5, 0.5);
    }
    
    _setupEventHandlers() {
      const canvas = this.canvas;
      const ctx = this.ctx;
      const state = this.state;
      
      // Evento ratón
      canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
      canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
      canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
      canvas.addEventListener('mouseout', (e) => this._onMouseOut(e));
      
      // Evento rueda del ratón
      canvas.addEventListener('wheel', (e) => this._onWheel(e));
      
      // Eventos táctiles para dispositivos móviles
      canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
      canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
      canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));
      
      // Eventos de teclado para atajos
      document.addEventListener('keydown', (e) => this._onKeyDown(e));
    }
    
    _createInitialLayers() {
      const layers = [];
      
      // Capa de fondo (visible)
      layers.push(this._createLayer('Fondo', {
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false
      }));
      
      // Capa Oculta (para editor de recorte)
      layers.push(this._createLayer('Oculta', {
        visible: false,
        opacity: 1,
        blendMode: 'source-over',
        locked: false
      }));
      
      this.state.layers = layers;
    }
    
    _createLayer(name, options = {}) {
      const layer = {
        id: Math.random().toString(36).substr(2, 9),
        name: name,
        width: Math.round(this.canvas.width / window.devicePixelRatio),
        height: Math.round(this.canvas.height / window.devicePixelRatio),
        data: this._createEmptyLayerData(),
        ...options
      };
      
      // Si no se especifica fuente, usar lienzo
      if (!options.source) {
        layer.source = () => {
          const url = URL.createObjectURL(
            new Blob([this._encodeLayerData(layer.data)], { type: 'image/png' })
          );
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          return url;
        };
      }
      
      return layer;
    }
    
    _createEmptyLayerData() {
      const width = Math.round(this.canvas.width / window.devicePixelRatio);
      const height = Math.round(this.canvas.height / window.devicePixelRatio);
      const data = new Uint8ClampedArray(width * height * 4);
      return {
        width,
        height,
        data,
        modified: Date.now()
      };
    }
    
    _encodeLayerData(layerData) {
      const canvas = document.createElement('canvas');
      canvas.width = layerData.width;
      canvas.height = layerData.height;
      const ctx = canvas.getContext('2d');
      
      const imageData = new ImageData(layerData.data, layerData.width, layerData.height);
      ctx.putImageData(imageData, 0, 0);
      
      return canvas.toDataURL('image/png');
    }
    
    _decodeLayerData(dataUrl) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          resolve(imageData.data);
        };
        img.src = dataUrl;
      });
    }
    
    beginPath(type = 'free', opts = {}) {
      this.state.isDrawing = true;
      
      this.pathData = {
        type,
        points: [],
        options: Object.assign(this._getDefaultPathOptions(type), opts)
      };
      
      const { x, y } = this._getCurrentPoint();
      this.pathData.points.push({ x, y, t: Date.now() });
      
      switch (type) {
        case 'free':
          this.pathData.points.push({ x, y, t: Date.now() });
          break;
        case 'line':
          this.pathData.points.push({ x, y, t: Date.now() });
          break;
        case 'curve':
          this.pathData.points.push({ x, y, t: Date.now() });
          break;
        case 'circle':
          this.pathData.points.push({ x, y, t: Date.now() });
          break;
        case 'polygon':
          this.pathData.points.push({ x, y, t: Date.now() });
          break;
        case 'text':
          this.pathData.text = opts.text || '';
          break;
        case 'shape':
          this.pathData.shape = opts.shape || 'rect';
          this.pathData.points.push({ x, y, t: Date.now() });
          break;
        default:
          this.pathData.points.push({ x, y, t: Date.now() });
      }
    }
    
    _getDefaultPathOptions(type) {
      const defaults = {
        free: {
          strokeStyle: this.opts.defaultStrokeStyle,
          strokeWidth: this.opts.defaultStrokeWidth,
          lineCap: 'round',
          lineJoin: 'round'
        },
        line: {
          strokeStyle: this.opts.defaultStrokeStyle,
          strokeWidth: this.opts.defaultStrokeWidth,
          lineCap: 'round',
          lineJoin: 'round'
        },
        curve: {
          strokeStyle: this.opts.defaultStrokeStyle,
          strokeWidth: this.opts.defaultStrokeWidth,
          lineCap: 'round',
          lineJoin: 'round',
          tension: 0.5
        },
        circle: {
          strokeStyle: this.opts.defaultStrokeStyle,
          strokeWidth: this.opts.defaultStrokeWidth,
          fillStyle: this.opts.defaultFillStyle,
          lineCap: 'round',
          lineJoin: 'round'
        },
        polygon: {
          strokeStyle: this.opts.defaultStrokeStyle,
          strokeWidth: this.opts.defaultStrokeWidth,
          fillStyle: this.opts.defaultFillStyle,
          lineCap: 'round',
          lineJoin: 'round'
        },
        shape: {
          shape: 'rect',
          strokeStyle: this.opts.defaultStrokeStyle,
          strokeWidth: this.opts.defaultStrokeWidth,
          fillStyle: this.opts.defaultFillStyle
        },
        text: {
          font: '16px Arial',
          fillStyle: this.opts.defaultFillStyle,
          textAlign: 'start',
          textBaseline: 'top'
        }
      };
      
      return Object.assign(defaults[type] || defaults.free, {
        antialias: this.opts.antialias,
        highQuality: this.opts.highQuality
      });
    }
    
    moveTo(x, y) {
      this.pathData.points[0] = { x, y, t: Date.now() };
      this._renderPath();
    }
    
    lineTo(x, y) {
      this.pathData.points.push({ x, y, t: Date.now() });
      this._renderPath();
    }
    
    quadraticCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
      this.pathData.points.push({ x: cp1x, y: cp1y, t: Date.now() });
      this.pathData.points.push({ x: cp2x, y: cp2y, t: Date.now() });
      this.pathData.points.push({ x, y, t: Date.now() });
      this._renderPath();
    }
    
    bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
      this.pathData.points.push({ x: cp1x, y: cp1y, t: Date.now() });
      this.pathData.points.push({ x: cp2x, y: cp2y, t: Date.now() });
      this.pathData.points.push({ x, y, t: Date.now() });
      this._renderPath();
    }
    
    arcTo(x, y, radius) {
      const lastPoint = this.pathData.points[this.pathData.points.length - 1];
      const cx = (lastPoint.x + x) / 2;
      const cy = (lastPoint.y + y) / 2;
      this.circle(cx, cy, radius, {});
    }
    
    circle(x, y, radius, opts = {}) {
      this.beginPath('circle', opts);
      this.pathData.points = [{ x, y, t: Date.now() }, { x, y, t: Date.now() }];
      this._renderPath();
    }
    
    rect(x, y, width, height, opts = {}) {
      this.beginPath('shape', { ...opts, shape: 'rect' });
      this.pathData.points = [
        { x, y, t: Date.now() },
        { x: x + width, y, t: Date.now() },
        { x: x + width, y: y + height, t: Date.now() },
        { x, y: y + height, t: Date.now() }
      ];
      this._renderPath();
    }
    
    polygon(points, opts = {}) {
      this.beginPath('polygon', opts);
      this.pathData.points = points.map(p => ({ ...p, t: Date.now() }));
      this._renderPath();
    }
    
    gradient(x0, y0, x1, y1, stops) {
      const gradient = this.ctx.createLinearGradient(x0, y0, x1, y1);
      stops.forEach(stop => {
        gradient.addColorStop(stop.offset, stop.color);
      });
      this.gradients.set('current', gradient);
      return gradient;
    }
    
    pattern(url, opts = {}) {
      const pattern = this.ctx.createPattern(url, 'repeat');
      this.patterns.set('current', pattern);
      return pattern;
    }
    
    fill(color = null, gradient = null, pattern = null) {
      this._ensureLayerData();
      const layer = this.state.layers[this.state.currentLayer];
      
      const fillStyle = color || gradient || pattern || this.pathData.options.fillStyle || this.opts.defaultFillStyle;
      
      // Guardar estado antes de rellenar
      this.saveState();
      
      // Dibujar en capa actual
      this._applyTransform();
      
      this.ctx.fillStyle = fillStyle;
      this.ctx.fill();
      
      // Marcar capa como modificada
      layer.data.modified = Date.now();
      
      this._renderCurrentLayer();
    }
    
    stroke(color = null, width = null) {
      this._ensureLayerData();
      const layer = this.state.layers[this.state.currentLayer];
      
      const strokeStyle = color || this.pathData.options.strokeStyle || this.opts.defaultStrokeStyle;
      const strokeWidth = width || this.pathData.options.strokeWidth || this.opts.defaultStrokeWidth;
      
      // Guardar estado antes de trazar
      this.saveState();
      
      // Dibujar en capa actual
      this._applyTransform();
      
      this.ctx.strokeStyle = strokeStyle;
      this.ctx.lineWidth = strokeWidth;
      
      // Aplicar estilo de línea de punto a línea según suavizado de bordes
      if (!this.opts.antialias) {
        this.ctx.lineWidth = Math.max(1, Math.round(this.ctx.lineWidth));
      }
      
      this.ctx.stroke();
      
      // Marcar capa como modificada
      layer.data.modified = Date.now();
      
      this._renderCurrentLayer();
    }
    
    setTransform(transform) {
      this.state.transform = { ...transform };
      this._redrawCanvas();
    }
    
    getTransform() {
      return { ...this.state.transform };
    }
    
    saveState() {
      const state = {
        history: [...this.state.history],
        historyIndex: this.state.historyIndex,
        currentLayer: this.state.currentLayer,
        layers: this.state.layers.map(layer => ({ ...layer, data: { ...layer.data } })),
        activeLayerIndex: this.state.activeLayerIndex,
        path: this.pathData ? { ...this.pathData } : null
      };
      
      this.state.history.push(state);
      this.state.historyIndex = this.state.history.length - 1;
      
      // Limitar historial
      if (this.state.history.length > this.opts.maxHistory) {
        this.state.history.shift();
        this.state.historyIndex--;
      }
    }
    
    restoreState(step = -1) {
      if (step === 0) return;
      
      const targetIndex = step < 0 ? this.state.historyIndex + step : this.state.historyIndex + step;
      
      if (targetIndex < 0 || targetIndex >= this.state.history.length) return;
      
      const state = this.state.history[targetIndex];
      
      // Restaurar estado
      this.state.historyIndex = targetIndex;
      this.state.currentLayer = state.currentLayer;
      this.state.layers = state.layers.map(layer => ({ ...layer }));
      this.state.activeLayerIndex = state.activeLayerIndex;
      this.pathData = state.path ? { ...state.path } : null;
      
      // Redibujar canvas
      this._redrawCanvas();
    }
    
    undo() {
      this.restoreState(-1);
    }
    
    redo() {
      this.restoreState(1);
    }
    
    clear(color = '#FFFFFF') {
      this.saveState();
      
      this._applyTransform();
      this.ctx.fillStyle = color;
      this.ctx.fillRect(0, 0, this.canvas.width / window.devicePixelRatio, this.canvas.height / window.devicePixelRatio);
      
      this._renderCurrentLayer();
    }
    
    exportPNG(dpi = 72) {
      const scale = dpi / 96;
      const width = Math.round(this.canvas.width * scale);
      const height = Math.round(this.canvas.height * scale);
      
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const exportCtx = exportCanvas.getContext('2d');
      
      exportCtx.scale(scale, scale);
      
      // Dibujar todas las capas
      this.state.layers.forEach((layer, index) => {
        if (!layer.visible) return;
        
        const img = new Image();
        img.onload = () => {
          exportCtx.drawImage(img, 0, 0);
        };
        img.src = this._createLayerImageURL(layer);
      });
      
      return exportCanvas.toDataURL('image/png');
    }
    
    exportSVG() {
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.canvas.width}" height="${this.canvas.height}">`;
      
      // Dibujar cada capa
      this.state.layers.forEach((layer, index) => {
        if (!layer.visible) return;
        
        const img = new Image();n        img.onload = () => {
          const svgImage = document.createElementNS('http://www.w3.org/2000/svg', 'image');
          svgImage.setAttribute('href', this._createLayerImageURL(layer));
          svgImage.setAttribute('width', this.canvas.width);
          svgImage.setAttribute('height', this.canvas.height);
          svg += svgImage.outerHTML;
        };
        img.src = this._createLayerImageURL(layer);
      });
      
      svg += '</svg>';
      return svg;
    }
    
    importSVG(svgString) {
      this.saveState();
      
      // Limpiar lienzo actual
      this.clear('#FFFFFF');
      
      // Parsear SVG
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
      const svgElement = svgDoc.querySelector('svg');
      
      if (svgElement) {
        const img = new Image();
        const svgData = new XMLSerializer().serializeToString(svgElement);
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);
        
        img.onload = () => {
          this._applyTransform();
          this.ctx.drawImage(img, 0, 0, this.canvas.width / window.devicePixelRatio, this.canvas.height / window.devicePixelRatio);
          this._renderCurrentLayer();
          URL.revokeObjectURL(svgUrl);
        };
        img.src = svgUrl;
      }
    }
    
    exportJSON() {
      const data = {
        id: this.id,
        width: this.canvas.width / window.devicePixelRatio,
        height: this.canvas.height / window.devicePixelRatio,
        layers: this.state.layers.map(layer => ({
          ...layer,
          data: {
            width: layer.data.width,
            height: layer.data.height,
            modified: layer.data.modified
          }
        }))
      };
      
      return JSON.stringify(data, null, 2);
    }
    
    importJSON(jsonData) {
      try {
        const data = JSON.parse(jsonData);
        
        // Validar datos
        if (!data.layers || !Array.isArray(data.layers)) {
          throw new Error('Invalid JSON format');
        }
        
        this.saveState();
        
        // Limpiar lienzo actual
        this.clear('#FFFFFF');
        
        // Importar capas
        this.state.layers = [];
        data.layers.forEach(layerData => {
          const layer = this._createLayer(layerData.name, layerData);
          this.state.layers.push(layer);
        });
        
        this._redrawCanvas();n
      if (typeof module !== 'undefined' && module.exports) {
        module.exports = { PaintingSystem };
      }
    }
    
    updateOptions(options) {
      Object.assign(this.opts, options);
    }
    
    getActiveLayer() {
      return this.state.layers[this.state.currentLayer];
    }
    
    setActiveLayer(index) {
      if (index >= 0 && index < this.state.layers.length) {
        this.state.currentLayer = index;
        this._redrawCanvas();
      }
    }
    
    addLayer(name, opts = {}) {
      const layer = this._createLayer(name, opts);
      this.state.layers.push(layer);
      this.state.currentLayer = this.state.layers.length - 1;
      this._redrawCanvas();
      return layer.id;
    }
    
    removeLayer(index) {
      if (index >= 0 && index < this.state.layers.length) {
        this.saveState();
        this.state.layers.splice(index, 1);
        if (this.state.currentLayer >= this.state.layers.length) {
          this.state.currentLayer = Math.max(0, this.state.layers.length - 1);
        }
        this._redrawCanvas();
      }
    }
    
    mergeLayer(index) {
      if (index >= 0 && index < this.state.layers.length && this.state.layers.length > 1) {
        this.saveState();
        
        const sourceLayer = this.state.layers[index];
        const targetLayerIndex = Math.min(index + 1, this.state.layers.length - 1);
        const targetLayer = this.state.layers[targetLayerIndex];
        
        // Mover datos de la fuente a la meta
        targetLayer.data = sourceLayer.data;
        targetLayer.data.modified = Date.now();
        
        // Eliminar capa de origen
        this.state.layers.splice(index, 1);
        
        if (this.state.currentLayer === index) {
          this.state.currentLayer = Math.min(index, this.state.layers.length - 1);
        }
        
        this._redrawCanvas();
      }
    }
    
    duplicateLayer(index) {
      if (index >= 0 && index < this.state.layers.length) {
        this.saveState();
        
        const sourceLayer = this.state.layers[index];
        const duplicateLayer = this._createLayer(`${sourceLayer.name} (copy)`, {
          ...sourceLayer,
          data: { ...sourceLayer.data }
        });
        
        this.state.layers.splice(index + 1, 0, duplicateLayer);
        this.state.currentLayer = index + 1;
        this._redrawCanvas();
        
        return duplicateLayer.id;
      }
    }
    
    reorderLayer(from, to) {
      if (from >= 0 && from < this.state.layers.length &&
          to >= 0 && to < this.state.layers.length &&
          from !== to) {
        
        // Mover capa
        const layer = this.state.layers.splice(from, 1)[0];
        this.state.layers.splice(to, 0, layer);
        
        // Ajustar índice de capa actual
        if (this.state.currentLayer === from) {
          this.state.currentLayer = to;
        } else if (from < to && this.state.currentLayer > from && this.state.currentLayer <= to) {
          this.state.currentLayer--;
        } else if (from > to && this.state.currentLayer >= to && this.state.currentLayer < from) {
          this.state.currentLayer++;
        }
        
        this._redrawCanvas();
      }
    }
    
    getLayers() {
      return this.state.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        width: layer.width,
        height: layer.height,
        modified: layer.data.modified
      }));
    }
    
    static isAvailable() {
      return typeof CanvasRenderingContext2D !== 'undefined' && 'getContext' in HTMLCanvasElement.prototype;
    }
    
    // ===== Métodos privados =====
    
    _applyTransform() {
      const { a, b, c, d, e, f } = this.state.transform;
      this.ctx.setTransform(a, b, c, d, e, f);
    }
    
    _ensureLayerData() {
      const layer = this.state.layers[this.state.currentLayer];
      if (!layer.data) {
        layer.data = this._createEmptyLayerData();
      }
    }
    
    _getCurrentPoint() {
      const layer = this.state.layers[this.state.currentLayer];
      if (!layer.data) {
        return { x: 0, y: 0 };
      }
      
      return {
        x: layer.data.width / 2,
        y: layer.data.height / 2
      };
    }
    
    _createLayerImageURL(layer) {
      const canvas = document.createElement('canvas');
      canvas.width = layer.data.width;
      canvas.height = layer.data.height;
      const ctx = canvas.getContext('2d');
      
      const imageData = new ImageData(layer.data.data, layer.data.width, layer.data.height);
      ctx.putImageData(imageData, 0, 0);
      
      return canvas.toDataURL();
    }
    
    _redrawCanvas() {
      const ctx = this.ctx;
      const canvas = this.canvas;
      
      // Limpiar canvas
      ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
      
      // Dibujar todas las capas
      this.state.layers.forEach((layer, index) => {
        if (!layer.visible) return;
        
        ctx.save();
        
        if (layer.opacity < 1) {
          ctx.globalAlpha = layer.opacity;
        }
        
        if (layer.blendMode !== 'source-over') {
          ctx.globalCompositeOperation = layer.blendMode;
        }
        
        ctx.drawImage(
          this._createLayerCanvas(layer),
          0, 0,
          layer.data.width,
          layer.data.height,
          0, 0,
          canvas.width / window.devicePixelRatio,
          canvas.height / window.devicePixelRatio
        );
        
        ctx.restore();
      });
    }
    
    _createLayerCanvas(layer) {
      const canvas = document.createElement('canvas');
      canvas.width = layer.data.width;
      canvas.height = layer.data.height;
      const ctx = canvas.getContext('2d');
      
      const imageData = new ImageData(layer.data.data, layer.data.width, layer.data.height);
      ctx.putImageData(imageData, 0, 0);
      
      return canvas;
    }
    
    _renderCurrentLayer() {
      const layer = this.state.layers[this.state.currentLayer];
      if (!layer) return;
      
      const canvas = this._createLayerCanvas(layer);
      const ctx = this.ctx;
      
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      
      const x = (this.canvas.width - layer.data.width * window.devicePixelRatio) / 2;
      const y = (this.canvas.height - layer.data.height * window.devicePixelRatio) / 2;
      
      ctx.drawImage(canvas, x, y);
      
      ctx.restore();
    }
    
    _renderPath() {
      const ctx = this.ctx;
      const path = this.pathData;
      
      if (!this.state.isDrawing || !path) return;
      
      ctx.save();
      this._applyTransform();
      
      // Configurar estilo de línea según opciones
      ctx.lineCap = path.options.lineCap || 'round';
      ctx.lineJoin = path.options.lineJoin || 'round';
      
      if (path.options.lineWidth) {
        ctx.lineWidth = path.options.lineWidth;
      }
      
      ctx.strokeStyle = path.options.strokeStyle || this.opts.defaultStrokeStyle;
      ctx.fillStyle = path.options.fillStyle || this.opts.defaultFillStyle;
      
      // Aplicar suavizado de bordes si está habilitado
      if (this.opts.antialias) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = this.opts.highQuality ? 'high' : 'medium';
      }
      
      // Dibujar según tipo de camino
      switch (path.type) {
        case 'free':
          this._drawFreePath(ctx, path);
          break;
        case 'line':
          this._drawLinePath(ctx, path);
          break;
        case 'curve':
          this._drawCurvePath(ctx, path);
          break;
        case 'circle':
          this._drawCirclePath(ctx, path);
          break;
        case 'polygon':
          this._drawPolygonPath(ctx, path);
          break;
        case 'shape':
          this._drawShapePath(ctx, path);
          break;
        case 'text':
          this._drawTextPath(ctx, path);
          break;
        default:
          this._drawFreePath(ctx, path);
      }
      
      ctx.restore();
    }
    
    _drawFreePath(ctx, path) {
      if (path.points.length < 2) return;
      
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      
      for (let i = 1; i < path.points.length; i++) {
        const point = path.points[i];
        if (path.options.tension && i > 1) {
          const prev = path.points[i - 1];
          const prevPrev = path.points[i - 2];
          ctx.quadraticCurveTo(prevPrev.x, prevPrev.y, prev.x, prev.y);
        }
        ctx.lineTo(point.x, point.y);
      }
      
      if (path.options.fillStyle) {
        ctx.fill();
      }
      
      if (path.options.strokeStyle) {
        ctx.stroke();
      }
    }
    
    _drawLinePath(ctx, path) {
      if (path.points.length < 2) return;
      
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      
      for (let i = 1; i < path.points.length; i++) {
        const point = path.points[i];
        ctx.lineTo(point.x, point.y);
      }
      
      if (path.options.fillStyle) {
        ctx.fill();
      }
      
      if (path.options.strokeStyle) {
        ctx.stroke();
      }
    }
    
    _drawCurvePath(ctx, path) {
      if (path.points.length < 2) return;
      
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      
      for (let i = 1; i < path.points.length; i += 3) {
        if (i + 2 < path.points.length) {
          const cp1 = path.points[i];
          const cp2 = path.points[i + 1];
          const end = path.points[i + 2];
          ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
          i += 2;
        }
      }
      
      if (path.options.fillStyle) {
        ctx.fill();
      }
      
      if (path.options.strokeStyle) {
        ctx.stroke();
      }
    }
    
    _drawCirclePath(ctx, path) {
      if (path.points.length < 2) return;
      
      const centerX = path.points[0].x;
      const centerY = path.points[0].y;
      const radiusX = path.points[1].x - centerX;
      const radiusY = path.points[1].y - centerY;
      
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, Math.abs(radiusX), Math.abs(radiusY), 0, 0, 2 * Math.PI);
      
      if (path.options.fillStyle) {
        ctx.fill();
      }
      
      if (path.options.strokeStyle) {
        ctx.stroke();
      }
    }
    
    _drawPolygonPath(ctx, path) {
      if (path.points.length < 3) return;
      
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      
      for (let i = 1; i < path.points.length; i++) {
        const point = path.points[i];
        ctx.lineTo(point.x, point.y);
      }
      
      ctx.closePath();
      
      if (path.options.fillStyle) {
        ctx.fill();
      }
      
      if (path.options.strokeStyle) {
        ctx.stroke();
      }
    }
    
    _drawShapePath(ctx, path) {
      if (!path.shape || !path.points.length) return;
      
      const shape = path.shape;
      const points = path.points;
      
      ctx.beginPath();
      
      switch (shape) {
        case 'rect':
          if (points.length >= 2) {
            const x = points[0].x;
            const y = points[0].y;
            const width = points[1] ? points[1].x - x : 100;
            const height = points[1] ? points[1].y - y : 100;
            ctx.rect(x, y, width, height);
          }
          break;
        case 'round_rect':
          if (points.length >= 2) {
            const x = points[0].x;
            const y = points[0].y;
            const width = points[1] ? points[1].x - x : 100;
            const height = points[1] ? points[1].y - y : 100;
            const radius = 10;
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + width - radius, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
            ctx.lineTo(x + width, y + height - radius);
            ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
            ctx.lineTo(x + radius, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
          }
          break;
        case 'ellipse':
          if (points.length >= 2) {
            const centerX = points[0].x;
            const centerY = points[0].y;
            const radiusX = points[1] ? points[1].x - centerX : 50;
            const radiusY = points[1] ? points[1].y - centerY : 30;
            ctx.ellipse(centerX, centerY, Math.abs(radiusX), Math.abs(radiusY), 0, 0, 2 * Math.PI);
          }
          break;
        case 'triangle':
          if (points.length >= 4) {
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[1].x, points[1].y);
            ctx.lineTo(points[2].x, points[2].y);
            ctx.closePath();
          }
          break;
        case 'star':
          if (points.length >= 6) {
            let innerRadius = 0;
            let outerRadius = 0;
            if (points.length >= 8) {
              const centerX = points[0].x;
              const centerY = points[0].y;
              outerRadius = points[1] ? Math.sqrt(Math.pow(points[1].x - centerX, 2) + Math.pow(points[1].y - centerY, 2)) : 50;
              innerRadius = points[2] ? Math.sqrt(Math.pow(points[2].x - centerX, 2) + Math.pow(points[2].y - centerY, 2)) : 25;
            }
            const centerX = points[0].x;
            const centerY = points[0].y;
            const pointsCount = 5;
            const angleStep = Math.PI * 2 / pointsCount;
            ctx.moveTo(centerX + outerRadius, centerY);
            for (let i = 1; i <= pointsCount * 2; i++) {
              const radius = (i % 2 === 0) ? outerRadius : innerRadius;
              const angle = i * angleStep / 2;
              const x = centerX + radius * Math.cos(angle);
              const y = centerY + radius * Math.sin(angle);
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            ctx.closePath();
          }
          break;
        default:
          if (points.length >= 2) {
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[1].x, points[1].y);
          }
      }
      
      if (path.options.fillStyle) {
        ctx.fill();
      }
      
      if (path.options.strokeStyle) {
        ctx.stroke();
      }
    }
    
    _drawTextPath(ctx, path) {
      if (!path.text) return;
      
      const options = path.options;
      const font = options.font || '16px Arial';
      const fillStyle = options.fillStyle || '#000000';
      const textAlign = options.textAlign || 'start';
      const textBaseline = options.textBaseline || 'top';
      
      ctx.font = font;
      ctx.fillStyle = fillStyle;
      ctx.textAlign = textAlign;
      ctx.textBaseline = textBaseline;
      
      const x = path.points[0] ? path.points[0].x : 0;
      const y = path.points[0] ? path.points[0].y : 0;
      
      ctx.fillText(path.text, x, y);
    }
    
    // ===== Manejadores de eventos =====
    
    _onMouseDown(e) {
      e.preventDefault();
      const point = this._getMousePoint(e);
      const { x, y } = point;
      
      // Verificar si se hizo clic en un elemento de UI
      if (this._hitTestUI(x, y)) {
        return;
      }
      
      // Iniciar nuevo camino si no hay activo
      if (!this.state.isDrawing) {
        this._checkForSelection(x, y);
        if (!this.state.selection) {
          this.beginPath('free');
          this.state.isDrawing = true;
        }
      }
    }
    
    _onMouseMove(e) {
      e.preventDefault();
      
      if (!this.state.isDrawing) {
        const point = this._getMousePoint(e);
        this._updateTooltips(point.x, point.y);
        return;
      }
      
      const point = this._getMousePoint(e);
      this.lineTo(point.x, point.y);
      
      this._updateCursor(point.x, point.y);
    }
    
    _onMouseUp(e) {
      e.preventDefault();
      
      if (this.state.isDrawing) {
        this.state.isDrawing = false;
        this.path = null;
        
        // Guardar estado después de dibujar
        this.saveState();
      }
      
      this._resetCursor();
    }
    
    _onMouseOut(e) {
      if (this.state.isDrawing) {
        this.state.isDrawing = false;
        this.path = null;
      }
      
      this._resetCursor();
    }
    
    _onWheel(e) {
      e.preventDefault();
      
      const delta = Math.sign(e.deltaY);
      const zoomFactor = delta > 0 ? 0.9 : 1.1;
      
      this.state.transform.a *= zoomFactor;
      this.state.transform.d *= zoomFactor;
      
      // Limitar zoom
      if (this.state.transform.a < 0.1) {
        this.state.transform.a = 0.1;
        this.state.transform.d = 0.1;
      } else if (this.state.transform.a > 10) {
        this.state.transform.a = 10;
        this.state.transform.d = 10;
      }
      
      this._redrawCanvas();
    }
    
    _onTouchStart(e) {
      e.preventDefault();
      const touch = e.touches[0];
      const point = this._getTouchPoint(touch);
      
      // Si hay más de un toque, tratar como gesto multi-touch
      if (e.touches.length > 1) {
        this._handleMultiTouch(e);
        return;
      }
      
      this._onMouseDown({
        preventDefault: () => {},
        clientX: touch.clientX,
        clientY: touch.clientY
      });
    }
    
    _onTouchMove(e) {
      e.preventDefault();
      
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        this._onMouseMove({
          preventDefault: () => {},
          clientX: touch.clientX,
          clientY: touch.clientY
        });
      } else if (e.touches.length > 1) {
        this._handleMultiTouch(e);
      }
    }
    
    _onTouchEnd(e) {
      e.preventDefault();
      this._onMouseUp({
        preventDefault: () => {},
        clientX: e.changedTouches[0].clientX,
        clientY: e.changedTouches[0].clientY
      });
    }
    
    _onKeyDown(e) {
      // Atajos de teclado
      switch (e.key) {
        case 'Escape':
          if (this.state.selection) {
            this.state.selection = null;
            this._redrawCanvas();
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (this.state.selection) {
            this._deleteSelection();
          }
          break;
        case 'c':
        case 'C':
          if (e.ctrlKey) {
            this._copySelection();
          }
          break;
        case 'v':
        case 'V':
          if (e.ctrlKey) {
            this._pasteSelection();
          }
          break;
        case 'z':
        case 'Z':
          if (e.ctrlKey && e.shiftKey) {
            this.redo();
          } else if (e.ctrlKey) {
            this.undo();
          }
          break;
      }
    }
    
    _getMousePoint(e) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      
      return {
        x: (e.clientX - rect.left) * scaleX / window.devicePixelRatio,
        y: (e.clientY - rect.top) * scaleY / window.devicePixelRatio
      };
    }
    
    _getTouchPoint(touch) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      
      return {
        x: (touch.clientX - rect.left) * scaleX / window.devicePixelRatio,
        y: (touch.clientY - rect.top) * scaleY / window.devicePixelRatio
      };
    }
    
    _hitTestUI(x, y) {
      // Implementar pruebas de colisión con elementos de UI
      return false;
    }
    
    _checkForSelection(x, y) {
      // Implementar detección de selección
      this.state.selection = null;
    }
    
    _updateTooltips(x, y) {
      // Implementar actualización de tooltips
    }
    
    _updateCursor(x, y) {
      // Implementar actualización del cursor
    }
    
    _resetCursor() {
      // Implementar reinicio del cursor
    }
    
    _handleMultiTouch(e) {
      // Implementar manejo de multi-touch
    }
    
    _deleteSelection() {
      // Implementar eliminación de selección
    }
    
    _copySelection() {
      // Implementar copiado de selección
    }
    
    _pasteSelection() {
      // Implementar pegado de selección
    }
  }

  global.Drawing = Drawing;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Drawing };
  }
})(typeof window !== 'undefined' ? window : this);
