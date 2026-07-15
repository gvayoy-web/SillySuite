/**
 * scratch-dynamic-editor.js — Editor de bloques dinámicos para ScratchUI
 *
 * Extiende ScratchUI para soportar bloques dinámicos:
 *   - Registrar bloques en tiempo real
 *   - Modificar bloques existentes
 *   - Eliminar bloques
 *   - Mantener historial de edición (undo/redo)
 *   - Exportar bloques dinámicos
 *   - Integrarse con DynamicBlocks y ScratchAOT
 *
 * API:
 *   DynamicEditor.init(scratchUI) -> instance
 *   instance.registerBlock(definition) -> blockId
 *   instance.modifyBlock(blockId, updates)
 *   instance.deleteBlock(blockId)
 *   instance.addBlockToEvent(opcode, eventOpcode?, position?)
 *   instance.exportDynamicBlocks() -> array
 *   instance.importDynamicBlocks(data) -> bool
 */

(function (global) {
  'use strict';

  const ScratchBlocks = global.ScratchBlocks
    || (typeof require !== 'undefined' ? require('./scratch-blocks.js').ScratchBlocks : null);
  const ScratchAOT = global.ScratchAOT || (typeof require !== 'undefined' ? require('./scratch-aot.js').ScratchAOT : null);
  const DynamicBlocks = global.DynamicBlocks || (typeof require !== 'undefined' ? require('./dynamic-blocks.js').DynamicBlocks : null);

  class DynamicBlockEditor {
    constructor(scratchUI) {
      this.ui = scratchUI;
      this.pendingChanges = [];
      this.history = [];
      this.maxHistory = 100;
      this.isProcessingChange = false;
      
      // Buscador y paleta para bloques dinámicos
      this.dynamicPalette = null;
      this.isDynamicPalette = false;
      
      this._bindEvents();
    }
    
    _bindEvents() {
      const { ui } = this;
      
      // Añadir evento para el botón "Paleta Dinámica"
      const toolbar = ui.root.querySelector('.scratch-toolbar');
      if (toolbar) {
        const dynamicBtn = document.createElement('button');
        dynamicBtn.className = 'toolbar-btn';
        dynamicBtn.innerHTML = '🧩 Dinámico';
        dynamicBtn.title = 'Paleta de bloques dinámicos';
        dynamicBtn.setAttribute('aria-label', 'Bloques dinámicos');
        dynamicBtn.addEventListener('click', () => this.toggleDynamicPalette());
        toolbar.insertBefore(dynamicBtn, toolbar.querySelector('[data-act="new"]') || toolbar.firstChild);
      }
      
      // Escuchar cambios en bloques dinámicos para actualizar la UI
      if (this.ui && this.ui._registerUIControl) {
        const originalRegister = this.ui._registerUIControl;
        this.ui._registerUIControl = (inst) => {
          originalRegister.call(this.ui, inst);
          this._handleNewBlock(inst);
        };
      }
    }
    
    _handleNewBlock(inst) {
      if (!inst || !inst.opcode) return;
      
      // Verificar si el bloque es dinámico
      const isDynamic = !(ScratchBlocks.exists(inst.opcode) && ScratchBlocks.get(inst.opcode));
      
      if (isDynamic) {
        const el = this.ui.domMap[inst._id];
        if (el) {
          el.classList.add('block-dynamic');
          el.title = 'Este bloque es dinámico (creado en tiempo de ejecución)';
        }
      }
    }
    
    toggleDynamicPalette() {
      this.isDynamicPalette = !this.isDynamicPalette;
      
      if (this.isDynamicPalette) {
        this.renderDynamicPalette();
        this.ui.elPalette.classList.add('dynamic-palette-open');
      } else {
        this.ui.elPalette.classList.remove('dynamic-palette-open');
      }
    }
    
    renderDynamicPalette() {
      if (!this.ui.elPalette) return;
      
      const dynamicBlocks = DynamicBlocks ? DynamicBlocks.getAll() : [];
      const stats = DynamicBlocks ? DynamicBlocks.getStats() : null;
      
      let html = `
        <div class="dynamic-palette-header">
          <div class="dynamic-stats">
            <span>🔧 Bloques dinámicos: ${dynamicBlocks.length}</span>
            ${stats ? `<span>📊 Por categoría: ${Object.entries(stats.byCategory).map(([k,v]) => `${v} ${k}`).join(', ')}</span>` : ''}
          </div>
          <div class="dynamic-actions">
            <button class="btn-sm" id="dynamic-import-btn" title="Importar bloques dinámicos">📁 Importar</button>
            <button class="btn-sm" id="dynamic-export-btn" title="Exportar bloques dinámicos">💾 Exportar</button>
            <button class="btn-sm" id="dynamic-clear-btn" title="Limpiar bloques dinámicos">🗑 Limpiar</button>
          </div>
        </div>
        <div class="dynamic-palette-content">
      `;
      
      if (dynamicBlocks.length === 0) {
        html += `
          <div class="dynamic-empty-state">
            <span class="empty-icon">🧩</span>
            <span class="empty-text">No hay bloques dinámicos</span>
            <button class="btn-sm" onclick="window.ScratchDynamicEditor.registerSampleBlock()">Crear bloque de ejemplo</button>
          </div>
        `;
      } else {
        // Agrupar por categoría
        const blocksByCategory = {};
        dynamicBlocks.forEach(opcode => {
          const def = DynamicBlocks.get(opcode);
          const category = def ? def.category : 'unknown';
          if (!blocksByCategory[category]) blocksByCategory[category] = [];
          blocksByCategory[category].push(opcode);
        });
        
        Object.entries(blocksByCategory).forEach(([category, opcodes]) => {
          html += `
            <div class="dynamic-category" data-category="${category}">
              <div class="dynamic-category-header">
                <span class="category-name">${category}</span>
                <span class="category-count">${opcodes.length} bloques</span>
              </div>
              <div class="dynamic-category-content">
          `;
          
          opcodes.forEach(opcode => {
            const def = DynamicBlocks.get(opcode);
            if (!def) return;
            
            html += `
              <div class="palette-block block-${def.type} dynamic-block" data-op="${opcode}" draggable="true" title="${this.humanize(opcode)} - Haz clic para modificar, arrastra para añadir">
                <span class="pb-icon">🧩</span>
                <span class="pb-label">${this.humanize(opcode)}</span>
                <span class="pb-type ${def.type}">${this.getBlockTypeIcon(def.type)}</span>
                <span class="dynamic-badge">D</span>
              </div>
            `;
          });
          
          html += '</div></div>';
        });
      }
      
      html += `
        </div>
      `;
      
      // Renderizar paleta dinámica
      const dynamicSection = this.ui.elPalette.querySelector('.dynamic-palette');
      if (dynamicSection) {
        dynamicSection.innerHTML = html;
      } else {
        this.ui.elPalette.insertAdjacentHTML('beforeend', `
          <div class="dynamic-palette">
            ${html}
          </div>
        `);
      }
      
      this._bindDynamicPaletteEvents();
    }
    
    _bindDynamicPaletteEvents() {
      // Botones de acción
      const importBtn = this.ui.elPalette.querySelector('#dynamic-import-btn');
      if (importBtn) {
        importBtn.addEventListener('click', () => this.importDynamicBlocks());
      }
      
      const exportBtn = this.ui.elPalette.querySelector('#dynamic-export-btn');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => this.exportDynamicBlocks());
      }
      
      const clearBtn = this.ui.elPalette.querySelector('#dynamic-clear-btn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => this.clearDynamicBlocks());
      }
      
      // Eventos de la paleta dinámica
      this.ui.elPalette.querySelectorAll('.dynamic-block').forEach(block => {
        block.addEventListener('click', (e) => {
          e.stopPropagation();
          const opcode = block.dataset.op;
          this.selectAndModifyBlock(opcode);
        });
        
        block.addEventListener('dragstart', (e) => {
          const opcode = block.dataset.op;
          const def = DynamicBlocks.get(opcode);
          if (def) {
            e.dataTransfer.setData('text/plain', opcode);
            e.dataTransfer.effectAllowed = 'copy';
            block.classList.add('dragging');
          }
        });
        
        block.addEventListener('dragend', () => {
          block.classList.remove('dragging');
        });
      });
      
      // Eventos de categorías
      this.ui.elPalette.querySelectorAll('.dynamic-category-header').forEach(header => {
        header.addEventListener('click', (e) => {
          const category = header.closest('.dynamic-category').dataset.category;
          header.closest('.dynamic-category').classList.toggle('collapsed');
        });
      });
    }
    
    importDynamicBlocks() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.style.display = 'none';
      input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            this.importDynamicBlocks(data);
          } catch (error) {
            alert(`Error al importar bloques dinámicos: ${error.message}`);
          }
        };
        reader.onerror = () => {
          alert('Error al leer el archivo');
        };
        reader.readAsText(file);
      });
      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    },
    
    importDynamicBlocks(data) {
      if (!DynamicBlocks) return false;
      
      try {
        const results = DynamicBlocks.importFromJSON(data);
        
        // Recargar paleta si hay nuevos bloques
        if (results.some(r => r.status === 'registered')) {
          this.renderDynamicPalette();
          this.ui.toast('Bloques dinámicos importados', 'success');
        }
        
        return true;
      } catch (error) {
        console.error('Error al importar bloques dinámicos:', error);
        this.ui.toast(`Error al importar: ${error.message}`, 'error');
        return false;
      }
    },
    
    exportDynamicBlocks() {
      if (!DynamicBlocks) return;
      
      const blocks = DynamicBlocks.exportToJSON();
      const blob = new Blob([JSON.stringify(blocks, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sillyquiz_dynamic_blocks_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.ui.toast('Bloques dinámicos exportados', 'success');
    },
    
    clearDynamicBlocks() {
      if (!DynamicBlocks || !confirm('¿Estás seguro de que deseas limpiar todos los bloques dinámicos? Esta acción no se puede deshacer.')) {
        return;
      }
      
      const cleared = DynamicBlocks.clearDynamic();
      this.ui.elPalette.classList.remove('dynamic-palette-open');
      this.isDynamicPalette = false;
      this.ui.toast(`Eliminados ${cleared} bloques dinámicos`, 'info');
    },
    
    selectAndModifyBlock(opcode) {
      // Encontrar instancia de bloque (o crear nueva)
      const eventStacks = this.ui.heads[this.ui.activeEvent] || [];
      const stack = eventStacks.length > 0 ? eventStacks[0] : null;
      
      if (stack) {
        // Encontrar primer bloque de este opcode
        let current = stack;
        let found = null;
        while (current) {
          if (current.opcode === opcode) {
            found = current;
            break;
          }
          current = current.next;
        }
        
        if (found) {
          this.ui.selectBlock(found);
        } else {
          // Añadir nuevo bloque
          this.ui.addBlockToEvent(opcode);
        }
      } else {
        this.ui.addBlockToEvent(opcode);
      }
    },
    
    humanize(op) {
      return op.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },
    
    getBlockTypeIcon(type) {
      const icons = {
        'hat': '🧢',
        'reporter': '📊',
        'boolean': '⭕',
        'command': '▶',
        'motion': '🚶',
        'looks': '🎨',
        'sound': '🔊',
        'pen': '✏️',
        'data': '📊',
        'event': '⚡',
        'control': '🔧',
        'sensing': '👁️',
        'operator': '⚙️',
        'variable': '📝',
        'list': '📋',
        'procedure': '📖'
      };
      return icons[type] || '📦';
    },
    
    registerSampleBlock() {
      if (!DynamicBlocks) return;
      
      const sampleBlock = {
        opcode: 'custom_dynamic_block',
        category: 'custom',
        type: 'stack',
        text: 'Mi bloque personalizado [VAL]',
        args: {
          VAL: { type: 'number', port: 'port-number', default: 42 },
          OPT: { type: 'string', port: 'port-string' }
        },
        meta: {
          sideEffects: ['state'],
          exec: 'sync'
        }
      };
      
      try {
        DynamicBlocks.register(sampleBlock.opcode, sampleBlock);
        this.ui.toast('Registrado bloque de ejemplo', 'success');
        this.renderDynamicPalette();
      } catch (error) {
        this.ui.toast(`Error al registrar bloque de ejemplo: ${error.message}`, 'error');
      }
    }
  }

  global.ScratchDynamicEditor = DynamicBlockEditor;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DynamicBlockEditor };
  }
})(typeof window !== 'undefined' ? window : this);
