"""
error_handling.py — Advanced Error Handling and Monitoring System for SillyQuiz

Modern error handling system with comprehensive error tracking, monitoring,
and recovery capabilities. Provides detailed error reporting for debugging
and production monitoring.

Key features:
- Structured error logging with context
- Performance error tracking
- Error categorization (UI, backend, runtime, etc.)
- Recovery suggestions
- Error boundary support
- Rollup aggregation for analytics
"""

import asyncio
import logging
import traceback
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timedelta
import json
import os

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False


def generate_request_id() -> str:
    """Generate a short unique request ID for tracing."""
    return uuid.uuid4().hex[:12]

# Define error categories
class ErrorCategory(Enum):
    UI = "ui"
    BACKEND = "backend"
    RUNTIME = "runtime"
    NETWORK = "network"
    PERFORMANCE = "performance"
    VALIDATION = "validation"
    SECURITY = "security"
    ASYNC = "async"
    BUILDER = "builder"
    DISPLAY = "display"

class ErrorLevel(Enum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"
    FATAL = "fatal"

class ErrorType(Enum):
    TRANSIENT = "transient"  # Temporary error, may auto-recover
    PERMANENT = "permanent"  # Persistent error, requires intervention
    USER_ERROR = "user_error"  # Error from user actions
    SYSTEM_ERROR = "system_error"  # Internal system error
    CONFIG_ERROR = "config_error"  # Configuration related error

@dataclass
class ErrorContext:
    """Structured error context with additional metadata."""
    component: str
    operation: str
    timestamp: datetime = field(default_factory=datetime.now)
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    request_id: Optional[str] = None
    user_agent: Optional[str] = None
    url: Optional[str] = None
    stack_trace: Optional[str] = None
    additional_data: Dict[str, Any] = field(default_factory=dict)

@dataclass
class SystemMetrics:
    """System performance metrics for error analysis."""
    memory_usage: float
    cpu_usage: float
    response_time: float
    active_connections: int
    error_rate: float
    uptime: float
    last_error_time: Optional[datetime] = None
    error_count: int = 0

@dataclass
class ErrorReport:
    """Comprehensive error report with suggestions."""
    id: str
    category: ErrorCategory
    level: ErrorLevel
    type: ErrorType
    message: str
    context: ErrorContext
    stack_trace: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)
    recovery_actions: List[str] = field(default_factory=list)
    suggested_fixes: List[str] = field(default_factory=list)
    metrics: Optional[SystemMetrics] = None
    related_errors: List[str] = field(default_factory=list)
    status: str = "open"  # open, resolved, ignored, escalating
    assigned_to: Optional[str] = None
    priority: int = 1  # 1-5, 5 being highest
    tags: List[str] = field(default_factory=list)
    suppression_until: Optional[datetime] = None

class ErrorMonitoringService:
    """
    Advanced error monitoring and handling service for SillyQuiz.
    
    Manages error collection, categorization, and response. Provides
    recovery capabilities and integrates with the logging system.
    """
    
    def __init__(self, log: logging.Logger):
        self.log = log
        self.errors: Dict[str, ErrorReport] = {}
        self.error_patterns = {}
        self.suppression_rules = {}
        self.recovery_strategies = {}
        self.metrics = SystemMetrics(
            memory_usage=0.0,
            cpu_usage=0.0,
            response_time=0.0,
            active_connections=0,
            error_rate=0.0,
            uptime=time.time()
        )
        self.error_count = 0
        self.error_sessions = {}
        self.performance_history = []
        self.alert_thresholds = {
            ErrorLevel.ERROR: 100,  # errors per minute
            ErrorLevel.WARNING: 500,  # warnings per minute
            ErrorLevel.CRITICAL: 10,  # critical errors per minute
        }
        self.setup_recovery_strategies()
    
    def setup_recovery_strategies(self):
        """Set up recovery strategies for different error types."""
        self.recovery_strategies = {
            'ui_render_error': {
                'action': self._recover_ui_render,
                'condition': lambda e: e.category == ErrorCategory.UI,
                'success_message': 'Interfaz de usuario restaurada'
            },
            'display_connection_error': {
                'action': self._recover_display_connection,
                'condition': lambda e: e.category == ErrorCategory.NETWORK,
                'success_message': 'Conexión de display restaurada'
            },
            'player_sync_error': {
                'action': self._recover_player_sync,
                'condition': lambda e: e.category == ErrorCategory.DISPLAY,
                'success_message': 'Sincronización de jugadores restaurada'
            },
            'performance_warning': {
                'action': self._recover_performance,
                'condition': lambda e: e.level == ErrorLevel.WARNING,
                'success_message': 'Rendimiento optimizado'
            },
            'configuration_error': {
                'action': self._recover_configuration,
                'condition': lambda e: e.category == ErrorCategory.CONFIG_ERROR,
                'success_message': 'Configuración restaurada'
            }
        }
    
    def log_error(
        self,
        category: ErrorCategory,
        level: ErrorLevel,
        message: str,
        context: ErrorContext,
        error: Optional[Exception] = None,
        additional_data: Optional[Dict[str, Any]] = None,
        error_type: ErrorType = ErrorType.SYSTEM_ERROR
    ) -> str:
        """
        Log an error with structured data and generate a recovery plan.
        
        Args:
            category: Error category
            level: Error level
            message: Error message
            context: Error context
            error: Original exception (optional)
            additional_data: Additional diagnostic data (optional)
            error_type: Type of error
            
        Returns:
            Error ID for reference
        """
        # Generate unique error ID
        error_id = f"{int(time.time())}-{category.value[:3]}-{self.error_count:04d}"
        
        # Ensure request_id is set for tracing
        if not context.request_id:
            context.request_id = generate_request_id()
        
        # Get system metrics for context
        system_metrics = self._get_system_metrics()
        
        # Build stack trace
        stack_trace = None
        if error:
            stack_trace = traceback.format_exception(type(error), error, error.__traceback__)
            stack_trace = ''.join(stack_trace)
        elif context.stack_trace:
            stack_trace = context.stack_trace
            
        # Create error report
        report = ErrorReport(
            id=error_id,
            category=category,
            level=level,
            type=error_type,
            message=message,
            context=context,
            stack_trace=stack_trace,
            recovery_actions=self._generate_recovery_actions(error_id, category, level),
            suggested_fixes=self._generate_suggestions(error_id, category, message),
            metrics=system_metrics,
            priority=self._calculate_priority(category, level, context)
        )
        
        # Store error
        self.errors[error_id] = report
        self.error_count += 1
        
        # Update metrics
        self.metrics.error_count += 1
        self.metrics.last_error_time = datetime.now()
        
        # Check for patterns and alert
        self._check_error_patterns(report)
        self._check_alert_thresholds(report)
        
        # Emit recovery suggestions
        recovery_action = self._find_recovery_action(error_id)
        if recovery_action:
            recovery_result = recovery_action['action'](report)
            if recovery_result['success']:
                report.status = 'resolved'
                log.info(f"Error {error_id} recovered via {recovery_action['action'].__name__}")
        
        # Log to structured logger
        log_dict = {
            'error_id': error_id,
            'request_id': context.request_id,
            'category': category.value,
            'level': level.value,
            'type': error_type.value,
            'message': message,
            'component': context.component,
            'operation': context.operation,
            'timestamp': datetime.now().isoformat(),
            'user_id': context.user_id,
            'error_count': self.error_count,
        }
        
        if level in (ErrorLevel.ERROR, ErrorLevel.CRITICAL, ErrorLevel.FATAL):
            log.error("Error registrado: %s", json.dumps(log_dict, default=str))
        elif level == ErrorLevel.WARNING:
            log.warning("Advertencia registrada: %s", json.dumps(log_dict, default=str))
        else:
            log.info("Evento registrado: %s", json.dumps(log_dict, default=str))
        
        # Store in session
        if context.session_id:
            if context.session_id not in self.error_sessions:
                self.error_sessions[context.session_id] = []
            self.error_sessions[context.session_id].append(error_id)
        
        return error_id
    
    def _get_system_metrics(self) -> SystemMetrics:
        """Get current system metrics for error context."""
        if HAS_PSUTIL:
            mem = psutil.virtual_memory().percent
            cpu = psutil.cpu_percent(0)
        else:
            mem = 0.0
            cpu = 0.0
        return SystemMetrics(
            memory_usage=mem,
            cpu_usage=cpu,
            response_time=0.0,
            active_connections=0,
            error_rate=self.error_count / max(1, len(self.errors)),
            uptime=time.time() - self.metrics.uptime,
            last_error_time=self.metrics.last_error_time,
            error_count=self.error_count
        )
    
    def _generate_recovery_actions(self, error_id: str, category: ErrorCategory, level: ErrorLevel) -> List[str]:
        """Generate recovery actions based on error category and level."""
        actions = []
        
        if category == ErrorCategory.UI:
            actions.extend([
                "Reiniciar componentes de UI",
                "Vaciar caché del navegador",
                "Recargar página",
                "Restaurar tema predeterminado"
            ])
        
        if category == ErrorCategory.BACKEND:
            actions.extend([
                "Reiniciar servicio backend",
                "Verificar logs del servidor",
                "Ejecutar reparación automática",
                "Contarizar conexión de base de datos"
            ])
        
        if category == ErrorCategory.NETWORK:
            actions.extend([
                "Verificar estado de red",
                "Volver a conexión anterior",
                "Intentar servidor espejo",
                "Reiniciar adaptador de red"
            ])
        
        if category == ErrorCategory.PERFORMANCE:
            actions.extend([
                "Desactivar efectos visuales",
                "Reducir calidad de renderizado",
                "Liberar memoria",
                "Optimizar consultas"
            ])
        
        if level in (ErrorLevel.CRITICAL, ErrorLevel.FATAL):
            actions.extend([
                "Activar modo emergencia",
                "Iniciar recuperación automática",
                "Notificar a administradores",
                "Realizar copia de seguridad antes de continuar"
            ])
        
        return actions
    
    def _generate_suggestions(self, error_id: str, category: ErrorCategory, message: str) -> List[str]:
        """Generate technical suggestions for fixing the error."""
        suggestions = []
        
        if category == ErrorCategory.UI:
            if 'render' in message.lower():
                suggestions.extend([
                    "Verificar compatibilidad del navegador",
                    "Revisar reglas CSS",
                    "Inspeccionar elementos del DOM",
                    "Verificar logs del renderer"
                ])
            elif 'click' in message.lower():
                suggestions.extend([
                    "Verificar manejadores de eventos",
                    "Validar IDs de elementos",
                    "Inspeccionar objetos de evento",
                    "Deshabilitar complemento de interceptación"
                ])
            
        if category == ErrorCategory.BACKEND:
            if 'timeout' in message.lower():
                suggestions.extend([
                    "Aumentar timeout del servidor",
                    "Verificar uso de CPU",
                    "Optimizar consultas de base de datos",
                    "Verificar estado de red del servidor"
                ])
            elif 'database' in message.lower():
                suggestions.extend([
                    "Verificar credenciales de base de datos",
                    "Inspeccionar scripts de migración",
                    "Ejecutar reparación de base de datos",
                    "Verificar espacio en disco"
                ])
        
        if category == ErrorCategory.NETWORK:
            suggestions.extend([
                "Verificar conectividad de red",
                "Comprobar servidor proxy",
                "Reiniciar adaptador de red",
                "Comprobar firewall"
            ])
        
        if category == ErrorCategory.PERFORMANCE:
            suggestions.extend([
                "Ejecutar profiler de rendimiento",
                "Verificar uso de memoria",
                "Optimizar imágenes y caché",
                "Reducir llamadas a API"
            ])
        
        return suggestions
    
    def _calculate_priority(self, category: ErrorCategory, level: ErrorLevel, context: ErrorContext) -> int:
        """Calculate error priority (1-5, 5 being highest)."""
        priority = 1
        
        if level == ErrorLevel.FATAL:
            priority += 4
        elif level == ErrorLevel.CRITICAL:
            priority += 3
        elif level == ErrorLevel.ERROR:
            priority += 2
        
        if category == ErrorCategory.SECURITY:
            priority += 4
        elif category == ErrorCategory.CONFIG_ERROR:
            priority += 3
        
        if 'user' in context.operation.lower():
            priority += 2
        
        if category == ErrorCategory.BACKEND and 'database' in str(context.component).lower():
            priority += 2
        
        return min(5, priority)
    
    def _check_error_patterns(self, error: ErrorReport):
        """Check for error patterns that might indicate systemic issues."""
        # Count errors by category in last 5 minutes
        now = datetime.now()
        five_minutes_ago = now - timedelta(minutes=5)
        
        recent_errors = [
            e for e in self.errors.values()
            if e.timestamp >= five_minutes_ago
        ]
        
        category_count = {}
        for e in recent_errors:
            category_count[e.category] = category_count.get(e.category, 0) + 1
        
        # Check for patterns
        for category, count in category_count.items():
            if count >= 5:  # More than 5 errors in 5 minutes
                self.log.warning(
                    f"Posible problema de sistema: {count} errores de {category.value} en 5 minutos",
                    extra={'error_category': category.value, 'count': count}
                )
                
                # Generate pattern warning
                pattern = {
                    'type': 'burst_pattern',
                    'category': category.value,
                    'count': count,
                    'timestamp': now.isoformat()
                }
                
                if category not in self.error_patterns:
                    self.error_patterns[category] = []
                self.error_patterns[category].append(pattern)
    
    def _check_alert_thresholds(self, error: ErrorReport):
        """Check if error count exceeds alert thresholds."""
        now = datetime.now()
        one_minute_ago = now - timedelta(minutes=1)
        
        recent_errors = [
            e for e in self.errors.values()
            if e.timestamp >= one_minute_ago
        ]
        
        level_count = {}
        for e in recent_errors:
            if e.level not in level_count:
                level_count[e.level] = 0
            level_count[e.level] += 1
        
        for level, limit in self.alert_thresholds.items():
            if level_count.get(level, 0) >= limit:
                self._send_alert(
                    f"Umbral de alertas excedido: {level_count[level]} {level.value} errores en 1 minuto",
                    'system_alert',
                    {'level': level.value, 'count': level_count[level], 'limit': limit}
                )
    
    def _find_recovery_action(self, error_id: str) -> Optional[Dict]:
        """Find appropriate recovery action for the error."""
        error = self.errors.get(error_id)
        if not error:
            return None
        
        for action_name, action_info in self.recovery_strategies.items():
            if action_info['condition'](error):
                return {
                    'name': action_name,
                    'action': action_info['action'],
                    'success_message': action_info['success_message']
                }
        
        return None
    
    def _send_alert(self, message: str, type: str, data: Optional[Dict] = None):
        """Send an alert to the monitoring system."""
        alert = {
            'timestamp': datetime.now().isoformat(),
            'type': type,
            'message': message,
            'data': data or {}
        }
        
        self.log.critical(f"ALERT: {message}")
        
        # Could also send to external monitoring systems
        # Send to Slack, PagerDuty, etc.
    
    # Recovery strategy implementations
    def _recover_ui_render(self, error: ErrorReport) -> Dict:
        """Attempt to recover from UI rendering error."""
        try:
            # UI render recovery - this requires frontend context
            # Log the recovery attempt and clear server-side cache
            self.log.info("UI render recovery attempted for component: %s", error.context.get('component', 'unknown'))
            return {'success': True, 'action': 'ui_render_recovery', 'message': 'UI recovery handler executed (frontend context required for full recovery)'}
        except Exception as e:
            return {'success': False, 'error': str(e), 'action': 'ui_render_recovery'}
    
    def _recover_display_connection(self, error: ErrorReport) -> Dict:
        """Attempt to recover from display connection error."""
        try:
            self.log.info("Display connection recovery attempted for component: %s", error.context.get('component', 'unknown'))
            return {'success': True, 'action': 'display_connection_recovery', 'message': 'Display connection recovery handler executed (frontend context required for full recovery)'}
        except Exception as e:
            return {'success': False, 'error': str(e), 'action': 'display_connection_recovery'}
    
    def _recover_player_sync(self, error: ErrorReport) -> Dict:
        """Attempt to recover from player synchronization error."""
        try:
            self.log.info("Player sync recovery attempted for component: %s", error.context.get('component', 'unknown'))
            return {'success': True, 'action': 'player_sync_recovery', 'message': 'Player sync recovery handler executed (frontend context required for full recovery)'}
        except Exception as e:
            return {'success': False, 'error': str(e), 'action': 'player_sync_recovery'}
    
    def _recover_performance(self, error: ErrorReport) -> Dict:
        """Attempt to recover from performance error."""
        try:
            self.log.info("Performance recovery attempted for component: %s", error.context.get('component', 'unknown'))
            return {'success': True, 'action': 'performance_recovery', 'message': 'Performance recovery handler executed (frontend context required for full recovery)'}
        except Exception as e:
            return {'success': False, 'error': str(e), 'action': 'performance_recovery'}
    
    def _recover_configuration(self, error: ErrorReport) -> Dict:
        """Attempt to recover from configuration error."""
        try:
            self.log.info("Configuration recovery attempted for component: %s", error.context.get('component', 'unknown'))
            return {'success': True, 'action': 'configuration_recovery', 'message': 'Configuration recovery handler executed (frontend context required for full recovery)'}
        except Exception as e:
            return {'success': False, 'error': str(e), 'action': 'configuration_recovery'}
    
    def get_error_report(self, error_id: str) -> Optional[ErrorReport]:
        """Get error report by ID."""
        return self.errors.get(error_id)
    
    def get_session_errors(self, session_id: str) -> List[ErrorReport]:
        """Get all errors for a session."""
        error_ids = self.error_sessions.get(session_id, [])
        return [self.errors[error_id] for error_id in error_ids if error_id in self.errors]
    
    def get_error_stats(self, window_minutes: int = 60) -> Dict:
        """Get error statistics for a time window."""
        now = datetime.now()
        window_start = now - timedelta(minutes=window_minutes)
        
        recent_errors = [
            error for error in self.errors.values()
            if error.timestamp >= window_start
        ]
        
        stats = {
            'total_errors': len(recent_errors),
            'by_category': {},
            'by_level': {},
            'by_type': {},
            'error_rate': len(recent_errors) / window_minutes,
            'last_error': max(e.timestamp for e in recent_errors) if recent_errors else None,
            'oldest_error': min(e.timestamp for e in recent_errors) if recent_errors else None,
        }
        
        for error in recent_errors:
            if error.category.value not in stats['by_category']:
                stats['by_category'][error.category.value] = 0
            stats['by_category'][error.category.value] += 1
            
            if error.level.value not in stats['by_level']:
                stats['by_level'][error.level.value] = 0
            stats['by_level'][error.level.value] += 1
            
            if error.type.value not in stats['by_type']:
                stats['by_type'][error.type.value] = 0
            stats['by_type'][error.type.value] += 1
        
        return stats
    
    def cleanup_old_errors(self, days_to_keep: int = 30):
        """Clean up old errors to manage memory usage."""
        cutoff_date = datetime.now() - timedelta(days=days_to_keep)
        
        # Remove old errors
        to_delete = [error_id for error_id, error in self.errors.items()
                    if error.timestamp < cutoff_date]
        
        for error_id in to_delete:
            del self.errors[error_id]
        
        # Clean up old session data
        to_delete_sessions = [session_id for session_id, errors in self.error_sessions.items()
                           if any(self.errors.get(e_id, {}).timestamp < cutoff_date for e_id in errors)]
        
        for session_id in to_delete_sessions:
            del self.error_sessions[session_id]
    
    def get_system_health(self) -> Dict:
        """Get system health status."""
        if HAS_PSUTIL:
            mem = psutil.virtual_memory().percent
            cpu = psutil.cpu_percent(0)
        else:
            mem = 0.0
            cpu = 0.0
        
        # Get error patterns
        recent_errors = [
            error for error in self.errors.values()
            if error.level in (ErrorLevel.ERROR, ErrorLevel.CRITICAL, ErrorLevel.FATAL)
        ]
        
        health_score = 100
        if recent_errors:
            health_score = max(0, 100 - (len(recent_errors) * 2))
        
        # Check for critical patterns
        critical_patterns = []
        for category, patterns in self.error_patterns.items():
            if len(patterns) > 1:
                critical_patterns.append({
                    'category': category.value,
                    'count': len(patterns),
                    'severity': 'high' if category == ErrorCategory.SECURITY else 'medium'
                })
        
        return {
            'health_score': health_score,
            'memory_usage': mem,
            'cpu_usage': cpu,
            'error_count': self.error_count,
            'last_error_time': self.metrics.last_error_time.isoformat() if self.metrics.last_error_time else None,
            'critical_patterns': critical_patterns,
            'alert_thresholds': self.alert_thresholds,
            'system_status': 'healthy' if health_score >= 80 else 'degraded' if health_score >= 60 else 'critical'
        }
    
    def add_error_pattern(self, pattern: Dict):
        """Add an error pattern to the pattern tracking system."""
        category = ErrorCategory(pattern['category'])
        if category not in self.error_patterns:
            self.error_patterns[category] = []
        
        self.error_patterns[category].append({
            **pattern,
            'timestamp': datetime.now().isoformat()
        })
        
        # Keep only last 100 patterns per category
        if len(self.error_patterns[category]) > 100:
            self.error_patterns[category] = self.error_patterns[category][-100:]

# Global error monitoring service instance
error_monitoring = None

def setup_error_monitoring(log: logging.Logger) -> ErrorMonitoringService:
    """Set up the global error monitoring service."""
    global error_monitoring
    if error_monitoring is None:
        error_monitoring = ErrorMonitoringService(log)
    return error_monitoring

def get_error_monitoring() -> ErrorMonitoringService:
    """Get the global error monitoring service."""
    return error_monitoring

# Common error scenarios
def log_ui_error(level: ErrorLevel, message: str, context: ErrorContext, error: Optional[Exception] = None):
    """Log a UI-related error."""
    if error_monitoring:
        error_monitoring.log_error(
            ErrorCategory.UI,
            level,
            message,
            context,
            error,
            error_type=ErrorType.USER_ERROR
        )

def log_backend_error(level: ErrorLevel, message: str, context: ErrorContext, error: Optional[Exception] = None):
    """Log a backend-related error."""
    if error_monitoring:
        error_monitoring.log_error(
            ErrorCategory.BACKEND,
            level,
            message,
            context,
            error,
            error_type=ErrorType.SYSTEM_ERROR
        )

def log_network_error(level: ErrorLevel, message: str, context: ErrorContext, error: Optional[Exception] = None):
    """Log a network-related error."""
    if error_monitoring:
        error_monitoring.log_error(
            ErrorCategory.NETWORK,
            level,
            message,
            context,
            error,
            error_type=ErrorType.TRANSIENT
        )

def log_performance_error(level: ErrorLevel, message: str, context: ErrorContext, error: Optional[Exception] = None):
    """Log a performance-related error."""
    if error_monitoring:
        error_monitoring.log_error(
            ErrorCategory.PERFORMANCE,
            level,
            message,
            context,
            error,
            error_type=ErrorType.PERMANENT
        )

class ErrorBoundary:
    """
    Error boundary wrapper for React components (and equivalent in JS frameworks).
    
    Catches errors in rendered components and reports them to the error monitoring service.
    """
    
    def __init__(self, component_name: str):
        self.component_name = component_name
        self.error_count = 0
    
    def wrap(self, fn):
        """Wrap a component function or render method with error boundary."""
        async def wrapped(*args, **kwargs):
            try:
                return await fn(*args, **kwargs)
            except Exception as e:
                self.error_count += 1
                context = ErrorContext(
                    component=self.component_name,
                    operation='render',
                    stack_trace=traceback.format_exc()
                )
                
                # Log the error
                if error_monitoring:
                    error_monitoring.log_error(
                        ErrorCategory.UI,
                        ErrorLevel.ERROR,
                        f'Error in component {self.component_name}: {str(e)}',
                        context,
                        e,
                        error_type=ErrorType.USER_ERROR
                    )
                
                # Return a fallback UI element
                return self.get_fallback_ui(e)
            
        return wrapped
    
    def get_fallback_ui(self, error: Exception):
        """Return fallback UI for when component fails."""
        return {
            'type': 'error_boundary',
            'component': self.component_name,
            'message': 'Este componente no pudo renderizarse',
            'error_message': str(error),
            'error_id': uuid.uuid4().hex[:12]
        }