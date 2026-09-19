// Export functionality for Canva editor - ES Module
// Dependencies loaded via CDN: JSZip (https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm)
// and gif.js (https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.min.js)

export class CanvaExport {
  /**
   * @param {Object} editor - CanvaEditor instance
   * @param {HTMLCanvasElement} editor.canvas - Main canvas
   * @param {CanvasRenderingContext2D} editor.ctx - Canvas 2D context
   * @param {Array} editor.sprites - Array of sprite objects
   * @param {Object} editor.currentSprite - Currently selected sprite
   * @param {number} editor.currentFrame - Current frame index
   * @param {Array} editor.timeline - Timeline frames
   * @param {Array} editor.layers - Layer objects
   * @param {number} editor.frameRate - Frames per second
   * @param {string} editor.projectName - Project name
   * @param {HTMLCanvasElement} editor.backgroundCanvas - Background canvas (optional)
   */
  constructor(editor) {
    this.editor = editor;
    this.canvas = editor.canvas;
    this.ctx = editor.ctx;
    this.sprites = editor.sprites || [];
    this.currentSprite = editor.currentSprite;
    this.currentFrame = editor.currentFrame ?? 0;
    this.timeline = editor.timeline;
    this.layers = editor.layers || [];
    this.frameRate = editor.frameRate ?? 12;
  }

  /**
   * Export .silly ZIP package (silly-package.js format)
   * Contains: manifest.json, blocks.json, assets/ (sprites as PNG, animations as JSON)
   * @returns {Promise<Blob>}
   */
  async exportSilly() {
    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    const manifest = this._buildManifest();
    const blocks = this._buildBlocks();
    const assets = await this._collectAssets();

    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('blocks.json', JSON.stringify(blocks, null, 2));

    const assetsFolder = zip.folder('assets');
    for (const [name, blob] of Object.entries(assets)) {
      assetsFolder.file(name, blob);
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    this._triggerDownload(blob, `${this.editor.projectName || 'project'}.silly`);
    return blob;
  }

  /**
   * Export current frame/layer composition as PNG
   * @returns {Promise<Blob>}
   */
  async exportPNG() {
    const canvas = this._getCurrentFrameCanvas();
    const blob = await this._canvasToBlob(canvas, 'image/png');
    const name = `${this.editor.projectName || 'frame'}-${this.currentFrame}.png`;
    this._triggerDownload(blob, name);
    return blob;
  }

  /**
   * Export current sprite animation as animated GIF
   * Uses canvas capture + gif.js (loaded via CDN)
   * @returns {Promise<Blob>}
   */
  async exportGIF() {
    const frames = this._getAnimationFrames();
    if (frames.length === 0) {
      throw new Error('No frames to export');
    }

    const GIF = (await import('https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.min.js')).default;
    const gif = new GIF({
      workers: 2,
      quality: 10,
      workerScript: 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js',
      width: this.canvas.width,
      height: this.canvas.height
    });

    for (const frame of frames) {
      gif.addFrame(frame.canvas, { copy: true, delay: 1000 / this.frameRate });
    }

    return new Promise((resolve, reject) => {
      gif.on('finished', (blob) => {
        const name = `${this.editor.projectName || 'animation'}.gif`;
        this._triggerDownload(blob, name);
        resolve(blob);
      });
      gif.on('error', reject);
      gif.render();
    });
  }

  /**
   * Export project as JSON (sprites, layers, frames, timeline)
   * @returns {Promise<Blob>}
   */
  async exportJSON() {
    const project = {
      meta: {
        name: this.editor.projectName || 'Untitled',
        version: '1.0',
        created: new Date().toISOString(),
        canvas: { width: this.canvas.width, height: this.canvas.height },
        frameRate: this.frameRate
      },
      sprites: this.sprites.map(s => this._serializeSprite(s)),
      layers: this.layers.map(l => this._serializeLayer(l)),
      timeline: this._serializeTimeline(),
      currentSprite: this.currentSprite?.id,
      currentFrame: this.currentFrame
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const name = `${this.editor.projectName || 'project'}.json`;
    this._triggerDownload(blob, name);
    return blob;
  }

  // Private methods

  _buildManifest() {
    return {
      name: this.editor.projectName || 'Untitled Project',
      version: '1.0.0',
      format: 'silly-package-v1',
      created: new Date().toISOString(),
      canvas: { width: this.canvas.width, height: this.canvas.height },
      frameRate: this.frameRate,
      sprites: this.sprites.map(s => ({
        id: s.id,
        name: s.name,
        frames: s.frames.length,
        currentFrame: s.currentFrame
      })),
      layers: this.layers.map(l => ({ id: l.id, name: l.name, visible: l.visible })),
      timeline: this.timeline?.map(t => ({ frame: t.frame, layers: t.layers }))
    };
  }

  _buildBlocks() {
    const blocks = {};
    for (const sprite of this.sprites) {
      blocks[sprite.id] = sprite.blocks || [];
    }
    return blocks;
  }

  async _collectAssets() {
    const assets = {};

    for (const sprite of this.sprites) {
      for (let i = 0; i < sprite.frames.length; i++) {
        const frame = sprite.frames[i];
        if (frame.canvas) {
          const blob = await this._canvasToBlob(frame.canvas, 'image/png');
          assets[`sprites/${sprite.id}/frame-${i}.png`] = blob;
        }
      }
      if (sprite.animations) {
        for (const [name, anim] of Object.entries(sprite.animations)) {
          const blob = new Blob([JSON.stringify(anim, null, 2)], { type: 'application/json' });
          assets[`animations/${sprite.id}/${name}.json`] = blob;
        }
      }
    }

    for (const layer of this.layers) {
      if (layer.canvas) {
        const blob = await this._canvasToBlob(layer.canvas, 'image/png');
        assets[`layers/${layer.id}.png`] = blob;
      }
    }

    if (this.editor.backgroundCanvas) {
      const blob = await this._canvasToBlob(this.editor.backgroundCanvas, 'image/png');
      assets['background.png'] = blob;
    }

    return assets;
  }

  _getCurrentFrameCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = this.canvas.width;
    canvas.height = this.canvas.height;
    const ctx = canvas.getContext('2d');

    if (this.editor.backgroundCanvas) {
      ctx.drawImage(this.editor.backgroundCanvas, 0, 0);
    }

    for (const layer of this.layers) {
      if (!layer.visible || !layer.canvas) continue;
      ctx.globalAlpha = layer.opacity ?? 1;
      ctx.globalCompositeOperation = layer.blendMode || 'source-over';
      ctx.drawImage(layer.canvas, layer.x ?? 0, layer.y ?? 0);
    }

    if (this.currentSprite?.frames[this.currentFrame]?.canvas) {
      const frame = this.currentSprite.frames[this.currentFrame];
      ctx.globalAlpha = this.currentSprite.opacity ?? 1;
      ctx.drawImage(frame.canvas, this.currentSprite.x ?? 0, this.currentSprite.y ?? 0);
    }

    return canvas;
  }

  _getAnimationFrames() {
    const frames = [];
    const sprite = this.currentSprite;
    if (!sprite?.animations) return frames;

    const currentAnim = sprite.animations[sprite.currentAnimation];
    if (!currentAnim) return frames;

    for (const frameIndex of currentAnim.frames) {
      const frame = sprite.frames[frameIndex];
      if (frame?.canvas) frames.push({ canvas: frame.canvas });
    }

    return frames;
  }

  _serializeSprite(sprite) {
    return {
      id: sprite.id,
      name: sprite.name,
      x: sprite.x ?? 0,
      y: sprite.y ?? 0,
      scaleX: sprite.scaleX ?? 1,
      scaleY: sprite.scaleY ?? 1,
      rotation: sprite.rotation ?? 0,
      opacity: sprite.opacity ?? 1,
      visible: sprite.visible !== false,
      currentFrame: sprite.currentFrame ?? 0,
      currentAnimation: sprite.currentAnimation,
      frames: sprite.frames.map(f => ({
        duration: f.duration ?? 1000 / this.frameRate,
        dataUrl: f.canvas ? this._canvasToDataURL(f.canvas) : null
      })),
      animations: sprite.animations ? Object.fromEntries(
        Object.entries(sprite.animations).map(([k, v]) => [k, { frames: v.frames, loop: v.loop }])
      ) : {},
      blocks: sprite.blocks || []
    };
  }

  _serializeLayer(layer) {
    return {
      id: layer.id,
      name: layer.name,
      x: layer.x ?? 0,
      y: layer.y ?? 0,
      opacity: layer.opacity ?? 1,
      visible: layer.visible !== false,
      blendMode: layer.blendMode || 'source-over',
      dataUrl: layer.canvas ? this._canvasToDataURL(layer.canvas) : null
    };
  }

  _serializeTimeline() {
    if (!this.timeline) return [];
    return this.timeline.map(t => ({
      frame: t.frame,
      layers: t.layers?.map(l => ({ id: l.id, visible: l.visible, opacity: l.opacity }))
    }));
  }

  _canvasToBlob(canvas, type) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas to blob failed')), type);
    });
  }

  _canvasToDataURL(canvas) {
    return canvas.toDataURL('image/png');
  }

  _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}