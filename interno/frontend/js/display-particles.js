//===========================================================================
//  PARTICLE SYSTEM - Advanced 2D Particle Engine for SillyQuiz Displays
//===========================================================================

(function(global) {
  'use strict';

  const PARTICLE_VERSION = '2.1.0';

  // Main particle engine class
  class SillyParticleSystem {
    constructor(container, opts = {}) {
      this.container = container;
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.container.appendChild(this.canvas);

      this.width = container.offsetWidth;
      this.height = container.offsetHeight;

      // Configuration
      this.config = {
        enabled: opts.enabled !== false,
        particleCount: opts.particleCount || 100,
        connectionDistance: opts.connectionDistance || 150,
        particleSizeMin: opts.particleSizeMin || 1,
        particleSizeMax: opts.particleSizeMax || 3,
        particleSpeedMin: opts.particleSpeedMin || 0.2,
        particleSpeedMax: opts.particleSpeedMax || 1,
        particleAlphaMin: opts.particleAlphaMin || 0.1,
        particleAlphaMax: opts.particleAlphaMax || 0.6,
        gravity: opts.gravity || { x: 0, y: 0.05 },
        friction: opts.friction || 0.95,
        repulsionRadius: opts.repulsionRadius || 100,
        pulseEffect: opts.pulseEffect || true,
        colorMode: opts.colorMode || 'theme', // 'theme', 'random', 'static'
        edgeEffect: opts.edgeEffect || 'wrap', // 'wrap', 'decay', 'bounce'
        animationSpeed: opts.animationSpeed || 1,
        trailEffect: opts.trailEffect || false,
        trailLength: opts.trailLength || 10,
        interactivity: opts.interactivity || {
          mouseRadius: 200,
          mouseRepulsion: 50,
          mouseAttraction: 1
        }
      };

      // State
      this.particles = [];
      this.mouse = { x: null, y: null };
      this.connections = [];
      this.particleHistory = [];
      this.animationId = null;
      this.lastTime = 0;
      this.isInitialized = false;
      this.particleIdCounter = 0;

      // Initialize
      this.init();
    }

    init() {
      if (!this.config.enabled) {
        this.canvas.style.display = 'none';
        return;
      }

      this.resize();
      this.createParticles();
      this.bindEvents();
      this.animate();
      this.isInitialized = true;

      // Emit initialization event
      this.emit('system:initialized', {
        particleCount: this.particles.length,
        config: this.config
      });
    }

    createParticles() {
      this.particles = [];

      // Determine particle colors based on color mode
      const colors = this.getColors();

      for (let i = 0; i < this.config.particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * Math.min(this.width, this.height) * 0.4;
        const x = this.width / 2 + Math.cos(angle) * radius;
        const y = this.height / 2 + Math.sin(angle) * radius;

        const velocity = {
          x: (Math.random() - 0.5) * this.config.particleSpeedMax,
          y: (Math.random() - 0.5) * this.config.particleSpeedMax
        };

        const particle = {
          id: this.particleIdCounter++,
          x,
          y,
          vx: velocity.x,
          vy: velocity.y,
          ax: 0,
          ay: 0,
          size: Math.random() * (this.config.particleSizeMax - this.config.particleSizeMin) +
                this.config.particleSizeMin,
          alpha: Math.random() * (this.config.particleAlphaMax - this.config.particleAlphaMin) +
                 this.config.particleAlphaMin,
          color: colors[Math.floor(Math.random() * colors.length)],
          age: 0,
          mass: Math.random() * 2 + 0.5,
          trail: [],
          hue: Math.random() * 360,
          lastMouseDistance: 0
        };

        this.particles.push(particle);
      }
    }

    getColors() {
      const baseColors = [];

      switch (this.config.colorMode) {
        case 'theme':
          baseColors.push(
            'var(--sq-color-accent-primary)',
            'var(--sq-color-accent-secondary)',
            'var(--sq-color-success)',
            'var(--sq-color-info)',
            'var(--sq-color-warning)',
            'var(--sq-color-danger)'
          );
          break;

        case 'random':
          const colors = [];
          const baseHues = [220, 280, 330, 60, 120, 180];
          for (let i = 0; i < 6; i++) {
            const hue = baseHues[i] + (Math.random() - 0.5) * 40;
            colors.push(`hsla(${hue}, 70%, 60%, 1)`);
          }
          baseColors.push(...colors);
          break;

        case 'static':
          baseColors.push(
            'rgba(255, 94, 58, 0.8)',
            'rgba(155, 103, 255, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(14, 165, 233, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(239, 68, 68, 0.8)'
          );
          break;

        default:
          baseColors.push(
            'var(--sq-color-accent-primary)',
            'var(--sq-color-accent-secondary)'
          );
      }

      return baseColors;
    }

    update(deltaTime) {
      this.particles.forEach(particle => {
        // Apply forces
        this.applyPhysics(particle, deltaTime);
        this.applyInteractions(particle, deltaTime);

        // Update position
        particle.x += particle.vx * deltaTime;
        particle.y += particle.vy * deltaTime;

        // Apply edge effects
        this.applyEdgeEffect(particle);

        // Update age
        particle.age += deltaTime;

        // Update trail
        if (this.config.trailEffect) {
          particle.trail.push({
            x: particle.x,
            y: particle.y,
            alpha: particle.alpha,
            size: particle.size
          });
          if (particle.trail.length > this.config.trailLength) {
            particle.trail.shift();
          }
        }

        // Update hue for pulsing effect
        if (this.config.pulseEffect) {
          particle.hue = (particle.hue + 0.5) % 360;
        }
      });

      // Update connections
      if (this.config.connectionDistance > 0) {
        this.updateConnections();
      }
    }

    applyPhysics(particle, deltaTime) {
      // Apply gravity
      if (this.config.gravity) {
        particle.ax += this.config.gravity.x;
        particle.ay += this.config.gravity.y;
      }

      // Update velocity
      particle.vx += particle.ax * deltaTime;
      particle.vy += particle.ay * deltaTime;

      // Apply friction
      if (this.config.friction < 1) {
        particle.vx *= this.config.friction;
        particle.vy *= this.config.friction;
      }

      // Reset acceleration
      particle.ax = 0;
      particle.ay = 0;
    }

    applyInteractions(particle, deltaTime) {
      // Mouse interactions
      if (this.mouse.x !== null && this.mouse.y !== null) {
        const dx = particle.x - this.mouse.x;
        const dy = particle.y - this.mouse.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.config.interactivity.mouseRadius) {
          const force = (1 - distance / this.config.interactivity.mouseRadius) * deltaTime;

          // Repulsion
          if (force > 0.1) {
            const angle = Math.atan2(dy, dx);
            particle.vx += Math.cos(angle) * this.config.interactivity.mouseRepulsion * force;
            particle.vy += Math.sin(angle) * this.config.interactivity.mouseRepulsion * force;
          }

          // Attraction
          particle.vx += dx * this.config.interactivity.mouseAttraction * force;
          particle.vy += dy * this.config.interactivity.mouseAttraction * force;
        }
      }

      // Particle-particle repulsion
      this.particles.forEach(other => {
        if (other.id === particle.id) return;

        const dx = particle.x - other.x;
        const dy = particle.y - other.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.config.repulsionRadius) {
          const force = (1 - distance / this.config.repulsionRadius) * 0.1 * deltaTime;
          const angle = Math.atan2(dy, dx);

          particle.vx += Math.cos(angle) * force * particle.mass;
          particle.vy += Math.sin(angle) * force * particle.mass;

          other.vx -= Math.cos(angle) * force * other.mass;
          other.vy -= Math.sin(angle) * force * other.mass;
        }
      });
    }

    applyEdgeEffect(particle) {
      const buffer = 50;

      // Wrap effect
      if (this.config.edgeEffect === 'wrap') {
        if (particle.x < -buffer) particle.x = this.width + buffer;
        else if (particle.x > this.width + buffer) particle.x = -buffer;

        if (particle.y < -buffer) particle.y = this.height + buffer;
        else if (particle.y > this.height + buffer) particle.y = -buffer;
      }

      // Decay effect (particle fades out at edges)
      else if (this.config.edgeEffect === 'decay') {
        const edgeDistance = Math.min(
          particle.x,
          this.width - particle.x,
          particle.y,
          this.height - particle.y
        );

        if (edgeDistance < 50) {
          particle.alpha = Math.max(0, particle.alpha - 0.01 * (50 - edgeDistance) / 50);

          if (particle.alpha <= 0) {
            this.resetParticle(particle);
          }
        }
      }

      // Bounce effect
      else if (this.config.edgeEffect === 'bounce') {
        if (particle.x < 0) {
          particle.x = 0;
          particle.vx = Math.abs(particle.vx) * 0.7;
        } else if (particle.x > this.width) {
          particle.x = this.width;
          particle.vx = -Math.abs(particle.vx) * 0.7;
        }

        if (particle.y < 0) {
          particle.y = 0;
          particle.vy = Math.abs(particle.vy) * 0.7;
        } else if (particle.y > this.height) {
          particle.y = this.height;
          particle.vy = -Math.abs(particle.vy) * 0.7;
        }
      }
    }

    resetParticle(particle) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * Math.min(this.width, this.height) * 0.4;

      particle.x = this.width / 2 + Math.cos(angle) * radius;
      particle.y = this.height / 2 + Math.sin(angle) * radius;
      particle.vx = (Math.random() - 0.5) * this.config.particleSpeedMax;
      particle.vy = (Math.random() - 0.5) * this.config.particleSpeedMax;
      particle.alpha = Math.random() * (this.config.particleAlphaMax - this.config.particleAlphaMin) +
                      this.config.particleAlphaMin;
      particle.trail = [];
    }

    updateConnections() {
      this.connections = [];

      for (let i = 0; i < this.particles.length; i++) {
        const p1 = this.particles[i];
        for (let j = i + 1; j < this.particles.length; j++) {
          const p2 = this.particles[j];

          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < this.config.connectionDistance) {
            // Calculate connection strength
            const strength = 1 - (distance / this.config.connectionDistance);
            const alpha = strength * 0.3 * p1.alpha * p2.alpha;

            this.connections.push({
              x1: p1.x,
              y1: p1.y,
              x2: p2.x,
              y2: p2.y,
              alpha,
              strength,
              particles: [p1, p2]
            });
          }
        }
      }
    }

    drawConnections() {
      if (this.connections.length === 0) return;

      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      this.ctx.lineWidth = 1;

      this.connections.forEach(conn => {
        if (conn.alpha < 0.05) return;

        this.ctx.globalAlpha = conn.alpha;

        this.ctx.beginPath();
        this.ctx.moveTo(conn.x1, conn.y1);
        this.ctx.lineTo(conn.x2, conn.y2);
        this.ctx.stroke();
      });

      this.ctx.restore();
    }

    drawParticles() {
      this.particles.forEach(particle => {
        const hue = this.config.pulseEffect ? particle.hue : 220;
        const color = this.config.colorMode === 'random' ? 
          `hsla(${hue}, 70%, 60%, ${particle.alpha})` :
          this.config.colorMode === 'theme' ?
          `hsla(${hue}, 70%, 60%, ${particle.alpha})` :
          `hsla(${hue}, 70%, 60%, ${particle.alpha})`;

        // Draw trail
        if (this.config.trailEffect && particle.trail.length > 0) {
          this.ctx.save();
          this.ctx.globalAlpha = particle.alpha * 0.3;

          for (let i = 0; i < particle.trail.length; i++) {
            const trailPoint = particle.trail[i];
            const trailAlpha = trailPoint.alpha * (i / particle.trail.length);
            this.ctx.beginPath();
            this.ctx.arc(trailPoint.x, trailPoint.y, trailPoint.size * 0.5, 0, Math.PI * 2);
            this.ctx.fillStyle = color.replace(')', ` , ${trailAlpha})`).replace('rgba', 'hsla').replace('(', 'hsla(');
            this.ctx.fill();
          }

          this.ctx.restore();
        }

        // Draw main particle
        this.ctx.save();
        this.ctx.globalAlpha = particle.alpha;

        if (this.config.pulseEffect) {
          const pulseSize = particle.size * (1 + Math.sin(particle.age * 0.005) * 0.2);
          this.ctx.beginPath();
          this.ctx.arc(particle.x, particle.y, pulseSize, 0, Math.PI * 2);
          this.ctx.fillStyle = `hsla(${particle.hue}, 70%, 60%, 1)`;
          this.ctx.fill();

          // Add glow effect
          this.ctx.shadowColor = `hsla(${particle.hue}, 70%, 60%, 0.8)`;
          this.ctx.shadowBlur = 10;
        } else {
          this.ctx.beginPath();
          this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
          this.ctx.fillStyle = color;
          this.ctx.fill();
        }

        this.ctx.restore();
      });
    }

    resize() {
      this.width = this.container.offsetWidth;
      this.height = this.container.offsetHeight;
      this.canvas.width = this.width;
      this.canvas.height = this.height;

      // Reset particles on resize
      this.createParticles();
    }

    bindEvents() {
      // Mouse tracking
      this.container.addEventListener('mousemove', (e) => {
        const rect = this.container.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;

        // Emit mouse move event
        this.emit('particle:mouse-move', {
          x: this.mouse.x,
          y: this.mouse.y,
          particleSystem: this
        });
      });

      this.container.addEventListener('mouseenter', () => {
        this.mouse.x = 0;
        this.mouse.y = 0;
      });

      this.container.addEventListener('mouseleave', () => {
        this.mouse.x = null;
        this.mouse.y = null;
      });

      // Window resize
      window.addEventListener('resize', () => {
        this.resize();
      });
    }

    animate(timestamp = 0) {
      if (!this.isInitialized) return;

      const deltaTime = Math.min((timestamp - this.lastTime) / 1000, 0.1);
      this.lastTime = timestamp;

      this.ctx.clearRect(0, 0, this.width, this.height);

      if (this.config.enabled) {
        this.update(deltaTime * this.config.animationSpeed);
        this.drawConnections();
        this.drawParticles();
      }

      this.animationId = requestAnimationFrame(this.animate.bind(this));
    }

    setMousePosition(x, y) {
      this.mouse.x = x;
      this.mouse.y = y;
    }

    updateConfig(newConfig) {
      Object.assign(this.config, newConfig);

      // Recreate particles if key settings changed
      if (newConfig.particleCount || newConfig.colorMode || newConfig.edgeEffect) {
        this.createParticles();
      }
    }

    pause() {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    }

    resume() {
      if (!this.animationId && this.isInitialized) {
        this.lastTime = performance.now();
        this.animate();
      }
    }

    destroy() {
      this.pause();
      this.container.removeChild(this.canvas);
      this.particles = [];
      this.connections = [];
      this.canvas = null;
      this.ctx = null;
      this.isInitialized = false;
      this.emit('system:destroyed');
    }

    // Event emitter (minimal implementation)
    on(event, callback) {
      if (!this.events) this.events = {};
      if (!this.events[event]) this.events[event] = [];
      this.events[event].push(callback);
    }

    emit(event, data) {
      if (!this.events || !this.events[event]) return;
      this.events[event].forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.error(`Error in particle system event handler for ${event}:`, e);
        }
      });
    }
  }

  // Factory function to create particle systems
  function createParticleSystem(container, opts = {}) {
    return new SillyParticleSystem(container, opts);
 }

  // Export
  global.SillyParticleSystem = SillyParticleSystem;
  global.createParticleSystem = createParticleSystem;

})(typeof window !== 'undefined' ? window : globalThis);
