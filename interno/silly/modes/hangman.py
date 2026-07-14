import random
import unicodedata
from .base import BaseMode


def _normalize(c):
    return unicodedata.normalize("NFD", c)[0].upper()


class HangmanMode(BaseMode):
    name = "hangman"
    icon = "\U0001faa2"

    def __init__(self, state, event_bus=None, config=None):
        super().__init__(state, event_bus, config)
        self.activo = False
        self.palabra = ""
        self.palabra_original = ""
        self.word_state = []
        self.attempts_left = 6
        self.max_attempts = 6
        self.guessed_letters = []
        self.wrong_letters = []
        self.timer_segundos = 60
        self.pistas = []

    def start(self, **kwargs):
        if self.activo:
            return {"error": "El ahorcado ya est\u00e1 activo"}
        config = self.state.config.get("modes", {}).get("hangman", {})
        words = config.get("words", [])
        if not words:
            return {"error": "No hay palabras configuradas. Ve a la pesta\u00f1a Ahorcado y agrega palabras."}
        self.palabra_original = random.choice(words).upper()
        self.palabra = "".join(_normalize(c) for c in self.palabra_original)
        self.word_state = []
        for ch in self.palabra_original:
            if ch.isspace():
                self.word_state.append(" ")
            else:
                self.word_state.append("_")
        self.max_attempts = config.get("max_attempts", 6)
        self.attempts_left = self.max_attempts
        self.guessed_letters = []
        self.wrong_letters = []
        self.timer_segundos = config.get("timer", 60)
        self.pistas = []
        self.activo = True
        self.log_actividad(f"Ahorcado iniciado — {len(self.palabra)} letras")
        return {
            "ok": True,
            "word_state": " ".join(self.word_state),
            "length": len(self.palabra),
            "attempts": self.attempts_left,
        }

    def stop(self):
        self.activo = False
        self.palabra = ""
        self.palabra_original = ""
        self.word_state = []
        self.attempts_left = 0
        self.guessed_letters = []
        self.wrong_letters = []

    def handle_action(self, action, data=None):
        if action == "iniciar":
            return self.start()
        elif action == "guess":
            letter = (data or {}).get("letra", "").upper()
            return self._guess(letter)
        elif action == "hint":
            return self._hint()
        elif action == "close":
            self.stop()
            return {"ok": True}
        return {"error": f"Acci\u00f3n desconocida: {action}"}

    def _guess(self, letter):
        if not self.activo:
            return {"error": "El ahorcado no est\u00e1 activo"}
        if not letter or len(letter) != 1:
            return {"error": "Ingrese una sola letra"}
        letter_norm = _normalize(letter)
        if letter_norm in [_normalize(l) for l in self.guessed_letters] or \
           letter_norm in [_normalize(l) for l in self.wrong_letters]:
            return {"error": "Letra ya ingresada", "word_state": " ".join(self.word_state)}

        normalized_palabra = [_normalize(c) for c in self.palabra_original]
        if letter_norm in normalized_palabra:
            self.guessed_letters.append(letter)
            for i, ch in enumerate(normalized_palabra):
                if ch == letter_norm:
                    self.word_state[i] = self.palabra_original[i]
            won = "_" not in self.word_state
            self.log_actividad(f"Ahorcado: letra '{letter}' — correcta")
            return {
                "ok": True, "letter": letter, "found": True,
                "word_state": " ".join(self.word_state),
                "attempts_left": self.attempts_left, "won": won,
            }
        else:
            self.wrong_letters.append(letter)
            self.attempts_left -= 1
            lost = self.attempts_left <= 0
            self.log_actividad(f"Ahorcado: letra '{letter}' — incorrecta ({self.attempts_left} vidas)")
            return {
                "ok": True, "letter": letter, "found": False,
                "word_state": " ".join(self.word_state) if not lost else " ".join(self.palabra_original),
                "attempts_left": self.attempts_left, "lost": lost,
                "palabra": self.palabra_original if lost else None,
            }

    def _hint(self):
        if not self.activo:
            return {"error": "El ahorcado no est\u00e1 activo"}
        hidden = [i for i, ch in enumerate(self.word_state) if ch == "_"]
        if not hidden:
            return {"ok": True, "word_state": " ".join(self.word_state), "won": True}
        idx = random.choice(hidden)
        letter = self.palabra_original[idx]
        self.guessed_letters.append(letter)
        normalized_palabra = [_normalize(c) for c in self.palabra_original]
        letter_norm = _normalize(letter)
        for i, ch in enumerate(normalized_palabra):
            if ch == letter_norm:
                self.word_state[i] = self.palabra_original[i]
        won = "_" not in self.word_state
        self.log_actividad(f"Ahorcado: pista — letra '{letter}' revelada")
        return {
            "ok": True, "letter": letter, "found": True,
            "word_state": " ".join(self.word_state),
            "attempts_left": self.attempts_left, "won": won, "pista": True,
        }

    def get_state(self):
        return {
            "activo": self.activo,
            "word_state": " ".join(self.word_state) if self.activo else "",
            "palabra": self.palabra_original if self.activo else "",
            "attempts_left": self.attempts_left,
            "max_attempts": self.max_attempts,
            "guessed_letters": self.guessed_letters,
            "wrong_letters": self.wrong_letters,
            "length": len(self.palabra) if self.activo else 0,
        }
