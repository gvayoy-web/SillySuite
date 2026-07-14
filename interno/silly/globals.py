class DependencyContainer:
    def __init__(self):
        self.state = None
        self.config = None
        self.mode_manager = None
        self.cronometro = None
        self.log = None
        self.DATA_FILE = ""
        self.BASE_DIR = ""
        self.event_bus = None
        self.sound_service = None


_container = DependencyContainer()
container = _container


def get_container():
    return container
