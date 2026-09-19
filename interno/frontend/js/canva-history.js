export class CanvaHistory {
  constructor(editor) {
    this.editor = editor;
    this.maxHistory = 100;
    this.history = [];
    this.currentIndex = -1;
    this.isUndoing = false;
    this.isRedoing = false;
  }

  get canUndo() {
    return this.currentIndex >= 0;
  }

  get canRedo() {
    return this.currentIndex < this.history.length - 1;
  }

  push(action) {
    if (this.isUndoing || this.isRedoing) return;

    const actionTypes = [
      'draw', 'erase', 'fill', 'shape', 'layer_add', 'layer_remove',
      'layer_reorder', 'layer_visibility', 'layer_opacity',
      'frame_add', 'frame_remove', 'frame_reorder',
      'sprite_add', 'sprite_remove', 'transform'
    ];

    if (!actionTypes.includes(action.type)) {
      console.warn(`Unknown action type: ${action.type}`);
      return;
    }

    this.history = this.history.slice(0, this.currentIndex + 1);
    this.history.push({
      type: action.type,
      beforeState: action.beforeState,
      afterState: action.afterState,
      description: action.description || action.type
    });

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.currentIndex++;
    }
  }

  undo() {
    if (!this.canUndo) return false;

    this.isUndoing = true;
    const action = this.history[this.currentIndex];

    try {
      this.applyInverse(action);
      this.currentIndex--;
      return true;
    } finally {
      this.isUndoing = false;
    }
  }

  redo() {
    if (!this.canRedo) return false;

    this.isRedoing = true;
    this.currentIndex++;
    const action = this.history[this.currentIndex];

    try {
      this.applyForward(action);
      return true;
    } finally {
      this.isRedoing = false;
    }
  }

  applyInverse(action) {
    const { type, beforeState, afterState } = action;

    switch (type) {
      case 'draw':
      case 'erase':
      case 'fill':
      case 'shape':
        this.editor.canvas.restoreState(beforeState);
        break;

      case 'layer_add':
        this.editor.layers.removeLayer(afterState.layerId);
        break;

      case 'layer_remove':
        this.editor.layers.addLayer(beforeState.layerData, beforeState.index);
        break;

      case 'layer_reorder':
        this.editor.layers.moveLayer(afterState.layerId, beforeState.index);
        break;

      case 'layer_visibility':
        this.editor.layers.setLayerVisibility(afterState.layerId, beforeState.visible);
        break;

      case 'layer_opacity':
        this.editor.layers.setLayerOpacity(afterState.layerId, beforeState.opacity);
        break;

      case 'frame_add':
        this.editor.timeline.removeFrame(afterState.frameId);
        break;

      case 'frame_remove':
        this.editor.timeline.addFrame(beforeState.frameData, beforeState.index);
        break;

      case 'frame_reorder':
        this.editor.timeline.moveFrame(afterState.frameId, beforeState.index);
        break;

      case 'sprite_add':
        this.editor.sprites.removeSprite(afterState.spriteId);
        break;

      case 'sprite_remove':
        this.editor.sprites.addSprite(beforeState.spriteData, beforeState.index);
        break;

      case 'transform':
        this.editor.canvas.restoreTransform(beforeState.transform);
        break;
    }

    this.editor.render();
  }

  applyForward(action) {
    const { type, beforeState, afterState } = action;

    switch (type) {
      case 'draw':
      case 'erase':
      case 'fill':
      case 'shape':
        this.editor.canvas.restoreState(afterState);
        break;

      case 'layer_add':
        this.editor.layers.addLayer(afterState.layerData, afterState.index);
        break;

      case 'layer_remove':
        this.editor.layers.removeLayer(beforeState.layerId);
        break;

      case 'layer_reorder':
        this.editor.layers.moveLayer(beforeState.layerId, afterState.index);
        break;

      case 'layer_visibility':
        this.editor.layers.setLayerVisibility(beforeState.layerId, afterState.visible);
        break;

      case 'layer_opacity':
        this.editor.layers.setLayerOpacity(beforeState.layerId, afterState.opacity);
        break;

      case 'frame_add':
        this.editor.timeline.addFrame(afterState.frameData, afterState.index);
        break;

      case 'frame_remove':
        this.editor.timeline.removeFrame(beforeState.frameId);
        break;

      case 'frame_reorder':
        this.editor.timeline.moveFrame(beforeState.frameId, afterState.index);
        break;

      case 'sprite_add':
        this.editor.sprites.addSprite(afterState.spriteData, afterState.index);
        break;

      case 'sprite_remove':
        this.editor.sprites.removeSprite(beforeState.spriteId);
        break;

      case 'transform':
        this.editor.canvas.applyTransform(afterState.transform);
        break;
    }

    this.editor.render();
  }

  clear() {
    this.history = [];
    this.currentIndex = -1;
  }

  getHistory() {
    return this.history.map((action, index) => ({
      index,
      type: action.type,
      description: action.description,
      isCurrent: index === this.currentIndex
    }));
  }

  getCurrentAction() {
    if (this.currentIndex >= 0 && this.currentIndex < this.history.length) {
      return this.history[this.currentIndex];
    }
    return null;
  }
}

export default CanvaHistory;