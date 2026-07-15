/**
 * dynamic-blocks.js — Registro maestro de bloques dinámico
 *
 * Permite la adición, modificación y eliminación de bloques en tiempo de ejecución,
 * rompiendo la barrera del sistema statico de ScratchBlocks.
 *
 * API:
 *   DynamicBlocks.register(opcode, definition) -> bool (éxito)
 *   DynamicBlocks.unregister(opcode) -> bool (éxito)
 *   DynamicBlocks.update(opcode, updates) -> bool (éxito)
 *   DynamicBlocks.get(opcode) -> definition | null
 *   DynamicBlocks.exists(opcode) -> bool
 *   DynamicBlocks.validate(definition) -> validationResult
 *   DynamicBlocks.getAllByCategory(category) -> opcode[]
 *   DynamicBlocks.getAll() -> { [opcode]: definition }
 */

(function (global) {
  'use strict';

  const ScratchBlocks = global.ScratchBlocks
    || global.window?.ScratchBlocks
    || (typeof require !== 'undefined' ? require('./scratch-blocks.js').ScratchBlocks : null);

  if (!ScratchBlocks) {
    throw new Error('DynamicBlocks requires ScratchBlocks (cargar scratch-blocks.js primero)');
  }

  const PORT = ScratchBlocks.PORT;

  const DynamicBlocks = {
    // Cache de definición de bloques; sincronizado con ScratchBlocks.registry internamente
    registry: Object.create(null),
    // Categorías ordenadas (hijo de ScratchBlocks.categoriesOrdered)
    categories: ScratchBlocks.categoriesOrdered ? ScratchBlocks.categoriesOrdered() : [],
    
    // Seguridad y validación
    SECURITY: {
      // Bloques deshabilitados por defecto en producción
      DISALLOWED_PRODUCTION: [
        'execute_raw_javascript',
        'inject_css_raw',
        'runtime_hot_reload',
        'system_replicate_state_to_node',
        'engine_load_game_template'
      ],
      
      // Tipos de puerto requeridos por categoría
      CATEGORY_PORTS: {
        'events': ['string'],
        'control': ['number', 'boolean'],
        'looks': ['string', 'number', 'boolean'],
        'audio': ['number', 'boolean'],
        'ndi': ['string'],
        'displays': ['string'],
        'quiz': ['string', 'number'],
        'state': ['string'],
        'operators': ['number'],
        'custom': ['string'],
        'players': ['string'],
        'db': ['string'],
        'runtime': ['string'],
        'engine': ['string'],
        'sprites': ['string'],
        'physics': ['number']
      },
      
      // Valores permitidos por categoría
      CATEGORY_VALUES: {
        'events': ['on_mode_init', 'on_question_start', 'on_question_load', 'on_player_buzz', 'on_player_answer', 'on_timer_expire', 'on_hardware_disconnect', 'on_custom_signal'],
        'looks': ['set_theme', 'show_ui_component', 'hide_ui_component', 'set_component_property', 'play_css_animation', 'spawn_particle_emitter', 'set_text_smooth', 'toggle_fullscreen_layer', 'trigger_scene_wipe'],
        'audio': ['play_bg_music', 'stop_bg_music_fade', 'play_sfx', 'set_audio_category_volume', 'trigger_audio_ducking', 'stop_all_sounds'],
        'ndi': ['ndi_start_discovery_worker', 'ndi_connect_source', 'ndi_disconnect_source', 'ndi_send_canvas_scene', 'ndi_set_frame_rate', 'ndi_toggle_failover_image', 'get_ndi_latency', 'is_ndi_source_online']
      }
    },
    
    // Validación
    validate(definition) {
      const errors = [];
      
      if (!definition || typeof definition !== 'object') {
        errors.push('La definición debe ser un objeto');
        return { valid: false, errors };
      }
      
      if (!definition.opcode || typeof definition.opcode !== 'string') {
        errors.push('El opcode es requerido y debe ser un string');
      } else if (!/^[a-z][a-z0-9_]*$/.test(definition.opcode)) {
        errors.push('El opcode debe comenzar con una letra y contener solo letras, números y guiones bajos');
      }
      
      if (!definition.category || typeof definition.category !== 'string') {
        errors.push('La categoría es requerida');
      } else if (!this.SECURITY.CATEGORY_VALUES[definition.category] && !definition.opcode.startsWith('custom_')) {
        errors.push(`Categoría desconocida: ${definition.category}`);
      }
      
      const validTypes = ['hat', 'stack', 'reporter', 'boolean'];
      if (!definition.type || !validTypes.includes(definition.type)) {
        errors.push(`El tipo debe ser uno de: ${validTypes.join(', ')}`);
      }
      
      if (!definition.text || typeof definition.text !== 'string') {
        errors.push('El texto es requerido');
      }
      
      if (definition.type === 'hat' && definition.exec !== 'event') {
        errors.push('Los bloques Hat deben tener exec: "event"');
      }
      
      if (definition.hasBody && !definition.bodies) {
        errors.push('Los bloques con cuerpo deben tener bodies');
      }
      
      // Validar argumentos
      if (definition.args) {
        Object.entries(definition.args).forEach(([token, spec]) => {
          if (!/^[A-Z_]+$/.test(token)) {
            errors.push(`El token de argumento '${token}' debe estar en mayúsculas con guiones bajos`);
          }
          
          if (!spec.type) {
            errors.push(`El argumento '${token}' debe tener un tipo`);
          }
          
          const validPortTypes = ['number', 'string', 'boolean', 'color', 'ndi', 'display', 'any', 'input', 'textarea', 'slider', 'image_file', 'audio_file', 'dropdown', 'id', 'display_id', 'output_id', 'source_id', 'player_id'];
          if (!validPortTypes.includes(spec.type)) {
            errors.push(`El tipo de puerto '${spec.type}' no es válido. Debe ser uno de: ${validPortTypes.join(', ')}`);
          }
          
          if (spec.type === 'dropdown' && !spec.options) {
            errors.push(`El argumento '${token}' es un dropdown pero no tiene opción`);
          }
        });
      }
      
      return {
        valid: errors.length === 0,
        errors,
        definition: definition || null
      };
    },
    
    // Normalizar definition (compatibilidad con ScratchBlocks.def)
    normalize(definition) {
      const normalized = {
        opcode: definition.opcode,
        category: definition.category,
        type: definition.type,
        text: definition.text,
        args: definition.args || {},
        hasBody: definition.hasBody || false,
        bodies: definition.bodies || null,
        exec: definition.exec || (definition.type === 'hat' ? 'event' : 'sync'),
        returns: definition.returns || (definition.type === 'reporter' ? 'any' : null),
        sideEffects: definition.sideEffects || [],
        scope: definition.scope || null,
        disabledInProd: !!definition.disabledInProd
      };
      
      // Normalizar categorías para compatibilidad
      if (!normalized.sideEffects.includes('ui') && (normalized.category === 'looks' || normalized.opcode.includes('set_') || normalized.opcode.includes('show_') || normalized.opcode.includes('hide_'))) {
        normalized.sideEffects.push('ui');
      }
      
      return normalized;
    },
    
    // Registrar un nuevo bloque
    register(opcode, definition) {
      if (!definition) {
        throw new Error('La definición es requerida para registrar un bloque');
      }
      
      const validation = this.validate(definition);
      if (!validation.valid) {
        throw new Error(`Validación fallida: ${validation.errors.join(', ')}`);
      }
      
      // Normalizar definition para compatibilidad
      const normalized = this.normalize(definition);
      
      // Si ya existe, reemplazar
      this.registry[opcode] = normalized;
      
      // También agregar a ScratchBlocks.registry para compatibilidad
      if (ScratchBlocks.registry) {
        ScratchBlocks.registry[opcode] = normalized;
      }
      
      // Log para seguimiento
      if (typeof console !== 'undefined') {
        console.log(`[DynamicBlocks] Registrado bloque: ${opcode} (${normalized.category})`);
      }
      
      return true;
    },
    
    // Desregistrar un bloque
    unregister(opcode) {
      if (!this.registry[opcode]) {
        return false;
      }
      
      delete this.registry[opcode];
      
      if (ScratchBlocks.registry && ScratchBlocks.registry[opcode]) {
        delete ScratchBlocks.registry[opcode];
      }
      
      if (typeof console !== 'undefined') {
        console.log(`[DynamicBlocks] Desregistrado bloque: ${opcode}`);
      }
      
      return true;
    },
    
    // Actualizar un bloque existente
    update(opcode, updates) {
      if (!this.registry[opcode]) {
        throw new Error(`No se puede actualizar el bloque desconocido: ${opcode}`);
      }
      
      const current = this.registry[opcode];
      const merged = { ...current, ...updates };
      
      // Revalidar
      const validation = this.validate(merged);
      if (!validation.valid) {
        throw new Error(`Actualización fallida: ${validation.errors.join(', ')}`);
      }
      
      this.registry[opcode] = this.normalize(merged);
      
      if (ScratchBlocks.registry) {
        ScratchBlocks.registry[opcode] = this.registry[opcode];
      }
      
      if (typeof console !== 'undefined') {
        console.log(`[DynamicBlocks] Actualizado bloque: ${opcode}`);
      }
      
      return true;
    },
    
    // Obtener definición de bloque
    get(opcode) {
      return this.registry[opcode] || null;
    },
    
    // Verificar si el bloque existe
    exists(opcode) {
      return !!this.registry[opcode];
    },
    
    // Obtener todos los opcodes
    getAll() {
      return Object.keys(this.registry);
    },
    
    // Obtener opcodes por categoría
    getAllByCategory(category) {
      return Object.entries(this.registry)
        .filter(([_, def]) => def.category === category)
        .map(([opcode]) => opcode);
    },
    
    // Importar múltiples bloques (desde JSON)
    importFromJSON(data) {
      if (!Array.isArray(data)) {
        throw new Error('El JSON de importación debe ser un array de definiciones de bloques');
      }
      
      const results = [];
      
      data.forEach(definition => {
        try {
          this.register(definition.opcode, definition);
          results.push({ opcode: definition.opcode, status: 'registered' });
        } catch (e) {
          results.push({ opcode: definition.opcode, status: 'failed', error: e.message });
        }
      });
      
      if (typeof console !== 'undefined') {
        console.log(`[DynamicBlocks] Importados ${results.length} bloques`);
      }
      
      return results;
    },
    
    // Exportar a JSON (filtrar por categoría)
    exportToJSON(category = null) {
      let blocks = Object.values(this.registry);
      
      if (category) {
        blocks = blocks.filter(b => b.category === category);
      }
      
      return blocks;
    },
    
    // Migrar del registro estático de ScratchBlocks
    importFromScratchBlocks() {
      if (!ScratchBlocks.registry) {
        return 0;
      }
      
      const imported = [];
      
      Object.entries(ScratchBlocks.registry).forEach(([opcode, definition]) => {
        // Si no está en nuestro registro, importarlo
        if (!this.registry[opcode]) {
          this.registry[opcode] = definition;
          imported.push(opcode);
        }
      });
      
      if (typeof console !== 'undefined' && imported.length > 0) {
        console.log(`[DynamicBlocks] Importados ${imported.length} bloques desde ScratchBlocks`);
      }
      
      return imported.length;
    },
    
    // Limpiar todos los bloques dinámicos (preservar el registro estático)
    clearDynamic() {
      const dynamicOpcodes = Object.keys(this.registry).filter(op => {
        return !ScratchBlocks.registry || !(op in ScratchBlocks.registry);
      });
      
      dynamicOpcodes.forEach(opcode => {
        delete this.registry[opcode];
      });
      
      if (typeof console !== 'undefined' && dynamicOpcodes.length > 0) {
        console.log(`[DynamicBlocks] Limpiados ${dynamicOpcodes.length} bloques dinámicos`);
      }
      
      return dynamicOpcodes.length;
    },
    
    // Obtener estadísticas
    getStats() {
      const byCategory = {};
      const byType = {};
      
      Object.values(this.registry).forEach(def => {
        if (!byCategory[def.category]) byCategory[def.category] = 0;
        byCategory[def.category]++;
        
        if (!byType[def.type]) byType[def.type] = 0;
        byType[def.type]++;
      });
      
      return {
        total: Object.keys(this.registry).length,
        byCategory,
        byType
      };
    },
    
    // Comparar con ScratchBlocks (si existe)
    compareWithScratchBlocks() {
      if (!ScratchBlocks.registry) {
        return {
          dynamicOnly: Object.keys(this.registry),
          scratchOnly: [],
          common: [],
          differences: []
        };
      }
      
      const dynamic = Object.keys(this.registry);
      const scratch = Object.keys(ScratchBlocks.registry);
      
      const dynamicOnly = dynamic.filter(op => !(op in ScratchBlocks.registry));
      const scratchOnly = scratch.filter(op => !this.registry.hasOwnProperty(op));
      const common = dynamic.filter(op => op in ScratchBlocks.registry);
      
      const differences = [];
      
      common.forEach(opcode => {
        const dynDef = this.registry[opcode];
        const scratchDef = ScratchBlocks.registry[opcode];
        
        Object.keys(dynDef).forEach(key => {
          if (JSON.stringify(dynDef[key]) !== JSON.stringify(scratchDef[key])) {
            differences.push(`${opcode}.${key} differs`);
          }
        });
      });
      
      return { dynamicOnly, scratchOnly, common, differences };
    }
  };

  // Export for both browser and Node
  if (typeof globalThis !== 'undefined') {
    globalThis.DynamicBlocks = DynamicBlocks;
  }
  if (typeof global !== 'undefined') {
    global.DynamicBlocks = DynamicBlocks;
  }
  if (typeof window !== 'undefined') {
    window.DynamicBlocks = DynamicBlocks;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DynamicBlocks };
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
