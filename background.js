// Reusable animated background that renders a bumpy metallic look with interactive mouse push
// Usage: new CustomBackground({ canvasId: 'bgCanvas', animate: true })
(function(){
  class CustomBackground {
    constructor(options = {}) {
      // Canvas
      this.canvas = options.canvas || document.getElementById(options.canvasId || 'bgCanvas');
      if (!this.canvas) throw new Error('CustomBackground: target canvas not found');
      this.ctx = this.canvas.getContext('2d');

      // Size
      if (!this.canvas.width || !this.canvas.height) {
        this.canvas.width = options.width || 800;
        this.canvas.height = options.height || 600;
      }
      this.width = this.canvas.width;
      this.height = this.canvas.height;

      // Config
  const bgCfg = (typeof BrushConfig !== 'undefined' && BrushConfig.background) ? BrushConfig.background : {};
  this.pushRadius = options.pushRadius ?? bgCfg.pushRadius ?? 100;
  this.bgCircleCount = options.bgCircleCount ?? bgCfg.bgCircleCount ?? 20000; // static layer count
  this.topCircleCount = options.topCircleCount ?? bgCfg.topCircleCount ?? 500;  // animated layer count
  this.showFPS = options.showFPS ?? bgCfg.showFPS ?? false;
  this.shouldAnimate = options.animate ?? bgCfg.animate ?? true;
    this.baseColor = options.baseColor ?? bgCfg.baseColor ?? '#363636ff';
    this.interactionMode = options.interactionMode ?? bgCfg.interactionMode ?? 'circles';
    // Visual & motion config
    this.vcfg = bgCfg.visual || {};
    this.vStatic = this.vcfg.static || {};
    this.vTop = this.vcfg.top || {};
    this.mcfg = bgCfg.motion || {};
    this.topRegion = bgCfg.topRegion || { type: 'circle', radiusRatio: 0.35 };

    // Precompute region geometry
    const minDim = Math.min(this.width, this.height);
    const cx = this.width / 2;
    const cy = this.height / 2;
    if (this.topRegion.type === 'rect') {
      const wr = Math.max(0, Math.min(1, this.topRegion.widthRatio ?? 0.6));
      const hr = Math.max(0, Math.min(1, this.topRegion.heightRatio ?? 0.6));
      this._region = { kind: 'rect', cx, cy, halfW: (this.width * wr) / 2, halfH: (this.height * hr) / 2 };
    } else {
      const rr = Math.max(0, Math.min(1, this.topRegion.radiusRatio ?? 0.35));
      this._region = { kind: 'circle', cx, cy, r: minDim * rr };
    }

    this._inRegion = (x, y) => {
      const R = this._region;
      if (R.kind === 'rect') {
        return Math.abs(x - R.cx) <= R.halfW && Math.abs(y - R.cy) <= R.halfH;
      }
      const dx = x - R.cx, dy = y - R.cy;
      return (dx * dx + dy * dy) <= (R.r * R.r);
    };

    this._clampToRegion = (pt) => {
      const R = this._region;
      if (R.kind === 'rect') {
        pt.x = Math.max(R.cx - R.halfW, Math.min(R.cx + R.halfW, pt.x));
        pt.y = Math.max(R.cy - R.halfH, Math.min(R.cy + R.halfH, pt.y));
        return pt;
      }
      // circle clamp: project outside points to circle perimeter
      const dx = pt.x - R.cx, dy = pt.y - R.cy;
      const d2 = dx * dx + dy * dy;
      const r = R.r;
      if (d2 > r * r) {
        const d = Math.sqrt(d2) || 1;
        pt.x = R.cx + (dx / d) * r;
        pt.y = R.cy + (dy / d) * r;
      }
      return pt;
    };

      // State
      this.mouseX = 0;
      this.mouseY = 0;
  this._lastUserPos = null;
      this.topLayerCircles = [];
      this.backgroundImageData = null;
  this._lastBrushPos = null;
  this.brushPositions = [];
  // Contour overlay (offscreen canvas)
  this._contourCanvas = document.createElement('canvas');
  this._contourCanvas.width = this.width;
  this._contourCanvas.height = this.height;
  this._contourCtx = this._contourCanvas.getContext('2d');

  // Sprite caches for prerendered top-layer circles
  this._spritesCfg = (typeof BrushConfig !== 'undefined' && BrushConfig.background?.sprites) ? BrushConfig.background.sprites : { enabled: true, radiusStep: 0.5, grayStep: 5 };
  this._spriteCacheTopShadow = new Map(); // key: radiusQ|outerScale|shadow params
  this._spriteCacheTopMain = new Map();   // key: radiusQ|grayQ|darkScale|hl

      // FPS
      this._fps = 0;
      this._frameCount = 0;
      this._lastTime = performance.now();
      this._raf = null;

      // Init
      this._attachMouse();
      this._initTopLayer();
      // Optional GPU particle path (deferred init because GPUCompute loads after background)
      this._gpuParticlesDesired = !!(BrushConfig?.background?.useGpuParticles) && (this.mcfg.deleteChance ?? 0) === 0;
      this._gpuParticlesEnabled = false;
      this._gpuParticleSyncInterval = Math.max(1, BrushConfig?.background?.gpuParticleSyncInterval || 2);
      this._gpuParticleFrame = 0;
  this._renderTopOnGPU = !!(BrushConfig?.background?.renderTopOnGPU);
  // Offscreen canvas to hold GPU-rendered particles (we'll draw GPU canvas directly)
  this._gpuCanvasLayer = null;
      // Defer actual init to _tryInitGpuParticles
      this._drawBackground(); // prerender static BG into ImageData

      if (this.shouldAnimate) this.start();
    }

    // Public API
    start() {
      if (this._raf) return;
      const loop = () => {
        this._raf = requestAnimationFrame(loop);
        this._tick();
      };
      this._raf = requestAnimationFrame(loop);
    }

    stop() {
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
    }

  resize(width, height) {
      if (width === this.width && height === this.height) return;
      this.stop();
      this.canvas.width = width;
      this.canvas.height = height;
      this.width = width;
      this.height = height;
      // Rebuild
      this.topLayerCircles = [];
      this._initTopLayer();
      // Clear sprite caches (radius/gray potentially different now)
      if (this._spriteCacheTopShadow) this._spriteCacheTopShadow.clear();
      if (this._spriteCacheTopMain) this._spriteCacheTopMain.clear();
      this._drawBackground();
      if (this.shouldAnimate) this.start();
    }

    toDataURL(type = 'image/png', quality) {
      // Render one frame and export as image
      this._renderFrame();
      return this.canvas.toDataURL(type, quality);
    }

    // Internals
    _attachMouse() {
      // Listen on document so we still track mouse when another canvas overlays this one
      document.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        // Update interaction coordinates for both modes
        if (this.interactionMode === 'circles' || this.interactionMode === 'thermalBrush') {
          this.mouseX = e.clientX - rect.left;
          this.mouseY = e.clientY - rect.top;
        }
        // In 'thermalBrush' mode, the brush drives us
        if (this.interactionMode === 'thermalBrush' && window.thermalBrush) {
          const pos = { x: this.mouseX, y: this.mouseY };
          if (typeof window.thermalBrush.addLinePositions === 'function' && this._lastUserPos) {
            window.thermalBrush.addLinePositions(this._lastUserPos, pos);
          } else if (typeof window.thermalBrush.enqueuePosition === 'function') {
            window.thermalBrush.enqueuePosition(pos);
          }
          this._lastUserPos = pos;
          this.onBrushPosition(pos);
        }
        // In 'circles' mode, push to thermalBrush if available
        if (this.interactionMode === 'circles' && window.thermalBrush) {
          const pos = { x: this.mouseX, y: this.mouseY };
          if (typeof window.thermalBrush.addLinePositions === 'function' && this._lastUserPos) {
            window.thermalBrush.addLinePositions(this._lastUserPos, pos);
          } else if (typeof window.thermalBrush.enqueuePosition === 'function') {
            window.thermalBrush.enqueuePosition(pos);
          }
          this._lastUserPos = pos;
        }
      });

      document.addEventListener('mouseleave', () => {
        this._lastUserPos = null;
      });
    }

    _initTopLayer() {
      for (let i = 0; i < this.topCircleCount; i++) {
        // Spawn uniformly within region
        let x, y;
        if (this._region.kind === 'rect') {
          x = this._region.cx + (Math.random() * 2 - 1) * this._region.halfW;
          y = this._region.cy + (Math.random() * 2 - 1) * this._region.halfH;
        } else {
          // random point in circle
          const t = 2 * Math.PI * Math.random();
          const r = this._region.r * Math.sqrt(Math.random());
          x = this._region.cx + r * Math.cos(t);
          y = this._region.cy + r * Math.sin(t);
        }
        const rMin = this.vTop.radiusMin ?? 3;
        const rMax = this.vTop.radiusMax ?? 8;
        const radius = Math.random() * (rMax - rMin) + rMin;
        const outerScale = this.vTop.outerScale ?? 1.3;
        const outerRadius = radius * outerScale;
        const gMin = this.vTop.grayMin ?? 150;
        const gMax = this.vTop.grayMax ?? 300; // browser clamps >255
        const grayRaw = Math.random() * (gMax - gMin) + gMin;
        const grayValue = Math.floor(Math.min(255, Math.max(0, grayRaw)));
        this.topLayerCircles.push({ x, y, radius, outerRadius, grayValue });
      }
    }

    _drawBackground() {
      const ctx = this.ctx;

      // Base fill
  ctx.fillStyle = this.baseColor;
      ctx.fillRect(0, 0, this.width, this.height);

      // Random circles (static baked layer)
      for (let i = 0; i < this.bgCircleCount; i++) {
        const x = Math.random() * this.width;
        const y = Math.random() * this.height;
        const rMin = this.vStatic.radiusMin ?? 3;
        const rMax = this.vStatic.radiusMax ?? 8;
        const radius = Math.random() * (rMax - rMin) + rMin;
        const outerScale = this.vStatic.outerScale ?? 1.3;
        const outerRadius = radius * outerScale;

        // Shadow
  const sOff = this.vStatic.shadowOffset ?? 5;
  const sIn = this.vStatic.shadowAlphaInner ?? 0.5;
  const sOut = this.vStatic.shadowAlphaOuter ?? 0.1;
  const shadowGradient = ctx.createRadialGradient(x + sOff, y + sOff, 0, x + sOff, y + sOff, outerRadius);
  shadowGradient.addColorStop(0, `rgba(0, 0, 0, ${sIn})`);
  shadowGradient.addColorStop(1, `rgba(0, 0, 0, ${sOut})`);
        ctx.beginPath();
  ctx.arc(x - sOff, y - sOff, outerRadius, 0, Math.PI * 2);
        ctx.fillStyle = shadowGradient;
        ctx.fill();

        // Main circle
        const hl = this.vStatic.highlightOffsetScale ?? 0.3;
        const offsetX = x - radius * hl;
        const offsetY = y - radius * hl;
        const gradient = ctx.createRadialGradient(offsetX, offsetY, 0, x, y, radius);
        const gMin = this.vStatic.grayMin ?? 100;
        const gMax = this.vStatic.grayMax ?? 200;
        const grayValue = Math.floor(Math.random() * (gMax - gMin) + gMin);
        const darkScale = this.vStatic.mainDarkScale ?? 0.2;
        gradient.addColorStop(0, `rgb(${grayValue}, ${grayValue}, ${grayValue})`);
        gradient.addColorStop(1, `rgb(${Math.floor(grayValue * darkScale)}, ${Math.floor(grayValue * darkScale)}, ${Math.floor(grayValue * darkScale)})`);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Cache for fast restore
      this.backgroundImageData = ctx.getImageData(0, 0, this.width, this.height);
    }

    _drawTopLayer() {
      const ctx = this.ctx;
      const sOff = this.vTop.shadowOffset ?? 5;
      const sIn = this.vTop.shadowAlphaInner ?? 0.6;
      const sOut = this.vTop.shadowAlphaOuter ?? 0.1;
      const hl = this.vTop.highlightOffsetScale ?? 0.3;
      const darkScale = this.vTop.mainDarkScale ?? 0.3;
      const outerScale = this.vTop.outerScale ?? 1.3;
      const useSprites = !!(this._spritesCfg && this._spritesCfg.enabled);
      const rStep = Math.max(0.1, this._spritesCfg?.radiusStep ?? 0.5);
      const gStep = Math.max(1, this._spritesCfg?.grayStep ?? 5);

      for (let i = 0; i < this.topLayerCircles.length; i++) {
        const c = this.topLayerCircles[i];
        if (useSprites) {
          // Quantize to reduce cache variants
          const rQ = Math.max(1, Math.round(c.radius / rStep) * rStep);
          const gQ = Math.max(0, Math.min(255, Math.round(c.grayValue / gStep) * gStep));

          // Shadow sprite
          const shadowKey = `v2|${rQ}|${outerScale}|${sOff}|${sIn}|${sOut}`;
          let shadowSprite = this._spriteCacheTopShadow.get(shadowKey);
          if (!shadowSprite) {
            const outerR = rQ * outerScale;
            const centerOffset = outerR + sOff;
            const size = Math.ceil(centerOffset * 2);
            const cvs = document.createElement('canvas');
            cvs.width = size; cvs.height = size;
            const sctx = cvs.getContext('2d');
            const grad = sctx.createRadialGradient(centerOffset, centerOffset, 0, centerOffset, centerOffset, outerR);
            grad.addColorStop(0, `rgba(0,0,0,${sIn})`);
            grad.addColorStop(1, `rgba(0,0,0,${sOut})`);
            sctx.beginPath();
            sctx.arc(centerOffset, centerOffset, outerR, 0, Math.PI * 2);
            sctx.fillStyle = grad;
            sctx.fill();
            shadowSprite = { canvas: cvs, size, centerOffset };
            this._spriteCacheTopShadow.set(shadowKey, shadowSprite);
          }

          // Main sprite
          const mainKey = `${rQ}|${gQ}|${darkScale}|${hl}`;
          let mainSprite = this._spriteCacheTopMain.get(mainKey);
          if (!mainSprite) {
            const r = rQ;
            const size = Math.ceil(r * 2);
            const cvs = document.createElement('canvas');
            cvs.width = size; cvs.height = size;
            const mctx = cvs.getContext('2d');
            const lightX = r - r * hl;
            const lightY = r - r * hl;
            const grad = mctx.createRadialGradient(lightX, lightY, 0, r, r, r);
            const dark = Math.floor(gQ * darkScale);
            grad.addColorStop(0, `rgb(${gQ},${gQ},${gQ})`);
            grad.addColorStop(1, `rgb(${dark},${dark},${dark})`);
            mctx.beginPath();
            mctx.arc(r, r, r, 0, Math.PI * 2);
            mctx.fillStyle = grad;
            mctx.fill();
            mainSprite = { canvas: cvs, size, r };
            this._spriteCacheTopMain.set(mainKey, mainSprite);
          }

          // Draw sprites
          const sx = Math.round(c.x - shadowSprite.centerOffset);
          const sy = Math.round(c.y - shadowSprite.centerOffset);
          ctx.drawImage(shadowSprite.canvas, sx, sy);

          const mx = Math.round(c.x - mainSprite.r);
          const my = Math.round(c.y - mainSprite.r);
          ctx.drawImage(mainSprite.canvas, mx, my);
        } else {
          // Fallback: render gradients directly
          // Shadow
          const shadowGradient = ctx.createRadialGradient(c.x + sOff, c.y + sOff, 0, c.x + sOff, c.y + sOff, c.outerRadius);
          shadowGradient.addColorStop(0, `rgba(0, 0, 0, ${sIn})`);
          shadowGradient.addColorStop(1, `rgba(0, 0, 0, ${sOut})`);
          ctx.beginPath();
          ctx.arc(c.x - sOff, c.y - sOff, c.outerRadius, 0, Math.PI * 2);
          ctx.fillStyle = shadowGradient;
          ctx.fill();

          // Main
          const lightOffsetX = c.x - c.radius * hl;
          const lightOffsetY = c.y - c.radius * hl;
          const gradient = ctx.createRadialGradient(lightOffsetX, lightOffsetY, 0, c.x, c.y, c.radius);
          gradient.addColorStop(0, `rgb(${c.grayValue}, ${c.grayValue}, ${c.grayValue})`);
          const dark = Math.floor(c.grayValue * darkScale);
          gradient.addColorStop(1, `rgb(${dark}, ${dark}, ${dark})`);
          ctx.beginPath();
          ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }
      }
    }

    _updateCircles() {
      const pushRadius = this.pushRadius;
      if (this._gpuParticlesEnabled && this._gpu && this._gpu.supported) {
        // Advance on GPU using current brush/mouse position as push center
        const params = {
          pushCenter: { x: this.mouseX, y: this.mouseY },
          pushRadius: this.pushRadius,
          baseStrength: this.mcfg.pushStrengthBase ?? 10,
          forceVarMin: this.mcfg.forceVariationMin ?? 0.2,
          forceVarMax: this.mcfg.forceVariationMax ?? 1.8,
          angleVarMax: this.mcfg.angleVariationMaxRad ?? (Math.PI / 1.5),
          driftMax: this.mcfg.driftMax ?? 4,
          time: performance.now() * 0.001
        };
        try { this._gpu.stepParticles(params); } catch (e) { this._gpuParticlesEnabled = false; }

        // Periodically sync positions back for CPU drawing
        this._gpuParticleFrame++;
        if ((this._gpuParticleFrame % this._gpuParticleSyncInterval) === 0) {
          const pos = this._gpu.downloadParticlePositions();
          if (pos && pos.length >= this.topLayerCircles.length * 2) {
            for (let i = 0; i < this.topLayerCircles.length; i++) {
              this.topLayerCircles[i].x = pos[i * 2];
              this.topLayerCircles[i].y = pos[i * 2 + 1];
            }
          }
        }
        return;
      }
      // CPU fallback path
      const deleteChance = this.mcfg.deleteChance ?? 0.0;
      const toRemove = [];
      this.topLayerCircles.forEach((circle, i) => {
        const dx = circle.x - this.mouseX;
        const dy = circle.y - this.mouseY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < pushRadius && distance > 0) {
          if (Math.random() < deleteChance) {
            toRemove.push(i);
            return;
          }

          const pushForce = (pushRadius - distance) / pushRadius;

          // Randomized push from config
          const fMin = this.mcfg.forceVariationMin ?? 0.2;
          const fMax = this.mcfg.forceVariationMax ?? 1.8;
          const forceVariation = fMin + Math.random() * (fMax - fMin);
          const baseStrength = this.mcfg.pushStrengthBase ?? 10;
          const pushDistance = pushForce * baseStrength * forceVariation;

          const angleVariation = (Math.random() - 0.5) * (this.mcfg.angleVariationMaxRad ?? (Math.PI / 1.5)); // ± ~60°
          const baseAngle = Math.atan2(dy, dx);
          const randomAngle = baseAngle + angleVariation;

          const ndx = Math.cos(randomAngle);
          const ndy = Math.sin(randomAngle);

          const dMax = this.mcfg.driftMax ?? 4;
          const driftX = (Math.random() - 0.5) * dMax;
          const driftY = (Math.random() - 0.5) * dMax;

          if (Math.random() < (this.mcfg.randomKickChance ?? 0.1)) {
            const randomDirection = Math.random() * Math.PI * 2;
            const randomForce = Math.random() * (this.mcfg.randomKickMax ?? 15);
            circle.x += Math.cos(randomDirection) * randomForce;
            circle.y += Math.sin(randomDirection) * randomForce;
          } else {
            circle.x += ndx * pushDistance + driftX;
            circle.y += ndy * pushDistance + driftY;
          }

          // Clamp
          const clamped = this._clampToRegion({ x: circle.x, y: circle.y });
          circle.x = clamped.x;
          circle.y = clamped.y;
        }
      });
      // Remove deleted particles in reverse order to maintain indices
      for (let j = toRemove.length - 1; j >= 0; j--) {
        this.topLayerCircles.splice(toRemove[j], 1);
      }
    }

    // Receive processed brush positions from ThermalBrush
    onBrushPosition(pos) {
      if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
      this._lastBrushPos = { x: pos.x, y: pos.y };
      this.brushPositions.push(pos);
      // Reuse same interaction math by mapping brush position to our mouse coords
      this.mouseX = pos.x;
      this.mouseY = pos.y;
    }

    _tick() {
      // FPS
      const now = performance.now();
      this._frameCount++;
      if (now - this._lastTime >= 1000) {
        this._fps = Math.round((this._frameCount * 1000) / (now - this._lastTime));
        this._frameCount = 0;
        this._lastTime = now;
      }

      // Attempt deferred GPU particle init once GPU becomes available
      if (!this._gpuParticlesEnabled && this._gpuParticlesDesired) {
        this._tryInitGpuParticles();
      }

      this._updateCircles();
      this._renderFrame();
    }

    _renderFrame() {
      const ctx = this.ctx;
      if (this.backgroundImageData) {
        ctx.putImageData(this.backgroundImageData, 0, 0);
      } else {
        ctx.clearRect(0, 0, this.width, this.height);
      }

      // Draw contour overlay first
      if (this._contourCanvas) {
        ctx.drawImage(this._contourCanvas, 0, 0);
      }

      // Then draw top layer particles on top of contour
      if (this._renderTopOnGPU && this._gpuParticlesEnabled && this._gpu && this._gpu.supported) {
        // Ensure GPU canvas is sized
        if (!this._gpuCanvasLayer) {
          this._gpuCanvasLayer = this._gpu.canvas; // reuse GPUCompute's canvas
          this._gpuCanvasLayer.width = this.width;
          this._gpuCanvasLayer.height = this.height;
        }
        // Render particles directly on GPU canvas
        try {
          this._gpu.renderParticles({
            outerScale: this.vTop.outerScale ?? 1.3,
            darkScale: this.vTop.mainDarkScale ?? 0.3,
            highlightOffset: this.vTop.highlightOffsetScale ?? 0.3
          });
          // Composite onto background
          ctx.drawImage(this._gpuCanvasLayer, 0, 0);
        } catch (e) {
          console.warn('GPU particle render failed; falling back to CPU draw:', e);
          this._renderTopOnGPU = false;
          this._drawTopLayer();
        }
      } else {
        this._drawTopLayer();
      }

      if (this.showFPS) {
        ctx.fillStyle = 'white';
        ctx.font = '16px Arial';
        ctx.fillText(`FPS: ${this._fps}`, 10, 25);
      }
    }
  }

  // Add methods on prototype to keep constructor clean
  CustomBackground.prototype._tryInitGpuParticles = function() {
    try {
      if (!this._gpuParticlesDesired) return;
      if (this._gpuParticlesEnabled) return;
      if (typeof GPUCompute === 'undefined') return;

      // Reuse app-wide GPUCompute if available; else create local one
      this._gpu = (window.thermalBrush && window.thermalBrush.gpuCompute && window.thermalBrush.gpuCompute.supported)
        ? window.thermalBrush.gpuCompute
        : new GPUCompute(this.width, this.height);

      if (!this._gpu || !this._gpu.supported) return;

      const positions = new Float32Array(this.topLayerCircles.length * 2);
      for (let i = 0; i < this.topLayerCircles.length; i++) {
        positions[i * 2] = this.topLayerCircles[i].x;
        positions[i * 2 + 1] = this.topLayerCircles[i].y;
      }
      // Build per-circle radii/gray arrays for GPU render
      const radii = new Float32Array(this.topLayerCircles.length);
      const grays = new Float32Array(this.topLayerCircles.length);
      for (let i = 0; i < this.topLayerCircles.length; i++) {
        radii[i] = this.topLayerCircles[i].radius;
        grays[i] = this.topLayerCircles[i].grayValue;
      }

      this._gpu.initParticles(this.topLayerCircles.length, {
        positions,
        radii,
        grays,
        region: this._region.kind === 'rect'
          ? { type: 'rect', cx: this._region.cx, cy: this._region.cy, halfW: this._region.halfW, halfH: this._region.halfH }
          : { type: 'circle', cx: this._region.cx, cy: this._region.cy, r: this._region.r }
      });

      this._gpuParticlesEnabled = true;
      console.log('GPU particles enabled');
    } catch (e) {
      console.warn('GPU particles init failed, staying on CPU:', e);
      this._gpuParticlesEnabled = false;
    }
  };

  CustomBackground.prototype.updateContourOverlay = function(params) {
    // Update the contour overlay with thermal data, max data, and persistent mask
    // This function renders a grayscale representation of the thermal simulation
    // onto an offscreen canvas, which is then composited in _renderFrame
    if (!params) return;
    const {
      thermalData,  // 1D array of thermal values (width * height)
      maxData,      // 1D array of maximum thermal values seen at each pixel
      persistentMask, // 1D boolean array indicating persistent pixels
      width,        // Canvas width
      height,       // Canvas height
      threshold,    // Threshold value (not used in current grayscale mode)
      step = 1,     // Sampling step for normalization (sparsely sample for performance)
      persistentColor = (typeof BrushConfig !== 'undefined' && BrushConfig.visual?.contour?.persistentColor) ? BrushConfig.visual.contour.persistentColor : 'black'
    } = params;

    // Validate required inputs
    if (!thermalData || !width || !height || typeof threshold !== 'number') return;

    // Ensure offscreen contour canvas matches the current size
    if (this._contourCanvas.width !== width || this._contourCanvas.height !== height) {
      this._contourCanvas.width = width;
      this._contourCanvas.height = height;
      this._contourCtx = this._contourCanvas.getContext('2d');
    }

    const ctx = this._contourCtx;

    // Safe step for sparse sampling (used in normalization to avoid full scan)
    const safeStep = Math.max(1, step | 0);

    // Retrieve contour visualization configuration from BrushConfig
    const contourCfg = (typeof BrushConfig !== 'undefined' && BrushConfig.visual?.contour) ? BrushConfig.visual.contour : {};
    const thrMode = contourCfg.thresholdMode || 'color';  // Mode for threshold rendering ('grayscale' or 'color')
    const perMode = contourCfg.persistentMode || 'grayscale'; // Mode for persistent rendering
    const gamma = Math.max(0.001, contourCfg.grayGamma ?? 1.0); // Gamma correction for grayscale
    const grayMin = Math.max(0, Math.min(255, contourCfg.grayMin ?? 0)); // Min grayscale value
    const grayMax = Math.max(grayMin, Math.min(255, contourCfg.grayMax ?? 255)); // Max grayscale value
    const maxCeil = Math.max(0, contourCfg.grayMaxCeiling ?? 0); // Ceiling for max normalization

    // Compute normalization factor for maxData to map [0, maxNorm] to [0, 1]
    // Sample sparsely to reduce computation cost
    let maxNorm = 1.0;
    if (maxData) {
      let m = 0;
      for (let y = 0; y < height; y += safeStep) {
        const row = y * width;
        for (let x = 0; x < width; x += safeStep) {
          const v = maxData[row + x];
          if (v > m) m = v;
        }
      }
      if (maxCeil > 0) m = Math.min(m, maxCeil); // Apply ceiling if configured
      maxNorm = m || 1; // Avoid division by zero
    }

    // Create a new ImageData object to hold pixel data for the entire canvas
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data; // Uint8ClampedArray of RGBA values (4 per pixel)

    // Process every pixel to set its color based on contour rules
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x; // Linear index into thermal/max/persistent arrays
        const dataIdx = idx * 4;   // Index into ImageData (4 bytes per pixel: R, G, B, A)
        let r = 0, g = 0, b = 0, a = 0; // Default to transparent

        // Priority: persistent mask overrides other rendering
        if (persistentMask && persistentMask[idx]) {
          if (perMode === 'grayscale' && maxData) {
            // Render persistent pixels in grayscale based on maxData
            const v = maxData[idx];
            let norm = Math.max(0, Math.min(1, v / maxNorm)); // Normalize to [0,1]
            if (gamma !== 1.0) norm = Math.pow(norm, gamma);   // Apply gamma
            const gray = Math.floor(grayMin + (grayMax - grayMin) * norm); // Map to grayscale range
            r = g = b = gray;
            a = 255; // Opaque
          } else {
            // Render persistent pixels in solid color (assumed 'black' for simplicity)
            r = g = b = 0; // Black
            a = 255;
          }
        } else if (thrMode === 'grayscale' && maxData) {
          // Render non-persistent pixels in grayscale based on maxData
          const v = maxData[idx];
          let norm = Math.max(0, Math.min(1, v / maxNorm));
          if (gamma !== 1.0) norm = Math.pow(norm, gamma);
          const gray = Math.floor(grayMin + (grayMax - grayMin) * norm);
          r = g = b = gray;
          a = 255;
        }
        // If no conditions met, pixel remains transparent (r=g=b=a=0)

        // Set the RGBA values in the ImageData array
        data[dataIdx] = r;
        data[dataIdx + 1] = g;
        data[dataIdx + 2] = b;
        data[dataIdx + 3] = a;
      }
    }

    // Apply the updated pixel data to the contour canvas
    ctx.putImageData(imageData, 0, 0);
  };

  // UMD-style export to window
  window.CustomBackground = CustomBackground;
})();
