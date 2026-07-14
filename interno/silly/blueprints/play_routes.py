"""
play_routes.py — Rutas para la página móvil de juego (/play/<client_id>).
"""
from flask import Blueprint, render_template_string, request, jsonify, abort
from silly.blueprints.sync_bridge import bridge

play_bp = Blueprint('play_routes', __name__, url_prefix='/play')


@play_bp.route('/<client_id>', methods=['GET'])
def play_page(client_id):
    """Sirve la página de juego móvil para un client_id válido."""
    # En producción validar token via query param ?token=...
    token = request.args.get('token')
    if not token:
        # Para testing: permitir sin token (el WS validará al conectar)
        pass
    return render_template_string(PLAY_TEMPLATE, client_id=client_id, token=token)


# Template HTML brutalista inline (vendored PixiJS + GSAP via CDN local en producción)
PLAY_TEMPLATE = r'''
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>SillyQuiz — {{ client_id }}</title>
<style>
:root {
  --ink:#0a0a0a; --paper:#ECEAE3; --paper-2:#E2DFD6; --surface:#F4F2EC;
  --cat-engine:#00B894; --cat-sprites:#FF6B00;
  --hard:4px 4px 0 var(--ink); --hard-lg:6px 6px 0 var(--ink);
}
* { box-sizing:border-box; margin:0; padding:0; }
html,body { height:100%; width:100%; overflow:hidden; background:var(--paper);
  font-family:'Segoe UI',Roboto,sans-serif; touch-action:none; }
#game-canvas { display:block; width:100%; height:100%; background:#111; }
.ui-layer { position:fixed; inset:0; pointer-events:none; z-index:10; }
.btn { pointer-events:auto; position:absolute; background:var(--ink); color:var(--paper);
  border:3px solid var(--ink); font-weight:800; font-size:1.1rem; padding:14px 22px;
  box-shadow:var(--hard); transition:transform 50ms,box-shadow 50ms; }
.btn:active { transform:translate(2px,2px); box-shadow:var(--hard-lg); }
#btn-left { left:16px; bottom:16px; }
#btn-right { right:16px; bottom:16px; }
#btn-fire { right:16px; bottom:110px; background:var(--cat-sprites); }
#btn-special { left:16px; bottom:110px; background:var(--cat-engine); }
.hud { pointer-events:none; position:absolute; top:16px; left:16px; right:16px; display:flex; justify-content:space-between; z-index:5; }
.hud-box { background:rgba(10,10,10,0.85); color:#fff; padding:10px 18px; border:3px solid var(--ink);
  font-weight:800; font-size:0.9rem; box-shadow:var(--hard); }
#status { position:absolute; top:16px; left:50%; transform:translateX(-50%); background:rgba(10,10,10,0.9);
  color:#fff; padding:8px 16px; border:3px solid var(--ink); font-weight:700; font-size:0.85rem;
  box-shadow:var(--hard); white-space:nowrap; }
</style>
</head>
<body>
<canvas id="game-canvas"></canvas>
<div class="hud">
  <div class="hud-box" id="hud-score">SCORE: 0</div>
  <div class="hud-box" id="hud-kills">KILLS: 0</div>
  <div class="hud-box" id="hud-rank">RANK: —</div>
</div>
<div id="status">Conectando…</div>
<div class="ui-layer">
  <button class="btn" id="btn-left">◀</button>
  <button class="btn" id="btn-right">▶</button>
  <button class="btn" id="btn-fire">FIRE</button>
  <button class="btn" id="btn-special">SPEC</button>
</div>

<!-- PixiJS 7 + GSAP 3 (local vendor) -->
<script src="/vendor/pixi.min.js"></script>
<script src="/vendor/gsap.min.js"></script>
<script>
(function() {
  'use strict';
  const CLIENT_ID = '{{ client_id }}';
  const TOKEN = '{{ token }}' || null;
  const WS_URL = (window.__SB_WS_URL || 'ws://' + location.hostname + ':8081');

  // Estado del juego
  const state = {
    x: 0, y: 0, vx: 0, vy: 0,
    score: 0, kills: 0, rank: 0,
    lastFire: 0, fireCooldown: 300,
    sprites: {}, bullets: [], enemies: [],
    connected: false, sessionId: null
  };

  // DOM
  const canvas = document.getElementById('game-canvas');
  const statusEl = document.getElementById('status');
  const hudScore = document.getElementById('hud-score');
  const hudKills = document.getElementById('hud-kills');
  const hudRank = document.getElementById('hud-rank');

  // PixiJS App
  const app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x111111,
    antialias: false,
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true
  });

  // Contenedores
  const world = new PIXI.Container();
  const bulletsLayer = new PIXI.Container();
  const enemiesLayer = new PIXI.Container();
  const playerLayer = new PIXI.Container();
  const uiLayer = new PIXI.Container();
  world.addChild(enemiesLayer, bulletsLayer, playerLayer);
  app.stage.addChild(world, uiLayer);

  // Jugador (triángulo simple brutalista)
  const playerGfx = new PIXI.Graphics();
  playerGfx.beginFill(0x00B894);
  playerGfx.moveTo(0, -24);
  playerGfx.lineTo(-18, 16);
  playerGfx.lineTo(18, 16);
  playerGfx.closePath();
  playerGfx.endFill();
  playerGfx.lineStyle(3, 0x0a0a0a);
  playerGfx.moveTo(0, -24);
  playerGfx.lineTo(-18, 16);
  playerGfx.lineTo(18, 16);
  playerGfx.closePath();
  playerLayer.addChild(playerGfx);
  playerGfx.x = app.screen.width / 2;
  playerGfx.y = app.screen.height - 80;
  state.x = playerGfx.x;
  state.y = playerGfx.y;

  // Botones táctiles
  const btnMap = { left:false, right:false, fire:false, special:false };
  document.getElementById('btn-left').addEventListener('touchstart', e=>{e.preventDefault();btnMap.left=true;});
  document.getElementById('btn-left').addEventListener('touchend', e=>{e.preventDefault();btnMap.left=false;});
  document.getElementById('btn-right').addEventListener('touchstart', e=>{e.preventDefault();btnMap.right=true;});
  document.getElementById('btn-right').addEventListener('touchend', e=>{e.preventDefault();btnMap.right=false;});
  document.getElementById('btn-fire').addEventListener('touchstart', e=>{e.preventDefault();btnMap.fire=true;});
  document.getElementById('btn-fire').addEventListener('touchend', e=>{e.preventDefault();btnMap.fire=false;});
  document.getElementById('btn-special').addEventListener('touchstart', e=>{e.preventDefault();btnMap.special=true;});
  document.getElementById('btn-special').addEventListener('touchend', e=>{e.preventDefault();btnMap.special=false;});

  // Teclado (desktop testing)
  window.addEventListener('keydown', e=>{ if(e.code==='ArrowLeft')btnMap.left=true; if(e.code==='ArrowRight')btnMap.right=true; if(e.code==='Space')btnMap.fire=true; if(e.code==='ShiftLeft')btnMap.special=true; });
  window.addEventListener('keyup', e=>{ if(e.code==='ArrowLeft')btnMap.left=false; if(e.code==='ArrowRight')btnMap.right=false; if(e.code==='Space')btnMap.fire=false; if(e.code==='ShiftLeft')btnMap.special=false; });

  // Spawnear enemigos (zombies)
  function spawnEnemy() {
    const g = new PIXI.Graphics();
    g.beginFill(0xFF3B30);
    g.drawRect(-16, -16, 32, 32);
    g.endFill();
    g.lineStyle(3, 0x0a0a0a);
    g.drawRect(-16, -16, 32, 32);
    g.x = Math.random() * (app.screen.width - 64) + 32;
    g.y = -40;
    g.vy = 60 + Math.random() * 80; // px/s
    g.hp = 1;
    enemiesLayer.addChild(g);
    state.enemies.push(g);
  }
  setInterval(spawnEnemy, 1200);

  // Disparo
  function fire() {
    const now = Date.now();
    if (now - state.lastFire < state.fireCooldown) return;
    state.lastFire = now;
    const b = new PIXI.Graphics();
    b.beginFill(0xFFD700);
    b.drawRect(-4, -12, 8, 24);
    b.endFill();
    b.lineStyle(2, 0x0a0a0a);
    b.drawRect(-4, -12, 8, 24);
    b.x = playerGfx.x;
    b.y = playerGfx.y - 24;
    b.vy = -700;
    bulletsLayer.addChild(b);
    state.bullets.push(b);
    // SFX visual (GSAP flash)
    gsap.fromTo(b, {scaleY:0.5}, {scaleY:1.2, duration:0.05, yoyo:true, repeat:1});
  }

  // WebSocket al sync_server
  let ws = null;
  function connectWS() {
    const url = (window.__SB_WS_URL || 'ws://' + location.hostname + ':8081');
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      state.connected = true;
      statusEl.textContent = 'Conectado — ' + CLIENT_ID;
      if (TOKEN) {
        ws.send(JSON.stringify({type:'play_connect', token:TOKEN}));
      }
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleWSMessage(msg);
      } catch(_) {}
    };
    ws.onclose = () => {
      state.connected = false;
      statusEl.textContent = 'Desconectado — reintentando…';
      setTimeout(connectWS, 2000);
    };
    ws.onerror = () => { statusEl.textContent = 'Error WS'; };
  }

  function handleWSMessage(msg) {
    if (msg.type === 'play_ready') {
      state.sessionId = msg.session_id;
      statusEl.textContent = 'Listo — ' + msg.client_id;
    } else if (msg.type === 'play_event_result' && msg.ok) {
      // Actualizar HUD local con leaderboard recibido
      if (msg.leaderboard) updateHUD(msg.leaderboard);
    } else if (msg.type === 'leaderboard_update') {
      if (msg.leaderboard) updateHUD(msg.leaderboard);
    } else if (msg.type === 'ping') {
      // Responder pong con timestamp para heartbeat
      ws.send(JSON.stringify({type: 'pong', ts: msg.ts}));
    } else if (msg.type === 'error') {
      statusEl.textContent = 'Error: ' + msg.msg;
    }
  }

  function updateHUD(leaderboard) {
    // leaderboard = [{client_id, value}, ...] ordenado descendente
    const me = leaderboard.find(p => p.client_id === CLIENT_ID);
    if (me) {
      state.kills = me.value;
      state.rank = leaderboard.indexOf(me) + 1;
      hudKills.textContent = 'KILLS: ' + state.kills;
      hudRank.textContent = 'RANK: #' + state.rank;
    }
    hudScore.textContent = 'SCORE: ' + state.score;
  }

  function sendEvent(eventKey, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !TOKEN) return;
    ws.send(JSON.stringify({
      type: 'play_event',
      token: TOKEN,
      event_key: eventKey,
      payload: payload
    }));
  }

  // Game loop
  let lastTime = performance.now();
  function gameLoop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Movimiento jugador
    const speed = 300;
    if (btnMap.left) state.x -= speed * dt;
    if (btnMap.right) state.x += speed * dt;
    state.x = Math.max(30, Math.min(app.screen.width - 30, state.x));
    playerGfx.x = state.x;

    // Disparo
    if (btnMap.fire) fire();

    // Balas
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.y += b.vy * dt;
      if (b.y < -30) { bulletsLayer.removeChild(b); state.bullets.splice(i,1); continue; }
      // Colisión con enemigos
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (Math.abs(b.x - e.x) < 24 && Math.abs(b.y - e.y) < 24) {
          // Hit
          bulletsLayer.removeChild(b); state.bullets.splice(i,1);
          e.hp--;
          gsap.to(e, {tint:0xFFFFFF, duration:0.05, yoyo:true, repeat:1});
          if (e.hp <= 0) {
            enemiesLayer.removeChild(e); state.enemies.splice(j,1);
            state.score += 100;
            state.kills++;
            sendEvent('zombie_kill', {metric:'kills', by:1});
            updateHUD([{client_id:CLIENT_ID, value:state.kills}]); // optimista
            gsap.to(e, {alpha:0, scale:0, duration:0.2, onComplete:()=>e.destroy()});
          }
          break;
        }
      }
    }

    // Enemigos
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      e.y += e.vy * dt;
      // Colisión con jugador
      if (Math.abs(e.x - playerGfx.x) < 28 && Math.abs(e.y - playerGfx.y) < 28) {
        // Game over simple
        sendEvent('player_death', {});
        statusEl.textContent = '¡MUERTO! Reiniciando…';
        gsap.to(playerGfx, {alpha:0, duration:0.3, yoyo:true, repeat:1});
        e.y = -100; // sacar
        break;
      }
      if (e.y > app.screen.height + 40) {
        enemiesLayer.removeChild(e); state.enemies.splice(i,1);
      }
    }

    // Resize handling
    if (app.screen.width !== canvas.clientWidth || app.screen.height !== canvas.clientHeight) {
      app.resize();
    }

    requestAnimationFrame(gameLoop);
  }

  // Arranque
  if (TOKEN) {
    connectWS();
  } else {
    statusEl.textContent = 'Falta token — añade ?token=... a la URL';
  }
  requestAnimationFrame(gameLoop);

  // Exponer para debug
  window.__GAME = { state, sendEvent, app };
})();
</script>
</body>
</html>
'''