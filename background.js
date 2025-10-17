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
  // Contour overlay (offscreen canvas)
  this._contourCanvas = document.createElement('canvas');
  this._contourCanvas.width = this.width;
  this._contourCanvas.height = this.height;
  this._contourCtx = this._contourCanvas.getContext('2d');

      // FPS
      this._fps = 0;
      this._frameCount = 0;
      this._lastTime = performance.now();
      this._raf = null;

      // Init
      this._attachMouse();
      this._initTopLayer();
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
        // Only update interaction coordinates from the mouse in 'circles' mode
        if (this.interactionMode === 'circles') {
          this.mouseX = e.clientX - rect.left;
          this.mouseY = e.clientY - rect.top;
        }
        // In 'thermalBrush' mode, the brush drives us; don't push into the brush here to avoid double drawing
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
      this.topLayerCircles.forEach(circle => {
        // Shadow
  const sOff = this.vTop.shadowOffset ?? 5;
  const sIn = this.vTop.shadowAlphaInner ?? 0.6;
  const sOut = this.vTop.shadowAlphaOuter ?? 0.1;
  const shadowGradient = ctx.createRadialGradient(circle.x + sOff, circle.y + sOff, 0, circle.x + sOff, circle.y + sOff, circle.outerRadius);
  shadowGradient.addColorStop(0, `rgba(0, 0, 0, ${sIn})`);
  shadowGradient.addColorStop(1, `rgba(0, 0, 0, ${sOut})`);
        ctx.beginPath();
  ctx.arc(circle.x - sOff, circle.y - sOff, circle.outerRadius, 0, Math.PI * 2);
        ctx.fillStyle = shadowGradient;
        ctx.fill();

        // Main
  const hl = this.vTop.highlightOffsetScale ?? 0.3;
  const lightOffsetX = circle.x - circle.radius * hl;
  const lightOffsetY = circle.y - circle.radius * hl;
        const gradient = ctx.createRadialGradient(lightOffsetX, lightOffsetY, 0, circle.x, circle.y, circle.radius);
  const darkScale = this.vTop.mainDarkScale ?? 0.3;
  gradient.addColorStop(0, `rgb(${circle.grayValue}, ${circle.grayValue}, ${circle.grayValue})`);
  gradient.addColorStop(1, `rgb(${Math.floor(circle.grayValue * darkScale)}, ${Math.floor(circle.grayValue * darkScale)}, ${Math.floor(circle.grayValue * darkScale)})`);
        ctx.beginPath();
        ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      });
    }

    _updateCircles() {
      const pushRadius = this.pushRadius;
        this.topLayerCircles.forEach(circle => {
        const dx = circle.x - this.mouseX;
        const dy = circle.y - this.mouseY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < pushRadius && distance > 0) {
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
    }

    // Receive processed brush positions from ThermalBrush
    onBrushPosition(pos) {
      if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
      this._lastBrushPos = { x: pos.x, y: pos.y };
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
      this._drawTopLayer();

      // Draw contour overlay on top of baked circles and top-layer dots
      if (this._contourCanvas) {
        ctx.drawImage(this._contourCanvas, 0, 0);
      }

      if (this.showFPS) {
        ctx.fillStyle = 'white';
        ctx.font = '16px Arial';
        ctx.fillText(`FPS: ${this._fps}`, 10, 25);
      }
    }
  }

  // Add methods on prototype to keep constructor clean
  CustomBackground.prototype.updateContourOverlay = function(params) {
    if (!params) return;
    const {
      thermalData,
      maxData,
      persistentMask,
      width,
      height,
      threshold,
      step = 1,
      thresholdColor = (typeof BrushConfig !== 'undefined' && BrushConfig.visual?.contour?.thresholdColor) ? BrushConfig.visual.contour.thresholdColor : 'red',
      persistentColor = (typeof BrushConfig !== 'undefined' && BrushConfig.visual?.contour?.persistentColor) ? BrushConfig.visual.contour.persistentColor : 'black'
    } = params;

    if (!thermalData || !width || !height || typeof threshold !== 'number') return;

    // Ensure offscreen matches size
    if (this._contourCanvas.width !== width || this._contourCanvas.height !== height) {
      this._contourCanvas.width = width;
      this._contourCanvas.height = height;
      this._contourCtx = this._contourCanvas.getContext('2d');
    }

    const ctx = this._contourCtx;
    ctx.clearRect(0, 0, width, height);

    const safeStep = Math.max(1, step | 0);

    // Pull grayscale mapping params from config
    const contourCfg = (typeof BrushConfig !== 'undefined' && BrushConfig.visual?.contour) ? BrushConfig.visual.contour : {};
    const thrMode = contourCfg.thresholdMode || 'color';
    const perMode = contourCfg.persistentMode || 'grayscale';
    const gamma = Math.max(0.001, contourCfg.grayGamma ?? 1.0);
    const grayMin = Math.max(0, Math.min(255, contourCfg.grayMin ?? 0));
    const grayMax = Math.max(grayMin, Math.min(255, contourCfg.grayMax ?? 255));
    const maxCeil = Math.max(0, contourCfg.grayMaxCeiling ?? 0);

    // Compute normalization for max data
    // If maxData exists, map its range to [0, 1], with optional ceiling
    let maxNorm = 1.0;
    if (maxData) {
      let m = 0;
      // sample sparsely with safeStep to reduce cost
      for (let y = 0; y < height; y += safeStep) {
        const row = y * width;
        for (let x = 0; x < width; x += safeStep) {
          const v = maxData[row + x];
          if (v > m) m = v;
        }
      }
      if (maxCeil > 0) m = Math.min(m, maxCeil);
      maxNorm = m || 1;
    }

    // Render threshold hits, either in color or grayscale based on config
    for (let y = 0; y < height; y += safeStep) {
      const row = y * width;
      for (let x = 0; x < width; x += safeStep) {
        const idx = row + x;
        const t = thermalData[idx];
        if (t >= threshold) {
          if (thrMode === 'grayscale' && maxData) {
            const v = maxData[idx];
            let norm = Math.max(0, Math.min(1, v / maxNorm));
            if (gamma !== 1.0) norm = Math.pow(norm, gamma);
            const gray = Math.floor(grayMin + (grayMax - grayMin) * norm);
            ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
          } else {
            ctx.fillStyle = thresholdColor;
          }
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    ctx.globalAlpha = 1.0;

    // Draw persistent mask if provided; shade by per-pixel maxData if configured
    if (persistentMask) {
      for (let y = 0; y < height; y += safeStep) {
        const row = y * width;
        for (let x = 0; x < width; x += safeStep) {
          const idx = row + x;
          if (persistentMask[idx]) {
            if (perMode === 'grayscale' && maxData) {
              const v = maxData[idx];
              let norm = Math.max(0, Math.min(1, v / maxNorm));
              if (gamma !== 1.0) norm = Math.pow(norm, gamma);
              const gray = Math.floor(grayMin + (grayMax - grayMin) * norm);
              ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
            } else {
              ctx.fillStyle = persistentColor;
            }
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
    }
  };

  // UMD-style export to window
  window.CustomBackground = CustomBackground;
})();
