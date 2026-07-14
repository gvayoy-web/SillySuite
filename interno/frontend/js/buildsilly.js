/*
 * Modo Builder UI Enhancement
 *
 * Mejoras avanzadas del diseño y funcionalidad del constructor de modos:
 * 1. Estilos CSS mejorados para mejor estética y cohesión visual
 * 2. Nueva paleta de colores y tipografía moderna
 * 3. Componentes de UI mejorados (botones, tarjetas, paneles)
 * 4. Sistema de animaciones y transiciones suaves
 * 5. Soporte para más tipos de bloques y componentes
 * 6. Sistema de diseño responsivo mejorado
 * 7. Elementos de accesibilidad (focus states, ARIA)
 */

/**
 * Mejoras del diseño del constructor de Modos
 * Mejora la interfaz de usuario con estilos modernos y mejorados
 */
// El builder real de la app es ScratchUI (modo-builder-v2.js). Este archivo solo
// aporta mejoras de UI (CSS moderno, accesibilidad). Como no existe una clase
// global ModoBuilder, creamos un stub para que las asignaciones de prototipo no
// lancen ReferenceError al cargarse como módulo.
if (typeof ModoBuilder === 'undefined') {
    var ModoBuilder = function () {
        this.panels = {};
        this.container = null;
        this.selectedComponent = null;
        this.components = [];
        this.previewEngine = null;
    };
}
ModoBuilder.prototype.enhanceUIDesign = function(root) {
    this.addModernCSS();
    // Resuelve el root real del builder (ScratchUI usa .scratch-app; el builder
    // legacy usa .modo-builder-app). Si no hay root concreto, las mejoras de DOM
    // se convierten en no-ops seguros.
    const target = root || this.container ||
        document.querySelector('.scratch-app') ||
        document.querySelector('.modo-builder-app');
    this.upgradeComponentStyles(target);
    this.setupResponsiveLayout(target);
    this.addInteractivityEnhancements(target);
    this.setupAccessibilityFeatures(target);
};

/**
 * Agregar estilos CSS modernos con variables CSS
 */
ModoBuilder.prototype.addModernCSS = function() {
    const styleId = 'modob-builder-modern-styles';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        :root {
            /* Paleta de colores moderna */
            --primary-color: #3b82f6;
            --primary-hover: #2563eb;
            --secondary-color: #64748b;
            --success-color: #10b981;
            --warning-color: #f59e0b;
            --danger-color: #ef4444;
            --info-color: #0ea5e9;
            
            /* Colores para tema oscuro (predominante) */
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-tertiary: #334155;
            --bg-hover: #1e293b;
            
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --text-inverse: #0f172a;
            
            --border-color: #334155;
            --border-light: #475569;
            
            /* Espaciado y tamaños */
            --spacing-xs: 4px;
            --spacing-sm: 8px;
            --spacing-md: 16px;
            --spacing-lg: 24px;
            --spacing-xl: 32px;
            --spacing-xxl: 48px;
            
            --radius-sm: 6px;
            --radius-md: 8px;
            --radius-lg: 12px;
            --radius-xl: 16px;
            
            /* Tipografía */
            --font-family-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            --font-size-xs: 12px;
            --font-size-sm: 14px;
            --font-size-base: 16px;
            --font-size-lg: 18px;
            --font-size-xl: 20px;
            --font-size-2xl: 24px;
            --font-size-3xl: 30px;
            
            /* Sombras y efectos */
            --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
            --shadow-md: 0 4px 6px rgba(0,0,0,0.1);
            --shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
            --shadow-xl: 0 20px 25px rgba(0,0,0,0.15);
            --shadow-2xl: 0 25px 50px rgba(0,0,0,0.25);
            
            /* Transiciones */
            --transition-fast: 0.15s ease;
            --transition-normal: 0.3s ease;
            --transition-slow: 0.5s ease;
        }
        
        /* Estilos base del constructor */
        .modo-builder-app {
            font-family: var(--font-family-sans);
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.5;
        }
        
        /* Step indicator mejorado */
        .step-indicator {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            padding: var(--spacing-md);
            margin-bottom: var(--spacing-lg);
        }
        
        .step-item {
            background: var(--bg-tertiary);
            border-radius: var(--radius-md);
            padding: var(--spacing-md);
            transition: all var(--transition-fast);
            cursor: pointer;
            position: relative;
            overflow: hidden;
        }
        
        .step-item:hover {
            background: var(--bg-hover);
            transform: translateY(-2px);
            box-shadow: var(--shadow-md);
        }
        
        .step-item.active {
            background: linear-gradient(135deg, var(--primary-color), var(--info-color));
            color: white;
        }
        
        .step-item.active::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--warning-color), var(--success-color));
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
        }
        
        /* Tarjetas de plantillas mejoradas */
        .template-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            overflow: hidden;
            transition: all var(--transition-normal);
            position: relative;
        }
        
        .template-card:hover {
            transform: translateY(-4px) scale(1.02);
            box-shadow: var(--shadow-xl);
            border-color: var(--primary-color);
        }
        
        .template-card.selected {
            border-color: var(--primary-color);
            background: rgba(59, 130, 246, 0.05);
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
        }
        
        .template-card::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--primary-color), var(--success-color));
            transform: scaleX(0);
            transition: transform var(--transition-normal);
        }
        
        .template-card:hover::after {
            transform: scaleX(1);
        }
        
        /* Sección de documentación mejorada */
        .documentation-section {
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(14, 165, 233, 0.1));
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xl);
            padding: var(--spacing-xl);
            margin: var(--spacing-lg) 0;
            backdrop-filter: blur(10px);
        }
        
        .docs-header {
            text-align: center;
            margin-bottom: var(--spacing-lg);
        }
        
        .docs-header h4 {
            color: var(--primary-color);
            font-size: var(--font-size-2xl);
            margin-bottom: var(--spacing-sm);
        }
        
        .docs-header p {
            color: var(--text-secondary);
            font-size: var(--font-size-lg);
        }
        
        /* Quick access buttons mejorados */
        .docs-quick-access {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: var(--spacing-md);
            margin-bottom: var(--spacing-xl);
        }
        
        .docs-btn {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            padding: var(--spacing-md);
            border: none;
            border-radius: var(--radius-md);
            background: var(--bg-tertiary);
            color: var(--text-primary);
            font-size: var(--font-size-base);
            cursor: pointer;
            transition: all var(--transition-fast);
            position: relative;
            overflow: hidden;
        }
        
        .docs-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left var(--transition-slow);
        }
        
        .docs-btn:hover::before {
            left: 100%;
        }
        
        .docs-btn:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
            background: var(--primary-color);
            color: white;
        }
        
        .docs-btn.primary {
            background: linear-gradient(135deg, var(--primary-color), var(--info-color));
            color: white;
        }
        
        .docs-btn.secondary {
            background: linear-gradient(135deg, var(--secondary-color), var(--success-color));
            color: white;
        }
        
        .docs-btn.tertiary {
            background: linear-gradient(135deg, var(--warning-color), var(--danger-color));
            color: white;
        }
        
        .btn-icon {
            font-size: var(--font-size-lg);
        }
        
        /* Estadísticas mejoradas */
        .docs-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: var(--spacing-md);
            margin-top: var(--spacing-lg);
        }
        
        .stat-item {
            background: var(--bg-tertiary);
            border-radius: var(--radius-lg);
            padding: var(--spacing-md);
            text-align: center;
            transition: transform var(--transition-fast);
        }
        
        .stat-item:hover {
            transform: scale(1.05);
            background: var(--primary-color);
            color: white;
        }
        
        .stat-number {
            display: block;
            font-size: var(--font-size-2xl);
            font-weight: bold;
            color: var(--primary-color);
            margin-bottom: var(--spacing-xs);
        }
        
        .stat-item:hover .stat-number {
            color: white;
        }
        
        .stat-label {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
        }
        
        .stat-item:hover .stat-label {
            color: rgba(255,255,255,0.8);
        }
        
        /* Mejoras del palette de componentes */
        .component-palette {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            padding: var(--spacing-md);
        }
        
        .palette-section-title {
            color: var(--primary-color);
            font-size: var(--font-size-lg);
            margin-bottom: var(--spacing-md);
            padding-bottom: var(--spacing-sm);
            border-bottom: 2px solid var(--border-color);
        }
        
        .palette-item {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: var(--spacing-sm);
            margin-bottom: var(--spacing-xs);
            transition: all var(--transition-fast);
            cursor: grab;
        }
        
        .palette-item:hover {
            border-color: var(--primary-color);
            background: rgba(59, 130, 246, 0.1);
            transform: scale(1.02);
        }
        
        .palette-item.locked {
            opacity: 0.6;
            cursor: not-allowed;
            border-style: dashed;
            border-color: var(--warning-color);
        }
        
        .palette-icon {
            font-size: var(--font-size-xl);
            margin-bottom: var(--spacing-xs);
        }
        
        .palette-name {
            font-size: var(--font-size-sm);
            font-weight: 500;
        }
        
        /* Mejoras del canvas del constructor */
        .builder-canvas {
            background: var(--bg-secondary);
            border: 2px dashed var(--border-color);
            border-radius: var(--radius-lg);
            position: relative;
            overflow: hidden;
        }
        
        .builder-canvas:hover {
            border-color: var(--primary-color);
            background: rgba(59, 130, 246, 0.05);
        }
        
        .canvas-header {
            background: var(--bg-tertiary);
            border-bottom: 1px solid var(--border-color);
            padding: var(--spacing-md);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .canvas-header h4 {
            color: var(--text-primary);
            margin: 0;
        }
        
        .canvas-controls {
            display: flex;
            gap: var(--spacing-sm);
        }
        
        /* Mejoras de botones */
        .btn {
            padding: var(--spacing-sm) var(--spacing-md);
            border: none;
            border-radius: var(--radius-md);
            font-size: var(--font-size-sm);
            font-weight: 500;
            cursor: pointer;
            transition: all var(--transition-fast);
            display: inline-flex;
            align-items: center;
            gap: var(--spacing-xs);
            position: relative;
            overflow: hidden;
        }
        
        .btn::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            border-radius: 50%;
            background: rgba(255,255,255,0.5);
            transform: translate(-50%, -50%);
            transition: width 0.6s, height 0.6s;
        }
        
        .btn:active::before {
            width: 300%;
            height: 300%;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, var(--primary-color), var(--info-color));
            color: white;
            box-shadow: var(--shadow-md);
        }
        
        .btn-primary:hover {
            box-shadow: var(--shadow-lg);
            transform: translateY(-1px);
        }
        
        .btn-secondary {
            background: var(--bg-tertiary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
        }
        
        .btn-secondary:hover {
            background: var(--bg-hover);
            border-color: var(--primary-color);
        }
        
        .btn-ghost {
            background: transparent;
            border: 1px solid transparent;
            color: var(--text-secondary);
        }
        
        .btn-ghost:hover {
            background: var(--bg-hover);
            color: var(--text-primary);
        }
        
        .btn-danger {
            background: linear-gradient(135deg, var(--danger-color), #dc2626);
            color: white;
        }
        
        .btn-success {
            background: linear-gradient(135deg, var(--success-color), #059669);
            color: white;
        }
        
        /* Mejoras de propiedades del componente */
        .component-properties {
            background: var(--bg-secondary);
            border-left: 1px solid var(--border-color);
            padding: var(--spacing-lg);
        }
        
        .properties-header {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            margin-bottom: var(--spacing-lg);
            padding-bottom: var(--spacing-md);
            border-bottom: 1px solid var(--border-color);
        }
        
        .properties-form {
            display: flex;
            flex-direction: column;
            gap: var(--spacing-md);
        }
        
        .form-field {
            display: flex;
            flex-direction: column;
            gap: var(--spacing-xs);
        }
        
        .form-field label {
            font-size: var(--font-size-sm);
            font-weight: 500;
            color: var(--text-secondary);
        }
        
        .form-field input,
        .form-field select,
        .form-field textarea {
            padding: var(--spacing-sm);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-sm);
            background: var(--bg-tertiary);
            color: var(--text-primary);
            font-size: var(--font-size-sm);
            transition: all var(--transition-fast);
        }
        
        .form-field input:focus,
        .form-field select:focus,
        .form-field textarea:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
            background: var(--bg-hover);
        }
        
        /* Mejoras de previsión */
        .preview-container {
            background: white;
            border-radius: var(--radius-lg);
            padding: var(--spacing-lg);
            color: var(--text-inverse);
            box-shadow: var(--shadow-xl);
            position: relative;
            overflow: hidden;
        }
        
        .preview-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--primary-color), var(--success-color));
            animation: shimmer 3s infinite;
        }
        
        @keyframes shimmer {
            0%, 100% { transform: translateX(-100%); }
            50% { transform: translateX(100%); }
        }
        
        .preview-tab {
            padding: var(--spacing-sm) var(--spacing-md);
            border: none;
            background: transparent;
            color: var(--text-secondary);
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all var(--transition-fast);
            position: relative;
        }
        
        .preview-tab:hover {
            background: var(--bg-tertiary);
            color: var(--text-primary);
        }
        
        .preview-tab.active {
            background: linear-gradient(135deg, var(--primary-color), var(--info-color));
            color: white;
        }
        
        /* Mejoras del panel de pasos */
        .step-nav {
            background: var(--bg-primary);
            border-bottom: 1px solid var(--border-color);
            padding: var(--spacing-sm);
            position: sticky;
            top: 0;
            z-index: 100;
            backdrop-filter: blur(10px);
        }
        
        .step-nav-btn {
            padding: var(--spacing-sm) var(--spacing-md);
            border: 1px solid var(--border-color);
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all var(--transition-fast);
        }
        
        .step-nav-btn:hover {
            background: var(--primary-color);
            color: white;
            border-color: var(--primary-color);
        }
        
        .step-nav-btn.active {
            background: linear-gradient(135deg, var(--primary-color), var(--info-color));
            color: white;
            border-color: var(--primary-color);
        }
        
        /* Utilidades de animación */
        .pulse {
            animation: pulse 2s infinite;
        }
        
        .fade-in {
            animation: fadeIn var(--transition-slow) ease;
        }
        
        .slide-up {
            animation: slideUp var(--transition-normal) ease;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        /* Scrollbar mejorada */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        
        ::-webkit-scrollbar-track {
            background: var(--bg-secondary);
        }
        
        ::-webkit-scrollbar-thumb {
            background: var(--bg-tertiary);
            border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: var(--primary-color);
        }
        
        /* Mejoras de tooltips y notifications */
        .toast {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-md);
            padding: var(--spacing-sm) var(--spacing-md);
            margin: var(--spacing-xs);
            box-shadow: var(--shadow-lg);
            animation: slideInRight var(--transition-normal) ease;
        }
        
        .toast-success {
            background: linear-gradient(135deg, var(--success-color), #059669);
            color: white;
            border-color: var(--success-color);
        }
        
        .toast-error {
            background: linear-gradient(135deg, var(--danger-color), #dc2626);
            color: white;
            border-color: var(--danger-color);
        }
        
        .toast-warning {
            background: linear-gradient(135deg, var(--warning-color), #d97706);
            color: white;
            border-color: var(--warning-color);
        }
        
        .toast-info {
            background: linear-gradient(135deg, var(--info-color), #0ea5e9);
            color: white;
            border-color: var(--info-color);
        }
        
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        /* Efectos hover para elementos interactivos */
        .interactive-element {
            transition: all var(--transition-fast);
            position: relative;
        }
        
        .interactive-element:hover {
            transform: translateY(-2px);
        }
        
        .interactive-element:active {
            transform: translateY(0);
        }
        
        /* Gradiente de fondo animado sutil */
        .modo-builder-app {
            background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
            min-height: 100vh;
            position: relative;
            overflow-x: hidden;
        }
        
        .modo-builder-app::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: radial-gradient(circle at 20% 20%, rgba(59, 130, 246, 0.1) 0%, transparent 50%),
                        radial-gradient(circle at 80% 80%, rgba(14, 165, 233, 0.1) 0%, transparent 50%);
            pointer-events: none;
            z-index: -1;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Mejorar los estilos de los componentes
 */
ModoBuilder.prototype.upgradeComponentStyles = function(root) {
    root = root || (this.panels && this.panels.root) || null;
    if (!root) return;
    // Apunta a los paneles reales de ScratchUI (.scratch-*) o a los del builder legacy.
    const palette = root.querySelector('.scratch-palette') || (this.panels && this.panels.palette);
    const canvas = root.querySelector('.scratch-canvas') || (this.panels && this.panels.canvas);
    const props = root.querySelector('.scratch-inspector') || (this.panels && this.panels.properties);
    if (palette) palette.classList.add('modern-palette');
    if (canvas) canvas.classList.add('modern-canvas');
    if (props) props.classList.add('modern-properties');
};

/**
 * Configurar diseño responsivo
 */
ModoBuilder.prototype.setupResponsiveLayout = function(root) {
    root = root || this.container;
    if (!root) return;
    // Solo añade clases de breakpoint como hook para CSS; NO toca anchos inline
    // para no romper el layout flex/grid de ScratchUI.
    const apply = () => {
        root.classList.remove('mobile-layout', 'tablet-layout', 'desktop-layout');
        const w = window.innerWidth;
        if (w <= 480) root.classList.add('mobile-layout');
        else if (w <= 768) root.classList.add('tablet-layout');
        else root.classList.add('desktop-layout');
    };
    apply();
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(apply, 250);
    });
};

ModoBuilder.prototype.updateLayoutForViewport = function() {
    const container = this.container;
    if (!container) return;
    
    // Limpiar clases anteriores
    container.classList.remove('mobile-layout', 'tablet-layout', 'desktop-layout');
    
    const width = window.innerWidth;
    
    if (width <= 480) {
        container.classList.add('mobile-layout');
        this.optimizeForMobile();
    } else if (width <= 768) {
        container.classList.add('tablet-layout');
        this.optimizeForTablet();
    } else {
        container.classList.add('desktop-layout');
        this.optimizeForDesktop();
    }
};

ModoBuilder.prototype.optimizeForMobile = function() {
    // En dispositivos móviles, usar diseño de una columna
    if (this.panels.palette) {
        this.panels.palette.style.width = '100%';
        this.panels.palette.style.position = 'sticky';
        this.panels.palette.style.top = '0';
        this.panels.palette.style.zIndex = '50';
        this.panels.palette.style.background = 'var(--bg-secondary)';
    }
    
    if (this.panels.canvas) {
        this.panels.canvas.style.width = '100%';
        this.panels.canvas.style.marginTop = '60px'; // Espacio para la pallete fija
    }
    
    if (this.panels.properties) {
        this.panels.properties.style.width = '100%';
        this.panels.properties.style.position = 'sticky';
        this.panels.properties.style.bottom = '0';
        this.panels.properties.style.zIndex = '50';
        this.panels.properties.style.background = 'var(--bg-secondary)';
    }
};

ModoBuilder.prototype.optimizeForTablet = function() {
    // En tabletas, usar diseño de dos columnas
    if (this.panels.palette) {
        this.panels.palette.style.width = '40%';
        this.panels.palette.style.maxWidth = '300px';
    }
    
    if (this.panels.canvas) {
        this.panels.canvas.style.flex = '1';
        this.panels.canvas.style.minWidth = '0';
    }
    
    if (this.panels.properties) {
        this.panels.properties.style.width = '40%';
        this.panels.properties.style.maxWidth = '300px';
    }
};

ModoBuilder.prototype.optimizeForDesktop = function() {
    // En desktop, mantener diseño de tres columnas
    if (this.panels.palette) {
        this.panels.palette.style.width = '30%';
        this.panels.palette.style.maxWidth = '400px';
    }
    
    if (this.panels.canvas) {
        this.panels.canvas.style.flex = '1';
        this.panels.canvas.style.minWidth = '0';
    }
    
    if (this.panels.properties) {
        this.panels.properties.style.width = '30%';
        this.panels.properties.style.maxWidth = '400px';
    }
};

/**
 * Agregar mejoras de interactividad
 */
ModoBuilder.prototype.addInteractivityEnhancements = function(root) {
    this.setupDragDropEnhancements(root);
    this.setupKeyboardNavigation();
    this.setupPreviewEnhancements();
};

/**
 * Mejorar la funcionalidad de drag & drop
 */
ModoBuilder.prototype.setupDragDropEnhancements = function(root) {
    const canvas = (root && root.querySelector('.scratch-canvas')) ||
        (this.panels && this.panels.canvas);
    if (!canvas) return;
    
    // Agregar indicador visual durante drag & drop
    canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        canvas.classList.add('drag-over');
    });
    
    canvas.addEventListener('dragleave', () => {
        canvas.classList.remove('drag-over');
    });
    
    canvas.addEventListener('drop', () => {
        setTimeout(() => {
            canvas.classList.remove('drag-over');
        }, 100);
    });
};

/**
 * Configurar navegación por teclado mejorada
 */
ModoBuilder.prototype.setupKeyboardNavigation = function() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 's':
                    e.preventDefault();
                    if (this.saveMode) this.saveMode();
                    break;
                case 'z':
                    if (e.shiftKey) {
                        e.preventDefault();
                        this.redo && this.redo();
                    } else {
                        e.preventDefault();
                        this.undo && this.undo();
                    }
                    break;
                case 'y':
                    e.preventDefault();
                    this.redo && this.redo();
                    break;
                case '+':
                    e.preventDefault();
                    this.zoomIn && this.zoomIn();
                    break;
                case '-':
                    e.preventDefault();
                    this.zoomOut && this.zoomOut();
                    break;
            }
        }
        
        // Navegación entre componentes con flechas (solo si hay selección)
        if (e.key.startsWith('Arrow') && this.selectedComponent) {
            e.preventDefault();
            this.navigateComponents(e.key);
        }
    });
};

ModoBuilder.prototype.navigateComponents = function(direction) {
    if (!this.selectedComponent) return;
    
    const currentIndex = this.components.findIndex(c => c.id === this.selectedComponent.id);
    let targetIndex;
    
    switch (direction) {
        case 'ArrowUp':
            targetIndex = Math.max(0, currentIndex - 1);
            break;
        case 'ArrowDown':
            targetIndex = Math.min(this.components.length - 1, currentIndex + 1);
            break;
        case 'ArrowLeft':
            // En mobile/tablet, navegar horizontalmente no es usual
            return;
        case 'ArrowRight':
            // En mobile/tablet, navegar horizontalmente no es usual
            return;
        default:
            return;
    }
    
    if (targetIndex !== currentIndex) {
        this.selectedComponent = this.components[targetIndex];
        this.renderComponentProperties(this.selectedComponent);
        this.scrollCanvasToComponent(this.selectedComponent);
    }
};

ModoBuilder.prototype.scrollCanvasToComponent = function(component) {
    if (!this.panels.canvas) return;
    
    const canvasContent = this.panels.canvas.querySelector('#canvasContent');
    if (!canvasContent) return;
    
    // Centrar el componente en el canvas (simplificado)
    const componentElement = document.querySelector(`[data-component-id="${component.id}"]`);
    if (componentElement) {
        componentElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        });
    }
};

/**
 * Configurar mejoras de preview
 */
ModoBuilder.prototype.setupPreviewEnhancements = function() {
    if (this.previewEngine) {
        // Agregar eventos para preview mejorados
        const refreshBtn = document.getElementById('btnRefreshPreview');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refreshPreview();
                this.showNotification('Vista previa actualizada', 'success');
            });
        }
    }
};

/**
 * Agregar características de accesibilidad
 */
ModoBuilder.prototype.setupAccessibilityFeatures = function(root) {
    root = root || this.container;
    // Agregar HTML5 semantic y roles al root real del builder
    if (root) {
        if (!root.getAttribute('role')) root.setAttribute('role', 'application');
        root.setAttribute('aria-label', 'Constructor de Modos - Editor Visual');
    }
    
    // Agregar ajustes de contraste para accesibilidad
    this.setupHighContrastMode();
    
    // Agregar ayuda para screen readers (apuntando a los paneles reales)
    this.setupScreenReaderSupport(root);
};

ModoBuilder.prototype.setupHighContrastMode = function() {
    const prefersHighContrast = window.matchMedia('(prefers-contrast: high)');
    
    const toggleHighContrast = () => {
        if (prefersHighContrast.matches) {
            document.documentElement.classList.add('high-contrast');
        } else {
            document.documentElement.classList.remove('high-contrast');
        }
    };
    
    toggleHighContrast();
    prefersHighContrast.addEventListener('change', toggleHighContrast);
};

ModoBuilder.prototype.setupScreenReaderSupport = function(root) {
    root = root || (this.panels && this.panels.root) || null;
    const palette = root && root.querySelector('.scratch-palette') || (this.panels && this.panels.palette);
    const canvas = root && root.querySelector('.scratch-canvas') || (this.panels && this.panels.canvas);
    const props = root && root.querySelector('.scratch-inspector') || (this.panels && this.panels.properties);
    if (palette) {
        palette.setAttribute('role', 'list');
        palette.setAttribute('aria-label', 'Paleta de componentes');
    }
    if (canvas) {
        canvas.setAttribute('role', 'region');
        canvas.setAttribute('aria-label', 'Canvas del constructor');
    }
    if (props) {
        props.setAttribute('role', 'region');
        props.setAttribute('aria-label', 'Propiedades del componente');
    }
};

/**
 * Mostrar notificación
 */
ModoBuilder.prototype.showNotification = function(message, type = 'info') {
    // Crear elemento de notificación si no existe
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.position = 'fixed';
        toastContainer.style.top = '20px';
        toastContainer.style.right = '20px';
        toastContainer.style.zIndex = '1000';
        document.body.appendChild(toastContainer);
    }
    
    // Crear notificación
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.marginBottom = '10px';
    
    toastContainer.appendChild(toast);
    
    // Mostrar notificación
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    }, 10);
    
    // Ocultar y remover después de 3 segundos
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
};

/**
 * Zoom in/preview (para preview)
 */
ModoBuilder.prototype.zoomIn = function() {
    if (this.previewEngine) {
        this.previewEngine.zoomIn && this.previewEngine.zoomIn();
    }
};

/**
 * Zoom out/preview (para preview)
 */
ModoBuilder.prototype.zoomOut = function() {
    if (this.previewEngine) {
        this.previewEngine.zoomOut && this.previewEngine.zoomOut();
    }
};

/**
 * Deshacer acción
 */
ModoBuilder.prototype.undo = function() {
    // Implementar deshacer (sería necesario mantener un historial de acciones)
    console.log('Deshacer acción');
};

/**
 * Rehacer acción
 */
ModoBuilder.prototype.redo = function() {
    // Implementar rehacer (sería necesario mantener un historial de acciones)
    console.log('Rehacer acción');
};

// Auto-aplicar las mejoras de UI al cargar. El CSS moderno es globalmente útil
// para el builder (ScratchUI usa .scratch-app). Si en el futuro existe un
// builder con paneles, estos métodos mejorarán también su interfaz.
if (typeof document !== 'undefined') {
    const initEnhancements = () => {
        try {
            new ModoBuilder().enhanceUIDesign();
        } catch (err) {
            console.warn('ModoBuilder enhancements no aplicados:', err);
        }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEnhancements);
    } else {
        initEnhancements();
    }
}