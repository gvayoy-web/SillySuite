export class CanvaEditor {
  constructor(options = {}) {
    this.canvas = options.canvas || this._createCanvas();
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.width = options.width || 800;
    this.height = options.height || 600;
    this.frameRate = options.frameRate || 12;

    this.sprites = [];
    this.currentSprite = null;
    this.layers = [];
    this.timeline = [];
    this.currentFrame = 0;
    this.history = options.history;
    this.bridge = options.bridge;
    this.export = options.export;

    this.snapToGrid = options.snapToGrid || false;
    this.gridSize = options.gridSize || 16;
    this.drawGrid = options.drawGrid || true;

    this.selectedTool = 'select';
    this.brushSize = 5;
    this.brushColor = '#FFFFFF';
    this.backgroundColor = '#000000';
    this.opacity = 1.0;

    this.isDrawing = false;
    this.lastX = 0;
    this.lastY = 0;
    this.tileX = 0;
    this.tileY = 0;

    this.currentAnimation = null;
    this.clipRegion = null;

    this.dirty = true;
    this.lastDrawTime = 0;
    this.drawInterval = 1000 / (options.targetFps || 60);
    this.drawRequestId = null;
    this.drawBatch = [];
    this.performanceStats = {
      lastFrameTime: 0,
      averageFPS: 60,
      frameTimeHistory: [],
      maxHistory: 60
    };

    this.canvasPool = [];
    this.poolSize = options.poolSize || 4;

    this._setupPerformanceMonitoring();
    this._setupRenderScheduler();
    this._setupEventListeners();
    this._initDefaultProject();
  }

  _setupPerformanceMonitoring() {
    this.performanceObserver = null;
    this.fpsHistory = [];
    this.historyMaxSize = 60;
    this.lastFpsUpdate = 0;
    this.frameCount = 0;
    this.isMonitoring = true;

    if ('requestAnimationFrame' in window) {
      this.performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.fpsHistory.push(entry);
          if (this.fpsHistory.length > this.historyMaxSize) {
            this.fpsHistory.shift();
          }
        }
      });

      try {
        this.performanceObserver.observe({ entryTypes: ['frame'] });
      } catch (e) {
        console.warn('PerformanceObserver not supported');
      }
    }
  }

  _setupRenderScheduler() {
    this.lastRenderTime = 0;
    this.renderThrottle = 1000 / (this.drawInterval || 60);
    this._scheduleNextRender();
  }

  _scheduleNextRender() {
    const now = performance.now();
    const timeSinceLastRender = now - this.lastRenderTime;

    if (timeSinceLastRender >= this.renderThrottle || this.dirty) {
      this.drawRequestId = requestAnimationFrame(this._renderFrame.bind(this));
    } else {
      this.drawRequestId = requestAnimationFrame(() => this._scheduleNextRender());
    }
  }

  _renderFrame(currentTime) {
    if (!this.isMonitoring) {
      this._drawCanvas();
      this.lastDrawTime = currentTime;
      this._updatePerformanceStats();
      this._scheduleNextRender();
      return;
    }

    if (currentTime - this.lastDrawTime >= this.drawInterval || this.dirty) {
      this._drawCanvas();
      this.lastDrawTime = currentTime;
      this._updatePerformanceStats();
    }

    this._scheduleNextRender();
  }

  _updatePerformanceStats() {
    const now = performance.now();
    const delta = now - this.lastFpsUpdate;
    this.frameCount++;

    if (delta >= 1000) {
      const fps = (this.frameCount * 1000) / delta;
      this.performanceStats.averageFPS = Math.round(fps);
      this.frameCount = 0;
      this.lastFpsUpdate = now;

      this._checkPerformanceAndAdjust(this.performanceStats.averageFPS);
    }

    this.lastDrawTime = now;
    this.performanceStats.lastFrameTime = delta;
  }

  _checkPerformanceAndAdjust(currentFps) {
    if (currentFps < 30) {
      this._reduceCanvasQuality();
    } else if (currentFps > 50 && this.fpsHistory.length > 30) {
      this._increaseCanvasQuality();
    }
  }

  _reduceCanvasQuality() {
    this.drawInterval = Math.max(30, this.drawInterval + 10);
    this.gridSize = Math.min(this.gridSize + 4, 32);
    this.drawGrid = false;
  }

  _increaseCanvasQuality() {
    this.drawInterval = Math.max(16, this.drawInterval - 5);
    this.drawGrid = true;
  }

  _getCanvasFromPool() {
    if (this.canvasPool.length > 0) {
      return this.canvasPool.pop();
    }
    const pooledCanvas = document.createElement('canvas');
    pooledCanvas.width = this.width;
    pooledCanvas.height = this.height;
    return pooledCanvas;
  }

  _releaseCanvasToPool(canvas) {
    if (this.canvasPool.length < this.poolSize) {
      canvas.width = canvas.width;
      canvas.height = canvas.height;
      this.canvasPool.push(canvas);
    }
  }

  _canvasPoolingDraw(canvas, context, x = 0, y = 0) {
    if (this.canvasPool.length > this.poolSize * 0.8) {
      const tempCanvas = this._getCanvasFromPool();
      tempCanvas.width = this.width;
      tempCanvas.height = this.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(canvas, x, y);
      this.ctx.drawImage(tempCanvas, 0, 0);
      this._releaseCanvasToPool(tempCanvas);
    } else {
      this.ctx.drawImage(canvas, x, y);
    }
  }

  _createCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.cursor = 'crosshair';
    canvas.style.imageSmoothingEnabled = false;
    return canvas;
  }

  _setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this._onMouseUp());
    this.canvas.addEventListener('mouseout', () => this._onMouseUp());
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e));

    document.addEventListener('keydown', (e) => this._onKeyDown(e));
    document.addEventListener('keyup', (e) => this._onKeyUp(e));

    this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _initDefaultProject() {
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.layers = [];
    this.sprites = [];
    this.timeline = [];
    this.currentFrame = 0;

    this._addBackgroundLayer();
  }

  _addBackgroundLayer() {
    const layer = {
      id: 'background-layer',
      name: 'Background',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      tileX: 0,
      tileY: 0,
      wrapX: false,
      wrapY: false,
      canvas: document.createElement('canvas'),
      x: 0,
      y: 0,
      width: this.canvas.width,
      height: this.canvas.height
    };

    layer.canvas.width = this.canvas.width;
    layer.canvas.height = this.canvas.height;
    this._fillCanvas(layer.canvas, this.backgroundColor);

    this.layers.unshift(layer);
  }

  _getActiveLayers() {
    return this.layers.filter(l => l.visible && !l.locked);
  }

  _drawCanvas() {
    this.dirty = false;

    if (this.lastDrawTime > 0) {
      const now = performance.now();
      const elapsed = now - this.lastDrawTime;
      this.performanceStats.frameTimeHistory.push(elapsed);
      if (this.performanceStats.frameTimeHistory.length > this.performanceStats.maxHistory) {
        this.performanceStats.frameTimeHistory.shift();
      }
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.imageSmoothingEnabled = false;

    if (this.currentSprite?.frames[this.currentFrame]?.canvas) {
      const frame = this.currentSprite.frames[this.currentFrame];
      const spriteBitmap = this._ensureBitmapReady(frame.canvas);
      if (spriteBitmap) {
        const globalAlpha = this.ctx.globalAlpha;
        this.ctx.globalAlpha = this.currentSprite.opacity !== undefined ? this.currentSprite.opacity : 1;
        this._canvasPoolingDraw(spriteBitmap, this.ctx, this.currentSprite.x || 0, this.currentSprite.y || 0);
        this.ctx.globalAlpha = globalAlpha;
      }
    }

    for (const layer of this._getActiveLayers()) {
      if (!layer.canvas || !layer.visible || layer.locked) continue;

      const globalAlpha = this.ctx.globalAlpha;
      this.ctx.globalAlpha = layer.opacity;
      this.ctx.globalCompositeOperation = layer.blendMode;

      const layerBitmap = this._ensureBitmapReady(layer.canvas);
      if (layerBitmap) {
        this._canvasPoolingDraw(layerBitmap, this.ctx, layer.x || 0, layer.y || 0);
      }
      this.ctx.globalAlpha = globalAlpha;
    }

    if (this.drawGrid) {
      this._drawGrid();
    }

    if (this.clipRegion) {
      this.ctx.clip();
    }
  }

  _ensureBitmapReady(canvas) {
    if (!canvas) return null;

    if (!canvas._bitmapReady) {
      canvas._bitmapReady = true;
      canvas._bitmap = this.ctx.createImageData(canvas.width, canvas.height);
      canvas._bitmap.data.set(canvas.getImageData(0, 0, canvas.width, canvas.height).data);
    }

    return canvas._bitmap;
  }

  _applyVisualEffects(context, options = {}) {
    const effects = [];

    if (options.blur) {
      effects.push(['blur', options.blur]);
    }

    if (options.contrast) {
      effects.push(['contrast', options.contrast]);
    }

    if (options.brightness) {
      effects.push(['brightness', options.brightness]);
    }

    if (options.sepia) {
      effects.push(['sepia', options.sepia]);
    }

    if (options.invert) {
      effects.push(['invert', options.invert]);
    }

    if (options.noise) {
      effects.push(['noise', options.noise]);
    }

    if (options.particle) {
      effects.push(['particle', options.particle]);
    }

    return this._compositeEffects(context, effects);
  }

  _compositeEffects(context, effects) {
    if (!effects.length) return;

    effects.forEach(([effect, value], index) => {
      context.save();

      switch (effect) {
        case 'blur':
          context.filter = `blur(${value}px)`;
          break;
        case 'contrast':
          context.filter = `contrast(${value}%)`;
          break;
        case 'brightness':
          context.filter = `brightness(${value}%)`;
          break;
        case 'sepia':
          context.filter = `sepia(${value}%)`;
          break;
        case 'invert':
          context.filter = `invert(${value}%)`;
          break;
        case 'noise':
          this._applyNoise(context, value);
          break;
        case 'particle':
          this._applyParticleEffect(context, value);
          break;
        default:
          break;
      }

      if (effect !== 'noise' && effect !== 'particle') {
        context.drawImage(context.canvas, 0, 0);
      }
      context.restore();
    });

    return context;
  }

  _applyNoise(context, intensity) {
    const imageData = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
    const data = imageData.data;
    const noiseFactor = intensity / 100;

    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 255 * noiseFactor;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }

    context.putImageData(imageData, 0, 0);
  }

  _applyParticleEffect(context, intensity) {
    const imageData = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      if (Math.random() < intensity / 100) {
        data[i] = 255;
        data[i + 1] = Math.random() * 255;
        data[i + 2] = Math.random() * 255;
        data[i + 3] = 255;
      }
    }

    context.putImageData(imageData, 0, 0);
  }

  setCanvasEffect(layerId, effectType, value) {
    const layer = this.layers.find(l => l.id === layerId);
    if (!layer || !layer.canvas) return false;

    this._saveStateToHistory({
      type: 'canvas_effect',
      beforeState: { layerId, previousEffect: layer.effect },
      afterState: { layerId, newEffect: { type: effectType, value }, layer }
    });

    layer.effect = { type: effectType, value };
    this.dirty = true;
    return true;
  }

  applySmartCorrection(imageData) {
    try {
      const data = imageData.data;
      const hist = new Uint32Array(256);

      for (let i = 0; i < data.length; i += 4) {
        hist[data[i]]++;
        hist[data[i + 1]]++;
        hist[data[i + 2]]++;
      }

      const total = imageData.width * imageData.height;
      let colorDistribution = { r: 0, g: 0, b: 0 };

      for (let i = 0; i < 256; i++) {
        colorDistribution.r += i * hist[i * 4];
        colorDistribution.g += i * hist[i * 4 + 1];
        colorDistribution.b += i * hist[i * 4 + 2];
      }

      colorDistribution.r /= total;
      colorDistribution.g /= total;
      colorDistribution.b /= total;

      const contrast = Math.tanh((colorDistribution.r + colorDistribution.g + colorDistribution.b) / 255);
      const brightness = Math.min(255, colorDistribution.r + colorDistribution.g + colorDistribution.b) / 3;

      const correctedData = this._applyCorrection(data, contrast, brightness);
      return correctedData;
    } catch (error) {
      console.error('Smart correction failed:', error);
      return imageData;
    }
  }

  _applyCorrection(data, contrast, brightness) {
    const correctedData = new Uint8ClampedArray(data.length);
    const contrastFactor = (1 + contrast) / (1 - contrast);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const cr = (r - 128) * contrastFactor + 128;
      const cg = (g - 128) * contrastFactor + 128;
      const cb = (b - 128) * contrastFactor + 128;

      correctedData[i] = Math.min(255, Math.max(0, Math.round(cr + brightness)));
      correctedData[i + 1] = Math.min(255, Math.max(0, Math.round(cg + brightness)));
      correctedData[i + 2] = Math.min(255, Math.max(0, Math.round(cb + brightness)));
      correctedData[i + 3] = data[i + 3];
    }

    return correctedData;
  }

  _drawGrid() {
    const gridSize = this.gridSize;
    const color = 'rgba(128, 128, 128, 0.2)';

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 0.5;

    for (let x = 0; x <= this.canvas.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }

    for (let y = 0; y <= this.canvas.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  _fillCanvas(canvas, color) {
    canvas.width = this.canvas.width;
    canvas.height = this.canvas.height;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  _getCanvasPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX || event.touches?.[0]?.clientX) - rect.left) * (this.canvas.width / rect.width),
      y: ((event.clientY || event.touches?.[0]?.clientY) - rect.top) * (this.canvas.height / rect.height)
    };
  }

  _snapToGrid(value) {
    return this.snapToGrid ? Math.round(value / this.gridSize) * this.gridSize : value;
  }

  _getPrecisionCoordinates(e) {
    const pos = this._getCanvasPosition(e);
    return {
      x: this._snapToGrid(pos.x),
      y: this._snapToGrid(pos.y)
    };
  }

  _updateTilePosition(pos) {
    const tilesX = Math.floor((pos.x - this.canvas.offsetLeft) / this.gridSize);
    const tilesY = Math.floor((pos.y - this.canvas.offsetTop) / this.gridSize);
    this.tileX = tilesX;
    this.tileY = tilesY;
  }

  _startDrawing(e) {
    this.isDrawing = true;
    const pos = this._getPrecisionCoordinates(e);
    this.lastX = pos.x;
    this.lastY = pos.y;

    if (this.selectedTool === 'select') {
      this._startSelecting(pos);
      return;
    }

    if (!this.currentSprite) return;

    const ctx = this.currentSprite.frames[this.currentFrame].canvas.getContext('2d');

    if (['brush', 'eraser'].includes(this.selectedTool)) {
      this._drawPixel(ctx, this.lastX, this.lastY);
    }
  }

  _startSelecting(pos) {
    this._updateTilePosition(pos);
    this.clipRegion = { startX: pos.x, startY: pos.y };
    this.canvas.style.cursor = 'crosshair';
  }

  _drawPixel(ctx, x, y) {
    const size = this.brushSize;

    ctx.save();
    ctx.globalCompositeOperation = this.selectedTool === 'brush' ? 'source-over' : 'destination-out';
    ctx.globalAlpha = this.selectedTool === 'brush' ? this.opacity : 1;

    const color = this.selectedTool === 'brush' ? this.brushColor : 'transparent';
    ctx.fillStyle = color;

    ctx.fillRect(x, y, size, size);
    ctx.restore();
  }

  _drawShape(ctx, fromX, fromY, toX, toY) {
    if (this.selectedTool === 'rect') {
      const width = toX - fromX;
      const height = toY - fromY;
      ctx.fillRect(fromX, fromY, width, height);
    } else if (this.selectedTool === 'circle') {
      const radius = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
      ctx.beginPath();
      ctx.ellipse(fromX, fromY, radius, radius, 0, 0, 2 * Math.PI);
      ctx.fill();
    } else if (this.selectedTool === 'line') {
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
    }
  }

  _updateHistory(action) {
    if (this.history) {
      this.history.push(action);
    }
  }

  _saveStateToHistory(type) {
    if (!this.history) return;
    const layers = this.layers.map(layer => ({
      ...layer,
      canvas: layer.canvas ? this._canvasToDataURL(layer.canvas) : null
    }));
    const sprites = this.sprites.map(sprite => ({
      ...sprite,
      frames: sprite.frames.map(frame => ({
        ...frame,
        canvas: frame.canvas ? this._canvasToDataURL(frame.canvas) : null
      }))
    }));

    this.history.push({
      type,
      beforeState: { layers, sprites },
      description: type
    });
  }

  _canvasToDataURL(canvas) {
    if (!canvas) return null;
    return canvas.toDataURL();
  }

  _createSprite(name) {
    const sprite = {
      id: `sprite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      currentFrame: 0,
      currentAnimation: null,
      frames: [],
      animations: {},
      blocks: []
    };

    this.sprites.push(sprite);

    const frame = {
      id: `frame_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      duration: 1000 / this.frameRate,
      canvas: document.createElement('canvas'),
      id: this.sprites.length - 1,
      index: this.sprites.length - 1
    };

    frame.canvas.width = this.width;
    frame.canvas.height = this.height;
    this._fillCanvas(frame.canvas, '#FFFFFF');

    sprite.frames.push(frame);
    this.currentSprite = sprite;

    this._saveStateToHistory('sprite_add');

    return sprite;
  }

  _duplicateSprite() {
    if (!this.currentSprite) {
      this._createSprite(`Sprite ${this.sprites.length + 1}`);
      return;
    }

    const original = { ...this.currentSprite };
    const newSprite = {
      ...original,
      id: `sprite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `${original.name} (Copy)`
    };

    this.sprites.push(newSprite);
    this.currentSprite = newSprite;

    this._saveStateToHistory('sprite_add');
  }

  _removeSprite() {
    if (!this.currentSprite) return;

    const spriteId = this.currentSprite.id;
    const index = this.sprites.findIndex(s => s.id === spriteId);

    if (index !== -1) {
      this.sprites.splice(index, 1);
      this.currentSprite = this.sprites[index] || this.sprites[0] || null;

      this._saveStateToHistory({
        type: 'sprite_remove',
        beforeState: { spriteId }
      });
    }
  }

  _addLayer(name, sourceCanvas = null) {
    const layer = {
      id: `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      tileX: 0,
      tileY: 0,
      wrapX: false,
      wrapY: false,
      canvas: sourceCanvas ? document.createElement('canvas') : null,
      x: 0,
      y: 0,
      width: this.canvas.width,
      height: this.canvas.height
    };

    if (sourceCanvas) {
      layer.canvas = document.createElement('canvas');
      layer.canvas.width = sourceCanvas.width;
      layer.canvas.height = sourceCanvas.height;
      layer.canvas.getContext('2d').drawImage(sourceCanvas, 0, 0);
    }

    this.layers.push(layer);
    this._saveStateToHistory('layer_add');

    return layer;
  }

  _duplicateLayer() {
    if (this.layers.length === 0) return;

    const lastLayer = this.layers[this.layers.length - 1];
    const duplicate = { ...lastLayer, id: `layer_${Date.now()}` };

    this.layers.push(duplicate);
    this._saveStateToHistory('layer_add');
  }

  _removeLayer(layerId) {
    const index = this.layers.findIndex(l => l.id === layerId);
    if (index === -1) return;

    const layer = this.layers[index];
    this._saveStateToHistory({
      type: 'layer_remove',
      beforeState: { layerId, layerData: { ...layer } }
    });

    this.layers.splice(index, 1);
  }

  _moveLayer(layerId, newIndex) {
    const index = this.layers.findIndex(l => l.id === layerId);
    if (index === -1 || index === newIndex) return;

    const layer = this.layers[index];
    this.layers.splice(index, 1);
    this.layers.splice(newIndex, 0, layer);

    this._saveStateToHistory({
      type: 'layer_reorder',
      beforeState: { layerId, index: newIndex },
      afterState: { layerId, index: newIndex }
    });
  }

  _applyLayerFilter(layer, filterType, value) {
    if (!layer.canvas) return;

    if (filterType === 'opacity') {
      layer.opacity = value / 100;
      this._updateHistory({
        type: 'layer_opacity',
        beforeState: { layerId: layer.id, opacity: layer.opacity },
        afterState: { layerId: layer.id, opacity: value }
      });
    } else if (filterType === 'visibility') {
      const wasVisible = layer.visible;
      layer.visible = value;
      this._updateHistory({
        type: 'layer_visibility',
        beforeState: { layerId: layer.id, visible: wasVisible },
        afterState: { layerId: layer.id, visible: value }
      });
    }
  }

  _addFrame(spriteId, frameData = null) {
    const sprite = this.sprites.find(s => s.id === spriteId);
    if (!sprite) return null;

    const frame = {
      id: `frame_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      duration: 1000 / this.frameRate,
      canvas: frameData?.canvas || document.createElement('canvas'),
      id: spriteId,
      index: sprite.frames.length,
      ...frameData
    };

    if (frameData?.canvas) {
      frame.canvas.width = frameData.canvas.width;
      frame.canvas.height = frameData.canvas.height;
      frame.canvas.getContext('2d').drawImage(frameData.canvas, 0, 0);
    } else {
      frame.canvas.width = this.width;
      frame.canvas.height = this.height;
      this._fillCanvas(frame.canvas, '#FFFFFF');
    }

    sprite.frames.push(frame);
    this._saveStateToHistory('frame_add');
    return frame;
  }

  _removeFrame(spriteId, frameIndex) {
    const sprite = this.sprites.find(s => s.id === spriteId);
    if (!sprite || sprite.frames.length <= 1) return;

    const frameId = sprite.frames[frameIndex].id;
    this._saveStateToHistory({
      type: 'frame_remove',
      beforeState: { frameId, spriteId, index: frameIndex }
    });

    sprite.frames.splice(frameIndex, 1);
  }

  _moveFrame(spriteId, fromIndex, toIndex) {
    const sprite = this.sprites.find(s => s.id === spriteId);
    if (!sprite) return;

    const frame = sprite.frames[fromIndex];
    sprite.frames.splice(fromIndex, 1);
    sprite.frames.splice(toIndex, 0, frame);

    this._saveStateToHistory({
      type: 'frame_reorder',
      beforeState: { frameId: frame.id, spriteId, index: toIndex },
      afterState: { frameId: frame.id, spriteId, index: toIndex }
    });
  }

  _setStageBackdrop(backdropColor) {
    if (this.layers.length > 0 && this.layers[0].id === 'background-layer') {
      this.layers[0].canvas = document.createElement('canvas');
      this.layers[0].canvas.width = this.canvas.width;
      this.layers[0].canvas.height = this.canvas.height;
      this._fillCanvas(this.layers[0].canvas, backdropColor || '#000000');
    }
  }

  _getBackgroundColor() {
    return this.layers.length > 0 && this.layers[0].id === 'background-layer' ? this.layers[0].canvas : null;
  }

  init() {
    this._drawCanvas();
    this._updateUI();
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();

    this._startDrawing(e);
  }

  _onMouseMove(e) {
    e.preventDefault();

    if (this.clipRegion && this.selectedTool === 'select') {
      const pos = this._getPrecisionCoordinates(e);
      this.canvas.style.cursor = 'crosshair';
      this._drawCanvas();

      const width = pos.x - this.clipRegion.startX;
      const height = pos.y - this.clipRegion.startY;
      this.ctx.save();
      this.ctx.strokeStyle = '#FF5E3A';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([5, 5]);
      this.ctx.strokeRect(this.clipRegion.startX, this.clipRegion.startY, width, height);
      this.ctx.restore();
      return;
    }

    if (this.isDrawing && this.selectedTool !== 'select') {
      const pos = this._getPrecisionCoordinates(e);
      const oldX = this.lastX;
      const oldY = this.lastY;

      this.lastX = pos.x;
      this.lastY = pos.y;

      this._updateTilePosition(pos);

      this._saveStateToHistory('draw');

      if (!this.currentSprite) return;

      const ctx = this.currentSprite.frames[this.currentFrame].canvas.getContext('2d');

      if (['brush', 'eraser'].includes(this.selectedTool)) {
        const radius = Math.hypot(pos.x - oldX, pos.y - oldY);
        const angle = Math.atan2(pos.y - oldY, pos.x - oldX);

        for (let i = 0; i < radius; i++) {
          const drawX = Math.round(oldX + Math.cos(angle) * i);
          const drawY = Math.round(oldY + Math.sin(angle) * i);
          this._drawPixel(ctx, drawX, drawY);
        }
      }

      if (['rect', 'circle', 'line'].includes(this.selectedTool)) {
        this._drawShape(ctx, oldX, oldY, pos.x, pos.y);
      }

      this._drawCanvas();
    }
  }

  _onMouseUp() {
    this.isDrawing = false;
    this.clipRegion = null;
    this.canvas.style.cursor = 'crosshair';
  }

  _onTouchStart(e) {
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => e.preventDefault()
    });
    this._onMouseDown(mouseEvent);
  }

  _onTouchMove(e) {
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => e.preventDefault()
    });
    this._onMouseMove(mouseEvent);
    e.preventDefault();
  }

  _onTouchEnd(e) {
    const touch = e.changedTouches[0];
    const mouseEvent = new MouseEvent('mouseup', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    this._onMouseUp();
  }

  _onWheel(e) {
    e.preventDefault();

    const delta = e.wheelDeltaY || -e.deltaY;
    this.brushSize = Math.max(1, Math.min(50, this.brushSize + Math.sign(delta) * 2));
    this._updateUI();
  }

  _onKeyDown(e) {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 's': e.preventDefault(); this.saveProject(); break;
        case 'o': e.preventDefault(); this.loadProject(); break;
        case 'n': e.preventDefault(); this.newSprite(); break;
        case 'z': e.preventDefault(); this.history?.undo(); break;
        case 'Z': e.preventDefault(); this.history?.redo(); break;
      }
    }

    if (e.key === 'Escape') {
      this.selectedTool = 'select';
      this._updateUI();
    }
  }

  _onKeyUp(e) {}

  selectTool(tool) {
    this.selectedTool = tool;
    this._updateUI();
  }

  setBrushSize(size) {
    this.brushSize = size;
    this._updateUI();
  }

  setBrushColor(color) {
    this.brushColor = color;
    this._updateUI();
  }

  setOpacity(opacity) {
    this.opacity = opacity;
    this._updateUI();
  }

  newSprite() {
    this._createSprite(`Sprite ${this.sprites.length + 1}`);
    this._updateUI();
  }

  duplicateSprite() {
    this._duplicateSprite();
    this._updateUI();
  }

  removeSprite() {
    this._removeSprite();
    this._updateUI();
  }

  addLayer(name) {
    this._addLayer(name);
    this._updateUI();
  }

  duplicateLayer() {
    this._duplicateLayer();
    this._updateUI();
  }

  removeLayer(layerId) {
    this._removeLayer(layerId);
    this._updateUI();
  }

  addFrameToSprite(spriteId) {
    const frame = this._addFrame(spriteId);
    if (frame) {
      this.currentFrame = spriteId;
      this._updateUI();
    }
  }

  removeFrame(spriteId, frameIndex) {
    this._removeFrame(spriteId, frameIndex);
    this._updateUI();
  }

  setStageBackdrop(color) {
    this._setStageBackdrop(color);
    this._drawCanvas();
    this._updateUI();
  }

  saveProject() {
    const project = this.serializeForBuilder();
    localStorage.setItem('canva-project-backup', JSON.stringify(project));
    this._updateUI();
  }

  async loadProject() {
    const data = localStorage.getItem('canva-project-backup');
    if (!data) return false;

    try {
      const project = JSON.parse(data);
      this.loadFromBuilder(project);
      this._updateUI();
      return true;
    } catch (e) {
      console.error('Failed to load project:', e);
      return false;
    }
  }

  serializeForBuilder() {
    return {
      width: this.canvas.width,
      height: this.canvas.height,
      frameRate: this.frameRate,
      backgroundColor: this.layers[0]?.canvas ? this._getCanvasDataURL(this.layers[0].canvas) : null,
      layers: this.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        x: layer.x || 0,
        y: layer.y || 0,
        opacity: layer.opacity || 1,
        visible: layer.visible !== false,
        blendMode: layer.blendMode || 'source-over',
        locked: layer.locked || false,
        width: layer.width || this.canvas.width,
        height: layer.height || this.canvas.height,
        dataUrl: layer.canvas ? this._getCanvasDataURL(layer.canvas) : null
      })),
      sprites: this.sprites.map(sprite => ({
        id: sprite.id,
        name: sprite.name,
        x: sprite.x || 0,
        y: sprite.y || 0,
        scaleX: sprite.scaleX || 1,
        scaleY: sprite.scaleY || 1,
        rotation: sprite.rotation || 0,
        opacity: sprite.opacity || 1,
        visible: sprite.visible !== false,
        locked: sprite.locked || false,
        currentFrame: sprite.currentFrame || 0,
        currentAnimation: sprite.currentAnimation || null,
        frames: sprite.frames.map(frame => ({
          id: frame.id,
          duration: frame.duration || 1000 / this.frameRate,
          index: frame.index || frame.id,
          canvas: frame.canvas ? this._getCanvasDataURL(frame.canvas) : null
        })),
        animations: sprite.animations || {}
      })),
      timeline: this.timeline
    };
  }

  loadFromBuilder(project) {
    this.canvas.width = project.width || this.width;
    this.canvas.height = project.height || this.height;

    this.frameRate = project.frameRate || this.frameRate;

    this.sprites = [];
    this.currentSprite = null;
    this.layers = [];
    this.timeline = [];
    this.currentFrame = 0;

    if (project.backgroundColor) {
      this._addBackgroundLayer();
      this._fillCanvas(this.layers[0].canvas, project.backgroundColor);
    }

    project.layers?.forEach(layerData => {
      const canvas = layerData.dataUrl ? this._createCanvasFromDataURL(layerData.dataUrl) : null;
      const layer = {
        id: layerData.id,
        name: layerData.name,
        x: layerData.x || 0,
        y: layerData.y || 0,
        opacity: layerData.opacity || 1,
        visible: layerData.visible,
        blendMode: layerData.blendMode,
        locked: layerData.locked,
        width: layerData.width || this.canvas.width,
        height: layerData.height || this.canvas.height,
        canvas,
        tileX: 0,
        tileY: 0,
        wrapX: false,
        wrapY: false
      };
      this.layers.push(layer);
    });

    if (project.sprites?.length > 0) {
      project.sprites.forEach(spriteData => {
        const sprite = {
          id: spriteData.id,
          name: spriteData.name,
          x: spriteData.x || 0,
          y: spriteData.y || 0,
          scaleX: spriteData.scaleX || 1,
          scaleY: spriteData.scaleY || 1,
          rotation: spriteData.rotation || 0,
          opacity: spriteData.opacity || 1,
          visible: spriteData.visible,
          locked: spriteData.locked,
          currentFrame: spriteData.currentFrame || 0,
          currentAnimation: spriteData.currentAnimation || null,
          frames: [],
          animations: spriteData.animations || {}
        };

        spriteData.frames?.forEach(frameData => {
          const canvas = frameData.canvas ? this._createCanvasFromDataURL(frameData.canvas) : null;
          const frame = {
            id: frameData.id,
            duration: frameData.duration || 1000 / this.frameRate,
            canvas,
            index: frameData.index || 0
          };
          sprite.frames.push(frame);
        });

        this.sprites.push(sprite);
      });

      this.currentSprite = this.sprites[0];
    }

    if (this.history) this.history.clear();
    if (this.bridge) this.bridge.requestProject();

    this._updateUI();
  }

  _createCanvasFromDataURL(dataUrl) {
    if (!dataUrl) return null;

    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };

    img.src = dataUrl;
    return canvas;
  }

  _getCanvasDataURL(canvas) {
    if (!canvas) return null;
    return canvas.toDataURL();
  }

  _updateUI() {
    this._drawCanvas();
  }

  previewAnimation() {
    if (!this.currentSprite || this.currentSprite.frames.length === 0) return;

    let frameIndex = 0;
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
    }

    this.animationInterval = setInterval(() => {
      this.currentFrame = frameIndex % this.currentSprite.frames.length;
      this._updateUI();
      frameIndex++;
    }, 1000 / this.frameRate);
  }

  stopPreview() {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    }
  }
}