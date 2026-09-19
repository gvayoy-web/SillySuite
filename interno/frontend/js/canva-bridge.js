/**
 * canva-bridge.js — Comunicación bidireccional Canva ↔ SillyBuilder
 * Usa MessageChannel (postMessage) + localStorage fallback
 */
export class CanvaBridge {
  constructor(editor) {
    this.editor = editor;
    this.channel = null;
    this.targetWindow = null;
    this.ready = false;
  }

  init() {
    // Si fuimos abiertos desde SillyBuilder, opener existe
    if (window.opener && !window.opener.closed) {
      this.targetWindow = window.opener;
      this._setupChannel();
    }

    // Escuchar mensajes del opener (SillyBuilder)
    window.addEventListener('message', (e) => this._onMessage(e));

    // Notificar que Canva está listo
    this._announceReady();

    // Fallback localStorage para cross-tab
    window.addEventListener('storage', (e) => {
      if (e.key === 'sillybuilder-canva-bridge' && e.newValue) {
        try {
          const msg = JSON.parse(e.newValue);
          if (msg.from === 'sillybuilder') this._handleBuilderMessage(msg);
        } catch (_) {}
      }
    });

    this.ready = true;
  }

  _setupChannel() {
    const channel = new MessageChannel();
    this.channel = channel.port1;
    this.channel.onmessage = (e) => this._onChannelMessage(e.data);

    // Enviar port2 al opener
    this.targetWindow.postMessage(
      { type: 'canva_ready', from: 'canva' },
      location.origin,
      [channel.port2]
    );
  }

  _announceReady() {
    if (this.targetWindow) return; // Ya usa MessageChannel

    // Fallback: postMessage simple + localStorage
    window.opener?.postMessage({ type: 'canva_ready', from: 'canva' }, location.origin);
    localStorage.setItem('sillybuilder-canva-bridge', JSON.stringify({
      type: 'canva_ready', from: 'canva', timestamp: Date.now()
    }));
  }

  _onMessage(event) {
    if (event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg?.from || msg.from !== 'sillybuilder') return;

    if (msg.type === 'sillybuilder-canva-bridge') {
      this._handleBuilderMessage(msg);
    }
  }

  _onChannelMessage(data) {
    if (data?.action === 'loadProject') {
      this.editor.loadFromBuilder(data.payload);
    }
  }

  _handleBuilderMessage(msg) {
    switch (msg.action) {
      case 'loadProject':
        this.editor.loadFromBuilder(msg.payload);
        break;
      case 'requestProject':
        this.sendProjectToBuilder();
        break;
    }
  }

  // --- API pública ---

  /** Enviar sprite exportado a SillyBuilder */
  sendSprite(spriteData) {
    this._sendToBuilder({ type: 'sprite_export', sprite: spriteData });
  }

  /** Enviar backdrop exportado a SillyBuilder */
  sendBackdrop(backdropData) {
    this._sendToBuilder({ type: 'backdrop_export', backdrop: backdropData });
  }

  /** Pedir proyecto actual a SillyBuilder */
  requestProject() {
    this._sendToBuilder({ type: 'request_project' });
  }

  /** Enviar proyecto completo (para sync) */
  sendProjectToBuilder() {
    const project = this.editor.serializeForBuilder();
    this._sendToBuilder({ type: 'project_sync', project });
  }

  _sendToBuilder(payload) {
    const msg = { type: 'sillybuilder-canva-bridge', from: 'canva', ...payload };

    // Vía MessageChannel (preferido)
    if (this.channel) {
      this.channel.postMessage(msg);
    }
    // Vía opener postMessage
    else if (this.targetWindow && !this.targetWindow.closed) {
      this.targetWindow.postMessage(msg, location.origin);
    }
    // Fallback localStorage
    else {
      localStorage.setItem('sillybuilder-canva-bridge', JSON.stringify({
        ...msg, timestamp: Date.now()
      }));
    }
  }
}