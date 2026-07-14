"""
TemplateEngine - Motor de instanciación de modos desde templates.
Convierte template JSON + config usuario -> Modo ejecutable.
"""

import json
import copy
import time
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

from .template_registry import template_registry
from .game_state_manager import game_state_manager, GameSession
from .models.dynamic_mode import DynamicMode

@dataclass
class ValidationResult:
    valid: bool
    errors: List[str]
    warnings: List[str]

@dataclass
class InstantiationResult:
    success: bool
    session: Optional[GameSession] = None
    mode: Optional[DynamicMode] = None
    error: Optional[str] = None
    warnings: List[str] = None

class TemplateEngine:
    """Motor para instanciar modos dinámicos desde templates"""
    
    # Mapeo de tipos de componente a handlers
    COMPONENT_HANDLERS = {
        'preguntas': '_handle_preguntas',
        'timer': '_handle_timer',
        'scoring': '_handle_scoring',
        'audio': '_handle_audio',
        'visual': '_handle_visual',
        'feedback': '_handle_feedback',
        'transitions': '_handle_transitions',
        'analytics': '_handle_analytics',
    }
    
    def __init__(self):
        self._mode_instances: Dict[str, DynamicMode] = {}
    
    def instantiate_mode(self, template_id: str, user_config: Dict, 
                         mode_name: str = None) -> InstantiationResult:
        """
        Instancia un nuevo modo desde template + configuración usuario.
        
        Args:
            template_id: ID del template base
            user_config: Configuración del usuario (sobrescribe template)
            mode_name: Nombre personalizado (opcional)
        
        Returns:
            InstantiationResult con sesión, modo y metadata
        """
        # 1. Obtener template
        template = template_registry.get_template(template_id)
        if not template:
            return InstantiationResult(
                success=False, 
                error=f"Template '{template_id}' no encontrado"
            )
        
        # 2. Validar configuración usuario contra atributos permitidos
        validation = self._validate_user_config(template, user_config)
        if not validation.valid:
            return InstantiationResult(
                success=False,
                error=f"Configuración inválida: {validation.errors}"
            )
        
        # 3. Mergear configuraciones (template + usuario)
        final_config = self._merge_configs(template['template_config'], user_config)
        
        # 4. Generar IDs únicos
        mode_id = f"custom_{template['id']}_{int(time.time() * 1000) % 100000}"
        session_id = f"sess_{mode_id}"
        
        # 5. Crear sesión en GameStateManager
        session = game_state_manager.create_session(
            mode_id=mode_id,
            mode_type='dynamic',
            config=final_config,
            template_id=template_id
        )
        
        # 6. Construir modo dinámico
        mode = self._build_dynamic_mode(template, final_config, mode_id, session)
        
        # 7. Registrar modo
        self._mode_instances[mode_id] = mode
        
        # 8. Incrementar descargas del template
        template_registry.increment_downloads(template_id)
        
        return InstantiationResult(
            success=True,
            session=session,
            mode=mode,
            warnings=validation.warnings
        )
    
    def _validate_user_config(self, template: Dict, user_config: Dict) -> ValidationResult:
        """Valida config usuario contra atributos permitidos del template"""
        allowed = template.get('atributos', {})
        errors = []
        warnings = []
        
        for key, value in user_config.items():
            if key not in allowed:
                warnings.append(f"Configuración '{key}' no reconocida en template, se ignorará")
                continue
            
            attr_def = allowed[key]
            
            # Validar tipo
            if 'type' in attr_def:
                expected = attr_def['type']
                if not self._check_type(value, expected):
                    errors.append(f"'{key}': se esperaba tipo {expected}, recibido {type(value).__name__}")
            
            # Validar rango
            if 'min' in attr_def and value < attr_def['min']:
                errors.append(f"'{key}': valor {value} menor que mínimo {attr_def['min']}")
            if 'max' in attr_def and value > attr_def['max']:
                errors.append(f"'{key}': valor {value} mayor que máximo {attr_def['max']}")
            
            # Validar enum
            if 'enum' in attr_def and value not in attr_def['enum']:
                errors.append(f"'{key}': valor '{value}' no en permitidos {attr_def['enum']}")
        
        return ValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings
        )
    
    def _merge_configs(self, base: Dict, override: Dict) -> Dict:
        """Merge profundo de configuraciones"""
        result = copy.deepcopy(base)
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._merge_configs(result[key], value)
            else:
                result[key] = value
        return result
    
    def _build_dynamic_mode(self, template: Dict, config: Dict, 
                            mode_id: str, session) -> DynamicMode:
        """Construye instancia de DynamicMode"""
        mode = DynamicMode(
            mode_id=mode_id,
            template_id=template['id'],
            nombre=template['nombre'],
            icono=template['icono'],
            config=config,
            session=session
        )
        
        # Registrar handlers de componentes
        for component in template.get('componentes', []):
            handler_name = self.COMPONENT_HANDLERS.get(component)
            if handler_name and hasattr(mode, handler_name):
                getattr(mode, handler_name)(template.get('template_config', {}))
        
        return mode
    
    def get_mode(self, mode_id: str) -> Optional[DynamicMode]:
        return self._mode_instances.get(mode_id)
    
    def stop_mode(self, mode_id: str) -> bool:
        if mode_id in self._mode_instances:
            mode = self._mode_instances[mode_id]
            mode.stop()
            del self._mode_instances[mode_id]
            return True
        return False
    
    def _check_type(self, value: Any, expected: str) -> bool:
        type_map = {
            'string': str,
            'number': (int, float),
            'integer': int,
            'boolean': bool,
            'array': list,
            'object': dict
        }
        expected_type = type_map.get(expected)
        if expected_type:
            return isinstance(value, expected_type)
        return True


# Instancia global
template_engine = TemplateEngine()