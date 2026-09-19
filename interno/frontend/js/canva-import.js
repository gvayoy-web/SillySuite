export class CanvaImport {
  constructor(editor) {
    this.editor = editor;
    this.sillyPackage = null;
  }

  // Import .silly ZIP file (JSZip via CDN)
  async importSilly(zipBlob) {
    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    const zip = await JSZip.loadAsync(zipBlob);

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('Invalid .silly file: missing manifest.json');

    const manifest = JSON.parse(await manifestFile.async('text'));
    this.sillyPackage = manifest;

    // Load assets
    const { sprites = {}, animations = {}, layers = {}, background = null } = manifest.assets || {};

    // Import sprites
    for (const [key, path] of Object.entries(sprites)) {
      const file = zip.file(path);
      if (file) {
        const blob = await file.async('blob');
        const img = await this._blobToImage(blob);
        this._importSpriteFromImage(img, `Sprite ${Object.keys(sprites).indexOf(key) + 1}`);
      }
    }

    // Import layers
    for (const [key, path] of Object.entries(layers)) {
      const file = zip.file(path);
      if (file) {
        const blob = await file.async('blob');
        const img = await this._blobToImage(blob);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        this.editor.layers.push({
          id: `layer_${Object.keys(layers).indexOf(key)}`,
          name: `Layer ${Object.keys(layers).indexOf(key) + 1}`,
          visible: true,
          opacity: 1,
          canvas,
          x: 0,
          y: 0,
          width: img.width,
          height: img.height
        });
      }
    }

    // Import background
    if (background) {
      const file = zip.file(background);
      if (file) {
        const blob = await file.async('blob');
        const img = await this._blobToImage(blob);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        if (this.editor.layers[0]) {
          this.editor.layers[0].canvas = canvas;
        } else {
          this.editor.layers.unshift(canvas);
        }
      }
    }

    this.editor.saveProject();
    return manifest;
  }

  // Import JSON project file
  async importJSON(jsonBlob) {
    const text = await jsonBlob.text();
    const project = JSON.parse(text);

    this.editor.loadFromBuilder(project);
    return project;
  }

  // Import image file
  importImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const sprite = this.editor._createSprite('Imported Sprite');
          sprite.frames[0].canvas = canvas;

          resolve(sprite);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Import from raw asset data URLs
  importAssetDataURL(assetName, dataUrl, type = 'image/png') {
    if (type === 'image/png' || type === 'image/jpeg') {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        if (assetName.startsWith('sprites/')) {
          const match = assetName.match(/sprites\/([^\/]+)\//);
          const spriteId = match ? match[1] : 'imported-sprite';
          const frameIndex = this.editor.sprites.find(s => s.id === spriteId)
            ?.frames.length || 0;

          let sprite = this.editor.sprites.find(s => s.id === spriteId);
          if (!sprite) {
            sprite = this.editor._createSprite(spriteId);
            this.editor.sprites.push(sprite);
          }

          sprite.frames[frameIndex].canvas = canvas;
          this.editor.currentSprite = sprite;
        } else if (assetName.startsWith('layers/')) {
          this.editor.layers.push({
            id: assetName.replace('layers/', '').replace('.png', ''),
            name: assetName,
            visible: true,
            opacity: 1,
            canvas,
            x: 0,
            y: 0,
            width: img.width,
            height: img.height
          });
        } else if (assetName === 'background.png') {
          if (this.editor.layers[0]) {
            this.editor.layers[0].canvas = canvas;
          } else {
            this.editor.layers.unshift({
              id: 'background-layer',
              name: 'Background',
              visible: true,
              opacity: 1,
              canvas,
              x: 0,
              y: 0,
              width: img.width,
              height: img.height
            });
          }
        }

        this.editor._updateUI();
      };
      img.src = dataUrl;
    }
  }

  async importFile(file) {
    if (file.name.endsWith('.silly') || file.name.endsWith('.zip')) {
      return this.importSilly(file);
    } else if (file.name.endsWith('.json')) {
      return this.importJSON(file);
    } else if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      return this.importImage(file);
    } else {
      throw new Error('Unsupported file type: ' + file.type);
    }
  }

  _blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  }
}