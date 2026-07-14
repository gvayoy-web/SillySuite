"""
engine.py — REST del Local Game Engine (puente al sync_server).

Endpoints usados por los opcodes engine_* y por el builder visual:
  POST /api/engine/register   { slots, base_name_url, metrics } -> tokens por jugador
  POST /api/engine/event      { token, event_key, payload }    -> incrementa leaderboard
  GET  /api/engine/leaderboard?session_id=&metric=             -> top en RAM
El sync_server es AUTORITATIVO: valida el token y nunca confía en el client_id
que envíe el celular.
"""
import threading

from flask import Blueprint, request, jsonify

from silly.blueprints.sync_bridge import bridge

engine_bp = Blueprint('engine', __name__, url_prefix='/api/engine')

# El bridge WebSocket usa asyncio.run por llamada; serializamos para evitar
# bucles de event loop concurrentes en el mismo hilo de Waitress.
_local = threading.Lock()


def _guard(fn):
    with _local:
        return fn()


@engine_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    slots = int(data.get('slots', 4))
    base = data.get('base_name_url', 'persona')
    metrics = data.get('metrics') or ['kills']
    session_id = data.get('session_id')
    res = _guard(lambda: bridge.register_session(slots, base, metrics, session_id))
    if not res or not res.get('ok', True) or 'players' not in res:
        return jsonify({'success': False, 'error': res.get('error', 'sin respuesta del motor')}), 502
    return jsonify({'success': True, 'session_id': res.get('session_id'), 'players': res.get('players')})


@engine_bp.route('/event', methods=['POST'])
def event():
    data = request.get_json(silent=True) or {}
    token = data.get('token')
    if not token:
        return jsonify({'success': False, 'error': 'falta token'}), 400
    res = _guard(lambda: bridge.report_event(token, data.get('event_key'), data.get('payload', {})))
    if not res or not res.get('ok'):
        return jsonify({'success': False, 'error': (res or {}).get('reason', 'evento rechazado')}), 400
    return jsonify({'success': True, 'client_id': res.get('client_id'),
                    'metric': res.get('metric'), 'leaderboard': res.get('leaderboard')})


@engine_bp.route('/leaderboard', methods=['GET'])
def leaderboard():
    session_id = request.args.get('session_id')
    metric = request.args.get('metric', 'kills')
    if not session_id:
        return jsonify({'success': False, 'error': 'falta session_id'}), 400
    res = _guard(lambda: bridge.get_leaderboard(session_id, metric))
    if not res or 'leaderboard' not in res:
        return jsonify({'success': False, 'error': (res or {}).get('error', 'sin datos')}), 502
    return jsonify({'success': True, 'session_id': session_id, 'metric': metric,
                    'leaderboard': res.get('leaderboard')})
