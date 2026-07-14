/*
 * Scratch Mode UI Control Definition
 *
 * Este archivo implementa la funcionalidad para definir controles de UI
 * para modos scratch. Permite definir automáticamente controles específicos
 * para cada componente scratch creado.
 */

/**
 * Define controles de UI para un componente scratch
 * Genera controles HTML que pueden ser manipulados a través de la interfaz
 */
class ScratchUIControlDefinition {
    constructor(component, options = {}) {
        this.component = component;
        this.options = {
            autoGenerate: true,
            includeProperties: true,
            includeEvents: false,
            includeState: true,
            ...options
        };
        this.definition = null;
        this.generateDefinition();
    }
    
    generateDefinition() {
        const component = this.component;
        const opts = this.options;
        
        this.definition = {
            controls: [],
            properties: {},
            events: [],
            state: {},
            layout: this.generateLayout()
        };
        
        if (opts.includeProperties) {
            this.definition.properties = this.generatePropertiesControl(component);
        }
        
        if (opts.includeEvents) {
            this.definition.events = this.generateEventsControl(component);
        }
        
        if (opts.includeState) {
            this.definition.state = this.generateStateControl(component);
        }
    }
    
    generateLayout() {
        // Definir una cuadrícula responsive para los controles
        return {
            type: 'grid',
            columns: this.getComponentColumnCount(),
            rows: this.getComponentRowCount(),
            gap: '15px',
            autoFit: true
        };
    }
    
    getComponentColumnCount() {
        // Diferentes componentes necesitan diferentes cantidades de columnas
        const type = this.component.type;
        if (type === 'header' || type === 'title') return 2;
        if (type === 'question-block' || type === 'answer-option') return 3;
        if (type === 'timer') return 2;
        if (type === 'score-display') return 3;
        return 2; // Default
    }
    
    getComponentRowCount() {
        // Diferentes componentes necesitan diferentes cantidades de filas
        const type = this.component.type;
        if (type === 'question-block') return 4;
        if (type === 'answer-option') return 3;
        if (type === 'header') return 3;
        if (type === 'image-display') return 2;
        return 2; // Default
    }
    
    generatePropertiesControl(component) {
        const properties = component.properties;
        const controls = [];
        
        if (properties.titulo && typeof properties.titulo === 'string') {
            controls.push({
                type: 'text',
                label: 'Título',
                key: 'titulo',
                value: properties.titulo,
                placeholder: 'Ingresa el título...',
                required: true,
                validation: { maxLength: 100 }
            });
        }
        
        if (properties.icono && typeof properties.icono === 'string') {
            controls.push({
                type: 'input',
                label: 'Ícono',
                key: 'icono',
                value: properties.icono,
                placeholder: 'Ej: 🎮',
                required: false,
                help: 'Usa un emoji o carácter para representar el modo'
            });
        }
        
        if (properties.categoria && typeof properties.categoria === 'string') {
            controls.push({
                type: 'select',
                label: 'Categoría',
                key: 'categoria',
                value: properties.categoria,
                options: [
                    { value: 'quiz', label: 'Quiz' },
                    { value: 'memory', label: 'Memoria' },
                    { value: 'timing', label: 'Tiempo' },
                    { value: 'battle', label: 'Batalla' },
                    { value: 'story', label: 'Historia' },
                    { value: 'challenge', label: 'Desafío' },
                    { value: 'hunter', label: 'Cazador' },
                    { value: 'custom', label: 'Personalizado' }
                ],
                required: false
            });
        }
        
        if (properties.tags && Array.isArray(properties.tags)) {
            controls.push({
                type: 'tags',
                label: 'Etiquetas',
                key: 'tags',
                value: properties.tags,
                placeholder: 'ej: biblico, rapido, competitivo',
                required: false,
                help: 'Separa las etiquetas con comas'
            });
        }
        
        if (properties.dificultad && typeof properties.dificultad === 'string') {
            controls.push({
                type: 'select',
                label: 'Dificultad',
                key: 'dificultad',
                value: properties.dificultad,
                options: [
                    { value: 'easy', label: 'Fácil' },
                    { value: 'medium', label: 'Medio' },
                    { value: 'hard', label: 'Difícil' },
                    { value: 'mixed', label: 'Mezclado' }
                ],
                required: false
            });
        }
        
        if (properties.tiempo_estimado && typeof properties.tiempo_estimado === 'string') {
            controls.push({
                type: 'input',
                label: 'Tiempo Estimado',
                key: 'tiempo_estimado',
                value: properties.tiempo_estimado,
                placeholder: '5-15 min',
                required: false,
                help: 'Duración aproximada del modo'
            });
        }
        
        return controls;
    }
    
    generateEventsControl(component) {
        // Evento predefined para cambios de propiedades
        const events = [{
            type: 'change',
            label: 'Cuando las propiedades cambian',
            key: 'onChange',
            description: 'Ejecuta cuando las propiedades del componente cambian',
            actions: ['notifyParent', 'refreshPreview', 'saveConfig']
        }];
        
        return events;
    }
    
    generateStateControl(component) {
        const state = component.state || {};
        const controls = {};
        
        // Estado básico del componente
        controls.activo = {
            type: 'boolean',
            label: 'Activo',
            value: state.activo !== false,
            required: true,
            help: 'Si el componente está activo en el modo'
        };
        
        if (state.cantidad) {
            controls.cantidad = {
                type: 'number',
                label: 'Cantidad',
                value: state.cantidad,
                min: 0,
                max: 1000,
                required: false,
                help: 'Número de elementos (preguntas, opciones, etc.)'
            };
        }
        
        if (state.tiempo_restante) {
            controls.tiempo_restante = {
                type: 'number',
                label: 'Tiempo Restante (segundos)',
                value: state.tiempo_restante,
                min: 0,
                max: 3600,
                required: false,
                help: 'Tiempo restante en segundos'
            };
        }
        
        return controls;
    }
    
    exportForScratch() {
        return {
            id: this.component._id,
            type: this.component.type,
            properties: this.definition.properties,
            events: this.definition.events,
            state: this.definition.state,
            layout: this.definition.layout,
            metadata: {
                created: new Date().toISOString(),
                version: '1.0.0',
                author: 'Scratch Builder'
            }
        };
    }
    
    static createFromScratchComponent(component, options = {}) {
        return new ScratchUIControlDefinition(component, options);
    }
}

/**
 * Gestor de definiciones de controles de UI para todos los componentes scratch
 */
class ScratchUIControlDefinitionManager {
    constructor() {
        this.definitions = new Map(); // componentId -> definition
        this.registry = new Map(); // componentType -> definition generator
    }
    
    registerComponentType(type, generator) {
        this.registry.set(type, generator);
    }
    
    defineComponent(component, options = {}) {
        const type = component.type;
        let definition = this.definitions.get(component._id);
        
        if (!definition) {
            if (this.registry.has(type)) {
                const generator = this.registry.get(type);
                definition = generator(component, options);
                this.definitions.set(component._id, definition);
            } else {
                // Usar el generador por defecto
                definition = new ScratchUIControlDefinition(component, options);
                this.definitions.set(component._id, definition);
            }
        }
        
        return definition;
    }
    
    getDefinition(componentId) {
        return this.definitions.get(componentId);
    }
    
    updateDefinition(componentId, updates) {
        const definition = this.definitions.get(componentId);
        if (definition) {
            Object.assign(definition, updates);
            return definition;
        }
        return null;
    }
    
    removeDefinition(componentId) {
        this.definitions.delete(componentId);
    }
    
    exportAllDefinitions() {
        const exportData = {
            metadata: {
                exportedAt: new Date().toISOString(),
                version: '1.0.0',
                totalComponents: this.definitions.size
            },
            definitions: Array.from(this.definitions.values()).map(def => (
                {
                    id: def.component._id,
                    ...def.exportForScratch()
                }
            ))
        };
        
        return exportData;
    }
    
    importDefinitions(importData) {
        if (!importData || !importData.definitions) {
            throw new Error('Invalid import data format');
        }
        
        importData.definitions.forEach(definitionData => {
            const componentId = definitionData.id;
            // En un escenario real, necesitaríamos mapear este ID a un componente real
            // Para demo, solo almacenamos la definición
            this.definitions.set(componentId, definitionData);
        });
        
        return importData.definitions.length;
    }
    
    getRegistry() {
        return Array.from(this.registry.entries());
    }
}

// Registro global del sistema de definiciones de UI controls
const uiControlRegistry = new ScratchUIControlDefinitionManager();

// Component types pre-registrados
uiControlRegistry.registerComponentType('header', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('title', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('preguntas', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true, includeEvents: true })
);

uiControlRegistry.registerComponentType('pregunta', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('opcion', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('timer', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('puntuaje', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('imagen', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('video', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('audio', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('tarjeta', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('tarjeta-memoria', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('carrusel', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('progress-bar', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('barra-vida', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('medidor', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

uiControlRegistry.registerComponentType('contador', (component, options) => 
    new ScratchUIControlDefinition(component, { ...options, includeProperties: true })
);

// Exportar para uso en scratch-builder-v2.js
global.ScratchUIControlDefinition = ScratchUIControlDefinition;
global.uiControlRegistry = uiControlRegistry;