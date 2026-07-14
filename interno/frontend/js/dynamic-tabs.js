/**
 * DYNAMIC TABS - Sistema de pestañas dinámicas para modos personalizados
 * Inyecta tabs en el sidebar y paneles en el contenido principal
 */

class DynamicTabSystem {
    constructor() {
        this.tabs = new Map(); // tabId -> { nombre, icon, config, panel }
        this.activeTab = null;
        this.tabCounter = 0;
        
        this.init();
    }
    
    init() {
        this.sidebar = document.querySelector('.sidebar-nav');
        this.contentArea = document.getElementById('content');
        
        // Crear botón para abrir Modo Builder
        this.createModeBuilderButton();
        
        // Observar cambios en tabs existentes
        this.observeTabs();
    }
    
    createModeTab(modeId, modeConfig) {
        // Crea nueva pestaña para modo personalizado - simplified version for scratch builder
        const tabId = `mode-${modeId}`;
        
        if (this.tabs.has(tabId)) {
            this.switchToTab(tabId);
            return tabId;
        }
        
        // Si es el modo scratch, usar el constructor y no una pestaña estándar
        if (modeId === 'scratch') {
            this.openModeBuilder();
            return null;
        }
        
        // Para otros modos, crear panel estándar
        const panel = document.createElement('div');
        panel.className = 'tab-panel hidden';
        panel.id = `panel-${tabId}`;
        panel.innerHTML = this.renderModeTabContent(modeId, modeConfig);
        
        this.contentArea.appendChild(panel);
        
        // Registrar
        this.registerTab(tabId, modeConfig.nombre || modeId, modeConfig.icono || '🎮', panel);
        
        // Cambiar a nueva tab
        this.switchToTab(tabId);
        
        // Inicializar funcionalidad del modo
        this.initModeFunctionality(modeId, modeConfig);
        
        return tabId;
    }
    
    createModeBuilderButton() {
        const builderBtn = document.createElement('button');
        builderBtn.className = 'tab-btn mode-builder-trigger';
        builderBtn.id = 'openModeBuilderBtn';
        builderBtn.title = 'Constructor de Modos';
        builderBtn.innerHTML = '🏗️<span class="mode-builder-badge hidden">NUEVO</span>';
        
        builderBtn.addEventListener('click', () => this.openModeBuilder());
        
        // Insertar antes del footer
        const footer = this.sidebar.querySelector('.sidebar-footer');
        this.sidebar.insertBefore(builderBtn, footer);
    }
    
    openModeBuilder() {
        // El constructor vive ahora en la pestaña "modos" (panel-modos).
        this.switchToTab('modos');
    }
    
    // === API PÚBLICA ===
    
    createModeTab(modeId, modeConfig) {
        // Crea nueva pestaña para modo personalizado
        const tabId = `mode-${modeId}`;
        
        if (this.tabs.has(tabId)) {
            this.switchToTab(tabId);
            return tabId;
        }
        
        // Crear panel
        const panel = document.createElement('div');
        panel.className = 'tab-panel hidden';
        panel.id = `panel-${tabId}`;
        panel.innerHTML = this.renderModeTabContent(modeId, modeConfig);
        
        this.contentArea.appendChild(panel);
        
        // Registrar
        this.registerTab(tabId, modeConfig.nombre || modeId, modeConfig.icono || '🎮', panel);
        
        // Cambiar a nueva tab
        this.switchToTab(tabId);
        
        // Inicializar funcionalidad del modo
        this.initModeFunctionality(modeId, modeConfig);
        
        return tabId;
    }
    
    registerTab(tabId, nombre, icon, panel) {
        // Botón en sidebar
        const btn = document.createElement('button');
        btn.className = 'tab-btn';
        btn.dataset.tab = tabId;
        btn.title = nombre;
        btn.innerHTML = icon;
        
        // Botón cerrar (hover)
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close-btn';
        closeBtn.innerHTML = '✕';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(tabId);
        });
        btn.appendChild(closeBtn);
        
        btn.addEventListener('click', () => this.switchToTab(tabId));
        
        // Insertar antes del footer
        const footer = this.sidebar.querySelector('.sidebar-footer');
        this.sidebar.insertBefore(btn, footer);
        
        this.tabs.set(tabId, {
            id: tabId,
            nombre,
            icon,
            panel,
            button: btn,
            closable: tabId !== 'modo-builder-v2' // El constructor no se cierra
        });
    }
    
    switchToTab(tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab) return;
        
        // Desactivar actual
        if (this.activeTab) {
            this.activeTab.panel.classList.add('hidden');
            this.activeTab.button.classList.remove('active');
        }
        
        // Activar nueva
        tab.panel.classList.remove('hidden');
        tab.button.classList.add('active');
        this.activeTab = tab;
        
        // Scroll panel into view
        tab.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    closeTab(tabId) {
        const tab = this.tabs.get(tabId);
        if (!tab || !tab.closable) return;
        
        // Si era la activa, ir a dashboard
        if (this.activeTab?.id === tabId) {
            this.switchToTab('dashboard');
        }
        
        // Remover DOM
        tab.panel.remove();
        tab.button.remove();
        
        // Limpiar mapa
        this.tabs.delete(tabId);
        
        toastSuccess(`Pestaña "${tab.nombre}" cerrada`);
    }
    
    renderModeTabContent(modeId, config) {
        const nombre = config.nombre || modeId;
        const icon = config.icono || '🎮';
        
        return `
            <div class="mode-tab-header">
                <div class="mode-tab-title">
                    <span class="mode-icon">${icon}</span>
                    <h2>${nombre}</h2>
                    <span class="mode-badge dynamic">PERSONALIZADO</span>
                </div>
                <div class="mode-tab-actions">
                    <button class="btn btn-ghost btn-sm" onclick="modoTabSystem.duplicateMode('${modeId}')">📋 Duplicar</button>
                    <button class="btn btn-ghost btn-sm" onclick="modoTabSystem.exportMode('${modeId}')">📤 Exportar</button>
                    <button class="btn btn-danger btn-sm" onclick="modoTabSystem.deleteMode('${modeId}')">🗑️ Eliminar</button>
                </div>
            </div>
            
            <div class="mode-tab-content">
                <!-- Controles específicos del modo se inyectan aquí -->
                <div class="mode-controls-container">
                    ${this.renderModeControls(modeId, config)}
                </div>
                
                <!-- Preview del modo -->
                <div class="mode-preview-section">
                    <h3>👁️ Vista Previa en Vivo</h3>
                    <canvas id="preview-${modeId}" class="mode-preview-canvas" width="800" height="450"></canvas>
                    <div class="preview-controls">
                        <button class="btn btn-primary btn-sm" onclick="previewEngines['${modeId}']?.render()">🔄 Actualizar</button>
                        <button class="btn btn-ghost btn-sm" onclick="previewEngines['${modeId}']?.triggerConfetti()">🎊 Confetti</button>
                        <button class="btn btn-ghost btn-sm" onclick="previewEngines['${modeId}']?.triggerFlash()">⚡ Flash</button>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderModeControls(modeId, config) {
        // Generar controles según componentes del modo
        const controls = [];
        
        if (config.preguntas) {
            controls.push(`
                <div class="control-section">
                    <h4>📝 Preguntas</h4>
                    <div class="control-grid">
                        <div class="control-item">
                            <label>Fuente</label>
                            <select id="${modeId}-preg-source">
                                <option value="baseActual">Base Actual</option>
                                <option value="personalizado">Personalizado</option>
                            </select>
                        </div>
                        <div class="control-item">
                            <label>Categoría</label>
                            <input type="text" id="${modeId}-preg-cat" placeholder="genesis, exodo...">
                        </div>
                        <div class="control-item">
                            <label>Cantidad</label>
                            <input type="number" id="${modeId}-preg-cant" value="10" min="1" max="100">
                        </div>
                    </div>
                </div>
            `);
        }
        
        if (config.timer) {
            controls.push(`
                <div class="control-section">
                    <h4>⏱️ Temporizador</h4>
                    <div class="control-grid">
                        <div class="control-item">
                            <label>Duración (seg)</label>
                            <input type="number" id="${modeId}-timer-dur" value="60" min="10" max="3600">
                        </div>
                        <div class="control-item">
                            <label>Alerta a los</label>
                            <input type="number" id="${modeId}-timer-alert" value="10" min="0" max="60">
                        </div>
                        <div class="control-item">
                            <label>Formato</label>
                            <select id="${modeId}-timer-fmt">
                                <option value="mm:ss">MM:SS</option>
                                <option value="ss">SS</option>
                            </select>
                        </div>
                    </div>
                </div>
            `);
        }
        
        if (config.scoring) {
            controls.push(`
                <div class="control-section">
                    <h4>🏆 Puntuación</h4>
                    <div class="control-grid">
                        <div class="control-item">
                            <label>Correcto</label>
                            <input type="number" id="${modeId}-score-ok" value="10" min="-50" max="100">
                        </div>
                        <div class="control-item">
                            <label>Incorrecto</label>
                            <input type="number" id="${modeId}-score-err" value="-3" min="-50" max="50">
                        </div>
                        <div class="control-item">
                            <label>Multiplicador racha</label>
                            <input type="number" id="${modeId}-score-mult" value="1.2" step="0.1" min="1" max="3">
                        </div>
                    </div>
                </div>
            `);
        }
        
        if (config.audio) {
            controls.push(`
                <div class="control-section">
                    <h4>🔊 Audio</h4>
                    <div class="control-grid">
                        <div class="control-item">
                            <label>Música</label>
                            <input type="file" id="${modeId}-audio-music" accept="audio/*">
                        </div>
                        <div class="control-item">
                            <label>Volumen</label>
                            <input type="range" id="${modeId}-audio-vol" min="0" max="100" value="50">
                        </div>
                    </div>
                </div>
            `);
        }
        
        return controls.join('') || '<p class="text-muted">Este modo no tiene controles configurables</p>';
    }
    
    initModeFunctionality(modeId, config) {
        // Inicializar preview engine para este modo
        const canvas = document.getElementById(`preview-${modeId}`);
        if (canvas) {
            window.previewEngines = window.previewEngines || {};
            window.previewEngines[modeId] = new PreviewEngine(canvas);
            
            // Render inicial
            setTimeout(() => {
                window.previewEngines[modeId]?.render(config);
            }, 100);
        }
        
        // Bind controles
        this.bindModeControls(modeId, config);
    }
    
    bindModeControls(modeId, config) {
        const container = document.getElementById(`mode-${modeId}-controls`);
        if (!container) return;
        
        // Auto-save en cambios
        container.addEventListener('change', (e) => {
            if (e.target.matches('input, select')) {
                this.saveModeConfig(modeId, e.target.id, e.target.value);
            }
        });
        
        container.addEventListener('input', (e) => {
            if (e.target.matches('input[type="range"]')) {
                this.updateRangeDisplay(e.target);
            }
        });
    }
    
    saveModeConfig(modeId, fieldId, value) {
        // Guardar en backend via API
        const mode = templateEngine.getMode(modeId);
        if (mode) {
            // Actualizar config local
            const key = fieldId.replace(`${modeId}-`, '').replace(/-/g, '_');
            // Determinar sección
            let section = 'general';
            if (fieldId.includes('preg')) section = 'preguntas';
            else if (fieldId.includes('timer')) section = 'timer';
            else if (fieldId.includes('score')) section = 'scoring';
            else if (fieldId.includes('audio')) section = 'audio';
            
            mode.config[section] = mode.config[section] || {};
            mode.config[section][key] = value;
            
            // Debounced save
            clearTimeout(this._saveTimers?.[modeId]);
            this._saveTimers = this._saveTimers || {};
            this._saveTimers[modeId] = setTimeout(() => {
                apiPost(`/api/modes/${modeId}/config`, mode.config);
            }, 500);
        }
    }
    
    // === MÉTODOS DE CONVENIENCIA ===
    
    duplicateMode(modeId) {
        // TODO: Implementar duplicación
        toastSuccess('Modo duplicado');
    }
    
    exportMode(modeId) {
        const mode = templateEngine.getMode(modeId);
        if (!mode) return;
        
        const exportData = {
            template_id: mode.template_id,
            mode_name: mode.nombre,
            exported_at: new Date().toISOString(),
            config: mode.config
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `modo_${mode.nombre.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        toastSuccess('Modo exportado');
    }
    
    deleteMode(modeId) {
        if (!confirm('¿Eliminar este modo permanentemente?')) return;
        
        templateEngine.stopMode(modeId);
        this.closeTab(`mode-${modeId}`);
        
        toastSuccess('Modo eliminado');
    }
    
    observeTabs() {
        // Observar clicks en tabs existentes
        this.sidebar.addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (btn && btn.dataset.tab) {
                this.switchToTab(btn.dataset.tab);
            }
        });
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    window.modoTabSystem = new DynamicTabSystem();
});

// Funciones globales para onclick
window.modoTabSystem = null; // Se inicializa arriba