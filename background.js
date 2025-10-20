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

    // Public API
    this.start = () => {
      if (this._raf) return;
      const loop = () => {
        this._raf = requestAnimationFrame(loop);
        this._tick();
      };
      this._raf = requestAnimationFrame(loop);
    };

    this.stop = () => {
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
    };

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
  // Pointer state: true while pointer is pressed (mouse down / touch active)
  this._pointerDown = false;
      this.topLayerCircles = [];
      this.backgroundImageData = null;
  this._lastBrushPos = null;
  this.brushPositions = [];
  // Contour overlay (offscreen canvas)
// ...existing code...
    // in the constructor near contour canvas init
    this._contourCanvas = document.createElement('canvas');
    this._contourCanvas.width = this.width;
    this._contourCanvas.height = this.height;
    this._contourCtx = this._contourCanvas.getContext('2d');
   this._contourImageData = this._contourCtx.createImageData(this.width, this.height);
   //initialise normalisation cache _prepareContourConfig
   this._contourCache = null;
   this._prepareContourConfig(bgCfg.contour);


// ...existing code...
  // Sprite caches for prerendered top-layer circles
  this._spritesCfg = (typeof BrushConfig !== 'undefined' && BrushConfig.background?.sprites) ? BrushConfig.background.sprites : { enabled: true, radiusStep: 0.5, grayStep: 5 };
  this._spriteCacheTopShadow = new Map(); // key: radiusQ|outerScale|shadow params
  this._spriteCacheTopMain = new Map();   // key: radiusQ|grayQ|darkScale|hl

      // FPS
      this._fps = 0;
      this._frameCount = 0;
      this._lastTime = performance.now();
      this._raf = null;
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
        // Only handle mouse movement when pointer is pressed (ignore hover)
        if (!this._pointerDown && (e.buttons === 0)) return;

        const rect = this.canvas.getBoundingClientRect();
        // Update local interaction coordinates for visuals only
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        // Do NOT forward these positions to ThermalBrush here. ThermalBrush
        // will call `window.bg.onBrushPosition(pos)` with brush-driven positions.
      });

      document.addEventListener('mouseleave', () => {
        this._lastUserPos = null;
      });

      // Pointer down/up to track pressed state (covers mouse/touch/pen)
      document.addEventListener('pointerdown', (e) => {
        this._pointerDown = true;
      });
      document.addEventListener('pointerup', (e) => {
        this._pointerDown = false;
      });
      document.addEventListener('pointercancel', (e) => {
        this._pointerDown = false;
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
      // Use the last brush-provided position; if none, default to region center
      const center = this._lastBrushPos ? { x: this._lastBrushPos.x, y: this._lastBrushPos.y } : { x: this._region.cx, y: this._region.cy };
      if (this._gpuParticlesEnabled && this._gpu && this._gpu.supported) {
        // Advance on GPU using brush-driven push center
        const params = {
          pushCenter: { x: center.x, y: center.y },
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
        const dx = circle.x - center.x;
        const dy = circle.y - center.y;
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
CustomBackground.prototype._prepareContourConfig = function(params) {
  // params may be a contour params object or an update call containing width/height/maxData
  const p = params || {};
  const width = p.width || this.width;
  const height = p.height || this.height;
  const step = (p.step == null) ? 1 : (p.step | 0) || 1;
  const maxData = p.maxData || null;

  // Serialize contour config to detect changes
  const contourCfgRaw = (typeof BrushConfig !== 'undefined' && BrushConfig.visual?.contour) ? BrushConfig.visual.contour : {};
  const cfgStr = JSON.stringify(contourCfgRaw);

  // If cache missing or size/config/step changed, recompute cached static fields
  const cache = this._contourCache || {};
  if (!cache._cfgStr || cache._cfgStr !== cfgStr || cache.width !== width || cache.height !== height || cache.step !== step) {
    const contourCfg = contourCfgRaw;
    const thrMode = contourCfg.thresholdMode || 'color';
    const perMode = contourCfg.persistentMode || 'grayscale';
    const gamma = Math.max(0.001, contourCfg.grayGamma ?? 1.0);
  const grayMin = Math.max(0, Math.min(255, Number.isFinite(contourCfg.grayMin) ? contourCfg.grayMin : 0));
  const grayMax = Math.max(grayMin, Math.min(255, Number.isFinite(contourCfg.grayMax) ? contourCfg.grayMax : 255));
  const alphaScale = Math.max(0, Math.min(1, Number.isFinite(contourCfg.alphaScale) ? contourCfg.alphaScale : 1.0));
    const maxCeil = Math.max(0, contourCfg.grayMaxCeiling ?? 0);
    const safeStep = Math.max(1, step | 0);

    this._contourCache = {
      _cfgStr: cfgStr,
      width, height, step: safeStep,
      thrMode, perMode, gamma, grayMin, grayMax, maxCeil, alphaScale,
      // intensity range used for normalization; default 0..1 until we compute from data
      intensityMin: 0,
      intensityMax: 1,
      maxNorm: cache.maxNorm || 1
    };
  }

  // If caller provided maxData (dense array of intensities) compute observed max for better normalization
  if (maxData && maxData.length === width * height) {
    let maxV = 0;
    let minV = Infinity;
    for (let i = 0; i < maxData.length; i++) {
      const v = maxData[i];
      if (!Number.isFinite(v)) continue;
      if (v > maxV) maxV = v;
      if (v < minV) minV = v;
    }
    if (!Number.isFinite(minV) || minV === Infinity) minV = 0;
    if (maxV <= 0) maxV = Math.max(1, cache.maxNorm || 1);
    this._contourCache.intensityMin = minV;
    this._contourCache.intensityMax = maxV;
    this._contourCache.maxNorm = maxV;
  }

  return this._contourCache;
};
  CustomBackground.prototype.convertIntensityToGray = function (value) {
    if (value == null) return 0;
    const cache = this._contourCache || {};
    const grayMin = Number.isFinite(cache.grayMin) ? cache.grayMin : 0;
    const grayMax = Number.isFinite(cache.grayMax) ? cache.grayMax : 255;
    const gamma = Number.isFinite(cache.gamma) ? cache.gamma : 1.0;
    const iMin = Number.isFinite(cache.intensityMin) ? cache.intensityMin : 0;
    const iMax = Number.isFinite(cache.intensityMax) ? cache.intensityMax : 1;

    let norm = (Number(value) - iMin) / (iMax - iMin);
    if (!Number.isFinite(norm)) norm = 0;
    norm = Math.max(0, Math.min(1, norm));

    if (gamma !== 1.0) norm = Math.pow(norm, gamma);

    const gray = Math.round(grayMin + (grayMax - grayMin) * norm);
    return Math.max(0, Math.min(255, gray));
  };

  CustomBackground.prototype.updateContourOverlay = function(params) {
    // Convert thermal/molten intensity data to grayscale and draw to offscreen contour canvas
    if (!params) return;
    const width = params.width || this.width;
    const height = params.height || this.height;
    const molten = params.molten_pixels || params.maxData || null;
    // Ensure contour cache is up-to-date (allow maxData to inform normalization)
    this._prepareContourConfig({ width, height, step: params.step, maxData: molten });

    // Fill the image buffer
    const out = this._contourImageData.data; // Uint8ClampedArray
    let di = 0;
    const n = width * height;

    for (let i = 0; i < n; i++) {
      const v = molten[i];
      if (v>0){
      const gray = this.convertIntensityToGray(v);
      out[di++] = gray;
      out[di++] = gray;
      out[di++] = gray;
      // Set alpha proportional to normalized intensity (avoid fully opaque black areas)
      const cache = this._contourCache || {};
      const iMin = Number.isFinite(cache.intensityMin) ? cache.intensityMin : 0;
      const iMax = Number.isFinite(cache.intensityMax) ? cache.intensityMax : 1;
      let alphaNorm = 0;
      if (iMax > iMin) alphaNorm = Math.max(0, Math.min(1, (v - iMin) / (iMax - iMin)));
      const scale = (cache && typeof cache.alphaScale === 'number') ? cache.alphaScale : 1.0;
      out[di++] = 255;}//Math.round(255 * alphaNorm * scale);}
      else {  
        di++;di++;di++;di++;
      }
    }
    this._contourCtx.putImageData(this._contourImageData, 0, 0);
  };

  // Export globally and close IIFE
  window.CustomBackground = CustomBackground;
})();
