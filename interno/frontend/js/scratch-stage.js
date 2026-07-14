"""
Stage Panel Component - Real-time Stage preview for scratch-build.

Implements a comprehensive Stage view with play/pause/stop controls,
event selection, size toggle, and real-time rendering of mode execution.
Designed as a right-panel component for the SillyBuild interface.
"""

import json
import time
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from datetime

@dataclass
class StageState:
    """State management for the Stage component."""
    current_event: str = "when_mode_init"
    is_running: bool = False
    is_paused: bool = False
    size_mode: str = "half"  # compact, half, full
    log_entries: List[Dict[str, Any]] = field(default_factory=list)
    execution_steps: List[Dict[str, Any]] = field(default_factory=list)
    current_theme: Dict[str, str] = field(default_factory=dict)
    components: Dict[str, Any] = field(default_factory=dict)

    def add_log(self, level: str, message: str, block_id: Optional[str] = None):
        """Add a log entry."""
        self.log_entries.append({
            "timestamp": time.time(),
            "level": level,
            "message": message,
            "block_id": block_id
        })
        # Keep only recent logs
        if len(self.log_entries) > 100:
            self.log_entries = self.log_entries[-100:]

    def clear(self):
        """Reset state."""
        self.is_running = False
        self.is_paused = False
        self.log_entries.clear()
        self.execution_steps.clear()
        self.components = {}

    def toggle_pause(self) -> bool:
        """Toggle pause state."""
        if not self.is_running:
            return False
        self.is_paused = not self.is_paused
        return self.is_paused

    def start(self):
        """Start execution."""
        self.is_running = True
        self.is_paused = False

    def stop(self):
        """Stop execution."""
        self.is_running = False
        self.is_paused = False

    def change_event(self, event: str):
        """Change current event."""
        self.current_event = event
        if self.is_running:
            self.stop()

    def get_state_summary(self) -> Dict[str, Any]:
        """Get a summary of the current state."""
        return {
            "event": self.current_event,
            "running": self.is_running,
            "paused": self.is_paused,
            "size_mode": self.size_mode,
            "log_count": len(self.log_entries),
            "components_count": len(self.components),
            "theme": self.current_theme,
        }


class StageEvent:
    """Represents a stage event with execution logic."""

    def __init__(self, name: str, heads: Dict):
        self.name = name
        self.heads = heads  # Scratch blocks heads structure
        self.is_active = True

    def compile(self, from_cache: bool = False) -> Dict[str, Any]:
        """Compile the event into an executable structure."""
        # In a real implementation, this would interface with ScratchAOT
        # For now, return a simple structure
        return {
            "event": self.name,
            "heads": self.heads,
            "compiled": not from_cache,
            "timestamp": time.time()
        }


class StageRenderer:
    """Renders stage content for display."""

    @staticmethod
    def render_state_to_html(state: StageState, target: str) -> str:
        """Render current stage state as HTML."""
        html = f'''
        <div class="stage-screen" data-state="{json.dumps(state.get_state_summary())}">
            <div class="stage-header">
                <span class="stage-event-badge">{state.current_event}</span>
                <span class="stage-status { "running" if state.is_running else "stopped" }">
                    { "🔄 Running" if state.is_running else "⏹ Stopped" }
                </span>
                { "⏸ Paused" if state.is_paused else "" }
            </div>

            <div class="stage-components">
        '''

        for component_type, component_data in state.components.items():
            html += StageRenderer.render_component(component_type, component_data)

        html += '''
            </div>

            <div class="stage-timeline">
                <div class="timeline-header">
                    <span>Evento: {state.current_event}</span>
                    <span>Componentes: {len(state.components)}</span>
                    <span>Entradas de log: {len(state.log_entries)}</span>
                </div>
                <div class="timeline-content">
        '''

        for entry in state.log_entries[-10:]:  # Show recent logs
            html += f'''
                <div class="timeline-entry { "error" if entry["level"] == "error" else "success" if entry["level"] == "success" else "info" }">
                    <span class="entry-time">{time.strftime("%H:%M:%S", time.localtime(entry["timestamp"]))}</span>
                    <span class="entry-level">{entry["level"].upper()}</span>
                    <span class="entry-message">{entry["message"]}</span>
                    { f'<span class="entry-block">({entry["block_id"]})</span>' if entry.get("block_id") else "" }
                </div>
            '''

        html += '''
                </div>
            </div>
        </div>
        '''

        return html

    @staticmethod
    def render_component(component_type: str, component_data: Dict) -> str:
        """Render a single component."""
        mapping = {
            "text": StageRenderer.render_text_component,
            "image": StageRenderer.render_image_component,
            "video": StageRenderer.render_video_component,
            "overlay": StageRenderer.render_overlay_component,
        }

        renderer = mapping.get(component_type, StageRenderer.render_generic_component)
        return renderer(component_type, component_data)

    @staticmethod
    def render_text_component(component_type: str, data: Dict) -> str:
        return f'''
        <div class="stage-component text-component">
            <div class="component-type">Texto</div>
            <div class="component-content">
                <h4>{data.get("title", "")}</h4>
                <p>{data.get("body", "")}</p>
            </div>
        </div>
        '''

    @staticmethod
    def render_image_component(component_type: str, data: Dict) -> str:
        src = data.get("src", "")
        return f'''
        <div class="stage-component image-component">
            <div class="component-type">Imagen</div>
            <div class="component-content">
                <img src="{src}" alt="Imagen del componente" class="component-image" />
            </div>
        </div>
        '''

    @staticmethod
    def render_video_component(component_type: str, data: Dict) -> str:
        src = data.get("src", "")
        return f'''
        <div class="stage-component video-component">
            <div class="component-type">Video</div>
            <div class="component-content">
                <video src="{src}" controls class="component-video"></video>
            </div>
        </div>
        '''

    @staticmethod
    def render_overlay_component(component_type: str, data: Dict) -> str:
        overlay_text = data.get("text", "")
        return f'''
        <div class="stage-component overlay-component">
            <div class="component-type">Overlay</div>
            <div class="component-content">
                <div class="overlay-text">{overlay_text}</div>
            </div>
        </div>
        '''

    @staticmethod
    def render_generic_component(component_type: str, data: Dict) -> str:
        return f'''
        <div class="stage-component generic-component">
            <div class="component-type">{component_type}</div>
            <div class="component-content">
                <pre>{json.dumps(data, indent=2)}</pre>
            </div>
        </div>
        '''


class Stage:
    """Main Stage component that manages stage state and rendering."""

    def __init__(self, parent_element: str, scratch_ui: Any):
        self.parent_element = parent_element
        self.scratch_ui = scratch_ui
        self.state = StageState()
        self.renderer = StageRenderer()
        self.current_compiled_event: Optional[Dict] = None
        self._is_mounted = False

    def mount(self):
        """Mount the Stage component to the DOM."""
        if not self._is_mounted:
            self._is_mounted = True
            self.render()

    def render(self):
        """Render the Stage component."""
        if not self._is_mounted:
            return

        html = self.renderer.render_state_to_html(self.state, self.parent_element)

        # In a real environment, this would set the innerHTML of a DOM element
        # For now, we'll store it for visualization purposes
        self.rendered_html = html

    def handle_event_change(self, event_name: str):
        """Handle event selection change."""
        self.state.change_event(event_name)
        self.render()

    def handle_play_pause(self, action: str):
        """Handle play/pause actions."""
        if action == "play":
            self.state.start()
            # Compile and start execution
            self.execute_current_event()
        elif action == "pause":
            self.state.toggle_pause()
        elif action == "stop":
            self.state.stop()

    def execute_current_event(self):
        """Execute the currently selected event."""
        if not self.scratch_ui or not hasattr(self.scratch_ui, 'heads'):
            return

        event_heads = self.scratch_ui.heads.get(self.state.current_event, {})
        if not event_heads:
            self.state.add_log("info", f"Evento '{self.state.current_event}' no tiene heads definidos")
            return

        # In real implementation, this would interface with ScratchRuntime
        self.state.add_log("info", f"Iniciando ejecución del evento: {self.state.current_event}", "engine")
        self.state.execution_steps.append({
            "timestamp": time.time(),
            "type": "event_start",
            "event": self.state.current_event
        })

    def update_component(self, component_type: str, data: Dict, source: str = "runtime"):
        """Update a component in the stage state."""
        self.state.components[component_type] = data
        self.state.add_log("info", f"Componente actualizado: {component_type} ({source})", f"comp_{component_type}")

    def set_theme(self, theme: Dict[str, str]):
        """Set the theme for the stage."""
        self.state.current_theme = theme

    def toggle_size(self, size_mode: str):
        """Toggle stage size mode."""
        self.state.size_mode = size_mode

    def close(self):
        """Close the Stage component."""
        self.state.stop()
        self._is_mounted = False


# Factory function
def create_stage(parent_selector: str, scratch_ui_instance: Any) -> Stage:
    """Create and return a new Stage instance."""
    parent_element = parent_selector
    stage = Stage(parent_element, scratch_ui_instance)
    stage.mount()
    return stage

if __name__ == "__main__":
    # Example usage (would be in frontend code)
    print("Stage component module loaded")
    print("Example usage:")
    print("  stage = create_stage('#stage-container', scratchUIInstance)")
