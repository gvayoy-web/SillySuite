"""
API REST para gestión de templates y modos dinámicos.
"""

from flask import Blueprint, jsonify, request, Response
import json

from silly.template_registry import template_registry
from silly.template_registry import list_scratch_templates, get_scratch_template
from silly.template_engine import template_engine
from silly.communication_manager import communication_manager
from silly.game_state_manager import game_state_manager

templates_bp = Blueprint('templates', __name__, url_prefix='/api/templates')

# === TEMPLATES ===

@templates_bp.route('', methods=['GET'])
def list_templates():
    """Lista templates con filtros"""
    categoria = request.args.get('categoria')
    busqueda = request.args.get('buscar')
    ordenar = request.args.get('ordenar', 'nombre')  # nombre | descargas | calificacion | reciente
    
    if busqueda:
        templates = template_registry.search_templates(busqueda)
    elif categoria:
        templates = template_registry.get_all_templates(categoria)
    else:
        templates = template_registry.get_all_templates()
    
    # Ordenar
    if ordenar == 'descargas':
        templates.sort(key=lambda t: t.get('descargas', 0), reverse=True)
    elif ordenar == 'calificacion':
        templates.sort(key=lambda t: t.get('calificacion', 0), reverse=True)
    elif ordenar == 'reciente':
        templates.sort(key=lambda t: t.get('fecha_creacion', ''), reverse=True)
    else:
        templates.sort(key=lambda t: t['nombre'])
    
    # Serializar para respuesta (sin config completa)
    result = []
    for t in templates:
        result.append({
            'id': t['id'],
            'nombre': t['nombre'],
            'descripcion': t['descripcion'],
            'icono': t['icono'],
            'categoria': t['categoria'],
            'tags': t.get('tags', []),
            'version': t['version'],
            'autor': t.get('autor', 'Sistema'),
            'preview_image': t.get('preview_image', ''),
            'descargas': t.get('descargas', 0),
            'calificacion': t.get('calificacion', 0),
            'componentes': t.get('componentes', []),
            'atributos_resumen': _resumir_atributos(t.get('atributos', {}))
        })
    
    return jsonify({
        'success': True,
        'templates': result,
        'categorias': template_registry.get_categories(),
        'total': len(result)
    })

def _resumir_atributos(attrs: Dict) -> Dict:
    """Resume atributos para listado"""
    return {k: {'type': v.get('type'), 'default': v.get('default')} 
            for k, v in attrs.items()}

@templates_bp.route('/scratch', methods=['GET'])
def list_scratch_template_api():
    """Lista plantillas en formato de bloques del builder visual."""
    templates = list_scratch_templates()
    return jsonify({
        'success': True,
        'templates': [{
            'id': t.get('id'),
            'title': t.get('title', t.get('id')),
            'description': t.get('description', ''),
            'tags': t.get('tags', []),
            'difficulty': t.get('difficulty', 'fácil'),
            'heads': t.get('heads', {})
        } for t in templates],
        'total': len(templates)
    })


@templates_bp.route('/scratch/<tpl_id>', methods=['GET'])
def get_scratch_template_api(tpl_id):
    """Obtiene una plantilla Scratch completa (con heads)."""
    tpl = get_scratch_template(tpl_id)
    if not tpl:
        return jsonify({'success': False, 'error': 'Plantilla no encontrada'}), 404
    return jsonify({'success': True, 'template': tpl})


@templates_bp.route('/<template_id>', methods=['GET'])
def get_template(template_id):
    """Obtiene template completo con configuración"""
    template = template_registry.get_template(template_id)
    if not template:
        return jsonify({'success': False, 'error': 'Template no encontrado'}), 404
    
    return jsonify({
        'success': True,
        'template': template
    })

@templates_bp.route('/<template_id>/preview', methods=['GET'])
def get_template_preview(template_id):
    """Genera configuración de preview para template"""
    template = template_registry.get_template(template_id)
    if not template:
        return jsonify({'success': False, 'error': 'Template no encontrado'}), 404
    
    # Generar config de preview con defaults
    preview_config = {}
    for key, attr in template.get('atributos', {}).items():
        preview_config[key] = attr.get('default', attr.get('min', ''))
    
    return jsonify({
        'success': True,
        'preview_config': preview_config,
        'template_meta': {
            'id': template['id'],
            'nombre': template['nombre'],
            'icono': template['icono'],
            'categoria': template['categoria']
        }
    })

@templates_bp.route('/<template_id>/instantiate', methods=['POST'])
def instantiate_mode(template_id):
    """Instancia nuevo modo desde template"""
    user_config = request.get_json(silent=True) or {}
    mode_name = user_config.pop('_mode_name', None)
    
    result = template_engine.instantiate_mode(template_id, user_config, mode_name)
    
    if not result.success:
        return jsonify({
            'success': False,
            'error': result.error,
            'warnings': result.warnings
        }), 400
    
    return jsonify({
        'success': True,
        'mode_id': result.mode.mode_id,
        'session_id': result.session.session_id,
        'mode_name': result.mode.nombre,
        'warnings': result.warnings
    })

@templates_bp.route('/categories', methods=['GET'])
def get_categories():
    """Obtiene categorías disponibles"""
    return jsonify({
        'success': True,
        'categories': template_registry.get_categories()
    })

# === MODOS DINÁMICOS ===

modes_bp = Blueprint('modes_dynamic', __name__, url_prefix='/api/modes')

@modes_bp.route('', methods=['GET'])
def list_dynamic_modes():
    """Lista modos dinámicos creados"""
    sessions = game_state_manager.list_sessions()
    dynamic = [s for s in sessions if s.mode_type == 'dynamic']
    
    return jsonify({
        'success': True,
        'modes': [{
            'mode_id': s.mode_id,
            'session_id': s.session_id,
            'nombre': s.config.get('_mode_name', s.mode_id),
            'template_id': s.template_id,
            'status': s.status,
            'created_at': s.created_at,
            'updated_at': s.updated_at,
            'players_count': len(s.players)
        } for s in dynamic]
    })

@modes_bp.route('/<mode_id>', methods=['GET'])
def get_dynamic_mode(mode_id):
    """Obtiene detalles de modo dinámico"""
    sessions = game_state_manager.list_sessions()
    session = next((s for s in sessions if s.mode_id == mode_id), None)
    
    if not session:
        return jsonify({'success': False, 'error': 'Modo no encontrado'}), 404
    
    mode = template_engine.get_mode(mode_id)
    
    return jsonify({
        'success': True,
        'mode': {
            'mode_id': mode_id,
            'session_id': session.session_id,
            'nombre': session.config.get('_mode_name', mode_id),
            'template_id': session.template_id,
            'config': session.config,
            'state': session.state,
            'status': session.status,
            'players': session.players,
            'created_at': session.created_at
        }
    })

@modes_bp.route('/<mode_id>/action', methods=['POST'])
def mode_action(mode_id):
    """Ejecuta acción en modo dinámico"""
    mode = template_engine.get_mode(mode_id)
    if not mode:
        return jsonify({'success': False, 'error': 'Modo no encontrado'}), 404
    
    data = request.get_json(silent=True) or {}
    action = data.get('action')
    
    if not action:
        return jsonify({'success': False, 'error': 'Acción requerida'}), 400
    
    result = mode.handle_action(action, data)
    return jsonify({'success': True, 'result': result})

@modes_bp.route('/<mode_id>', methods=['DELETE'])
def delete_dynamic_mode(mode_id):
    """Elimina modo dinámico"""
    mode = template_engine.get_mode(mode_id)
    if not mode:
        return jsonify({'success': False, 'error': 'Modo no encontrado'}), 404
    
    # Detener modo
    mode.stop()
    
    # Eliminar de engine
    template_engine.stop_mode(mode_id)
    
    # Eliminar sesión
    sessions = game_state_manager.list_sessions()
    session = next((s for s in sessions if s.mode_id == mode_id), None)
    if session:
        game_state_manager.delete_session(session.session_id)
    
    return jsonify({'success': True, 'message': 'Modo eliminado'})

# === SSE ENDPOINTS ===

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