import os
import sys
import threading
import time
import webbrowser
import subprocess
import socket
import atexit
import traceback
import logging
from pathlib import Path

# GUI dependencies
try:
    import tkinter as tk
    from tkinter import ttk, messagebox
    HAS_GUI = True
except ImportError:
    HAS_GUI = False

# System tray dependencies
try:
    import pystray
    from PIL import Image
    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False

BASE_DIR = Path(__file__).parent.resolve()
INSTALADO_FILE = BASE_DIR / ".instalado"
REQUIREMENTS_FILE = BASE_DIR.parent / "requirements.txt"
PORT = 8080
SERVER_URL = f"http://127.0.0.1:{PORT}/sillycontrol"
BUILDER_URL = f"http://127.0.0.1:{PORT}/html/buildsilly.html"
DISPLAY_URL = f"http://127.0.0.1:{PORT}/display"
WS_PORT = 8081
WS_URL = f"ws://127.0.0.1:{WS_PORT}"

_shutdown_event = threading.Event()
_server_thread = None
_ws_thread = None
_ws_loop = None
_tray_icon = None

def _setup_logging():
    try:
        logging.basicConfig(
            filename=str(BASE_DIR / "launcher.log"),
            level=logging.INFO,
            format="%(asctime)s [%(levelname)s] %(message)s",
            filemode="a",
        )
        # Also add console handler for python.exe (not pythonw.exe)
        if sys.stdout is not None:
            console = logging.StreamHandler(sys.stdout)
            console.setLevel(logging.INFO)
            console.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
            logging.getLogger().addHandler(console)
    except Exception:
        pass

def log_error(msg):
    try:
        logging.error(msg)
    except Exception:
        pass

def log_info(msg):
    try:
        logging.info(msg)
    except Exception:
        pass

# Single-instance mutex (TCP socket on dedicated port)
_INSTANCE_SOCK = None
_INSTANCE_PORT = 4890

def ensure_single_instance():
    global _INSTANCE_SOCK
    try:
        _INSTANCE_SOCK = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _INSTANCE_SOCK.bind(("127.0.0.1", _INSTANCE_PORT))
        _INSTANCE_SOCK.listen(1)
        return True
    except OSError:
        return False

# Captured error from server thread for user feedback
_server_error = None

# GUI State
_gui_running = False
_server_status = "PARADO"
_gui_window = None
_status_label = None
_btn_start = None
_btn_stop = None

# Modern Color Palette (SillyQuiz brutalist)
COLOR_BG = "#0B0B0B"
COLOR_SURFACE = "#161616"
COLOR_SURFACE_HOVER = "#1E1E1E"
COLOR_BORDER = "#2A2A2A"
COLOR_PRIMARY = "#FF5E3A"
COLOR_PRIMARY_HOVER = "#FF7A5C"
COLOR_PRIMARY_PRESSED = "#BF4A2E"
COLOR_DANGER = "#FF3B30"
COLOR_DANGER_HOVER = "#FF6B6B"
COLOR_DANGER_PRESSED = "#E82E22"
COLOR_WARNING = "#FFD400"
COLOR_TEXT_PRIMARY = "#F2EBDD"
COLOR_TEXT_SECONDARY = "#A8A090"
COLOR_TEXT_MUTED = "#6B6B6B"
COLOR_ACCENT = "#7C3AED"
COLOR_ACCENT_HOVER = "#8B5CF6"
COLOR_ONLINE = "#00B894"
COLOR_OFFLINE = "#FF3B30"

FONT_FAMILY = "Space Grotesk"
FONT_MONO = "Space Mono"

def get_base_dir():
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS).resolve()
    return BASE_DIR

def install_dependencies():
    base_dir = get_base_dir()
    req_file = base_dir.parent / "requirements.txt"
    if not req_file.exists():
        return
    try:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", str(req_file)
        ], cwd=base_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        INSTALADO_FILE.write_text(str(time.time()))
    except Exception:
        pass

CRITICAL_MODULES = ["flask", "waitress", "flask_cors", "websockets", "jsonschema", "Pillow", "pystray"]

def _ensure_module(mod):
    try:
        __import__(mod)
        return True
    except ImportError:
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", mod],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return True
        except Exception:
            return False

def ensure_dependencies():
    for m in CRITICAL_MODULES:
        _ensure_module(m)
    if not INSTALADO_FILE.exists():
        install_dependencies()

def kill_port(port):
    try:
        if sys.platform == "win32":
            result = subprocess.run(["netstat", "-ano"], capture_output=True, text=True)
            for line in result.stdout.splitlines():
                if f":{port} " in line and "LISTENING" in line:
                    parts = line.split()
                    if len(parts) >= 5:
                        pid = parts[-1]
                        subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True)
        else:
            subprocess.run(["fuser", "-k", f"{port}/tcp"], capture_output=True)
    except Exception:
        pass

def wait_for_port(port, timeout=10):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except Exception:
            time.sleep(0.2)
    return False

def run_server():
    global _server_error
    _server_error = None
    base_dir = get_base_dir()
    os.chdir(base_dir)
    sys.path.insert(0, str(base_dir))

    try:
        from silly.app import app, SERVER_PORT, HAS_WAITRESS, waitress_serve
    except Exception as e:
        _server_error = f"No se pudo importar la aplicación del servidor: {e}"
        log_error(_server_error)
        return

    try:
        if HAS_WAITRESS:
            waitress_serve(app, host="0.0.0.0", port=SERVER_PORT, threads=100)
        else:
            app.run(debug=False, host="0.0.0.0", port=SERVER_PORT, use_reloader=False, threaded=True)
    except Exception as e:
        _server_error = f"El servidor falló al iniciar (¿puerto {SERVER_PORT} en uso?): {e}"
        log_error(_server_error)

def open_browser():
    if wait_for_port(PORT, 15):
        webbrowser.open(SERVER_URL, new=2)
        return True
    return False

def _run_ws_thread():
    global _ws_loop
    try:
        import asyncio
        import websocket_server
    except Exception as e:
        print("No se pudo cargar el sync server:", e)
        return
    loop = asyncio.new_event_loop()
    _ws_loop = loop
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(websocket_server.main_async("0.0.0.0", WS_PORT))
    except Exception:
        pass

def start_ws_sync():
    global _ws_thread
    t = threading.Thread(target=_run_ws_thread, daemon=True)
    t.start()
    return t

def ensure_ws_lib():
    try:
        import websockets
        return True
    except ImportError:
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "websockets"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return True
        except Exception:
            return False

def update_server_status(new_status):
    global _server_status
    _server_status = new_status
    if HAS_GUI and _gui_window:
        status_text = "EN LÍNEA" if new_status else "PARADO"
        color = COLOR_ONLINE if new_status else COLOR_OFFLINE
        if _gui_window.winfo_exists():
            if _status_label:
                _status_label.config(text=f"● {status_text}", fg=color)
            _update_status_indicator(new_status)

def _update_status_indicator(online):
    if _gui_window and _gui_window.winfo_exists():
        try:
            indicator = _gui_window.nametowidget("status_indicator")
            indicator.config(bg=COLOR_ONLINE if online else COLOR_OFFLINE)
        except Exception:
            pass

def create_tray_icon():
    if not HAS_TRAY:
        return None

    icon_path = BASE_DIR.parent / "sillyquiz.ico"
    if not icon_path.exists():
        icon_path = BASE_DIR / "sillyquiz.ico"

    if icon_path.exists():
        image = Image.open(icon_path)
    else:
        image = Image.new("RGBA", (64, 64), (13, 15, 20, 0))
        # Draw a simple icon
        from PIL import ImageDraw
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle([8, 8, 56, 56], radius=12, fill=(0, 212, 170, 255))
        draw.text((22, 20), "SQ", fill=(13, 15, 20, 255), font_size=24)

    menu = pystray.Menu(
        pystray.MenuItem("SillyQuiz", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Abrir Panel", lambda: webbrowser.open(SERVER_URL)),
        pystray.MenuItem("Constructor (BuildSilly)", lambda: webbrowser.open(BUILDER_URL)),
        pystray.MenuItem("Pantalla Display", lambda: webbrowser.open(DISPLAY_URL)),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Salir", on_exit),
    )

    icon = pystray.Icon("SillyQuiz", image, "SillyQuiz", menu)
    return icon

def on_exit(icon=None, item=None):
    _shutdown_event.set()
    try:
        import requests
        requests.post(f"http://127.0.0.1:{PORT}/api/shutdown", timeout=2)
    except Exception:
        pass
    _stop_ws()
    if _tray_icon:
        _tray_icon.stop()
    os._exit(0)

def _stop_ws():
    global _ws_thread, _ws_loop
    if _ws_loop is not None:
        try:
            _ws_loop.call_soon_threadsafe(_ws_loop.stop)
        except Exception:
            pass
    if _ws_thread is not None:
        _ws_thread.join(timeout=3)
    _ws_thread = None
    _ws_loop = None
    kill_port(WS_PORT)

# Modern styled button
class ModernButton(tk.Button):
    def __init__(self, master, style="primary", **kwargs):
        self.style_type = style
        self._pressed = False
        
        styles = {
            "primary": {
                "bg": COLOR_PRIMARY, "fg": COLOR_BG,
                "activebackground": COLOR_PRIMARY_HOVER, "activeforeground": COLOR_BG,
            },
            "danger": {
                "bg": COLOR_DANGER, "fg": COLOR_TEXT_PRIMARY,
                "activebackground": COLOR_DANGER_HOVER, "activeforeground": COLOR_TEXT_PRIMARY,
            },
            "secondary": {
                "bg": COLOR_SURFACE, "fg": COLOR_TEXT_PRIMARY,
                "activebackground": COLOR_SURFACE_HOVER, "activeforeground": COLOR_TEXT_PRIMARY,
            },
            "ghost": {
                "bg": COLOR_SURFACE, "fg": COLOR_TEXT_SECONDARY,
                "activebackground": COLOR_SURFACE_HOVER, "activeforeground": COLOR_TEXT_PRIMARY,
            }
        }
        
        s = styles.get(style, styles["primary"])
        
        super().__init__(master, **kwargs,
            font=(FONT_FAMILY, 10, "bold"),
            relief=tk.FLAT,
            cursor="hand2",
            bd=0,
            highlightthickness=0,
            bg=s["bg"],
            fg=s["fg"],
            activebackground=s["activebackground"],
            activeforeground=s["activeforeground"],
            padx=20,
            pady=12,
        )
        
        self.default_bg = s["bg"]
        self.hover_bg = s["activebackground"]
        self.pressed_bg = styles[style].get("activebackground", s["activebackground"])
        
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<ButtonPress-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)
    
    def _on_enter(self, e):
        if self["state"] != tk.DISABLED:
            self.config(bg=self.hover_bg)
    
    def _on_leave(self, e):
        if self["state"] != tk.DISABLED and not self._pressed:
            self.config(bg=self.default_bg)
    
    def _on_press(self, e):
        if self["state"] != tk.DISABLED:
            self._pressed = True
            self.config(bg=self.pressed_bg)
    
    def _on_release(self, e):
        self._pressed = False
        if self["state"] != tk.DISABLED:
            self.config(bg=self.hover_bg if self.winfo_containing(e.x_root, e.y_root) == self else self.default_bg)
    
    def set_state(self, state):
        self.config(state=state)
        if state == tk.DISABLED:
            self.config(bg=COLOR_BORDER, fg=COLOR_TEXT_MUTED)
        else:
            self.config(bg=self.default_bg, fg=self["fg"])

def create_gui():
    global _gui_window, _server_status, _gui_running, _status_label, _btn_start, _btn_stop

    if not HAS_GUI:
        return

    _gui_running = True
    log_info("create_gui: START")

    _gui_window = tk.Tk()
    log_info("create_gui: Tk() created")

    _gui_window.title("SillyQuiz — Administrador del Servidor")
    _gui_window.geometry("540x620")
    _gui_window.configure(bg=COLOR_BG)
    _gui_window.resizable(False, False)
    _gui_window.minsize(540, 620)

    # Center window
    _gui_window.update_idletasks()
    x = (_gui_window.winfo_screenwidth() // 2) - 270
    y = (_gui_window.winfo_screenheight() // 2) - 310
    _gui_window.geometry(f"+{x}+{y}")

    # Try to set icon
    try:
        icon_path = BASE_DIR.parent / "sillyquiz.ico"
        if not icon_path.exists():
            icon_path = BASE_DIR / "sillyquiz.ico"
        if icon_path.exists():
            _gui_window.iconbitmap(str(icon_path))
    except Exception:
        pass

    log_info("create_gui: Building UI...")

    # Main container with padding
    main_frame = tk.Frame(_gui_window, bg=COLOR_BG, padx=24, pady=20)
    main_frame.pack(fill=tk.BOTH, expand=True)

    # Header
    header_frame = tk.Frame(main_frame, bg=COLOR_BG)
    header_frame.pack(fill=tk.X, pady=(0, 24))

    # Logo + Title
    logo_frame = tk.Frame(header_frame, bg=COLOR_BG)
    logo_frame.pack(anchor=tk.W)

    # App icon circle
    icon_canvas = tk.Canvas(logo_frame, width=48, height=48, bg=COLOR_BG, highlightthickness=0)
    icon_canvas.pack(side=tk.LEFT, padx=(0, 14))
    icon_canvas.create_oval(4, 4, 44, 44, fill=COLOR_PRIMARY, outline="")
    icon_canvas.create_text(24, 24, text="SQ", fill=COLOR_BG, font=(FONT_FAMILY, 16, "bold"))

    title_frame = tk.Frame(logo_frame, bg=COLOR_BG)
    title_frame.pack(side=tk.LEFT, fill=tk.Y)

    tk.Label(
        title_frame,
        text="SillyQuiz",
        font=(FONT_FAMILY, 22, "bold"),
        bg=COLOR_BG,
        fg=COLOR_TEXT_PRIMARY,
    ).pack(anchor=tk.W)

    tk.Label(
        title_frame,
        text="Administrador del Servidor",
        font=(FONT_FAMILY, 10),
        bg=COLOR_BG,
        fg=COLOR_TEXT_MUTED,
    ).pack(anchor=tk.W)

    # Status Card
    status_card = tk.Frame(main_frame, bg=COLOR_SURFACE, highlightbackground=COLOR_BORDER, highlightthickness=1)
    status_card.pack(fill=tk.X, pady=(0, 20), ipady=16, ipadx=20)

    # Status header
    status_header = tk.Frame(status_card, bg=COLOR_SURFACE)
    status_header.pack(fill=tk.X, pady=(0, 8))

    tk.Label(
        status_header,
        text="Estado del Servidor",
        font=(FONT_FAMILY, 11, "bold"),
        bg=COLOR_SURFACE,
        fg=COLOR_TEXT_SECONDARY,
    ).pack(side=tk.LEFT)

    # Status indicator + text
    status_row = tk.Frame(status_card, bg=COLOR_SURFACE)
    status_row.pack(fill=tk.X)

    # Animated status dot
    status_canvas = tk.Canvas(status_row, width=12, height=12, bg=COLOR_SURFACE, highlightthickness=0, name="status_indicator")
    status_canvas.pack(side=tk.LEFT, padx=(0, 10))
    status_dot = status_canvas.create_oval(2, 2, 10, 10, fill=COLOR_OFFLINE, outline="")

    _status_label = tk.Label(
        status_row,
        text=f"● {_server_status}",
        font=(FONT_FAMILY, 13, "bold"),
        bg=COLOR_SURFACE,
        fg=COLOR_OFFLINE,
    )
    _status_label.pack(side=tk.LEFT, anchor=tk.W)

    # Pulse animation for online status
    def pulse_status():
        if _gui_running and _gui_window and _gui_window.winfo_exists():
            if _server_status == "EN LÍNEA":
                current = status_canvas.itemcget(status_dot, "fill")
                new_color = COLOR_ONLINE if current == COLOR_OFFLINE else COLOR_ONLINE
                status_canvas.itemconfig(status_dot, fill=new_color)
            else:
                status_canvas.itemconfig(status_dot, fill=COLOR_OFFLINE)
            _gui_window.after(1500, pulse_status)

    pulse_status()
    log_info("create_gui: pulse_status started")

    # Divider
    divider = tk.Frame(main_frame, bg=COLOR_BORDER, height=1)
    divider.pack(fill=tk.X, pady=(0, 20))

    # Control Buttons
    btn_frame = tk.Frame(main_frame, bg=COLOR_BG)
    btn_frame.pack(fill=tk.X, pady=(0, 24))

    _btn_start = ModernButton(
        btn_frame,
        style="primary",
        text="▶  Iniciar Servidor",
        command=start_server_gui,
    )
    _btn_start.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8))

    _btn_stop = ModernButton(
        btn_frame,
        style="danger",
        text="⏹  Detener Servidor",
        command=stop_server_gui,
        state=tk.DISABLED,
    )
    _btn_stop.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(8, 0))

    log_info("create_gui: Control buttons created")

    # Divider
    divider2 = tk.Frame(main_frame, bg=COLOR_BORDER, height=1)
    divider2.pack(fill=tk.X, pady=(0, 20))

    # Quick Links Section
    links_label = tk.Label(
        main_frame,
        text="⚡  Accesos Rápidos",
        font=(FONT_FAMILY, 11, "bold"),
        bg=COLOR_BG,
        fg=COLOR_TEXT_SECONDARY,
    )
    links_label.pack(anchor=tk.W, pady=(0, 12))

    links_data = [
        ("📊", "Panel de Control", SERVER_URL, COLOR_PRIMARY),
        ("🖥️", "Pantalla Display", DISPLAY_URL, COLOR_ACCENT),
        ("🧩", "Constructor (BuildSilly)", BUILDER_URL, COLOR_WARNING),
        ("📋", "Estado API", f"http://127.0.0.1:{PORT}/api/estado-actual", COLOR_TEXT_MUTED),
    ]

    def lighten_color(hex_color, factor=0.2):
        hex_color = hex_color.lstrip('#')
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
        r = min(255, int(r + (255 - r) * factor))
        g = min(255, int(g + (255 - g) * factor))
        b = min(255, int(b + (255 - b) * factor))
        return f"#{r:02x}{g:02x}{b:02x}"

    for icon, title, url, accent_color in links_data:
        link_frame = tk.Frame(main_frame, bg=COLOR_SURFACE, highlightbackground=COLOR_BORDER, highlightthickness=1)
        link_frame.pack(fill=tk.X, pady=4, ipady=10, ipadx=14)

        # Icon circle
        icon_canvas = tk.Canvas(link_frame, width=36, height=36, bg=COLOR_SURFACE, highlightthickness=0)
        icon_canvas.pack(side=tk.LEFT, padx=(0, 14))
        icon_canvas.create_oval(2, 2, 34, 34, fill=lighten_color(accent_color), outline=accent_color)
        icon_canvas.create_text(18, 18, text=icon, font=(FONT_FAMILY, 13), fill=accent_color)

        # Text content
        text_frame = tk.Frame(link_frame, bg=COLOR_SURFACE)
        text_frame.pack(side=tk.LEFT, fill=tk.X, expand=True)

        tk.Label(
            text_frame,
            text=title,
            font=(FONT_FAMILY, 10, "bold"),
            bg=COLOR_SURFACE,
            fg=COLOR_TEXT_PRIMARY,
            anchor=tk.W,
        ).pack(anchor=tk.W)

        tk.Label(
            text_frame,
            text=url,
            font=(FONT_MONO, 8),
            bg=COLOR_SURFACE,
            fg=COLOR_TEXT_MUTED,
            anchor=tk.W,
        ).pack(anchor=tk.W)

        # Click handler
        def make_handler(u):
            return lambda e: webbrowser.open(u)

        for widget in [link_frame, icon_canvas, text_frame]:
            widget.bind("<Button-1>", make_handler(url))
            widget.bind("<Enter>", lambda e, w=link_frame: w.config(bg=COLOR_SURFACE_HOVER))
            widget.bind("<Leave>", lambda e, w=link_frame: w.config(bg=COLOR_SURFACE))
            widget.config(cursor="hand2")

    log_info("create_gui: Quick links created")

    # Divider
    divider3 = tk.Frame(main_frame, bg=COLOR_BORDER, height=1)
    divider3.pack(fill=tk.X, pady=(20, 16))

    # Server info
    info_frame = tk.Frame(main_frame, bg=COLOR_BG)
    info_frame.pack(fill=tk.X, pady=(0, 20))

    tk.Label(
        info_frame,
        text=f"Servidor HTTP: http://127.0.0.1:{PORT}",
        font=(FONT_MONO, 9),
        bg=COLOR_BG,
        fg=COLOR_TEXT_MUTED,
    ).pack(anchor=tk.W)

    tk.Label(
        info_frame,
        text=f"WebSocket Sync: ws://127.0.0.1:{WS_PORT}",
        font=(FONT_MONO, 9),
        bg=COLOR_BG,
        fg=COLOR_TEXT_MUTED,
    ).pack(anchor=tk.W)

    # Bottom buttons
    bottom_frame = tk.Frame(main_frame, bg=COLOR_BG)
    bottom_frame.pack(fill=tk.X, side=tk.BOTTOM)

    # Minimize to tray button (if available)
    if HAS_TRAY:
        btn_tray = ModernButton(
            bottom_frame,
            style="secondary",
            text="📥 Minimizar a Bandeja",
            command=minimize_to_tray,
        )
        btn_tray.pack(side=tk.LEFT, padx=(0, 8))

    btn_quit = ModernButton(
        bottom_frame,
        style="ghost",
        text="✕  Salir",
        command=on_gui_close,
    )
    btn_quit.pack(side=tk.RIGHT)

    log_info("create_gui: Bottom buttons created")

    # Start status update thread
    update_server_status_thread()
    log_info("create_gui: Status thread started")

    _gui_window.protocol("WM_DELETE_WINDOW", on_gui_close)
    log_info("create_gui: Entering mainloop")
    _gui_window.mainloop()
    log_info("create_gui: mainloop ENDED")

def update_server_status_thread():
    if not _gui_running or not _gui_window:
        return

    try:
        if _server_thread and _server_thread.is_alive():
            current_status = "EN LÍNEA"
        else:
            current_status = "PARADO"

        if current_status != _server_status:
            update_server_status(current_status == "EN LÍNEA")

        _gui_window.after(1000, update_server_status_thread)
    except Exception:
        pass

def start_server_gui():
    global _server_thread, _ws_thread
    if _server_thread and _server_thread.is_alive():
        messagebox.showinfo("Información", "El servidor ya está en ejecución.")
        return

    try:
        if not getattr(sys, 'frozen', False):
            ensure_dependencies()
        log_info(f"Intentando iniciar el servidor en el puerto {PORT}...")
        kill_port(PORT)

        _server_thread = threading.Thread(target=run_server, daemon=True)
        _server_thread.start()

        # WebSocket sync server (port 8081)
        global _ws_thread
        if ensure_ws_lib():
            _ws_thread = start_ws_sync()
        else:
            print("Advertencia: no se pudo instalar 'websockets'; sync multi-display desactivado.")

        update_server_status(True)
        _gui_window.after(100, check_server_started)

        _btn_start.set_state(tk.DISABLED)
        _btn_stop.set_state(tk.NORMAL)

    except Exception as e:
        messagebox.showerror("Error", f"No se pudo iniciar el servidor: {e}")
        update_server_status(False)

def check_server_started():
    if not _gui_running or not _gui_window:
        return
    if wait_for_port(PORT, 2):
        update_server_status(True)
        _btn_start.set_state(tk.DISABLED)
        _btn_stop.set_state(tk.NORMAL)
        webbrowser.open(SERVER_URL)
        messagebox.showinfo("Éxito", "Servidor iniciado correctamente.\n\nSe abrió el panel de control en el navegador.")
    elif _server_thread and _server_thread.is_alive():
        _gui_window.after(100, check_server_started)
    else:
        update_server_status(False)
        detalle = _server_error or "El servidor terminó inesperadamente o no enlazó el puerto."
        log_error("check_server_started: " + detalle)
        messagebox.showerror("Error", "El servidor no pudo iniciarse.\n\n" + str(detalle))
        _btn_start.set_state(tk.NORMAL)
        _btn_stop.set_state(tk.DISABLED)

def stop_server_gui():
    try:
        if _server_thread and _server_thread.is_alive():
            _shutdown_event.set()
            try:
                import requests
                requests.post(f"http://127.0.0.1:{PORT}/api/shutdown", timeout=2)
            except Exception:
                pass
            _server_thread.join(timeout=5)

        _stop_ws()

        update_server_status(False)
        _btn_start.set_state(tk.NORMAL)
        _btn_stop.set_state(tk.DISABLED)

        messagebox.showinfo("Información", "Servidor detenido.")

    except Exception as e:
        messagebox.showerror("Error", f"No se pudo detener el servidor: {e}")

def minimize_to_tray():
    global _tray_icon
    if HAS_TRAY:
        _gui_window.withdraw()
        _tray_icon = create_tray_icon()
        if _tray_icon:
            threading.Thread(target=_tray_icon.run, daemon=True).start()

def on_gui_close():
    if messagebox.askokcancel("Salir", "¿Desea cerrar la aplicación y detener el servidor?"):
        _shutdown_event.set()
        if _server_thread and _server_thread.is_alive():
            try:
                import requests
                requests.post(f"http://127.0.0.1:{PORT}/api/shutdown", timeout=2)
            except Exception:
                pass
        _stop_ws()
        if _gui_window:
            _gui_window.destroy()
        os._exit(0)

def security_bootstrap():
    """Generate CSRF_SECRET + PIN hash on first run. Shows PIN to user."""
    import hashlib
    import secrets as _secrets

    config_path = BASE_DIR / "config.json"
    password_hash_path = BASE_DIR / ".password_hash"
    password_salt_path = BASE_DIR / ".password_salt"

    # --- CSRF_SECRET: inject into env if not set ---
    if not os.environ.get("CSRF_SECRET"):
        if config_path.exists():
            try:
                import json as _json
                with open(config_path, "r", encoding="utf-8") as f:
                    cfg = _json.load(f)
                csrf = cfg.get("security", {}).get("csrf_secret", "")
                if csrf:
                    os.environ["CSRF_SECRET"] = csrf
            except Exception:
                pass
        if not os.environ.get("CSRF_SECRET"):
            new_secret = _secrets.token_hex(32)
            os.environ["CSRF_SECRET"] = new_secret
            # Persist to config.json
            try:
                import json as _json
                cfg = {}
                if config_path.exists():
                    with open(config_path, "r", encoding="utf-8") as f:
                        cfg = _json.load(f)
                cfg.setdefault("security", {})["csrf_secret"] = new_secret
                with open(config_path, "w", encoding="utf-8") as f:
                    _json.dump(cfg, f, indent=4, ensure_ascii=False)
                log_info("CSRF_SECRET generado y guardado en config.json")
            except Exception as e:
                log_error(f"No se pudo guardar CSRF_SECRET en config.json: {e}")

    # --- PIN: generate on first run, show to user ---
    os.environ["SILLY_PASSWORD_HASH"] = str(password_hash_path)
    os.environ["SILLY_PASSWORD_SALT"] = ""

    if not password_hash_path.exists():
        pin = _secrets.token_hex(4).upper()[:8]  # 8-char alphanumeric PIN
        salt = _secrets.token_hex(16)
        try:
            h = hashlib.sha256((pin + salt).encode()).hexdigest()
            password_hash_path.write_text(h, encoding="utf-8")
            password_salt_path.write_text(salt, encoding="utf-8")
            log_info("PIN de acceso generado (primer arranque)")
            # Show PIN to user
            if HAS_GUI:
                try:
                    import tkinter as tk
                    from tkinter import messagebox
                    root = tk.Tk()
                    root.withdraw()
                    messagebox.showinfo(
                        "SillyQuiz — Primer Arranque",
                        f"Se ha generado un PIN de acceso para el panel de control.\n\n"
                        f"PIN: {pin}\n\n"
                        f"Guárdalo en un lugar seguro. Se requiere para acceder al panel."
                    )
                    root.destroy()
                except Exception:
                    pass
            else:
                print(f"\n{'='*60}")
                print(f"  SILLYQUIZ — Primer Arranque")
                print(f"  PIN de acceso al panel: {pin}")
                print(f"  Guárdalo en un lugar seguro.")
                print(f"{'='*60}\n")
        except Exception as e:
            log_error(f"No se pudo generar PIN: {e}")
    else:
        # Ensure salt is set for existing installations
        if password_salt_path.exists():
            os.environ["SILLY_PASSWORD_SALT"] = password_salt_path.read_text(encoding="utf-8").strip()


def main():
    global _gui_running, _server_thread, _ws_thread

    # Security bootstrap: generate secrets + PIN on first run
    security_bootstrap()

    # Headless mode (servers / CI / tests): SILLYQUIZ_HEADLESS=1
    if os.environ.get("SILLYQUIZ_HEADLESS"):
        if not getattr(sys, 'frozen', False):
            ensure_dependencies()
        kill_port(PORT)
        _server_thread = threading.Thread(target=run_server, daemon=True)
        _server_thread.start()
        if ensure_ws_lib():
            _ws_thread = start_ws_sync()
        open_browser()
        _shutdown_event.wait()
        return

    # First try GUI
    gui_ok = False
    if HAS_GUI:
        try:
            create_gui()
            gui_ok = True
        except Exception as e:
            if _gui_window:
                _gui_window.destroy()
            log_error(f"Error al crear GUI, iniciando en modo servidor: {e}")

    if not gui_ok:
        # No GUI (or failed): auto-start server + WS sync
        log_info("Modo servidor (sin GUI interactiva). Abriendo panel en navegador...")

        if HAS_TRAY:
            if not open_browser():
                log_info("Advertencia: No se pudo abrir el navegador automáticamente.")
            _tray_icon = create_tray_icon()
            _tray_icon.run()
        else:
            if not getattr(sys, 'frozen', False):
                ensure_dependencies()
            kill_port(PORT)

            _server_thread = threading.Thread(target=run_server, daemon=True)
            _server_thread.start()

            if ensure_ws_lib():
                _ws_thread = start_ws_sync()

            open_browser()

            _shutdown_event.wait()

if __name__ == "__main__":
    _setup_logging()
    try:
        if not ensure_single_instance():
            log_info("Otra instancia de SillyQuiz ya está en ejecución; se aborta esta.")
            headless = bool(os.environ.get("SILLYQUIZ_HEADLESS")) or not HAS_GUI
            if not headless:
                try:
                    import tkinter as tk
                    from tkinter import messagebox
                    root = tk.Tk()
                    root.withdraw()
                    messagebox.showerror(
                        "SillyQuiz",
                        "Ya hay otra instancia de SillyQuiz ejecutándose.\n\n"
                        "Cierra la ventana del administrador o el icono de la bandeja "
                        "del sistema antes de abrir otra."
                    )
                    root.destroy()
                except Exception:
                    pass
            sys.exit(1)

        log_info("Launcher iniciado (PID %s)." % os.getpid())
        main()
        log_info("Launcher finalizado.")
    except Exception:
        log_error("Excepción no controlada en el launcher:\n" + traceback.format_exc())
        raise