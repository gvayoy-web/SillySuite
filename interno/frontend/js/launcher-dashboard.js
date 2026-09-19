/**
 * launcher-dashboard.js — Web-based Dashboard for SillyQuiz Launcher
 * Replaces Tkinter GUI with modern, responsive web interface
 * Communicates with Flask backend via REST API + WebSocket
 */

(function(global) {
  'use strict';

  class LauncherDashboard {
    constructor() {
      this.state = {
        server: { online: false, starting: false },
        ws: { connected: false },
        stats: { uptime: 0, connections: 0, sessions: 0, memory: 0 },
        health: { flask: 'unknown', ws: 'unknown', db: 'unknown', engine: 'unknown' },
        activity: [],
        connections: [],
        wsMetrics: { displays: 0, sessions: 0, mobiles: 0, fifoRate: 0, latency: 0 },
        engineMetrics: { games: 0, players: 0, leaderboards: 0, tokens: 0 },
        theme: 'dark',
        language: 'es',
        animations: true,
        compactMode: false
      };

      this.pollInterval = null;
      this.ws = null;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 10;
      this.reconnectDelay = 2000;

      this.init();
    }

    async init() {
      this.loadSettings();
      this.applyTheme();
      this.bindEvents();
      await this.fetchInitialData();
      this.startPolling();
      this.connectWebSocket();
      this.showToast('Dashboard cargado', 'success');
    }

    // ==================== SETTINGS ====================
    loadSettings() {
      try {
        const saved = localStorage.getItem('sillyquiz-dashboard-settings');
        if (saved) {
          const settings = JSON.parse(saved);
          this.state.theme = settings.theme || 'dark';
          this.state.language = settings.language || 'es';
          this.state.animations = settings.animations !== false;
          this.state.compactMode = settings.compactMode === true;
          
          document.getElementById('setTheme').value = this.state.theme;
          document.getElementById('setLanguage').value = this.state.language;
          document.getElementById('setAnimations').checked = this.state.animations;
          document.getElementById('setCompactMode').checked = this.state.compactMode;
          
          if (this.state.compactMode) {
            document.body.classList.add('compact-mode');
          }
        }
      } catch (e) {
        console.warn('Failed to load settings:', e);
      }
    }

    saveSettings() {
      try {
        localStorage.setItem('sillyquiz-dashboard-settings', JSON.stringify({
          theme: this.state.theme,
          language: this.state.language,
          animations: this.state.animations,
          compactMode: this.state.compactMode
        }));
      } catch (e) {
        console.warn('Failed to save settings:', e);
      }
    }

    applyTheme() {
      const theme = this.state.theme;
      if (theme === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.classList.toggle('light', !prefersDark);
      } else {
        document.documentElement.classList.toggle('light', theme === 'light');
      }
    }

    // ==================== EVENT BINDING ====================
    bindEvents() {
      // Navigation
      document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          this.switchView(item.dataset.view);
        });
      });

      // Mobile sidebar toggle (if added later)
      // document.getElementById('sidebarToggle')?.addEventListener('click', () => this.toggleSidebar());

      // Server controls
      document.getElementById('btnStartServer')?.addEventListener('click', () => this.startServer());
      document.getElementById('btnStopServer')?.addEventListener('click', () => this.stopServer());
      document.getElementById('btnRestartServer')?.addEventListener('click', () => this.restartServer());
      document.getElementById('clearLogs')?.addEventListener('click', () => this.clearLogs());
      document.getElementById('autoScrollLogs')?.addEventListener('change', (e) => this.autoScrollLogs = e.target.checked);

      // Logs modal
      document.getElementById('openLogs')?.addEventListener('click', () => this.openLogsModal());
      document.getElementById('btnRefreshLogs')?.addEventListener('click', () => this.loadLogsModal());
      document.getElementById('logLevelFilter')?.addEventListener('change', () => this.filterLogsModal());

      // Theme settings
      document.getElementById('setTheme')?.addEventListener('change', (e) => {
        this.state.theme = e.target.value;
        this.applyTheme();
        this.saveSettings();
      });

      document.getElementById('setLanguage')?.addEventListener('change', (e) => {
        this.state.language = e.target.value;
        this.saveSettings();
        this.showToast('Idioma cambiado (recargar para aplicar)', 'info');
      });

      document.getElementById('setAnimations')?.addEventListener('change', (e) => {
        this.state.animations = e.target.checked;
        document.documentElement.style.setProperty('--sq-transition-normal', this.state.animations ? '0.2s ease' : '0.01ms');
        this.saveSettings();
      });

      document.getElementById('setCompactMode')?.addEventListener('change', (e) => {
        this.state.compactMode = e.target.checked;
        document.body.classList.toggle('compact-mode', this.state.compactMode);
        this.saveSettings();
      });

      // Server settings
      document.getElementById('setHttpPort')?.addEventListener('change', (e) => this.updateServerSetting('httpPort', e.target.value));
      document.getElementById('setWsPort')?.addEventListener('change', (e) => this.updateServerSetting('wsPort', e.target.value));
      document.getElementById('setDebugMode')?.addEventListener('change', (e) => this.updateServerSetting('debug', e.target.checked));
      document.getElementById('setWaitress')?.addEventListener('change', (e) => this.updateServerSetting('waitress', e.target.checked));

      // Security settings
      document.getElementById('setAuthEnabled')?.addEventListener('change', (e) => this.updateServerSetting('authEnabled', e.target.checked));
      document.getElementById('setCorsOrigins')?.addEventListener('change', (e) => this.updateServerSetting('corsOrigins', e.target.value));
      document.getElementById('setRateLimit')?.addEventListener('change', (e) => this.updateServerSetting('rateLimit', parseInt(e.target.value)));
      document.getElementById('btnRegeneratePin')?.addEventListener('click', () => this.regeneratePin());

      // Advanced settings
      document.getElementById('setJwtSecret')?.addEventListener('change', (e) => this.updateServerSetting('jwtSecret', e.target.value));
      document.getElementById('setTokenTtl')?.addEventListener('change', (e) => this.updateServerSetting('tokenTtl', parseInt(e.target.value)));
      document.getElementById('setHeartbeatInterval')?.addEventListener('change', (e) => this.updateServerSetting('heartbeatInterval', parseInt(e.target.value)));
      document.getElementById('btnCreateBackup')?.addEventListener('click', () => this.createBackup());

      // Theme creation modal
      document.getElementById('btnCreateTheme')?.addEventListener('click', () => this.openModal('modalCreateTheme'));
      document.getElementById('formCreateTheme')?.addEventListener('submit', (e) => this.createTheme(e));

      // Modal close buttons
      document.querySelectorAll('[data-dismiss], .modal-close, .modal-backdrop').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target === el || el.hasAttribute('data-dismiss') || el.classList.contains('modal-close') || el.classList === 'modal-backdrop') {
            this.closeAllModals();
          }
        });
      });

      // Keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          document.getElementById('themeSearch')?.focus();
        }
        if (e.key === 'Escape') {
          this.closeAllModals();
        }
      });

      // Theme search
      document.getElementById('themeSearch')?.addEventListener('input', (e) => this.filterThemes(e.target.value));
      document.getElementById('themeCategory')?.addEventListener('change', (e) => this.filterThemesByCategory(e.target.value));

      // Toast click to dismiss
      document.getElementById('toastContainer')?.addEventListener('click', (e) => {
        const toast = e.target.closest('.toast');
        if (toast) toast.remove();
      });
    }

    // ==================== VIEW MANAGEMENT ====================
    switchView(viewId) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      
      const view = document.getElementById('view-' + viewId);
      const nav = document.querySelector(`.nav-item[data-view="${viewId}"]`);
      
      if (view) view.classList.add('active');
      if (nav) nav.classList.add('active');

      // Load view-specific data
      switch (viewId) {
        case 'themes': this.loadThemes(); break;
        case 'templates': this.loadTemplates(); break;
        case 'monitor': this.fetchWsMetrics(); break;
        case 'settings': this.loadSettingsUI(); break;
      }
    }

    // ==================== DATA FETCHING ====================
    async fetchInitialData() {
      try {
        await Promise.all([
          this.fetchServerStatus(),
          this.fetchHealth(),
          this.fetchActivity(),
          this.fetchBuildInfo()
        ]);
      } catch (e) {
        console.error('Initial fetch failed:', e);
      }
    }

    async api(endpoint, options = {}) {
      const baseUrl = window.location.origin;
      const response = await fetch(baseUrl + endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers
        },
        credentials: 'include',
        ...options
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return response.json();
    }

    async fetchServerStatus() {
      try {
        const data = await this.api('/api/health');
        this.state.server.online = data.status === 'ok';
        this.state.stats.uptime = Math.floor(data.uptime || 0);
        this.updateServerStatusUI();
      } catch (e) {
        this.state.server.online = false;
        this.updateServerStatusUI();
      }
    }

    async fetchHealth() {
      try {
        const data = await this.api('/api/health/detailed');
        this.state.health = {
          flask: data.flask || 'unknown',
          ws: data.websocket || 'unknown',
          db: data.database || 'unknown',
          engine: data.engine || 'unknown'
        };
        this.updateHealthUI();
      } catch (e) {
        this.state.health = { flask: 'down', ws: 'down', db: 'down', engine: 'down' };
        this.updateHealthUI();
      }
    }

    async fetchActivity() {
      try {
        const data = await this.api('/api/activity?limit=20');
        this.state.activity = data.activity || [];
        this.updateActivityUI();
      } catch (e) {
        this.state.activity = [];
        this.updateActivityUI();
      }
    }

    async fetchBuildInfo() {
      try {
        const data = await this.api('/api/build-info');
        document.getElementById('buildInfo').textContent = data.version || 'v6.0';
      } catch (e) {
        document.getElementById('buildInfo').textContent = 'v6.0';
      }
    }

    async fetchWsMetrics() {
      try {
        const data = await this.api('/api/ws/stats');
        this.state.wsMetrics = data;
        this.updateWsMetricsUI();
      } catch (e) {
        console.warn('WS metrics fetch failed:', e);
      }
    }

    async fetchEngineMetrics() {
      try {
        const data = await this.api('/api/engine/stats');
        this.state.engineMetrics = data;
        this.updateEngineMetricsUI();
      } catch (e) {
        console.warn('Engine metrics fetch failed:', e);
      }
    }

    async fetchConnections() {
      try {
        const data = await this.api('/api/connections');
        this.state.connections = data.connections || [];
        this.updateConnectionsUI();
      } catch (e) {
        console.warn('Connections fetch failed:', e);
      }
    }

    async loadLogs() {
      try {
        const data = await this.api('/api/logs?lines=100');
        this.renderLogs(data.logs || []);
      } catch (e) {
        console.warn('Logs fetch failed:', e);
      }
    }

    // ==================== SERVER CONTROL ====================
    async startServer() {
      if (this.state.server.online || this.state.server.starting) return;
      
      this.state.server.starting = true;
      this.updateServerStatusUI();
      this.showToast('Iniciando servidor...', 'info');

      try {
        await this.api('/api/server/start', { method: 'POST' });
        this.showToast('Servidor iniciado correctamente', 'success');
      } catch (e) {
        this.showToast('Error iniciando servidor: ' + e.message, 'error');
      } finally {
        this.state.server.starting = false;
        await this.fetchServerStatus();
      }
    }

    async stopServer() {
      if (!this.state.server.online) return;

      this.showToast('Deteniendo servidor...', 'info');

      try {
        await this.api('/api/server/stop', { method: 'POST' });
        this.showToast('Servidor detenido', 'success');
      } catch (e) {
        this.showToast('Error deteniendo servidor: ' + e.message, 'error');
      } finally {
        await this.fetchServerStatus();
      }
    }

    async restartServer() {
      this.showToast('Reiniciando servidor...', 'info');
      try {
        await this.api('/api/server/restart', { method: 'POST' });
        this.showToast('Servidor reiniciado', 'success');
      } catch (e) {
        this.showToast('Error reiniciando: ' + e.message, 'error');
      } finally {
        setTimeout(() => this.fetchServerStatus(), 3000);
      }
    }

    // ==================== WEBSOCKET ====================
    connectWebSocket() {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:8081/dashboard`;

      try {
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
          this.state.ws.connected = true;
          this.reconnectAttempts = 0;
          this.updateWsStatusUI();
          this.ws.send(JSON.stringify({ type: 'subscribe', channels: ['stats', 'logs', 'connections'] }));
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.handleWsMessage(msg);
          } catch (e) {
            console.warn('WS message parse error:', e);
          }
        };

        this.ws.onclose = () => {
          this.state.ws.connected = false;
          this.updateWsStatusUI();
          this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
          console.error('WS error:', err);
        };
      } catch (e) {
        console.error('WS connection failed:', e);
        this.scheduleReconnect();
      }
    }

    scheduleReconnect() {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.showToast('No se pudo reconectar WebSocket', 'error');
        return;
      }

      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
      setTimeout(() => this.connectWebSocket(), delay);
    }

    handleWsMessage(msg) {
      switch (msg.type) {
        case 'stats':
          this.updateStatsFromWs(msg.data);
          break;
        case 'log':
          this.appendLog(msg.data);
          break;
        case 'connection':
          this.handleConnectionEvent(msg.data);
          break;
        case 'activity':
          this.addActivity(msg.data);
          break;
        case 'health':
          this.state.health = msg.data;
          this.updateHealthUI();
          break;
      }
    }

    updateStatsFromWs(data) {
      if (data.uptime !== undefined) this.state.stats.uptime = data.uptime;
      if (data.connections !== undefined) this.state.stats.connections = data.connections;
      if (data.sessions !== undefined) this.state.stats.sessions = data.sessions;
      if (data.memory !== undefined) this.state.stats.memory = data.memory;
      this.updateStatsUI();
    }

    appendLog(logEntry) {
      const container = document.getElementById('logsContainer');
      if (!container) return;

      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = `
        <span class="log-time">${this.formatTime(logEntry.timestamp)}</span>
        <span class="log-level ${logEntry.level}">${logEntry.level.toUpperCase()}</span>
        <span class="log-message">${this.escapeHtml(logEntry.message)}</span>
      `;
      container.appendChild(entry);

      // Auto-scroll
      if (this.autoScrollLogs !== false) {
        container.scrollTop = container.scrollHeight;
      }

      // Limit entries
      while (container.children.length > 500) {
        container.removeChild(container.firstChild);
      }
    }

    handleConnectionEvent(data) {
      const idx = this.state.connections.findIndex(c => c.id === data.id);
      if (data.event === 'connected') {
        if (idx === -1) this.state.connections.push(data.connection);
      } else if (data.event === 'disconnected') {
        if (idx !== -1) this.state.connections.splice(idx, 1);
      } else if (data.event === 'updated' && idx !== -1) {
        this.state.connections[idx] = { ...this.state.connections[idx], ...data.connection };
      }
      this.updateConnectionsUI();
    }

    addActivity(activity) {
      this.state.activity.unshift(activity);
      if (this.state.activity.length > 50) this.state.activity.pop();
      this.updateActivityUI();
    }

    // ==================== POLLING ====================
    startPolling() {
      this.pollInterval = setInterval(async () => {
        if (this.state.server.online) {
          await Promise.all([
            this.fetchServerStatus(),
            this.fetchHealth(),
            this.fetchActivity(),
            this.fetchConnections(),
            this.fetchWsMetrics(),
            this.fetchEngineMetrics()
          ]);
        } else {
          await this.fetchServerStatus();
        }
        this.updateStatsUI();
      }, 5000);
    }

    stopPolling() {
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
    }

    // ==================== UI UPDATES ====================
    updateServerStatusUI() {
      const indicator = document.getElementById('serverStatusIndicator');
      const text = document.getElementById('serverStatusText');
      const btnStart = document.getElementById('btnStartServer');
      const btnStop = document.getElementById('btnStopServer');
      const btnRestart = document.getElementById('btnRestartServer');
      const navStatus = document.getElementById('serverStatus');

      if (this.state.server.starting) {
        indicator.querySelector('.status-dot').className = 'status-dot starting';
        text.textContent = 'Iniciando...';
        btnStart.disabled = true;
        btnStop.disabled = true;
        btnRestart.disabled = true;
        if (navStatus) {
          navStatus.className = 'nav-status';
          navStatus.textContent = 'Iniciando';
        }
      } else if (this.state.server.online) {
        indicator.querySelector('.status-dot').className = 'status-dot online';
        text.textContent = 'En Línea';
        btnStart.disabled = true;
        btnStop.disabled = false;
        btnRestart.disabled = false;
        if (navStatus) {
          navStatus.className = 'nav-status online';
          navStatus.textContent = '●';
        }
      } else {
        indicator.querySelector('.status-dot').className = 'status-dot';
        text.textContent = 'Detenido';
        btnStart.disabled = false;
        btnStop.disabled = true;
        btnRestart.disabled = true;
        if (navStatus) {
          navStatus.className = 'nav-status offline';
          navStatus.textContent = '○';
        }
      }
    }

    updateWsStatusUI() {
      // Could add WS status indicator in nav
    }

    updateStatsUI() {
      document.getElementById('statUptime').textContent = this.formatUptime(this.state.stats.uptime);
      document.getElementById('statConnections').textContent = this.state.stats.connections;
      document.getElementById('statSessions').textContent = this.state.stats.sessions;
      document.getElementById('statMemory').textContent = this.formatBytes(this.state.stats.memory);
    }

    updateHealthUI() {
      const healthMap = {
        flask: 'healthFlask',
        ws: 'healthWS',
        db: 'healthDB',
        engine: 'healthEngine'
      };

      Object.entries(this.state.health).forEach(([key, value]) => {
        const el = document.getElementById(healthMap[key]);
        if (el) {
          el.className = 'health-status ' + (value === 'ok' || value === 'healthy' ? 'healthy' : 
                                              value === 'degraded' ? 'degraded' :
                                              value === 'down' ? 'down' : 'unknown');
          el.textContent = value === 'ok' ? 'OK' : value === 'healthy' ? 'Saludable' :
                           value === 'degraded' ? 'Degradado' : value === 'down' ? 'Caído' : 'Desconocido';
        }
      });
    }

    updateActivityUI() {
      const container = document.getElementById('activityList');
      if (!container) return;

      if (this.state.activity.length === 0) {
        container.innerHTML = '<div class="activity-item"><div class="activity-content"><div class="activity-title">Sin actividad reciente</div><div class="activity-meta">El servidor está tranquilo</div></div></div>';
        return;
      }

      container.innerHTML = this.state.activity.map(a => `
        <div class="activity-item">
          <div class="activity-icon ${a.type || 'info'}">${this.getActivityIcon(a.type)}</div>
          <div class="activity-content">
            <div class="activity-title">${this.escapeHtml(a.message)}</div>
            <div class="activity-meta">${this.formatTime(a.timestamp)} · ${a.source || 'sistema'}</div>
          </div>
        </div>
      `).join('');
    }

    getActivityIcon(type) {
      const icons = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌',
        server: '🖥️',
        ws: '🔗',
        game: '🎮',
        user: '👤'
      };
      return icons[type] || '📋';
    }

    updateWsMetricsUI() {
      const m = this.state.wsMetrics;
      document.getElementById('wsDisplays').textContent = m.displays || 0;
      document.getElementById('wsSessions').textContent = m.sessions || 0;
      document.getElementById('wsMobiles').textContent = m.mobiles || 0;
      document.getElementById('wsFifoRate').textContent = m.fifoRate || 0;
      document.getElementById('wsLatency').textContent = (m.latency || 0) + ' ms';
    }

    updateEngineMetricsUI() {
      const m = this.state.engineMetrics;
      document.getElementById('engineGames').textContent = m.games || 0;
      document.getElementById('enginePlayers').textContent = m.players || 0;
      document.getElementById('engineLeaderboards').textContent = m.leaderboards || 0;
      document.getElementById('engineTokens').textContent = m.tokens || 0;
    }

    updateConnectionsUI() {
      const tbody = document.getElementById('connectionsBody');
      if (!tbody) return;

      if (this.state.connections.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay conexiones activas</td></tr>';
        return;
      }

      tbody.innerHTML = this.state.connections.map(c => `
        <tr>
          <td><code>${this.escapeHtml(c.id?.slice(0, 12) || '?')}</code></td>
          <td><span class="connection-type">${this.escapeHtml(c.type || 'unknown')}</span></td>
          <td><span class="connection-status ${c.connected ? 'connected' : 'disconnected'}">${c.connected ? 'Conectado' : 'Desconectado'}</span></td>
          <td>${c.lastActivity ? this.formatTime(c.lastActivity) : '—'}</td>
          <td><code>${this.escapeHtml(c.ip || '?')}</code></td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="dashboard.disconnectClient('${c.id}')" ${!c.connected ? 'disabled' : ''}>Desconectar</button>
          </td>
        </tr>
      `).join('');
    }

    renderLogs(logs) {
      const container = document.getElementById('logsContainer');
      if (!container) return;

      container.innerHTML = (logs || []).map(l => `
        <div class="log-entry">
          <span class="log-time">${this.formatTime(l.timestamp)}</span>
          <span class="log-level ${l.level}">${l.level.toUpperCase()}</span>
          <span class="log-message">${this.escapeHtml(l.message)}</span>
        </div>
      `).join('');

      if (this.autoScrollLogs !== false) {
        container.scrollTop = container.scrollHeight;
      }
    }

    clearLogs() {
      document.getElementById('logsContainer').innerHTML = '';
    }

    // ==================== MODALS ====================
    openModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.hidden = false;
        modal.querySelector('input, select, textarea')?.focus();
        document.body.style.overflow = 'hidden';
      }
    }

    closeAllModals() {
      document.querySelectorAll('.modal').forEach(m => m.hidden = true);
      document.body.style.overflow = '';
    }

    async loadThemes() {
      const grid = document.getElementById('themesGrid');
      if (!grid) return;

      grid.innerHTML = '<div class="loading">Cargando temas...</div>';

      try {
        const data = await this.api('/api/themes');
        this.renderThemes(data.themes || []);
      } catch (e) {
        grid.innerHTML = '<div class="error">Error cargando temas</div>';
      }
    }

    renderThemes(themes) {
      const grid = document.getElementById('themesGrid');
      if (!grid) return;

      if (themes.length === 0) {
        grid.innerHTML = '<div class="empty-state">No hay temas disponibles</div>';
        return;
      }

      grid.innerHTML = themes.map(t => `
        <article class="theme-card" data-theme="${t.id}" data-category="${t.category}">
          <div class="theme-preview">
            <div class="theme-colors">
              <div class="theme-color" style="background: ${t.colors.primary}"></div>
              <div class="theme-color" style="background: ${t.colors.secondary}"></div>
              <div class="theme-color" style="background: ${t.colors.accent}"></div>
              <div class="theme-color" style="background: ${t.colors.background}"></div>
              <div class="theme-color" style="background: ${t.colors.surface}"></div>
            </div>
          </div>
          <div class="theme-info">
            <div class="theme-name">${this.escapeHtml(t.name)}</div>
            <div class="theme-category">${t.category}</div>
          </div>
        </article>
      `).join('');

      // Add click handlers
      grid.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => this.applyTheme(card.dataset.theme));
      });
    }

    filterThemes(query) {
      const cards = document.querySelectorAll('.theme-card');
      const q = query.toLowerCase();
      cards.forEach(card => {
        const name = card.querySelector('.theme-name').textContent.toLowerCase();
        const cat = card.querySelector('.theme-category').textContent.toLowerCase();
        card.style.display = name.includes(q) || cat.includes(q) ? '' : 'none';
      });
    }

    filterThemesByCategory(category) {
      const cards = document.querySelectorAll('.theme-card');
      cards.forEach(card => {
        card.style.display = !category || card.dataset.category === category ? '' : 'none';
      });
    }

    async applyTheme(themeId) {
      try {
        await this.api('/api/themes/apply', {
          method: 'POST',
          body: JSON.stringify({ themeId })
        });
        this.showToast('Tema aplicado: ' + themeId, 'success');
      } catch (e) {
        this.showToast('Error aplicando tema: ' + e.message, 'error');
      }
    }

    async createTheme(e) {
      e.preventDefault();
      const form = e.target;
      const data = {
        name: form.themeName.value,
        category: form.themeCategory.value,
        colors: {
          primary: form.themePrimary.value,
          secondary: form.themeSecondary.value,
          accent: form.themeAccent.value,
          background: form.themeBg.value,
          surface: form.themeSurface.value,
          text: form.themeText.value
        },
        font: form.themeFont.value
      };

      try {
        await this.api('/api/themes', {
          method: 'POST',
          body: JSON.stringify(data)
        });
        this.showToast('Tema creado: ' + data.name, 'success');
        this.closeAllModals();
        this.loadThemes();
        form.reset();
      } catch (e) {
        this.showToast('Error creando tema: ' + e.message, 'error');
      }
    }

    async loadTemplates() {
      const grid = document.getElementById('templatesGrid');
      if (!grid) return;

      grid.innerHTML = '<div class="loading">Cargando plantillas...</div>';

      try {
        const data = await this.api('/api/templates');
        this.renderTemplates(data.templates || []);
      } catch (e) {
        grid.innerHTML = '<div class="error">Error cargando plantillas</div>';
      }
    }

    renderTemplates(templates) {
      const grid = document.getElementById('templatesGrid');
      if (!grid) return;

      if (templates.length === 0) {
        grid.innerHTML = '<div class="empty-state">No hay plantillas disponibles</div>';
        return;
      }

      grid.innerHTML = templates.map(t => `
        <article class="template-card">
          <div class="template-header">
            <span class="template-icon">${t.icon || '📋'}</span>
            <div class="template-meta">
              <h3>${this.escapeHtml(t.title)}</h3>
              <div class="template-tags">
                ${(t.tags || []).map(tag => `<span class="template-tag">${this.escapeHtml(tag)}</span>`).join('')}
              </div>
            </div>
          </div>
          <p class="template-description">${this.escapeHtml(t.description)}</p>
          <div class="template-actions">
            <button class="btn btn-primary" onclick="dashboard.loadTemplate('${t.id}')">Cargar</button>
            <button class="btn btn-secondary" onclick="dashboard.previewTemplate('${t.id}')">Previsualizar</button>
          </div>
        </article>
      `).join('');
    }

    async loadTemplate(id) {
      try {
        await this.api('/api/templates/load', {
          method: 'POST',
          body: JSON.stringify({ templateId: id })
        });
        this.showToast('Plantilla cargada: ' + id, 'success');
        window.open('/html/SillyBuild.html', '_blank');
      } catch (e) {
        this.showToast('Error cargando plantilla: ' + e.message, 'error');
      }
    }

    previewTemplate(id) {
      window.open(`/api/templates/${id}/preview`, '_blank');
    }

    async loadSettingsUI() {
      try {
        const data = await this.api('/api/settings');
        document.getElementById('setHttpPort').value = data.httpPort || 8080;
        document.getElementById('setWsPort').value = data.wsPort || 8081;
        document.getElementById('setDebugMode').checked = data.debug || false;
        document.getElementById('setWaitress').checked = data.waitress !== false;
        document.getElementById('setAuthEnabled').checked = data.authEnabled !== false;
        document.getElementById('setCorsOrigins').value = (data.corsOrigins || []).join(', ');
        document.getElementById('setRateLimit').value = data.rateLimit || 300;
        document.getElementById('setJwtSecret').value = data.jwtSecret || '';
        document.getElementById('setTokenTtl').value = data.tokenTtl || 8;
        document.getElementById('setHeartbeatInterval').value = data.heartbeatInterval || 30;
      } catch (e) {
        console.warn('Failed to load settings UI:', e);
      }
    }

    async updateServerSetting(key, value) {
      try {
        await this.api('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ [key]: value })
        });
        this.showToast('Configuración guardada', 'success');
      } catch (e) {
        this.showToast('Error guardando: ' + e.message, 'error');
        this.loadSettingsUI(); // Reset UI
      }
    }

    async regeneratePin() {
      if (!confirm('¿Generar nuevo PIN de acceso? El actual dejará de funcionar.')) return;
      try {
        const data = await this.api('/api/auth/regenerate-pin', { method: 'POST' });
        this.showToast('Nuevo PIN: ' + data.pin, 'success', 10000);
      } catch (e) {
        this.showToast('Error generando PIN: ' + e.message, 'error');
      }
    }

    async createBackup() {
      this.showToast('Creando backup...', 'info');
      try {
        await this.api('/api/backup', { method: 'POST' });
        this.showToast('Backup creado correctamente', 'success');
      } catch (e) {
        this.showToast('Error creando backup: ' + e.message, 'error');
      }
    }

    async disconnectClient(id) {
      if (!confirm('¿Desconectar este cliente?')) return;
      try {
        await this.api('/api/connections/' + encodeURIComponent(id), { method: 'DELETE' });
        this.showToast('Cliente desconectado', 'success');
      } catch (e) {
        this.showToast('Error: ' + e.message, 'error');
      }
    }

    // ==================== LOGS MODAL ====================
    async openLogsModal() {
      this.openModal('modalLogs');
      await this.loadLogsModal();
    }

    async loadLogsModal() {
      const level = document.getElementById('logLevelFilter').value;
      try {
        const data = await this.api('/api/logs?lines=500' + (level ? '&level=' + level : ''));
        const container = document.getElementById('modalLogsContainer');
        if (container) {
          container.innerHTML = (data.logs || []).map(l => `
            <div class="log-entry">
              <span class="log-time">${this.formatTime(l.timestamp)}</span>
              <span class="log-level ${l.level}">${l.level.toUpperCase()}</span>
              <span class="log-message">${this.escapeHtml(l.message)}</span>
            </div>
          `).join('');
        }
      } catch (e) {
        console.warn('Modal logs load failed:', e);
      }
    }

    filterLogsModal() {
      this.loadLogsModal();
    }

    // ==================== UTILITIES ====================
    showToast(message, type = 'info', duration = 4000) {
      const container = document.getElementById('toastContainer');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.innerHTML = `
        <span class="toast-icon">${this.getToastIcon(type)}</span>
        <span class="toast-message">${this.escapeHtml(message)}</span>
        <button class="toast-close" aria-label="Cerrar">✕</button>
      `;

      toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.animation = 'toastSlideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    getToastIcon(type) {
      return { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }[type] || 'ℹ️';
    }

    formatUptime(seconds) {
      if (!seconds) return '0:00:00';
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    formatBytes(bytes) {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    formatTime(timestamp) {
      if (!timestamp) return '—';
      const date = new Date(timestamp);
      return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // Initialize when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      global.dashboard = new LauncherDashboard();
    });
  } else {
    global.dashboard = new LauncherDashboard();
  }

})(window);