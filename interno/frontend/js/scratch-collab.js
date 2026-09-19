/**
 * scratch-collab.js — Colaboración en tiempo real (Yjs-style CRDT simplificado)
 *
 * Permite edición multi-usuario del canvas de bloques.
 * Usa WebRTC DataChannels (peer-to-peer) o WebSocket relay.
 *
 * API:
 *   CollabSession.join(roomId, userId) -> Promise<session>
 *   session.on('remote-change', (change) => { ... })
 *   session.applyLocalChange(change)
 *   session.leave()
 */

(function (global) {
  'use strict';

  const SIGNALING_URL = global.__COLLAB_SIGNALING || 'wss://signaling.sillyquiz.io';

  /** CRDT Document simplificado para operaciones de bloques. */
  class YDoc {
    constructor() {
      this.blocks = new Map(); // blockId -> { data, version, origin }
      this.version = 0;
    }

    /** Aplica operación local, retorna operación normalizada. */
    apply(change, origin) {
      this.version++;
      const op = { ...change, v: this.version, o: origin, t: Date.now() };
      this._applyOp(op);
      return op;
    }

    /** Aplica operación remota. */
    applyRemote(op, origin) {
      if (op.v <= this.version) return; // Ya aplicado
      this.version = op.v;
      this._applyOp(op);
    }

    _applyOp(op) {
      switch (op.type) {
        case 'add-block':
          this.blocks.set(op.id, { data: op.data, version: op.v, origin: op.o });
          break;
        case 'move-block':
          if (this.blocks.has(op.id)) {
            const b = this.blocks.get(op.id);
            b.data = op.data;
            b.version = op.v;
            b.origin = op.o;
          }
          break;
        case 'delete-block':
          this.blocks.delete(op.id);
          break;
        case 'update-args':
          if (this.blocks.has(op.id)) {
            const b = this.blocks.get(op.id);
            b.data.args = { ...b.data.args, ...op.args };
            b.version = op.v;
          }
          break;
      }
    }

    /** Obtiene estado actual para sincronización. */
    getState() {
      return {
        version: this.version,
        blocks: Array.from(this.blocks.entries()).map(([id, b]) => ({ id, ...b }))
      };
    }
  }

  class CollabSession {
    constructor(roomId, userId, opts) {
      this.roomId = roomId;
      this.userId = userId;
      this.opts = opts || {};
      this.peers = new Map(); // userId -> { pc, dc, pending }
      this.ws = null;
      this.handlers = new Map();
      this.doc = new YDoc(); // Documento CRDT simplificado
      this._connected = false;
    }

    /** Conecta al servidor de señalización y une a la sala. */
    async join() {
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(SIGNALING_URL);
        this.ws.onopen = () => {
          this.ws.send(JSON.stringify({ type: 'join', room: this.roomId, user: this.userId }));
        };
        this.ws.onmessage = (e) => this._handleSignal(JSON.parse(e.data));
        this.ws.onerror = reject;
        this.ws.onclose = () => this._emit('disconnect');
        
        // Timeout de conexión
        setTimeout(() => {
          if (!this._connected) reject(new Error('Timeout conectando a sala'));
        }, 10000);
        
        this.once('connected', resolve);
      });
    }

    /** Aplica un cambio local y lo propaga a peers. */
    applyLocalChange(change) {
      const op = this.doc.apply(change, this.userId);
      this._broadcast({ type: 'op', op, user: this.userId });
    }

    /** Registra handler para eventos. */
    on(event, handler) {
      (this.handlers.get(event) || this.handlers.set(event, []).get(event)).push(handler);
    }

    once(event, handler) {
      const wrapper = (data) => {
        this.off(event, wrapper);
        handler(data);
      };
      this.on(event, wrapper);
    }

    off(event, handler) {
      const arr = this.handlers.get(event) || [];
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    }

    leave() {
      this._broadcast({ type: 'leave', user: this.userId });
      this.peers.forEach(p => { p.dc.close(); p.pc.close(); });
      this.peers.clear();
      if (this.ws) this.ws.close();
      this._emit('leave');
    }

    _emit(event, data) {
      (this.handlers.get(event) || []).forEach(h => h(data));
    }

    _broadcast(msg) {
      this.peers.forEach(p => {
        if (p.dc.readyState === 'open') p.dc.send(JSON.stringify(msg));
      });
    }

    async _handleSignal(msg) {
      switch (msg.type) {
        case 'welcome':
          this._connected = true;
          this._emit('connected');
          // Conectar a peers existentes
          for (const peerId of msg.peers) {
            if (peerId !== this.userId) await this._createPeer(peerId, true);
          }
          break;
        case 'peer-joined':
          await this._createPeer(msg.user, false);
          break;
        case 'peer-left':
          this._removePeer(msg.user);
          break;
        case 'offer':
          await this._handleOffer(msg.from, msg.offer);
          break;
        case 'answer':
          await this._handleAnswer(msg.from, msg.answer);
          break;
        case 'ice-candidate':
          await this._handleIceCandidate(msg.from, msg.candidate);
          break;
        case 'op':
          this.doc.applyRemote(msg.op, msg.user);
          this._emit('remote-change', msg.op);
          break;
      }
    }

    async _createPeer(peerId, isInitiator) {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const dc = pc.createDataChannel('collab', { ordered: true });
      
      this.peers.set(peerId, { pc, dc, pending: [] });
      
      dc.onopen = () => this._emit('peer-connected', peerId);
      dc.onmessage = (e) => this._handlePeerMessage(peerId, JSON.parse(e.data));
      dc.onclose = () => this._removePeer(peerId);
      
      pc.onicecandidate = (e) => {
        if (e.candidate) this.ws.send(JSON.stringify({ type: 'ice-candidate', to: peerId, candidate: e.candidate }));
      };
      
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.ws.send(JSON.stringify({ type: 'offer', to: peerId, offer }));
      }
    }

    _handlePeerMessage(peerId, msg) {
      if (msg.type === 'op') {
        this.doc.applyRemote(msg.op, peerId);
        this._emit('remote-change', msg.op);
      }
    }

    async _handleOffer(from, offer) {
      const peer = this.peers.get(from);
      if (!peer) return;
      await peer.pc.setRemoteDescription(offer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.ws.send(JSON.stringify({ type: 'answer', to: from, answer }));
    }

    async _handleAnswer(from, answer) {
      const peer = this.peers.get(from);
      if (peer) await peer.pc.setRemoteDescription(answer);
    }

    async _handleIceCandidate(from, candidate) {
      const peer = this.peers.get(from);
      if (peer) await peer.pc.addIceCandidate(candidate);
    }

    _removePeer(peerId) {
      const peer = this.peers.get(peerId);
      if (peer) { peer.dc.close(); peer.pc.close(); }
      this.peers.delete(peerId);
      this._emit('peer-disconnected', peerId);
    }
  }

  global.CollabSession = CollabSession;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CollabSession };
  }
})(typeof window !== 'undefined' ? window : this);