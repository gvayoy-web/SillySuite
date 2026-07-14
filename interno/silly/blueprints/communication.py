"""
API para comunicación en tiempo real (SSE + Polling).
Compatible con Waitress usando Smart Polling adaptativo.
"""

from flask import Blueprint, Response, request, stream_with_context, jsonify

from silly.communication_manager import communication_manager

comm_bp = Blueprint('communication', __name__, url_prefix='/api/comm')

@comm_bp.route('/sse/<session_id>', methods=['GET'])
def sse_stream(session_id):
    """Stream SSE para updates tiempo real"""
    last_event_id = request.headers.get('Last-Event-ID', '0')
    try:
        last_event_id = int(last_event_id)
    except ValueError:
        last_event_id = 0
    
    return communication_manager.create_sse_response(session_id, last_event_id)

@comm_bp.route('/sse/<session_id>/stats', methods=['GET'])
def sse_stats(session_id):
    """Estadísticas de conexiones SSE"""
    count = communication_manager.get_session_clients_count(session_id)
    return jsonify({
        'success': True,
        'session_id': session_id,
        'connected_clients': count
    })