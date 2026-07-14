"""
DynamicMode - Modo dinámico instanciado desde template.
Ejecutable, con estado, eventos y lifecycle completo.
"""

import time
import threading
import random
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, field

from ..game_state_manager import GameSession
from ..config_loader import load_questions


@dataclass
class ModeEvent:
    event_type: str
    payload: Dict
    timestamp: float = field(default_factory=time.time)


class DynamicMode:
    """
    Modo dinámico completamente funcional.
    Maneja: lifecycle, estado, eventos, timers, scoring, preguntas.
    """
    
    def __init__(self, mode_id: str, template_id: str, nombre: str, 
                 icono: str, config: Dict, session):
        self.mode_id = mode_id
        self.template_id = template_id
        self.nombre = nombre
        self.icono = icono
        self.config = config
        self.session = session
        
        # Estado interno
        self._state = {
            'fase': 'waiting',  # waiting | active | paused | finished
            'pregunta_actual': 0,
            'preguntas': [],
            'puntuaciones': {},
            'timer': None,
            'racha_actual': {},
            'eventos': []
        }
        
        # Callbacks de eventos
        self._event_handlers: Dict[str, List[Callable]] = {}
        self._lock = threading.Lock()
        
        # Timer thread
        self._timer_thread: Optional[threading.Thread] = None
        self._timer_running = False
        
        # Referencias a componentes
        self._componentes: Dict[str, Any] = {}
    
    # === LIFECYCLE ===
    
    def start(self, **kwargs) -> Dict:
        """Inicia el modo"""
        with self._lock:
            if self._state['fase'] != 'waiting':
                return {'error': 'Modo ya iniciado'}
            
            self._state['fase'] = 'active'
            self._initialize_components()
            self._load_questions()
            self._start_timer()
            self._emit('mode_started', {'mode_id': self.mode_id})
            
            # Actualizar sesión
            self.session.state = self._state.copy()
            return {'ok': True, 'state': self.get_state()}
    
    def stop(self) -> Dict:
        """Detiene el modo completamente"""
        with self._lock:
            self._timer_running = False
            if self._timer_thread:
                self._timer_thread.join(timeout=2)
            
            self._state['fase'] = 'finished'
            self._emit('mode_stopped', {'mode_id': self.mode_id})
            return {'ok': True}
    
    def pause(self) -> Dict:
        with self._lock:
            if self._state['fase'] != 'active':
                return {'error': 'Modo no activo'}
            self._state['fase'] = 'paused'
            self._emit('mode_paused', {})
            return {'ok': True}
    
    def resume(self) -> Dict:
        with self._lock:
            if self._state['fase'] != 'paused':
                return {'error': 'Modo no pausado'}
            self._state['fase'] = 'active'
            self._emit('mode_resumed', {})
            return {'ok': True}
    
    # === COMPONENTES ===
    
    def _initialize_components(self):
        """Inicializa componentes según config"""
        cfg = self.config
        
        # Preguntas
        if 'preguntas' in cfg:
            self._componentes['preguntas'] = PreguntasComponent(cfg['preguntas'])
        
        # Timer
        if 'timer' in cfg:
            self._componentes['timer'] = TimerComponent(cfg['timer'])
        
        # Scoring
        if 'scoring' in cfg:
            self._componentes['scoring'] = ScoringComponent(cfg['scoring'])
        
        # Audio
        if 'audio' in cfg:
            self._componentes['audio'] = AudioComponent(cfg['audio'])
        
        # Visual
        if 'visual' in cfg:
            self._componentes['visual'] = VisualComponent(cfg['visual'])
    
    def _load_questions(self):
        """Carga preguntas según configuración"""
        if 'preguntas' not in self._componentes:
            return
        
        comp = self._componentes['preguntas']
        source = self.config.get('preguntas', {}).get('source', 'baseActual')
        categoria = self.config.get('preguntas', {}).get('categoria', '')
        cantidad = self.config.get('preguntas', {}).get('cantidad', 10)
        dificultad = self.config.get('preguntas', {}).get('dificultad', 'mixed')

        # Integrar con BD real de preguntas (pym.json) en lugar de mock.
        self._state['preguntas'] = comp.generar_preguntas(
            source, categoria, cantidad, dificultad
        )
    
    # === TIMER ===
    
    def _start_timer(self):
        timer_cfg = self.config.get('timer', {})
        if not timer_cfg:
            return
        
        self._timer_running = True
        self._timer_thread = threading.Thread(target=self._timer_loop, daemon=True)
        self._timer_thread.start()
    
    def _timer_loop(self):
        timer_cfg = self.config.get('timer', {})
        duration = timer_cfg.get('valorInicial', 60)
        alert_at = timer_cfg.get('alertaEn', 10)
        
        self._state['timer'] = {
            'total': duration,
            'restante': duration,
            'alerta_en': alert_at,
            'formato': timer_cfg.get('formato', 'mm:ss')
        }
        
        while self._timer_running and self._state['fase'] == 'active':
            time.sleep(1)
            with self._lock:
                if not self._timer_running or self._state['fase'] != 'active':
                    break
                
                self._state['timer']['restante'] -= 1
                
                # Eventos de timer
                if self._state['timer']['restante'] == alert_at:
                    self._emit('timer_alert', {'restante': alert_at})
                elif self._state['timer']['restante'] <= 0:
                    self._emit('timer_expired', {})
                    self._handle_timer_expired()
                    break
                
                # Actualizar sesión cada 5s
                if self._state['timer']['restante'] % 5 == 0:
                    self._sync_session()
    
    def _handle_timer_expired(self):
        """Maneja expiración de timer"""
        # Auto-contestar incorrecto o pasar pregunta
        self._emit('timer_expired_action', {})
        self.next_question()
    
    # === FLUJO PREGUNTAS ===
    
    def answer_question(self, player_id: str, answer_index: int) -> Dict:
        """Procesa respuesta de jugador"""
        with self._lock:
            if self._state['fase'] != 'active':
                return {'error': 'Modo no activo'}
            
            if not self._state['preguntas']:
                return {'error': 'Sin preguntas cargadas'}
            
            pregunta = self._state['preguntas'][self._state['pregunta_actual']]
            correcta = pregunta.get('respuesta_correcta', 0) == answer_index
            
            # Calcular puntos
            puntos = 0
            if 'scoring' in self._componentes:
                puntos = self._componentes['scoring'].calculate(
                    correcta, 
                    self._state.get('racha_actual', {}).get(player_id, 0)
                )
            
            # Actualizar puntuación
            if player_id not in self._state['puntuaciones']:
                self._state['puntuaciones'][player_id] = 0
            self._state['puntuaciones'][player_id] += puntos
            
            # Actualizar racha
            if correcta:
                self._state['racha_actual'][player_id] = self._state['racha_actual'].get(player_id, 0) + 1
            else:
                self._state['racha_actual'][player_id] = 0
            
            # Efectos audio/visual
            if 'audio' in self._componentes:
                self._componentes['audio'].play('correct' if correcta else 'incorrect')
            if 'visual' in self._componentes:
                self._componentes['visual'].trigger('correct' if correcta else 'incorrect')
            
            self._emit('question_answered', {
                'player_id': player_id,
                'correct': correcta,
                'points': puntos,
                'streak': self._state['racha_actual'][player_id]
            })
            
            # Auto-siguiente pregunta después de delay
            threading.Timer(1.5, self.next_question).start()
            
            return {
                'ok': True,
                'correct': correcta,
                'points': puntos,
                'new_score': self._state['puntuaciones'][player_id]
            }
    
    def next_question(self) -> Dict:
        """Avanza a siguiente pregunta"""
        with self._lock:
            self._state['pregunta_actual'] += 1
            
            if self._state['pregunta_actual'] >= len(self._state['preguntas']):
                return self.finish()
            
            # Reset timer
            if 'timer' in self._componentes:
                self._componentes['timer'].reset()
            
            self._emit('next_question', {
                'question_index': self._state['pregunta_actual'],
                'question': self._state['preguntas'][self._state['pregunta_actual']]
            })
            return {'ok': True}
    
    def finish(self) -> Dict:
        """Finaliza modo y calcula ganador"""
        with self._lock:
            self._state['fase'] = 'finished'
            self._timer_running = False
            
            # Determinar ganador
            puntuaciones = self._state['puntuaciones']
            ganador = max(puntuaciones.items(), key=lambda x: x[1])[0] if puntuaciones else None
            
            self._emit('mode_finished', {
                'winner': ganador,
                'scores': puntuaciones,
                'final_state': self._state.copy()
            })
            
            return {'ok': True, 'winner': ganador, 'scores': puntuaciones}
    
    # === ESTADO Y EVENTOS ===
    
    def get_state(self) -> Dict:
        with self._lock:
            return self._state.copy()
    
    def _sync_session(self):
        """Sincroniza estado con GameStateManager"""
        self.session.state = self._state.copy()
        game_state_manager.update_session_state(self.session.session_id, self._state)
    
    def _emit(self, event_type: str, payload: Dict):
        """Emite evento a listeners y SSE"""
        event = ModeEvent(event_type, payload)
        self._state['eventos'].append({
            'type': event_type,
            'payload': payload,
            'timestamp': event.timestamp
        })
        
        # Callbacks locales
        for handler in self._event_handlers.get(event_type, []):
            try:
                handler(payload)
            except Exception as e:
                print(f"[DynamicMode] Error en handler {event_type}: {e}")
        
        # SSE via GameStateManager
        game_state_manager._emit_event(self.session.session_id, event_type, payload)
    
    def on(self, event_type: str, handler: Callable):
        """Registra handler de evento"""
        if event_type not in self._event_handlers:
            self._event_handlers[event_type] = []
        self._event_handlers[event_type].append(handler)
    
    def handle_action(self, action: str, data: Dict) -> Dict:
        """Maneja acciones externas (API)"""
        handlers = {
            'start': self.start,
            'stop': self.stop,
            'pause': self.pause,
            'resume': self.resume,
            'answer': lambda d: self.answer_question(d['player_id'], d['answer']),
            'next': self.next_question,
        }
        
        handler = handlers.get(action)
        if handler:
            return handler(data)
        return {'error': f'Acción desconocida: {action}'}


# === COMPONENTES BASE ===

class BaseComponent:
    def __init__(self, config: Dict):
        self.config = config
    
    def reset(self):
        pass

class PreguntasComponent(BaseComponent):
    def generar_preguntas(self, source: str, categoria: str, cantidad: int, dificultad: str) -> List[Dict]:
        """Carga preguntas reales desde la base de datos (pym.json).

        Soporta filtrado por categoría y dificultad, barajado y recorte a la
        cantidad solicitada. Si la BD está vacía, degrada a un mock mínimo para
        no romper el modo. Devuelve una lista normalizada con la forma que espera
        el resto del motor (texto, opciones, respuesta_correcta, dificultad, categoria).
        """
        banco = load_questions()
        if not banco:
            return self._mock(cantidad, categoria, dificultad)

        def normaliza(p: Dict) -> Dict:
            opciones = p.get('opciones') or p.get('options') or ['A', 'B', 'C', 'D']
            rc = p.get('respuesta_correcta', p.get('correcta', p.get('answer')))
            if rc is None:
                rc = 0
            elif isinstance(rc, str):
                try:
                    rc = ['A', 'B', 'C', 'D'].index(rc.upper())
                except ValueError:
                    rc = 0
            return {
                'id': p.get('id', p.get('qid', f'q_{id(p)}')),
                'texto': p.get('texto') or p.get('pregunta') or p.get('question') or '',
                'opciones': opciones,
                'respuesta_correcta': rc,
                'dificultad': p.get('dificultad', dificultad),
                'categoria': p.get('categoria', categoria),
                'explicacion': p.get('explicacion', '')
            }

        filtradas = banco
        if categoria:
            filtradas = [p for p in filtradas if (p.get('categoria') or '').lower() == categoria.lower()]
        if dificultad and dificultad != 'mixed':
            filtradas = [p for p in filtradas if (p.get('dificultad') or '').lower() == dificultad.lower()]

        if not filtradas:
            filtradas = banco

        mezcladas = list(filtradas)
        random.shuffle(mezcladas)
        seleccionadas = mezcladas[:max(1, cantidad)]
        return [normaliza(p) for p in seleccionadas]

    @staticmethod
    def _mock(cantidad: int, categoria: str, dificultad: str) -> List[Dict]:
        return [{
            'id': f'q_{i}',
            'texto': f'Pregunta {i+1} de {categoria or "general"}',
            'opciones': ['A', 'B', 'C', 'D'],
            'respuesta_correcta': i % 4,
            'dificultad': dificultad,
            'categoria': categoria,
            'explicacion': ''
        } for i in range(cantidad)]

class TimerComponent(BaseComponent):
    def __init__(self, config: Dict):
        super().__init__(config)
        self.duration = config.get('valorInicial', 60)
        self.remaining = self.duration
    
    def reset(self):
        self.remaining = self.duration

class ScoringComponent(BaseComponent):
    def calculate(self, correct: bool, streak: int) -> int:
        cfg = self.config
        if not correct:
            return cfg.get('incorrecto', -3)
        
        base = cfg.get('correcto', 10)
        if streak > 0:
            multiplier = cfg.get('multiplicador_racha', 1.2)
            return int(base * (multiplier ** min(streak, 5)))
        return base

class AudioComponent(BaseComponent):
    def play(self, sound_type: str):
        # Integrar con SoundService existente
        pass

class VisualComponent(BaseComponent):
    def trigger(self, effect_type: str):
        # Integrar con ThemeEngine existente
        pass