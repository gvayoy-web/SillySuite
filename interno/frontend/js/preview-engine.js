/**
 * PREVIEW ENGINE - Motor de vista previa en Canvas 2D
 * Ligero, sin WebGL, compatible con ThemeEngine
 */

class PreviewEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.config = null;
        this.animationId = null;
        this.time = 0;
        this.particles = [];
        this.themeColors = this.getThemeColors();
        this._resizeHandler = () => this.resize();
        
        this.resize();
        window.addEventListener('resize', this._resizeHandler);
    }
    
    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
    }
    
    getThemeColors() {
        const styles = getComputedStyle(document.documentElement);
        const v = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
        return {
            primary: v('--sq-primary', '#0038ff'),
            secondary: v('--sq-secondary', '#ffffff'),
            accent: v('--sq-accent', '#7c3aed'),
            background: v('--sq-bg-primary', '#07070e'),
            surface: v('--sq-bg-secondary', '#0e0e1a'),
            border: v('--sq-border', '#1e1e3a'),
            text: v('--sq-text-primary', '#ffffff'),
            muted: v('--sq-text-muted', '#888'),
            green: v('--sq-success', '#4ade80'),
            red: v('--sq-danger', '#f87171'),
            yellow: v('--sq-warning', '#fbbf24')
        };
    }
    
    render(config) {
        this.config = config;
        this.time = 0;
        this.particles = [];
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        this.animate();
    }
    
    animate() {
        this.time += 1/60;
        this.draw();
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    draw() {
        const { ctx, width, height, themeColors } = this;
        
        // Limpiar
        ctx.fillStyle = themeColors.background;
        ctx.fillRect(0, 0, width, height);
        
        // Fondo con gradiente sutil
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, themeColors.background);
        grad.addColorStop(1, themeColors.surface);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
        
        // Partículas de fondo (si habilitado)
        if (this.config?.visual?.animaciones?.includes('particles')) {
            this.drawParticles();
        }
        
        // Dibujar componentes en orden
        this.drawScoreboard();
        this.drawTimer();
        this.drawQuestionArea();
        this.drawChat();
        
        // Efectos visuales activos
        this.drawEffects();
    }
    
    drawScoreboard() {
        const { ctx, width, themeColors } = this;
        const config = this.config?.scoring || {};
        
        const scores = this.config?.puntuaciones || { 'Equipo A': 0, 'Equipo B': 150 };
        const teams = Object.entries(scores);
        
        if (teams.length === 0) return;
        
        const barHeight = 80;
        const padding = 20;
        const barWidth = (width - padding * (teams.length + 1)) / teams.length;
        
        teams.forEach(([name, score], i) => {
            const x = padding + i * (barWidth + padding);
            const y = 20;
            
            // Fondo tarjeta
            ctx.fillStyle = themeColors.surface;
            ctx.fillRect(x, y, barWidth, barHeight);
            
            // Borde con color de equipo
            const teamColor = i === 0 ? themeColors.primary : themeColors.accent;
            ctx.strokeStyle = teamColor;
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, barWidth, barHeight);
            
            // Nombre equipo
            ctx.fillStyle = themeColors.text;
            ctx.font = 'bold 14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(name, x + barWidth/2, y + 25);
            
            // Puntuación
            ctx.fillStyle = teamColor;
            ctx.font = 'bold 32px Inter, sans-serif';
            ctx.fillText(score.toString(), x + barWidth/2, y + 60);
        });
    }
    
    drawTimer() {
        const { ctx, width, height, themeColors } = this;
        const timerConfig = this.config?.timer || {};
        
        if (!timerConfig) return;
        
        const remaining = timerConfig.valorInicial || 60;
        const total = timerConfig.valorInicial || 60;
        const progress = remaining / total;
        
        const centerX = width / 2;
        const centerY = 80;
        const radius = 45;
        
        // Círculo fondo
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = themeColors.surface;
        ctx.fill();
        
        // Progreso
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, -Math.PI/2, -Math.PI/2 + Math.PI * 2 * progress);
        ctx.lineWidth = 8;
        ctx.strokeStyle = progress < 0.2 ? themeColors.red : 
                          progress < 0.4 ? themeColors.yellow : themeColors.green;
        ctx.stroke();
        
        // Texto tiempo
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const timeStr = `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
        
        ctx.fillStyle = themeColors.text;
        ctx.font = 'bold 24px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(timeStr, centerX, centerY);
        
        // Alerta visual
        if (remaining <= 10 && Math.floor(this.time * 2) % 2 === 0) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius + 5, 0, Math.PI * 2);
            ctx.strokeStyle = themeColors.red;
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }
    
    drawQuestionArea() {
        const { ctx, width, height, themeColors } = this;
        
        const preguntas = this.config?.preguntas || [];
        const current = this.config?.pregunta_actual || 0;
        
        if (!preguntas.length) return;
        
        const q = preguntas[current];
        if (!q) return;
        
        const areaY = height - 280;
        const areaHeight = 260;
        const padding = 30;
        
        // Fondo
        ctx.fillStyle = themeColors.surface;
        ctx.fillRect(padding, areaY, width - padding * 2, areaHeight);
        
        // Borde
        ctx.strokeStyle = themeColors.border;
        ctx.lineWidth = 2;
        ctx.strokeRect(padding, areaY, width - padding * 2, areaHeight);
        
        // Número pregunta
        ctx.fillStyle = themeColors.accent;
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`PREGUNTA ${current + 1} / ${preguntas.length}`, padding + 20, areaY + 35);
        
        // Texto pregunta
        ctx.fillStyle = themeColors.text;
        ctx.font = '20px Inter, sans-serif';
        this.wrapText(ctx, q.texto || '¿Pregunta de ejemplo?', padding + 20, areaY + 70, width - padding * 2 - 40, 28);
        
        // Opciones
        const opciones = q.opciones || ['A', 'B', 'C', 'D'];
        const startY = areaY + 160;
        const optHeight = 45;
        const optGap = 10;
        
        opciones.forEach((opt, i) => {
            const x = padding + 20;
            const y = startY + i * (optHeight + optGap);
            const w = width - padding * 2 - 40;
            
            // Fondo opción
            ctx.fillStyle = themeColors.surface;
            ctx.fillRect(x, y, w, optHeight);
            
            // Borde
            ctx.strokeStyle = themeColors.border;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, optHeight);
            
            // Letra
            ctx.fillStyle = themeColors.accent;
            ctx.font = 'bold 18px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String.fromCharCode(65 + i), x + 30, y + optHeight/2);
            
            // Texto
            ctx.fillStyle = themeColors.text;
            ctx.font = '16px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(opt, x + 70, y + optHeight/2);
        });
    }
    
    drawChat() {
        // Chat lateral simple
        const { ctx, width, themeColors } = this;
        const chatX = width - 220;
        const chatY = 120;
        const chatW = 200;
        
        // Fondo
        ctx.fillStyle = themeColors.surface;
        ctx.fillRect(chatX, chatY, chatW, 200);
        ctx.strokeStyle = themeColors.border;
        ctx.strokeRect(chatX, chatY, chatW, 200);
        
        // Header
        ctx.fillStyle = themeColors.text;
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('💬 CHAT', chatX + 10, chatY + 20);
        
        // Mensajes mock
        const mensajes = [
            { user: 'Jugador1', text: '¡Vamos equipo!' },
            { user: 'Jugador2', text: 'Esta es fácil' }
        ];
        
        mensajes.forEach((msg, i) => {
            ctx.fillStyle = themeColors.muted;
            ctx.font = '10px Inter, sans-serif';
            ctx.fillText(msg.user, chatX + 10, chatY + 45 + i * 30);
            ctx.fillStyle = themeColors.text;
            ctx.font = '11px Inter, sans-serif';
            ctx.fillText(msg.text, chatX + 10, chatY + 60 + i * 30);
        });
    }
    
    drawParticles() {
        // Partículas sutiles de fondo
        const { ctx, width, height, themeColors, time } = this;
        
        if (this.particles.length < 30) {
            for (let i = this.particles.length; i < 30; i++) {
                this.particles.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    vx: (Math.random() - 0.5) * 0.5,
                    vy: (Math.random() - 0.5) * 0.5,
                    size: Math.random() * 2 + 1,
                    alpha: Math.random() * 0.3 + 0.1,
                    color: [themeColors.primary, themeColors.accent, themeColors.green][Math.floor(Math.random() * 3)]
                });
            }
        }
        
        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            
            if (p.x < 0) p.x = width;
            if (p.x > width) p.x = 0;
            if (p.y < 0) p.y = height;
            if (p.y > height) p.y = 0;
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.alpha;
            ctx.fill();
        });
        
        ctx.globalAlpha = 1;
    }
    
    drawEffects() {
        // Efectos visuales temporales (flash, shake, etc.)
        // Se activan via events del PreviewEngine
    }
    
    wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        let testLine = '';
        let lines = [];
        
        for (let n = 0; n < words.length; n++) {
            testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                lines.push(line);
                line = words[n] + ' ';
            } else {
                line = testLine;
            }
        }
        lines.push(line);
        
        lines.forEach((l, i) => {
            ctx.fillText(l, x, y + i * lineHeight);
        });
    }
    
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
    }
    
    // Métodos para activar efectos desde eventos
    triggerFlash(color = '#ffffff') {
        // Implementar flash
    }
    
    triggerShake(intensity = 10) {
        // Implementar shake
    }
    
    triggerConfetti() {
        // Implementar confetti
    }
}