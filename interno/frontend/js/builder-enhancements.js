(function(global) {
  'use strict';

  const BUILDER_VERSION = '3.0.0';

  //================================================================================
  // CONFIGURATION & STATE MANAGEMENT
  //================================================================================

  class BuilderState {
    constructor() {
      this.currentProject = null;
      this.projectHistory = [];
      this.isSaved = false;
      this.autoSaveEnabled = true;
      this.autoSaveInterval = 5000;
      this.lastSaveTime = 0;
      this.changeListeners = [];
      this.isInitialized = false;
    }

    setProject(project) {
      this.projectHistory.push(this.currentProject);
      this.currentProject = project;
      this.isSaved = false;
      this.notifyChange('project-changed', {
        project,
        previous: this.projectHistory[this.projectHistory.length - 1]
      });
      this.scheduleAutoSave();
    }

    getProject() {
      return this.currentProject;
    }

    markSaved() {
      this.isSaved = true;
      this.lastSaveTime = Date.now();
      this.notifyChange('project-saved', {
        timestamp: this.lastSaveTime
      });
    }

    scheduleAutoSave() {
      if (!this.autoSaveEnabled) return;

      clearTimeout(this.autoSaveTimeout);
      this.autoSaveTimeout = setTimeout(() => {
        this.saveToStorage();
      }, this.autoSaveInterval);
    }

    async saveToStorage() {
      if (!this.currentProject) return;

      try {
        const projectData = JSON.stringify(this.currentProject);
        localStorage.setItem('sillyquiz_builder_project', projectData);
        this.markSaved();
        this.notifyChange('storage-saved', {
          timestamp: Date.now()
        });
      } catch (e) {
        this.notifyChange('storage-error', {
          error: e.message
        });
      }
    }

    async loadFromStorage() {
      try {
        const projectData = localStorage.getItem('sillyquiz_builder_project');
        if (projectData) {
          const project = JSON.parse(projectData);
          this.setProject(project);
          return project;
        }
      } catch (e) {
        this.notifyChange('storage-error', {
          error: e.message
        });
      }
      return null;
    }

    clear() {
      if (confirm('¿Estás seguro de que deseas borrar el proyecto actual?')) {
        this.setProject({
          version: BUILDER_VERSION,
          name: 'Nuevo proyecto',
          description: '',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          blocks: [],
          assets: {},
          settings: {
            width: 800,
            height: 600,
            theme: 'dark',
            zoom: 1,
            panX: 0,
            panY: 0
          }
        });
      }
    }

    canUndo() {
      return this.projectHistory.length > 0;
    }

    undo() {
      if (this.canUndo()) {
        const previous = this.projectHistory.pop();
        this.notifyChange('undo', {
          previous
        });
        return previous;
      }
      return null;
    }

    getChangeHistory() {
      return this.projectHistory;
    }

    onChange(callback) {
      this.changeListeners.push(callback);
      return () => {
        const index = this.changeListeners.indexOf(callback);
        if (index > -1) {
          this.changeListeners.splice(index, 1);
        }
      };
    }

    notifyChange(event, data) {
      this.changeListeners.forEach(callback => {
        try {
          callback(event, data);
        } catch (e) {
          console.error(`Error en callback de cambio: ${e}`);
        }
      });
    }

    export() {
      if (!this.currentProject) return null;

      return {
        ...this.currentProject,
        exportedAt: new Date().toISOString(),
        version: BUILDER_VERSION
      };
    }

    import(data) {
      if (!data.version) {
        throw new Error('Datos de proyecto inválidos: falta la versión');
      }

      this.setProject(data);
      return this.currentProject;
    }

    cleanup() {
      if (this.autoSaveTimeout) {
        clearTimeout(this.autoSaveTimeout);
      }
      this.changeListeners = [];
      this.projectHistory = [];
      this.currentProject = null;
      this.isInitialized = false;
    }
  }

  //================================================================================
  // TEMPLATE GALLERY - Pre-built project templates
  //================================================================================

  const PROJECT_TEMPLATES = {
    trivia: {
      name: 'Trivia de Ciencia',
      description: 'Plantilla clásica de trivia con preguntas de ciencia',
      icon: '🎓',
      theme: 'ocean',
      blocks: [
        {
          opcode: 'on_mode_init',
          text: 'cuando el cronómetro inicia en vivo',
          args: {}
        },
        {
          opcode: 'set_theme',
          text: 'aplicar tema [THEME]',
          args: { THEME: 'ocean' }
        },
        {
          opcode: 'show_ui_component',
          text: 'mostrar [COMP] en [DISP]',
          args: { COMP: 'pregunta', DISP: 'display' }
        },
        {
          opcode: 'quiz_init_engine',
          text: 'quiz_init_engine preguntas:[N] categorias:[CAT]',
          args: { N: 10, CAT: 'ciencia' }
        }
      ]
    },

    competition: {
      name: 'Competencia/Rankings',
      description: 'Sistema avanzado de rankings con animaciones',
      icon: '🏆',
      theme: 'fire',
      blocks: [
        {
          opcode: 'on_mode_init',
          text: 'al iniciar el modo',
          args: {}
        },
        {
          opcode: 'set_theme',
          text: 'aplicar tema [THEME]',
          args: { THEME: 'fire' }
        },
        {
          opcode: 'show_ui_component',
          text: 'mostrar [COMP] en [DISP]',
          args: { COMP: 'tabla_puntajes', DISP: 'display' }
        },
        {
          opcode: 'players_set_active_slots',
          text: 'players_set_active_slots [N] jugadores',
          args: { N: 16 }
        },
        {
          opcode: 'repeat_times',
          text: 'repetir [N] veces',
          args: { N: 5 },
          body: [
            {
              opcode: 'wait_seconds',
              text: 'esperar [SEC] segundos',
              args: { SEC: 1 },
              body: [
                {
                  opcode: 'quiz_get_answer_text',
                  text: 'quiz_get_answer_text [OPT]',
                  args: { OPT: 'A' }
                }
              ]
            }
          ]
        }
      ]
    },

    animation: {
      name: 'Show de Animación Completo',
      description: 'Showcase con animaciones avanzadas y efectos visuales',
      icon: '✨',
      theme: 'neon',
      blocks: [
        {
          opcode: 'on_mode_init',
          text: 'al iniciar el modo',
          args: {}
        },
        {
          opcode: 'set_theme',
          text: 'aplicar tema [THEME]',
          args: { THEME: 'neon' }
        },
        {
          opcode: 'set_background_image',
          text: 'fondo con imagen [SRC] en [DISP]',
          args: { SRC: 'http://example.com/bg.jpg', DISP: 'display' }
        },
        {
          opcode: 'spawn_particle_emitter',
          text: 'partículas [KIND] en X:[X] Y:[Y]',
          args: { KIND: 'confetti', X: 0, Y: 0 }
        },
        {
          opcode: 'play_bg_music',
          text: 'música [FILE] vol [VOL] loop [LOOP]',
          args: { FILE: 'http://example.com/music.mp3', VOL: 50, LOOP: true }
        },
        {
          opcode: 'repeat_times',
          text: 'repetir [N] veces',
          args: { N: 50 },
          body: [
            {
              opcode: 'if_then',
              text: 'si [COND] entonces',
              args: { COND: 'boolean true' },
              body: [
                {
                  opcode: 'spawn_particle_emitter',
                  text: 'partículas [KIND] en X:[X] Y:[Y]',
                  args: { KIND: 'fire', X: Math.random() * 800 - 400, Y: Math.random() * 600 - 300 }
                }
              ]
            }
          ]
        }
      ]
    },

    quiz_master: {
      name: 'Quiz Master Pro',
      description: 'Motor de quiz completo con sistema de puntuación',
      icon: '🧠',
      theme: 'retro',
      blocks: [
        {
          opcode: 'on_mode_init',
          text: 'al iniciar el modo',
          args: {}
        },
        {
          opcode: 'set_theme',
          text: 'aplicar tema [THEME]',
          args: { THEME: 'retro' }
        },
        {
          opcode: 'show_ui_component',
          text: 'mostrar [COMP] en [DISP]',
          args: { COMP: 'pregunta', DISP: 'display' }
        },
        {
          opcode: 'show_ui_component',
          text: 'mostrar [COMP] en [DISP]',
          args: { COMP: 'tabla_puntajes', DISP: 'display' }
        },
        {
          opcode: 'quiz_init_engine',
          text: 'quiz_init_engine preguntas:[N] categorias:[CAT]',
          args: { N: 20, CAT: 'mix' }
        },
        {
          opcode: 'on_question_start',
          text: 'cuando el cronómetro inicia en vivo',
          args: {}
        }
      ]
    }
  };

  //================================================================================
  // BUILDER ENHANCEMENTS CLASS - Main enhancements controller
  //================================================================================

  class BuilderEnhancements {
    constructor(scratchUI) {
      this.scratchUI = scratchUI;
      this.state = new BuilderState();
      this.isInitialized = false;
      this.updateInterval = null;
    }

    init() {
      if (this.isInitialized) return;

      this.setupStateManagement();
      this.setupTemplateGallery();
      this.setupImportExport();
      this.setupKeyboardShortcuts();
      this.setupCommandPalette();
      this.setupLivePreview();
      this.setupAssetManagement();
      this.setupPerformanceMonitoring();

      this.isInitialized = true;

      // Emit initialization event
      this.emit('enhancements:initialized', {
        state: this.state,
        scratchUI: this.scratchUI
      });
    }

    setupStateManagement() {
      this.state.onChange(this.handleStateChange.bind(this));

      // Auto-load project from localStorage on startup
      this.state.loadFromStorage().then(project => {
        if (project) {
          this.emit('enhancements:project-loaded', {
            project
          });
        } else {
          // Create new project
          this.createNewProject();
        }
      });
    }

    createNewProject() {
      const project = {
        version: BUILDER_VERSION,
        name: 'Nuevo proyecto',
        description: '',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        blocks: [],
        assets: {},
        settings: {
          width: 800,
          height: 600,
          theme: 'dark',
          zoom: 1,
          panX: 0,
          panY: 0
        }
      };
      this.state.setProject(project);
      this.emit('enhancements:new-project', {
        project
      });
    }

    setupTemplateGallery() {
      // Make templates available to the UI
      globalThis.BUILDER_TEMPLATES = PROJECT_TEMPLATES;

      // Emit template event for UI
      this.emit('enhancements:templates-ready', {
        templates: PROJECT_TEMPLATES
      });
    }

    setupImportExport() {
      // Export button handler
      this.onAction('export', () => {
        const projectData = this.state.export();
        if (!projectData) return;

        const dataStr = JSON.stringify(projectData, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

        const exportName = `${this.state.currentProject.name || 'sillyquiz-project'}.json`;
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportName);
        linkElement.click();

        this.showToast('Proyecto exportado exitosamente', 'success');
      });

      // Import button handler
      this.onAction('import', async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;

          try {
            const text = await file.text();
            const data = JSON.parse(text);
            this.state.import(data);
            this.showToast('Proyecto importado exitosamente', 'success');
          } catch (err) {
            this.showToast('Error importando proyecto: ' + err.message, 'error');
          }
        };

        input.click();
      });
    }

    setupKeyboardShortcuts() {
      // Register global keyboard shortcuts
      const shortcuts = {
        'Ctrl+N': 'new',
        'Ctrl+S': 'save',
        'Ctrl+O': 'load',
        'Ctrl+E': 'export',
        'Ctrl+Shift+E': 'import',
        'Ctrl+Shift+L': 'theme-toggle',
        'Ctrl+M': 'fab-toggle',
        'Ctrl+P': 'command-palette',
        'F1': 'shortcuts',
        'F5': 'run-preview',
        'F9': 'breakpoint-toggle',
        'F11': 'step-into',
        'Ctrl+Enter': 'run-preview',
        'Escape': 'close-modals'
      };

      document.addEventListener('keydown', (e) => {
        const keys = [];
        if (e.ctrlKey || e.metaKey) keys.push('Ctrl');
        if (e.shiftKey) keys.push('Shift');
        if (e.altKey) keys.push('Alt');
        keys.push(e.key.replace('Arrow', '').replace('Plus', '+').replace('Minus', '-'));

        const shortcutKey = keys.join('+');
        const action = shortcuts[shortcutKey];

        if (action) {
          e.preventDefault();
          this.handleKeyboardAction(action, e);
        }
      });
    }

    setupCommandPalette() {
      this.onAction('command-palette', () => {
        if (globalThis.sillyBuilderEnhancements.commandPalette) {
          globalThis.sillyBuilderEnhancements.commandPalette.open();
        }
      });
    }

    setupLivePreview() {
      // Watch for project changes and trigger live preview updates
      this.state.onChange((event, data) => {
        if (event === 'project-changed' || event === 'storage-saved') {
          this.triggerLivePreviewUpdate(data);
        }
      });
    }

    setupAssetManagement() {
      // Initialize asset manager if available
      if (globalThis.AssetManager) {
        globalThis.AssetManager.init({
          onAssetChange: () => this.triggerLivePreviewUpdate({
            type: 'assets'
          })
        });
      }
    }

    setupPerformanceMonitoring() {
      let lastFrameTime = performance.now();
      let fps = 60;

      const measureFPS = (currentFrameTime) => {
        const delta = currentFrameTime - lastFrameTime;
        fps = 1000 / delta;
        lastFrameTime = currentFrameTime;

        if (fps < 30) {
          this.onPerformanceWarning('Low FPS detected', {
            fps
          });
        }

        requestAnimationFrame(measureFPS);
      };

      requestAnimationFrame(measureFPS);
    }

    handleKeyboardAction(action, e) {
      switch (action) {
        case 'new':
          if (confirm('¿Crear nuevo proyecto? Se perderán los cambios no guardados.')) {
            this.createNewProject();
          }
          break;

        case 'save':
          this.onAction('save')();
          break;

        case 'load':
          this.onAction('load')();
          break;

        case 'export':
          this.onAction('export')();
          break;

        case 'import':
          this.onAction('import')();
          break;

        case 'theme-toggle':
          const currentTheme = document.documentElement.classList.contains('theme-light') ? 'dark' : 'light';
          document.documentElement.classList.toggle('theme-light');
          if (this.state.currentProject) {
            this.state.currentProject.settings.theme = currentTheme;
          }
          this.showToast(currentTheme === 'dark' ? 'Modo oscuro activado' : 'Modo claro activado', 'info');
          break;

        case 'fab-toggle':
          const fab = document.getElementById('sqFabBtn');
          if (fab) fab.click();
          break;

        case 'command-palette':
          this.onAction('command-palette')();
          break;

        case 'shortcuts':
          this.emit('enhancements:show-shortcuts');
          break;

        case 'run-preview':
          this.onAction('preview')();
          break;

        case 'breakpoint-toggle':
          this.scratchUI?.toggleBreakpoint?.();
          break;

        case 'step-into':
          this.scratchUI?.stepInto?.();
          break;

        case 'close-modals':
          this.emit('enhancements:close-all-modals');
          break;
      }
    }

    handleStateChange(event, data) {
      switch (event) {
        case 'project-changed':
          this.showToast(`Proyecto "${this.state.currentProject.name}" modificado`, 'info');
          break;

        case 'project-saved':
          this.showToast('Proyecto guardado en localStorage', 'success');
          break;

        case 'storage-saved':
          // Silent save
          break;

        case 'storage-error':
          this.showToast('Error guardando en almacenamiento: ' + data.error, 'error');
          break;

        case 'undo':
          this.showToast('Proyecto revertido', 'info');
          break;
      }
    }

    setupTemplateGalleryUI() {
      // This is called from scratch-ui when ready
      if (this.isInitialized && this.scratchUI?.elPalette) {
        this.renderTemplatePalette();
      }
    }

    renderTemplatePalette() {
      const templates = Object.values(PROJECT_TEMPLATES);

      templates.forEach(template => {
        const block = document.createElement('div');
        block.className = 'template-card';
        block.innerHTML = `
          <div class="template-card__icon">${template.icon}</div>
          <div class="template-card__content">
            <h4 class="template-card__title">${template.name}</h4>
            <p class="template-card__desc">${template.description}</p>
          </div>
        `;

        block.addEventListener('click', () => {
          this.applyTemplate(template);
          this.hideTemplateGallery();
        });

        this.scratchUI.elPalette.appendChild(block);
      });
    }

    applyTemplate(template) {
      // Create a new project from template
      const project = {
        version: BUILDER_VERSION,
        name: template.name,
        description: template.description,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        blocks: template.blocks.map(block => ({
          ...block,
          id: 'temp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9)
        })),
        assets: {},
        settings: {
          width: 800,
          height: 600,
          theme: template.theme,
          zoom: 1,
          panX: 0,
          panY: 0
        }
      };

      this.state.setProject(project);
      this.showToast(`Plantilla "${template.name}" aplicada`, 'success');
    }

    triggerLivePreviewUpdate(data) {
      this.emit('enhancements:live-preview-trigger', data);
    }

    // Action dispatcher
    onAction(action, handler) {
      if (!this.actions) this.actions = {};
      this.actions[action] = handler;
      return this;
    }

    getAction(action) {
      return this.actions ? this.actions[action] : null;
    }

    // Toast notifications
    showToast(message, type = 'info', duration = 3000) {
      if (globalThis.SillyBuilder && globalThis.SillyBuilder.showToast) {
        globalThis.SillyBuilder.showToast(message, type, duration);
      } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
      }
    }

    // Event emitter
    on(event, callback) {
      if (!this.events) this.events = {};
      if (!this.events[event]) this.events[event] = [];
      this.events[event].push(callback);
      return () => {
        const index = this.events[event].indexOf(callback);
        if (index > -1) {
          this.events[event].splice(index, 1);
        }
      };
    }

    emit(event, data) {
      if (!this.events || !this.events[event]) return;
      this.events[event].forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.error(`Error en callback de mejoras del builder: ${e}`);
        }
      });
    }

    // Initialization check
    isReady() {
      return this.isInitialized && this.scratchUI?.isInitialized;
    }

    // Cleanup
    destroy() {
      if (this.autoSaveTimeout) {
        clearTimeout(this.autoSaveTimeout);
      }
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }
      this.state.cleanup();
      this.actions = null;
      this.events = null;
      this.isInitialized = false;
    }
  }

  //================================================================================
  // FACTORY FUNCTION & EXPORT
  //================================================================================

  function createBuilderEnhancements(scratchUI) {
    return new BuilderEnhancements(scratchUI);
 }

  //================================================================================
  // AUTO-INSTALLATION - Attach enhancements to existing ScratchUI
  //================================================================================

  function autoInstall(scratchUI) {
    if (!scratchUI) {
      console.warn('ScratchUI no disponible para auto-instalación de mejoras del builder');
      return null;
    }

    const enhancements = createBuilderEnhancements(scratchUI);
    enhancements.init();

    // Store globally for manual access
    globalThis.sillyBuilderEnhancements = enhancements;

    // Setup template gallery when palette is ready
    if (scratchUI.elPalette) {
      enhancements.setupTemplateGalleryUI();
    } else {
      // Wait for scratch-ui to be ready
      setTimeout(() => {
        if (scratchUI.elPalette) {
          enhancements.setupTemplateGalleryUI();
        }
      }, 100);
    }

    return enhancements;
 }

  //================================================================================
  // EXPORT
  //================================================================================

  globalThis.BuilderEnhancements = BuilderEnhancements;
  globalThis.createBuilderEnhancements = createBuilderEnhancements;
  globalThis.autoInstall = autoInstall;
  globalThis.PROJECT_TEMPLATES = PROJECT_TEMPLATES;

})(typeof window !== 'undefined' ? window : globalThis);
