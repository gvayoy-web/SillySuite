"""
Registro centralizado de templates de modos.
Maneja carga, validación, versionado y búsqueda.
"""

import json
import threading
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from jsonschema import validate, ValidationError

from .game_state_manager import game_state_manager

TEMPLATES_DIR = Path(__file__).parent.parent / "modo_templates"
BASE_TEMPLATES_DIR = TEMPLATES_DIR / "base"
COMMUNITY_TEMPLATES_DIR = TEMPLATES_DIR / "community"
SCRATCH_TEMPLATES_DIR = TEMPLATES_DIR / "scratch"

# JSON Schema para validación de templates
TEMPLATE_SCHEMA = {
    "type": "object",
    "required": ["id", "nombre", "descripcion", "icono", "categoria", "version", 
                 "template_config", "componentes", "atributos"],
    "properties": {
        "id": {"type": "string", "pattern": "^[a-z0-9-]+$"},
        "nombre": {"type": "string", "minLength": 1, "maxLength": 100},
        "descripcion": {"type": "string", "maxLength": 500},
        "icono": {"type": "string", "minLength": 1},
        "categoria": {"type": "string", "enum": ["quiz", "memory", "timing", "battle", "story", "challenge", "hunter", "custom"]},
        "tags": {"type": "array", "items": {"type": "string"}},
        "version": {"type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$"},
        "autor": {"type": "string"},
        "fecha_creacion": {"type": "string", "format": "date-time"},
        "preview_image": {"type": "string"},
        "descargas": {"type": "integer", "minimum": 0},
        "calificacion": {"type": "number", "minimum": 0, "maximum": 5},
        "template_config": {"type": "object"},
        "componentes": {"type": "array", "items": {"type": "string"}},
        "atributos": {"type": "object"},
        "original_template_id": {"type": "string"},
        "assets": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "required": ["file", "kind"],
                "properties": {
                    "file": {"type": "string"},
                    "kind": {"type": "string", "enum": ["image", "audio", "video"]}
                }
            }
        }
    }
}

CATEGORIA_CONFIG = {
    "quiz": {"nombre": "Quiz", "icono": "❓", "color": "#3B82F6"},
    "memory": {"nombre": "Memoria", "icono": "🧠", "color": "#10B981"},
    "timing": {"nombre": "Tiempo", "icono": "⏱️", "color": "#F59E0B"},
    "battle": {"nombre": "Batalla", "icono": "⚔️", "color": "#EF4444"},
    "story": {"nombre": "Historia", "icono": "📖", "color": "#8B5CF6"},
    "challenge": {"nombre": "Desafío", "icono": "🏆", "color": "#EC4899"},
    "hunter": {"nombre": "Cazador", "icono": "🏴‍☠️", "color": "#F97316"},
    "custom": {"nombre": "Personalizado", "icono": "🛠️", "color": "#6B7280"}
}

@dataclass
class TemplateMeta:
    id: str
    nombre: str
    descripcion: str
    icono: str
    categoria: str
    tags: List[str]
    version: str
    autor: str
    fecha_creacion: str
    preview_image: str
    descargas: int
    calificacion: float

class TemplateRegistry:
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._templates: Dict[str, Dict] = {}
        self._meta: Dict[str, TemplateMeta] = {}
        self._categorias: set = set()
        self._load_all_templates()
        self._sync_with_database()
    
    def _load_all_templates(self):
        """Carga todos los templates de ambos directorios"""
        self._templates.clear()
        self._meta.clear()
        self._categorias.clear()
        
        # Cargar base templates
        if BASE_TEMPLATES_DIR.exists():
            for template_file in BASE_TEMPLATES_DIR.glob("*.json"):
                self._load_template_file(template_file, is_base=True)
        
        # Cargar community templates
        if COMMUNITY_TEMPLATES_DIR.exists():
            for template_file in COMMUNITY_TEMPLATES_DIR.rglob("*.json"):
                self._load_template_file(template_file, is_base=False)
        
        print(f"[TemplateRegistry] Cargados {len(self._templates)} templates")
        print(f"[TemplateRegistry] Categorías: {sorted(self._categorias)}")
    
    def _load_template_file(self, path: Path, is_base: bool):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                template = json.load(f)

            try:
                validate(instance=template, schema=TEMPLATE_SCHEMA)
            except ValidationError as ve:
                # El schema es estricto; cargamos igualmente con defaults para
                # no dejar vacío el catálogo (la galería del builder lo necesita).
                template = self._normalize_template(template, path)
                print(f"[TemplateRegistry] {path.name} cargado con defaults ({ve.message})")

            template_id = template.get('id') or path.stem
            template['id'] = template_id
            self._templates[template_id] = template
            self._categorias.add(template.get('categoria', 'general'))

            # Meta para listados rápidos
            self._meta[template_id] = TemplateMeta(
                id=template_id,
                nombre=template.get('nombre', template_id),
                descripcion=template.get('descripcion', ''),
                icono=template.get('icono', '🧩'),
                categoria=template.get('categoria', 'general'),
                tags=template.get('tags', []),
                version=template.get('version', '1.0'),
                autor=template.get('autor', 'Sistema'),
                fecha_creacion=template.get('fecha_creacion', time.strftime('%Y-%m-%dT%H:%M:%S')),
                preview_image=template.get('preview_image', ''),
                descargas=template.get('descargas', 0),
                calificacion=template.get('calificacion', 0)
            )
        except (json.JSONDecodeError, ValidationError) as e:
            print(f"[TemplateRegistry] Error cargando {path}: {e}")

    @staticmethod
    def _normalize_template(t: Dict, path: Path) -> Dict:
        t = dict(t)
        t.setdefault('id', path.stem)
        t.setdefault('nombre', t['id'])
        t.setdefault('descripcion', '')
        t.setdefault('icono', '🧩')
        t.setdefault('categoria', 'general')
        t.setdefault('version', '1.0')
        t.setdefault('template_config', {})
        t.setdefault('componentes', t.get('componentes', []))
        t.setdefault('atributos', {})
        return t
    
    def _sync_with_database(self):
        """Sincroniza templates con base de datos para búsqueda rápida"""
        for template in self._templates.values():
            try:
                game_state_manager.save_template_metadata(template)
            except Exception as e:
                print(f"[TemplateRegistry] Error sincronizando {template['id']}: {e}")
    
    def get_template(self, template_id: str) -> Optional[Dict]:
        return self._templates.get(template_id)
    
    def get_all_templates(self, categoria: str = None) -> List[Dict]:
        templates = list(self._templates.values())
        if categoria:
            templates = [t for t in templates if t['categoria'] == categoria]
        return sorted(templates, key=lambda t: t['nombre'])
    
    def get_template_meta(self, template_id: str) -> Optional[TemplateMeta]:
        return self._meta.get(template_id)
    
    def get_all_meta(self, categoria: str = None) -> List[TemplateMeta]:
        metas = list(self._meta.values())
        if categoria:
            metas = [m for m in metas if m.categoria == categoria]
        return sorted(metas, key=lambda m: m.nombre)
    
    def search_templates(self, query: str) -> List[Dict]:
        q = query.lower()
        results = []
        for t in self._templates.values():
            if (q in t['nombre'].lower() or 
                q in t['descripcion'].lower() or
                any(q in tag.lower() for tag in t.get('tags', []))):
                results.append(t)
        return results
    
    def get_categories(self) -> List[Dict]:
        return [
            {"id": cat, "nombre": CATEGORIA_CONFIG[cat]["nombre"], 
             "icono": CATEGORIA_CONFIG[cat]["icono"], 
             "color": CATEGORIA_CONFIG[cat]["color"]}
            for cat in sorted(self._categorias)
        ]
    
    def register_template(self, template_data: Dict, is_community: bool = False) -> bool:
        """Registra nuevo template"""
        try:
            validate(instance=template_data, schema=TEMPLATE_SCHEMA)
        except ValidationError as e:
            print(f"[TemplateRegistry] Template inválido: {e}")
            return False
        
        template_id = template_data['id']
        target_dir = COMMUNITY_TEMPLATES_DIR / "user_templates" if is_community else BASE_TEMPLATES_DIR
        target_dir.mkdir(parents=True, exist_ok=True)
        
        file_path = target_dir / f"{template_id}.json"
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(template_data, f, ensure_ascii=False, indent=2)
        
        # Recargar
        self._load_all_templates()
        return True
    
    def delete_template(self, template_id: str, is_community: bool = False) -> bool:
        """Elimina template"""
        target_dir = COMMUNITY_TEMPLATES_DIR / "user_templates" if is_community else BASE_TEMPLATES_DIR
        file_path = target_dir / f"{template_id}.json"
        
        if file_path.exists():
            file_path.unlink()
            self._load_all_templates()
            return True
        return False
    
    def increment_downloads(self, template_id: str):
        if template_id in self._templates:
            self._templates[template_id]['descargas'] = self._templates[template_id].get('descargas', 0) + 1
            self._save_template(template_id)
            # Actualizar en BD
            game_state_manager.increment_downloads(template_id)
    
    def update_rating(self, template_id: str, new_rating: float):
        if template_id in self._templates:
            current = self._templates[template_id].get('calificacion', 0)
            downloads = self._templates[template_id].get('descargas', 1)
            # Promedio ponderado simple
            new_avg = round((current * (downloads - 1) + new_rating) / downloads, 1)
            self._templates[template_id]['calificacion'] = new_avg
            self._save_template(template_id)
            game_state_manager.update_rating(template_id, new_rating)
    
    def _save_template(self, template_id: str):
        template = self._templates[template_id]
        is_community = template.get('autor') != 'Sistema'
        target_dir = COMMUNITY_TEMPLATES_DIR / "user_templates" if is_community else BASE_TEMPLATES_DIR
        file_path = target_dir / f"{template_id}.json"
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(template, f, ensure_ascii=False, indent=2)


# Instancia global
template_registry = TemplateRegistry()


# ---------------------------------------------------------------------------
# Plantillas en formato Scratch (modelo de bloques del builder visual).
# Se cargan aparte porque usan "heads" en lugar del esquema de modos.
# ---------------------------------------------------------------------------
def list_scratch_templates() -> List[Dict]:
    out = []
    if not SCRATCH_TEMPLATES_DIR.exists():
        return out
    for f in sorted(SCRATCH_TEMPLATES_DIR.glob("*.json")):
        try:
            with open(f, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
            if "heads" in data:
                out.append(data)
        except (json.JSONDecodeError, OSError):
            continue
    return out


def get_scratch_template(tpl_id: str) -> Optional[Dict]:
    path = SCRATCH_TEMPLATES_DIR / f"{tpl_id}.json"
    if not path.exists():
        return None
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        return data if "heads" in data else None
    except (json.JSONDecodeError, OSError):
        return None