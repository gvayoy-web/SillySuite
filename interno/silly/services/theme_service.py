"""Theme service — Complete 25 preset themes with rotation and blending support."""

import json
import os
import random
import hashlib
import threading
from copy import deepcopy
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple

from silly.globals import container
from silly.services.sse import EVENT_DISPLAY_UPDATE


class ThemeRotationManager:
    """Manages theme rotation with intelligent scheduling."""

    def __init__(self):
        self._lock = threading.Lock()
        self._rotation_interval = 300  # Default 5 minutes
        self._is_rotating = False
        self._current_theme_index = 0
        self._excluded_themes = set()
        self._seed = None
        self._last_rotation_time = None

    def configure(self, interval_seconds: int, seed: int = None, exclude_slugs: List[str] = None):
        """Configure rotation settings."""
        with self._lock:
            self._rotation_interval = max(60, min(3600, interval_seconds))  # 1-60 minutes
            if seed is not None:
                self._seed = seed
            self._current_theme_index = 0
            if exclude_slugs is not None:
                self._excluded_themes = set(exclude_slugs)
            self._last_rotation_time = datetime.now()

    def set_exclusion(self, theme_slugs: List[str]):
        """Set themes to exclude from rotation."""
        with self._lock:
            self._excluded_themes = set(theme_slugs)

    def to_dict(self) -> Dict:
        """Serialize rotation state to dict."""
        with self._lock:
            return {
                "interval_seconds": self._rotation_interval,
                "seed": self._seed,
                "excluded_themes": list(self._excluded_themes),
                "is_rotating": self._is_rotating,
                "last_rotation": self._last_rotation_time.isoformat() if self._last_rotation_time else None
            }

    def from_dict(self, data: Dict):
        """Restore rotation state from dict."""
        with self._lock:
            if "interval_seconds" in data:
                self._rotation_interval = max(60, min(3600, int(data["interval_seconds"])))
            if "seed" in data:
                self._seed = data["seed"]
            if "excluded_themes" in data:
                self._excluded_themes = set(data["excluded_themes"])
            if "is_rotating" in data:
                self._is_rotating = bool(data["is_rotating"])
            if "last_rotation" in data and data["last_rotation"]:
                try:
                    self._last_rotation_time = datetime.fromisoformat(data["last_rotation"])
                except:
                    self._last_rotation_time = None

    def get_next_theme(self, current_slug: str, available_slugs: List[str]) -> Tuple[str, bool]:
        """
        Get the next theme in rotation.

        Args:
            current_slug: Current theme slug
            available_slugs: List of all available theme slugs

        Returns:
            Tuple of (next_theme_slug, is_random)
        """
        with self._lock:
            filtered_slugs = [s for s in available_slugs if s not in self._excluded_themes]

            if not filtered_slugs:
                return current_slug, False

            if self._seed is not None:
                random.seed(self._seed)

            # Calculate next index
            if current_slug in filtered_slugs:
                current_index = filtered_slugs.index(current_slug)
                next_index = (current_index + 1) % len(filtered_slugs)
                next_slug = filtered_slugs[next_index]
                self._last_rotation_time = datetime.now()
                return next_slug, False
            else:
                # If current is not in list (first call), return first or random
                if len(filtered_slugs) == 1:
                    self._last_rotation_time = datetime.now()
                    return filtered_slugs[0], False
                else:
                    import time
                    random.seed(int(time.time()) + hash(current_slug))
                    next_slug = random.choice(filtered_slugs)
                    self._last_rotation_time = datetime.now()
                    return next_slug, True

    def should_rotate(self, last_rotation: datetime) -> bool:
        """Check if it's time to rotate to next theme."""
        with self._lock:
            if not last_rotation:
                return True
            if not self._is_rotating:
                return False
            elapsed = (datetime.now() - last_rotation).total_seconds()
            return elapsed >= self._rotation_interval

    def reset(self):
        """Reset rotation state."""
        with self._lock:
            self._current_theme_index = 0
            self._excluded_themes.clear()
            self._last_rotation_time = None
            self._is_rotating = False


class MultiScreenThemeManager:
    """Manages themes for multiple screens with blending support."""

    def __init__(self):
        self._lock = threading.Lock()
        self._screen_configs = {}
        self._theme_blend_modes = {
            "simple": self._simple_blend,
            "overlap": self._overlap_blend,
            "tiled": self._tiled_blend,
            "cascade": self._cascade_blend,
            "aura": self._aura_blend
        }

    def setup_screen(self, screen_id: str, theme_slug: str, screen_config: Dict = None):
        """
        Setup a screen with theme.

        Args:
            screen_id: Unique screen identifier
            theme_slug: Theme to apply
            screen_config: Screen-specific configuration
        """
        with self._lock:
            if screen_config is None:
                screen_config = {
                    "name": f"Pantalla {screen_id}",
                    "role": self._determine_role(screen_id),
                    "elements": {"timer": True, "question": True, "scores": True, "shapes": True, "overlays": True},
                    "layout": {},
                    "mapping": {},
                    "group": None,
                    "blend_mode": "simple"
                }

            self._screen_configs[screen_id] = {
                "theme": theme_slug,
                "config": screen_config,
                "last_updated": datetime.now(),
                "display_order": len(self._screen_configs) + 1
            }

    def _determine_role(self, screen_id: str) -> str:
        """Determine screen role based on ID."""
        roles = ["main", "secondary", "scoreboard", "timer", "stage"]
        return roles[int(screen_id) % len(roles)] if screen_id.isdigit() else "main"

    def blend_themes(self, themes: List[Dict], blend_mode: str, blend_factor: float = 0.5) -> Dict:
        """
        Blend multiple themes into a single theme.

        Args:
            themes: List of theme dictionaries
            blend_mode: Mode of blending
            blend_factor: Weight for each theme (0-1)

        Returns:
            Blended theme
        """
        with self._lock:
            if not themes:
                return {}

            if blend_mode not in self._theme_blend_modes:
                blend_mode = "simple"

            return self._theme_blend_modes[blend_mode](themes, blend_factor)

    def _simple_blend(self, themes: List[Dict], factor: float) -> Dict:
        """Simple blend - average all properties."""
        if not themes:
            return {}

        blended = deepcopy(themes[0])

        for theme in themes[1:]:
            for key in blended:
                if isinstance(blended[key], dict) and isinstance(theme.get(key), dict):
                    for subkey in blended[key]:
                        if isinstance(blended[key][subkey], (int, float)) and isinstance(theme[key].get(subkey), (int, float)):
                            blended[key][subkey] = blended[key][subkey] * (1 - factor) + theme[key][subkey] * factor
                        elif isinstance(blended[key][subkey], str) and isinstance(theme[key].get(subkey), str):
                            blended[key][subkey] = theme[key][subkey]
                elif isinstance(blended[key], list) and isinstance(theme.get(key), list):
                    if key in ["enabled_shapes", "enabled_effects"]:
                        blended[key] = list(set(blended[key] + theme[key]))

        return blended

    def _overlap_blend(self, themes: List[Dict], factor: float) -> Dict:
        """Overlap blend - merge and enhance."""
        return self._simple_blend(themes, factor * 0.7)

    def _tiled_blend(self, themes: List[Dict], factor: float) -> Dict:
        """Tiled blend - alternate between themes."""
        if not themes:
            return {}

        import time
        theme_index = int(time.time()) % len(themes)
        return deepcopy(themes[theme_index])

    def _cascade_blend(self, themes: List[Dict], factor: float) -> Dict:
        """Cascade blend - progressively change from first to last."""
        if not themes:
            return {}

        import time
        theme_index = int(time.time() * 0.1) % len(themes)
        return deepcopy(themes[theme_index])

    def _aura_blend(self, themes: List[Dict], factor: float) -> Dict:
        """Aura blend - create an ethereal blend."""
        if not themes:
            return {}

        blended = deepcopy(themes[0])

        for key in blended:
            if isinstance(blended[key], dict) and "colors" in key:
                if "primary" in blended[key]:
                    blended[key]["primary"] = self._modify_color_blending(blended[key]["primary"], theme["colors"]["primary"], factor)
                if "accent" in blended[key]:
                    blended[key]["accent"] = self._modify_color_blending(blended[key]["accent"], theme["colors"]["accent"], factor)

        return blended

    def _modify_color_blending(self, base_color: str, overlay_color: str, factor: float) -> str:
        """Blend two colors together."""
        try:
            if base_color.startswith("#"):
                r1, g1, b1 = self._hex_to_rgb(base_color)
            elif base_color.startswith("rgba"):
                r1, g1, b1, _ = self._parse_rgba(base_color)
            else:
                return base_color

            if overlay_color.startswith("#"):
                r2, g2, b2 = self._hex_to_rgb(overlay_color)
            elif overlay_color.startswith("rgba"):
                r2, g2, b2, _ = self._parse_rgba(overlay_color)
            else:
                return base_color

            r = int(r1 * (1 - factor) + r2 * factor)
            g = int(g1 * (1 - factor) + g2 * factor)
            b = int(b1 * (1 - factor) + b2 * factor)
            return f"#{r:02x}{g:02x}{b:02x}"
        except:
            return base_color

    def _hex_to_rgb(self, hex_color: str) -> Tuple[int, int, int]:
        """Convert hex color to RGB tuple."""
        hex_color = hex_color.lstrip("#")
        if len(hex_color) == 6:
            return int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
        return 0, 0, 0

    def _parse_rgba(self, rgba_color: str) -> Tuple[int, int, int, int]:
        """Parse RGBA color string."""
        import re
        match = re.match(r"rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)", rgba_color)
        if match:
            return int(match.group(1)), int(match.group(2)), int(match.group(3)), float(match.group(4))
        return 0, 0, 0, 1.0

    def get_screen_config(self, screen_id: str) -> Dict:
        """Get configuration for a specific screen."""
        with self._lock:
            return self._screen_configs.get(screen_id, {}).get("config", {})

    def get_all_screen_configs(self) -> Dict:
        """Get all screen configurations."""
        with self._lock:
            return {sid: config.get("config", {}) for sid, config in self._screen_configs.items()}

    def update_screen_theme(self, screen_id: str, new_theme_slug: str) -> bool:
        """Update theme for a specific screen."""
        with self._lock:
            if screen_id not in self._screen_configs:
                return False

            self._screen_configs[screen_id]["theme"] = new_theme_slug
            self._screen_configs[screen_id]["last_updated"] = datetime.now()
            return True


class CompleteThemeEngine:
    """Complete theme engine with 25 preset themes and full customization."""

    def __init__(self, themes_dir):
        self.themes_dir = themes_dir
        os.makedirs(themes_dir, exist_ok=True)
        self._lock = threading.Lock()
        self._rotation_manager = ThemeRotationManager()
        self._multi_screen_manager = MultiScreenThemeManager()
        self._all_themes_cache = {}
        self._custom_user_themes = {}
        self._load_all_themes()
        self._create_25_preset_themes()

    def _load_all_themes(self):
        """Load all themes from cache."""
        self._all_themes_cache = {}
        if not os.path.isdir(self.themes_dir):
            return

        for fname in os.listdir(self.themes_dir):
            if fname.endswith(".json"):
                slug = fname[:-5]
                try:
                    with open(os.path.join(self.themes_dir, fname), "r", encoding="utf-8") as f:
                        self._all_themes_cache[slug] = json.load(f)
                except (json.JSONDecodeError, OSError):
                    continue

    def _create_25_preset_themes(self):
        """Create 25 preset themes with variety."""
        base_themes = self._get_base_theme_template()

        # Nature Themes (6)
        nature_presets = self._create_nature_themes(base_themes)

        # Fantasy Themes (6)
        fantasy_presets = self._create_fantasy_themes(base_themes)

        # Modern Themes (6)
        modern_presets = self._create_modern_themes(base_themes)

        # Festive Themes (6)
        festive_presets = self._create_festive_themes(base_themes)

        # Add all themes to cache
        all_presets = nature_presets + fantasy_presets + modern_presets + festive_presets

        for theme in all_presets:
            slug = theme["slug"]
            if slug not in self._all_themes_cache:
                self._all_themes_cache[slug] = theme
                self._save_theme(theme)

    def _get_base_theme_template(self) -> Dict:
        """Get base theme template."""
        return {
            "slug": "",
            "name": "",
            "description": "",
            "author": "SillyQuiz",
            "version": 3,
            "created_at": datetime.now().isoformat(),
            "last_modified": datetime.now().isoformat(),
            "colors": {
                "primary": "#0038ff",
                "secondary": "#ffffff",
                "accent": "#7C3AED",
                "surface": "#ffffff",
                "text": "#000000",
                "border": "#000000",
                "glow": "rgba(124,58,237,0.3)",
                "bg_gradient": ["#0038ff", "#1a1aff"]
            },
            "typography": {
                "heading_font": "Bebas Neue",
                "body_font": "Space Grotesk",
                "timer_font": "Bebas Neue",
                "score_font": "Space Grotesk",
                "size_scale": 1.0,
                "text_shadow": False,
                "text_glow": False
            },
            "timer": {
                "style": "circle",
                "position": "tr",
                "position_x": None,
                "position_y": None,
                "size": "medium",
                "colors": {
                    "background": "rgba(0,0,0,0.6)",
                    "text": "#ffffff",
                    "progress": "#7C3AED",
                    "glow": "rgba(124,58,237,0.5)",
                    "urgent": "#ff4444"
                },
                "animation": "pulse"
            },
            "layout": {
                "scores_position": "bottom",
                "header_style": "full",
                "question_height": "normal",
                "logo_visible": True,
                "decorations_visible": True,
                "scores_height": 300
            },
            "shapes": {
                "enabled": [
                    "star", "cross", "flame", "cup", "crown", "dove",
                    "heart", "lamp", "wings", "key", "fish", "sword"
                ],
                "spawn_rate": 2500,
                "max_count": 15,
                "color_source": "team",
                "behavior": "float",
                "size": "medium",
                "opacity": 0.8,
                "react_to_events": True
            },
            "screens": {
                "1": {
                    "name": "Principal",
                    "role": "main",
                    "elements": {"timer": True, "question": True, "scores": True, "shapes": True, "overlays": True},
                    "layout": {},
                    "mapping": {}
                },
                "2": {
                    "name": "Secundaria",
                    "role": "secondary",
                    "elements": {"timer": False, "question": False, "scores": True, "shapes": True, "overlays": False},
                    "layout": {},
                    "mapping": {}
                }
            },
            "effects": {
                "default_effects": ["scanline", "vignette"],
                "intensity": 1.0,
                "mode_transition": "fade",
                "theme_transition": "fade",
                "screen_shake": True,
                "confetti": True
            },
            "sound": {
                "pack": "procedural",
                "volume": 1.0,
                "events": {}
            },
            "modes": {}
        }

    def _create_nature_themes(self, base: Dict) -> List[Dict]:
        """Create 6 nature-themed variants."""
        nature_variants = [
            {"name": "Bosque Esmeralda", "description": "Tema natural verde con follaje vibrante", "slug": "nature-forest-green"},
            {"name": "Césped Fresca", "description": "Tema pradera tranquila con tonos suaves", "slug": "nature-pasture-fresh"},
            {"name": "Lago Tranquilo", "description": "Tema lago sereno con reflejos dorados", "slug": "nature-lake-peaceful"},
            {"name": "Selva Misteriosa", "description": "Tema selva densa con misterio rojo", "slug": "nature-jungle-mysterious"},
            {"name": "Pradera Dorado", "description": "Tema campo soleado con cálido dorado", "slug": "nature-meadow-golden"},
            {"name": "Río Azul", "description": "Tema río cristalino con refracción azul", "slug": "nature-river-blue"}
        ]

        themes = []
        for variant in nature_variants:
            theme = deepcopy(base)
            theme.update(variant)

            # Customize based on theme type
            if "forest" in variant["slug"]:
                theme["colors"]["primary"] = "#064e3b"
                theme["colors"]["secondary"] = "#d1fae5"
                theme["colors"]["accent"] = "#34d399"
                theme["typography"]["heading_font"] = "Roboto Slab"
                theme["shapes"]["enabled"] = ["tree", "leaf", "flower", "dove", "heart", "crown", "star", "fish", "bread"]
                theme["shapes"]["color_source"] = "gradient"
                theme["effects"]["default_effects"] = ["fog", "bloom"]

            elif "pasture" in variant["slug"]:
                theme["colors"]["primary"] = "#84cc16"
                theme["colors"]["secondary"] = "#fef3c7"
                theme["colors"]["accent"] = "#f59e0b"
                theme["typography"]["heading_font"] = "Poppins"
                theme["shapes"]["enabled"] = ["grass", "flower", "butterfly", "dove", "heart", "key", "star", "fish", "bread"]
                theme["shapes"]["behavior"] = "gentle_float"
                theme["effects"]["default_effects"] = ["petals", "light"]

            elif "lake" in variant["slug"]:
                theme["colors"]["primary"] = "#0369a1"
                theme["colors"]["secondary"] = "#e0f2fe"
                theme["colors"]["accent"] = "#7dd3fc"
                theme["typography"]["heading_font"] = "Source Sans Pro"
                theme["shapes"]["enabled"] = ["water_drop", "fish", "dove", "heart", "crown", "star", "bread", "key"]
                theme["shapes"]["color_source"] = "water"
                theme["shapes"]["opacity"] = 0.6
                theme["effects"]["default_effects"] = ["ripples", "reflection", "depth"]

            elif "jungle" in variant["slug"]:
                theme["colors"]["primary"] = "#14532d"
                theme["colors"]["secondary"] = "#dcfce7"
                theme["colors"]["accent"] = "#4ade80"
                theme["typography"]["heading_font"] = "Montserrat"
                theme["shapes"]["enabled"] = ["vine", "leaf", "lizard", "dove", "heart", "crown", "star", "fish", "bread"]
                theme["shapes"]["spawn_rate"] = 4000
                theme["effects"]["default_effects"] = ["humidity", "glow", "shadow"]

            elif "meadow" in variant["slug"]:
                theme["colors"]["primary"] = "#ca8a04"
                theme["colors"]["secondary"] = "#fef3c7"
                theme["colors"]["accent"] = "#fbbf24"
                theme["typography"]["heading_font"] = "Playfair Display"
                theme["shapes"]["enabled"] = ["sunflower", "butterfly", "dove", "heart", "crown", "star", "fish", "bread"]
                theme["shapes"]["behavior"] = "upward_float"
                theme["effects"]["default_effects"] = ["glint", "glimmer"]

            elif "river" in variant["slug"]:
                theme["colors"]["primary"] = "#0284c7"
                theme["colors"]["secondary"] = "#e0f2fe"
                theme["colors"]["accent"] = "#38bdf8"
                theme["typography"]["heading_font"] = "Inter"
                theme["shapes"]["enabled"] = ["water_drop", "flow", "fish", "dove", "heart", "key", "star", "bread"]
                theme["shapes"]["color_source"] = "current"
                theme["shapes"]["size"] = "small"
                theme["effects"]["default_effects"] = ["current", "splash", "wake"]

            themes.append(theme)

        return themes

    def _create_fantasy_themes(self, base: Dict) -> List[Dict]:
        """Create 6 fantasy-themed variants."""
        fantasy_variants = [
            {"name": "Mystic Observatory", "description": "Tema astronómico místico con estrellas flotantes", "slug": "fantasy-observatory"},
            {"name": "Dragon's Lair", "description": "Tema de guarida de dragón con magma ardiente", "slug": "fantasy-dragon-lair"},
            {"name": "Elven Forest", "description": "Tema bosque élfico con rayos lunares", "slug": "fantasy-elven-forest"},
            {"name": "Magic Castle", "description": "Tema castillo encantado con gótico místico", "slug": "fantasy-magic-castle"},
            {"name": "Phoenix Rising", "description": "Tema renacimiento fenicio con llamas doradas", "slug": "fantasy-phoenix-rising"},
            {"name": "Celestial Garden", "description": "Tema jardín celestial con pétalos luminosos", "slug": "fantasy-celestial-garden"}
        ]

        themes = []
        for variant in fantasy_variants:
            theme = deepcopy(base)
            theme.update(variant)

            if "observatory" in variant["slug"]:
                theme["colors"]["primary"] = "#312e81"
                theme["colors"]["secondary"] = "#fef3c7"
                theme["colors"]["accent"] = "#fbbf24"
                theme["typography"]["heading_font"] = "Orbitron"
                theme["shapes"]["enabled"] = ["star", "constellation", "moon", "comet", "dove", "heart", "crown", "key", "fish", "bread", "lamp"]
                theme["shapes"]["color_source"] = "celestial"
                theme["effects"]["default_effects"] = ["twinkle", "constellation", "nebula"]

            elif "dragon" in variant["slug"]:
                theme["colors"]["primary"] = "#7f1d1d"
                theme["colors"]["secondary"] = "#fef2f2"
                theme["colors"]["accent"] = "#dc2626"
                theme["typography"]["heading_font"] = "Unifraktur Maguntia"
                theme["shapes"]["enabled"] = ["flame", "dragon_scale", "ember", "crown", "heart", "key", "star", "fish", "bread", "lamp", "wings"]
                theme["shapes"]["behavior"] = "volcano"
                theme["effects"]["default_effects"] = ["fire", "smoke", "ember"]
                theme["timer"]["style"] = "bar"

            elif "elven" in variant["slug"]:
                theme["colors"]["primary"] = "#065f46"
                theme["colors"]["secondary"] = "#d1fae5"
                theme["colors"]["accent"] = "#10b981"
                theme["typography"]["heading_font"] = "Cormorant Garamond"
                theme["shapes"]["enabled"] = ["leaf", "elf_ear", "flower", "dove", "heart", "crown", "star", "key", "fish", "bread", "wings"]
                theme["shapes"]["color_source"] = "leaf"
                theme["effects"]["default_effects"] = ["pollen", "glimmer", "nature"]

            elif "castle" in variant["slug"]:
                theme["colors"]["primary"] = "#1e293b"
                theme["colors"]["secondary"] = "#f1f5f9"
                theme["colors"]["accent"] = "#64748b"
                theme["typography"]["heading_font"] = "Cinzel"
                theme["shapes"]["enabled"] = ["arch", "banner", "crown", "shield", "heart", "key", "star", "fish", "bread", "lamp", "wings"]
                theme["shapes"]["size"] = "large"
                theme["effects"]["default_effects"] = ["stained_glass", "candlelight", "echo"]

            elif "phoenix" in variant["slug"]:
                theme["colors"]["primary"] = "#451a03"
                theme["colors"]["secondary"] = "#fff7ed"
                theme["colors"]["accent"] = "#dc2626"
                theme["typography"]["heading_font"] = "Bebas Neue"
                theme["shapes"]["enabled"] = ["phoenix", "flame", "ash", "crown", "heart", "key", "star", "fish", "bread", "lamp", "fire"]
                theme["shapes"]["behavior"] = "rebirth"
                theme["effects"]["default_effects"] = ["phoenix", "fire", "rise"]

            elif "celestial" in variant["slug"]:
                theme["colors"]["primary"] = "#312e81"
                theme["colors"]["secondary"] = "#e0f2fe"
                theme["colors"]["accent"] = "#06b6d4"
                theme["typography"]["heading_font"] = "Space Mono"
                theme["shapes"]["enabled"] = ["star", "cloud", "rain", "dove", "heart", "crown", "key", "fish", "bread", "lamp"]
                theme["shapes"]["behavior"] = "gravity"
                theme["effects"]["default_effects"] = ["rainbow", "prism", "spectrum"]

            themes.append(theme)

        return themes

    def _create_modern_themes(self, base: Dict) -> List[Dict]:
        """Create 6 modern-themed variants."""
        modern_variants = [
            {"name": "Cyber Nexus", "description": "Tema cyberpunk futurista con neón", "slug": "modern-cyber-nexus"},
            {"name": "Glass Matrix", "description": "Tema matrix digital con código escurridizo", "slug": "modern-glass-matrix"},
            {"name": "Quantum Circuit", "description": "Tema circuitos cuánticos con holo verde", "slug": "modern-quantum-circuit"},
            {"name": "Neon Singularity", "description": "Tema singularidad neón con pulsos", "slug": "modern-neon-singularity"},
            {"name": "Digital Wave", "description": "Tema ondas digitales con cian dinámico", "slug": "modern-digital-wave"},
            {"name": "Tech Cortex", "description": "Tema corteza tecnológica con metal pulido", "slug": "modern-tech-cortex"}
        ]

        themes = []
        for variant in modern_variants:
            theme = deepcopy(base)
            theme.update(variant)

            if "cyber" in variant["slug"]:
                theme["colors"]["primary"] = "#0f172a"
                theme["colors"]["secondary"] = "#e2e8f0"
                theme["colors"]["accent"] = "#06ffa5"
                theme["typography"]["heading_font"] = "Space Grotesk"
                theme["typography"]["body_font"] = "JetBrains Mono"
                theme["timer"]["style"] = "digital"
                theme["shapes"]["enabled"] = ["circuit", "data_stream", "binary", "crown", "heart", "key", "star", "fish", "bread", "lamp", "scan"]
                theme["shapes"]["color_source"] = "data"
                theme["effects"]["default_effects"] = ["hologram", "scanline", "glitch"]

            elif "glass" in variant["slug"]:
                theme["colors"]["primary"] = "#1e293b"
                theme["colors"]["secondary"] = "#f8fafc"
                theme["colors"]["accent"] = "#00ffff"
                theme["typography"]["heading_font"] = "Rajdhani"
                theme["layout"]["header_style"] = "compact"
                theme["shapes"]["enabled"] = ["matrix", "drop", "binary", "crown", "heart", "key", "star", "fish", "bread", "lamp", "glass"]
                theme["shapes"]["opacity"] = 0.7
                theme["effects"]["default_effects"] = ["glass", "reflection", "depth"]

            elif "quantum" in variant["slug"]:
                theme["colors"]["primary"] = "#0f766e"
                theme["colors"]["secondary"] = "#ccfbf1"
                theme["colors"]["accent"] = "#34d399"
                theme["typography"]["heading_font"] = "Silkscreen"
                theme["shapes"]["enabled"] = ["atom", "quantum", "particle", "crown", "heart", "key", "star", "fish", "bread", "lamp", "hologram"]
                theme["shapes"]["behavior"] = "quantum"
                theme["effects"]["default_effects"] = ["quantum", "hologram", "dimension"]

            elif "singularity" in variant["slug"]:
                theme["colors"]["primary"] = "#4c1d95"
                theme["colors"]["secondary"] = "#e9d5ff"
                theme["colors"]["accent"] = "#a855f7"
                theme["typography"]["heading_font"] = "Press Start 2P"
                theme["shapes"]["enabled"] = ["singularity", "void", "expansion", "crown", "heart", "key", "star", "fish", "bread", "lamp", "portal"]
                theme["shapes"]["color_source"] = "void"
                theme["effects"]["default_effects"] = ["singularity", "void", "expansion"]

            elif "digital" in variant["slug"]:
                theme["colors"]["primary"] = "#155e75"
                theme["colors"]["secondary"] = "#e0f2fe"
                theme["colors"]["accent"] = "#06b6d4"
                theme["typography"]["heading_font"] = "Digital Dysplasia"
                theme["shapes"]["enabled"] = ["data_wave", "binary_digit", "scan", "crown", "heart", "key", "star", "fish", "bread", "lamp", "frequency"]
                theme["shapes"]["behavior"] = "wave"
                theme["effects"]["default_effects"] = ["digital_rain", "scan", "frequency"]

            elif "tech" in variant["slug"]:
                theme["colors"]["primary"] = "#374151"
                theme["colors"]["secondary"] = "#f3f4f6"
                theme["colors"]["accent"] = "#60a5fa"
                theme["typography"]["heading_font"] = "Exo 2"
                theme["shapes"]["enabled"] = ["circuit_board", "chip", "connector", "crown", "heart", "key", "star", "fish", "bread", "lamp", "socket"]
                theme["shapes"]["size"] = "small"
                theme["effects"]["default_effects"] = ["tech", "circuit", "binary"]

            themes.append(theme)

        return themes

    def _create_festive_themes(self, base: Dict) -> List[Dict]:
        """Create 6 festive-themed variants."""
        festive_variants = [
            {"name": "Confetti Carnival", "description": "Tema carnaval con explosión de coloridos", "slug": "festive-confetti-carnival"},
            {"name": "Fireworks Night", "description": "Tema fuegos artificiales con cielo estelar", "slug": "festive-fireworks-night"},
            {"name": "Holiday Lights", "description": "Tema luces navideñas con destellos dorados", "slug": "festive-holiday-lights"},
            {"name": " Mardi Gras Parade", "description": "Tema carnaval con globos tropicales", "slug": "festive-mardi-gras-parade"},
            {"name": "New Year's Eve", "description": "Tema año nuevo con champa brilloso", "slug": "festive-new-years-eve"},
            {"name": "Birthday Celebration", "description": "Tema cumpleaños con globos arcoíris", "slug": "festive-birthday-celebration"}
        ]

        themes = []
        for variant in festive_variants:
            theme = deepcopy(base)
            theme.update(variant)

            if "confetti" in variant["slug"]:
                theme["colors"]["primary"] = "#dc2626"
                theme["colors"]["secondary"] = "#fef2f2"
                theme["colors"]["accent"] = "#f59e0b"
                theme["typography"]["heading_font"] = "Bebas Neue"
                theme["shapes"]["enabled"] = ["balloon", "confetti", "streamer", "crown", "heart", "key", "star", "fish", "bread", "lamp", "gift"]
                theme["shapes"]["behavior"] = "celebration"
                theme["effects"]["default_effects"] = ["confetti", "celebration", "party"]
                theme["timer"]["style"] = "bar"

            elif "fireworks" in variant["slug"]:
                theme["colors"]["primary"] = "#1e293b"
                theme["colors"]["secondary"] = "#f8fafc"
                theme["colors"]["accent"] = "#fbbf24"
                theme["typography"]["heading_font"] = "Playfair Display"
                theme["shapes"]["enabled"] = ["firework_star", "explosion", "spark", "crown", "heart", "key", "star", "fish", "bread", "lamp", "burst"]
                theme["effects"]["default_effects"] = ["fireworks", "explosion", "starburst"]

            elif "lights" in variant["slug"]:
                theme["colors"]["primary"] = "#991b1b"
                theme["colors"]["secondary"] = "#fef3c7"
                theme["colors"]["accent"] = "#f59e0b"
                theme["typography"]["heading_font"] = "Italiana"
                theme["shapes"]["enabled"] = ["bulb", "twinkle", "glow", "crown", "heart", "key", "star", "fish", "bread", "lamp", "sparkle"]
                theme["shapes"]["behavior"] = "twinkle"
                theme["effects"]["default_effects"] = ["lights", "twinkle", "glow"]

            elif "parade" in variant["slug"]:
                theme["colors"]["primary"] = "#059669"
                theme["colors"]["secondary"] = "#dcfce7"
                theme["colors"]["accent"] = "#fbbf24"
                theme["typography"]["heading_font"] = "Poppins"
                theme["shapes"]["enabled"] = ["balloon", "streamer", "confetti", "crown", "heart", "key", "star", "fish", "bread", "lamp", "banner"]
                theme["effects"]["default_effects"] = ["confetti", "parade", "celebration"]

            elif "new-years" in variant["slug"]:
                theme["colors"]["primary"] = "#1e293b"
                theme["colors"]["secondary"] = "#f8fafc"
                theme["colors"]["accent"] = "#22d3ee"
                theme["typography"]["heading_font"] = "Bebas Neue"
                theme["shapes"]["enabled"] = ["party", "champagne", "glitter", "crown", "heart", "key", "star", "fish", "bread", "lamp", "bottle"]
                theme["effects"]["default_effects"] = ["glitter", "champagne", "party"]

            elif "birthday" in variant["slug"]:
                theme["colors"]["primary"] = "#7c3aed"
                theme["colors"]["secondary"] = "#faf5ff"
                theme["colors"]["accent"] = "#fbbf24"
                theme["typography"]["heading_font"] = "Poppins"
                theme["shapes"]["enabled"] = ["balloon", "ribbon", "cake", "crown", "heart", "key", "star", "fish", "bread", "lamp", "confetti"]
                theme["effects"]["default_effects"] = ["confetti", "balloon", "gift"]
                theme["timer"]["style"] = "digital"

            themes.append(theme)

        return themes

    def _save_theme(self, theme: Dict):
        """Save theme to file."""
        path = os.path.join(self.themes_dir, f"{theme['slug']}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(theme, f, ensure_ascii=False, indent=2)

    def get_all_themes(self) -> List[Dict]:
        """Get all themes including presets."""
        with self._lock:
            themes = []

            # Add preset themes
            for slug, theme in self._all_themes_cache.items():
                theme_copy = deepcopy(theme)
                theme_copy["source"] = "preset"
                themes.append(theme_copy)

            # Add custom user themes
            for slug, theme in self._custom_user_themes.items():
                theme_copy = deepcopy(theme)
                theme_copy["source"] = "custom"
                themes.append(theme_copy)

            return themes

    def get_theme(self, slug: str) -> Optional[Dict]:
        """Get theme by slug."""
        with self._lock:
            theme = self._all_themes_cache.get(slug)
            if theme:
                return deepcopy(theme)
            return None

    def add_custom_theme(self, theme_data: Dict) -> Dict:
        """Add a custom theme."""
        with self._lock:
            slug = theme_data.get("slug") or self._slugify(theme_data.get("name", "custom-theme"))

            while slug in self._all_themes_cache:
                slug += "-custom"

            theme = deepcopy(theme_data)
            theme["slug"] = slug
            theme["source"] = "custom"
            theme["created_at"] = datetime.now().isoformat()

            self._custom_user_themes[slug] = theme
            self._save_theme(theme)

            return deepcopy(theme)

    def _slugify(self, name: str) -> str:
        """Convert name to slug."""
        s = name.lower().strip()
        s = re.sub(r'[^\w\s-]', '', s)
        s = re.sub(r'[\s_]+', '-', s)
        return s[:48]

    def setup_multi_screen(self, screen_config: Dict) -> List[Dict]:
        """
        Setup themes for multiple screens with blending.

        Args:
            screen_config: Dictionary of screen configurations

        Returns:
            List of screen theme configurations
        """
        with self._lock:
            results = []

            for screen_id, config in screen_config.items():
                if isinstance(config, str):
                    # Just set theme for this screen
                    theme = self.get_theme(config)
                    if theme:
                        results.append({
                            "screen_id": screen_id,
                            "theme": theme,
                            "blend_mode": config.get("blend_mode", "simple"),
                            "order": config.get("order", len(results) + 1)
                        })
                elif isinstance(config, dict):
                    # Full configuration with optional blending
                    theme_slug = config.get("theme")
                    blend_mode = config.get("blend_mode", "simple")
                    blend_factor = config.get("blend_factor", 0.5)

                    if theme_slug:
                        theme = self.get_theme(theme_slug)
                        if theme:
                            # Get additional themes for blending
                            blend_themes = [theme]
                            blend_theme_slug = config.get("blend_with")

                            if blend_theme_slug:
                                additional = self.get_theme(blend_theme_slug)
                                if additional:
                                    blend_themes.append(additional)

                            # Blend themes if needed
                            if len(blend_themes) > 1:
                                blended_theme = self._multi_screen_manager.blend_themes(
                                    blend_themes,
                                    blend_mode,
                                    blend_factor
                                )
                            else:
                                blended_theme = theme

                            results.append({
                                "screen_id": screen_id,
                                "theme": blended_theme,
                                "blend_mode": blend_mode,
                                "order": config.get("order", len(results) + 1),
                                "config": config.get("display_config", {})
                            })

            # Sort by order
            results.sort(key=lambda x: x.get("order", 999))
            return results

    def configure_rotation(self, interval_seconds: int, seed: int = None, exclude_slugs: List[str] = None):
        """Configure theme rotation settings."""
        self._rotation_manager.configure(interval_seconds, seed)
        if exclude_slugs:
            self._rotation_manager.set_exclusion(exclude_slugs)

    def get_current_theme(self, current_slug: str, available_slugs: List[str]) -> Tuple[str, bool]:
        """Get current theme."""
        with self._lock:
            if not available_slugs:
                return current_slug, False

            # Filter out the current theme
            filtered_slugs = [s for s in available_slugs if s != current_slug]

            if not filtered_slugs:
                return current_slug, False

            # Get next theme
            next_slug, is_random = self._rotation_manager.get_next_theme(current_slug, filtered_slugs)
            return next_slug, is_random

    def get_theme_preview_data(self, theme_slug: str) -> Dict:
        """Get preview data for a theme."""
        theme = self.get_theme(theme_slug)
        if not theme:
            return {}

        return {
            "slug": theme["slug"],
            "name": theme["name"],
            "description": theme["description"],
            "colors": theme.get("colors", {}),
            "primary_color": theme.get("colors", {}).get("primary", "#0038ff"),
            "accent_color": theme.get("colors", {}).get("accent", "#7C3AED"),
            "timer_style": theme.get("timer", {}).get("style", "circle"),
            "shapes": theme.get("shapes", {}),
            "effects": theme.get("effects", {}),
            "typography": theme.get("typography", {}),
            "layout": theme.get("layout", {}),
            "sound": theme.get("sound", {}),
            "modes": theme.get("modes", {})
        }

    def get_random_theme(self, exclude_slugs: List[str] = None) -> Dict:
        """Get a random theme."""
        with self._lock:
            available_slugs = list(self._all_themes_cache.keys())

            if exclude_slugs:
                available_slugs = [s for s in available_slugs if s not in exclude_slugs]

            if not available_slugs:
                return {}

            theme_slug = random.choice(available_slugs)
            return self.get_theme(theme_slug)

    def get_themes_by_category(self, category: str) -> List[Dict]:
        """Get themes by category."""
        with self._lock:
            category_mapping = {
                "nature": ["nature-", "forest", "meadow", "lake", "river", "jungle"],
                "fantasy": ["fantasy-", "observatory", "dragon", "elven", "castle", "phoenix", "celestial"],
                "modern": ["modern-", "cyber", "glass", "quantum", "singularity", "digital", "tech"],
                "festive": ["festive-", "confetti", "fireworks", "lights", "parade", "new-years", "birthday"],
            }

            if category not in category_mapping:
                return []

            themes = []
            keywords = category_mapping[category]

            for slug, theme in self._all_themes_cache.items():
                for keyword in keywords:
                    if keyword in slug:
                        themes.append(self.get_theme_preview_data(slug))
                        break

            return themes

    def get_all_categories(self) -> List[str]:
        """Get all available categories."""
        return ["nature", "fantasy", "modern", "festive"]

    def get_screens_from_theme(self, theme_slug: str) -> Dict:
        """Extract screens configuration from a theme."""
        theme = self.get_theme(theme_slug)
        if not theme:
            return {}
        screens = theme.get("screens", {})
        if not screens:
            return self._get_base_theme_template()["screens"]
        return screens

    def apply_theme_screens_to_display(self, theme_slug: str, existing_screens: Dict = None) -> Dict:
        """Merge theme's screens config into display_config screens.
        
        Preserves any user customizations (layout, mapping) that exist in
        the current display_config screens, but overrides element visibility
        from the theme definition.
        """
        theme_screens = self.get_screens_from_theme(theme_slug)
        if not theme_screens:
            return existing_screens or {}

        result = {}
        for screen_id, screen_cfg in theme_screens.items():
            merged = deepcopy(screen_cfg)
            if existing_screens and screen_id in existing_screens:
                existing = existing_screens[screen_id]
                # Preserve user's layout and mapping customizations
                if existing.get("layout"):
                    merged["layout"] = deepcopy(existing["layout"])
                if existing.get("mapping"):
                    merged["mapping"] = deepcopy(existing["mapping"])
                if existing.get("name"):
                    merged["name"] = existing["name"]
            result[screen_id] = merged

        # Carry over any extra screens the user added that are NOT in the theme
        if existing_screens:
            for sid, scfg in existing_screens.items():
                if sid not in result:
                    result[sid] = deepcopy(scfg)

        return result

    def get_rotation_state(self) -> Dict:
        """Get rotation state for persistence."""
        state = self._rotation_manager.to_dict()
        return state

    def set_rotation_state(self, state: Dict):
        """Set rotation state from persisted data."""
        self._rotation_manager.from_dict(state)

    def get_multi_screen_manager(self):
        """Get the multi-screen manager instance."""
        return self._multi_screen_manager

    def get_rotation_manager(self):
        """Get the rotation manager instance."""
        return self._rotation_manager

    def cleanup(self):
        """Cleanup resources."""
        with self._lock:
            self._all_themes_cache.clear()
            self._custom_user_themes.clear()


class ThemeService:
    """Wrapper around CompleteThemeEngine for the old blueprints API.

    Provides the methods expected by container.theme_service in the themes blueprint.
    """

    def __init__(self, themes_dir):
        from silly.globals import container as _c
        self._engine = _c.theme_engine

    def list(self) -> List[Dict]:
        return self._engine.get_all_themes()

    def get(self, slug: str) -> Optional[Dict]:
        return self._engine.get_theme(slug)

    def create(self, data: Dict) -> Optional[Dict]:
        return self._engine.add_custom_theme(data)

    def update(self, slug: str, data: Dict) -> Optional[Dict]:
        theme = self._engine.get_theme(slug)
        if not theme:
            return None
        merged = deepcopy(theme)
        merged.update(data)
        merged["slug"] = slug
        merged["last_modified"] = datetime.now().isoformat()
        with self._engine._lock:
            self._engine._all_themes_cache[slug] = merged
            self._engine._save_theme(merged)
        return deepcopy(merged)

    def delete(self, slug: str) -> bool:
        theme = self._engine.get_theme(slug)
        if not theme:
            return False
        with self._engine._lock:
            self._engine._all_themes_cache.pop(slug, None)
            self._engine._custom_user_themes.pop(slug, None)
            path = os.path.join(self._engine.themes_dir, f"{slug}.json")
            if os.path.exists(path):
                os.remove(path)
        return True

    def duplicate(self, slug: str, new_name: str = None) -> Optional[Dict]:
        theme = self._engine.get_theme(slug)
        if not theme:
            return None
        data = deepcopy(theme)
        if new_name:
            data["name"] = new_name
        else:
            data["name"] = data.get("name", slug) + " (copia)"
        return self._engine.add_custom_theme(data)

    def export_json(self, slug: str) -> Optional[Dict]:
        return self._engine.get_theme(slug)

    def import_json(self, data: Dict) -> Optional[Dict]:
        if not data or not data.get("name"):
            return None
        return self._engine.add_custom_theme(data)
