class ThermalBrush {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.width = BrushConfig.canvas.width;
        this.height = BrushConfig.canvas.height;
        
        // Performance tracking
        this.performanceStats = {
            frameTime: 0,
            gpuTime: 0,
            lastFrameStart: 0,
            fps: 0,
            frameCount: 0,
            lastFpsTime: performance.now()
        };
        
        // Initialize GPU compute if available
        this.useGPU = false;
        this.gpuCompute = null;
        this.brushBatch = [];
        
        // Try GPU initialization if enabled
        if (BrushConfig.performance?.useGPU !== false) {
            try {
                if (typeof GPUCompute !== 'undefined') {
                    this.gpuCompute = new GPUCompute(this.width, this.height);
                    if (this.gpuCompute && this.gpuCompute.supported) {
                        this.useGPU = true;
                        this.maxBatchSize = BrushConfig.performance?.gpuBatchSize || 8;
                    }
                }
            } catch (error) {
                console.warn('GPU initialization failed, using CPU fallback:', error);
                this.useGPU = false;
                this.gpuCompute = null;
            }
        }
        
        console.log(`Using ${this.useGPU ? 'GPU' : 'CPU'} acceleration`);
        
        // Add GPU status display
        const gpuStatus = document.createElement('div');
        gpuStatus.id = 'gpuStatus';
        gpuStatus.style.cssText = 'position: absolute; top: 60px; left: 10px; color: white; font-family: monospace; background: rgba(0,0,0,0.8); padding: 5px; border-radius: 3px; z-index: 5; font-size: 12px;';
        gpuStatus.innerHTML = `GPU: ${this.useGPU ? '<span style="color: #4f4">Accelerated</span>' : '<span style="color: #ff4">CPU Mode</span>'}`;
        document.getElementById('stage').appendChild(gpuStatus);
        
        // Thermal data - using Float32Array for performance
        this.thermalData = new Float32Array(this.width * this.height);
        this.persistentMask = new Uint8Array(this.width * this.height);
    // Tracks the maximum intensity a pixel has reached while at/above threshold
    this.maxThresholded = new Float32Array(this.width * this.height);
        
        // Parameters from config
        this.brushRadius = BrushConfig.brush.radius;
        this.blurSigma = BrushConfig.thermal.blurSigma;
        this.threshold = BrushConfig.brush.threshold;
        this.brushIntensity = BrushConfig.brush.intensity;
        
        // Drawing state
        this.isDrawing = false;
        this.lastPos = null;
        this.positionQueue = [];
        this.brushPositions = [];
        this.particles = [];
        this.particleSprites = new Map();
        this.maxPositionsPerFrame = BrushConfig.performance.maxPositionsPerFrame;
        
        // Frame counter for timing
        this.frameCounter = 0;
        
        // Smoothing properties
        this.smoothAlpha = BrushConfig.smoothing.alpha;
        this.prevSmooth = null;
        
        // Always initialize CPU components (needed for fallback)
        this.brush = this.createFeatheredBrush(this.brushRadius);
        this.initializeGaussianKernel();
        
        // Setup events
        this.setupEvents();
        
        // Start animation loop
        this.animate();

        // Setup freeze/wipe overlay canvas
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.id = 'freezeOverlay';
        this.overlayCanvas.width = this.width;
        this.overlayCanvas.height = this.height;
        this.overlayCanvas.style.position = 'absolute';
        this.overlayCanvas.style.top = '0';
        this.overlayCanvas.style.left = '0';
        this.overlayCanvas.style.zIndex = '3';
        this.overlayCanvas.style.pointerEvents = 'none';
        document.getElementById('stage').appendChild(this.overlayCanvas);
        this.overlayCtx = this.overlayCanvas.getContext('2d');

        // Expose control to UI
        window.freezeFrameAndWipe = () => this.freezeFrameAndWipe();

        // Adaptive background throttling state
        this._slowFrameCount = 0;
        this._fastFrameCount = 0;
        this._bgPausedByAdaptive = false;
    }

    // Synchronize GPU buffers back into CPU arrays for rendering/metrics
    // Throttled by caller usage; kept lightweight and robust here
    syncFromGPU() {
        if (!this.useGPU || !this.gpuCompute || !this.gpuCompute.supported) return;
        // Download thermal field
        const thermal = this.gpuCompute.downloadThermalData();
        if (!thermal || thermal.length !== this.thermalData.length) {
            throw new Error('GPU thermal download failed or size mismatch');
        }
        this.thermalData.set(thermal);

        // Download max tracking (optional but used for contours)
        const maxData = this.gpuCompute.downloadMaxData();
        if (maxData && maxData.length === this.maxThresholded.length) {
            this.maxThresholded.set(maxData);
        }

        // Download persistent mask (optional for contours)
        const persistent = this.gpuCompute.downloadPersistentData();
        if (persistent && persistent.length === this.persistentMask.length) {
            this.persistentMask.set(persistent);
        }
    }
    
    createFeatheredBrush(radius) {
        const size = radius * 2 + 1;
        const brush = new Float32Array(size * size);
        const center = radius;
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - center;
                const dy = y - center;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance <= radius) {
                    const intensity = 1.0 - (distance / radius);
                    brush[y * size + x] = intensity;
                }
            }
        }
        return { data: brush, size };
    }
    
    setupEvents() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        
        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.startDrawing(mouseEvent);
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.draw(mouseEvent);
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopDrawing();
        }, { passive: false });
    }
    
    getEventPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: Math.floor((e.clientX - rect.left) * (this.width / rect.width)),
            y: Math.floor((e.clientY - rect.top) * (this.height / rect.height))
        };
    }
    
    startDrawing(e) {
        this.isDrawing = true;
        const pos = this.getEventPos(e);
        this.lastPos = pos;
        this.positionQueue.push(pos);
    }
    
    draw(e) {
        if (!this.isDrawing) return;
        
        const pos = this.getEventPos(e);
        this.addLinePositions(this.lastPos, pos);
        this.lastPos = pos;
    }
    
    stopDrawing() {
        this.isDrawing = false;
    }

    // Allow external components (e.g., background) to enqueue a draw position
    enqueuePosition(pos) {
        if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
        const x = Math.max(0, Math.min(this.width - 1, Math.floor(pos.x)));
        const y = Math.max(0, Math.min(this.height - 1, Math.floor(pos.y)));
        const last = this.positionQueue[this.positionQueue.length - 1];
        if (!last || last.x !== x || last.y !== y) {
            this.positionQueue.push({ x, y });
        }
    }
    
    addLinePositions(start, end) {
        if (BrushConfig.smoothing.useBresenham) {
            this.addLinePositionsBresenham(start, end);
        } else {
            this.addLinePositionsLinear(start, end);
        }
    }
    
    addLinePositionsBresenham(start, end) {
        let x0 = Math.floor(start.x);
        let y0 = Math.floor(start.y);
        let x1 = Math.floor(end.x);
        let y1 = Math.floor(end.y);
        
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        
        while (true) {
            // Apply EMA smoothing
            let smoothedPos;
            if (!this.prevSmooth) {
                smoothedPos = { x: x0, y: y0 };
                this.prevSmooth = smoothedPos;
            } else {
                const a = this.smoothAlpha;
                smoothedPos = {
                    x: Math.round(a * x0 + (1 - a) * this.prevSmooth.x),
                    y: Math.round(a * y0 + (1 - a) * this.prevSmooth.y)
                };
                this.prevSmooth = smoothedPos;
            }
            
            // Only add if position is different from the last one in queue
            const lastPos = this.positionQueue[this.positionQueue.length - 1];
            if (!lastPos || lastPos.x !== smoothedPos.x || lastPos.y !== smoothedPos.y) {
                this.positionQueue.push({ x: smoothedPos.x, y: smoothedPos.y });
            }
            
            // Check if we've reached the end point
            if (x0 === x1 && y0 === y1) break;
            
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }
    
    addLinePositionsLinear(start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= 0) return;

        const steps = Math.max(1, Math.ceil(distance));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = Math.floor(start.x + dx * t);
            const y = Math.floor(start.y + dy * t);

            // EMA smoothing
            if (!this.prevSmooth) {
                this.prevSmooth = { x, y };
            } else {
                const a = this.smoothAlpha;
                this.prevSmooth = {
                    x: Math.round(a * x + (1 - a) * this.prevSmooth.x),
                    y: Math.round(a * y + (1 - a) * this.prevSmooth.y),
                };
            }

            // Only add if position is different from the last one in queue
            const lastPos = this.positionQueue[this.positionQueue.length - 1];
            if (!lastPos || lastPos.x !== this.prevSmooth.x || lastPos.y !== this.prevSmooth.y) {
                this.positionQueue.push({ x: this.prevSmooth.x, y: this.prevSmooth.y });
            }
        }
    }
    
    applyBrush(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
        
        if (this.useGPU && this.gpuCompute && this.gpuCompute.supported) {
            try {
                // Batch brush applications for GPU
                this.brushBatch.push({ x, y });
                if (this.brushBatch.length >= this.maxBatchSize) {
                    this.flushBrushBatch();
                }
            } catch (error) {
                console.warn('GPU brush failed, falling back to CPU:', error);
                this.useGPU = false;
                this.applyBrushCPU(x, y);
            }
        } else {
            // CPU path
            this.applyBrushCPU(x, y);
        }
    }
    
    applyBrushCPU(x, y) {
        const brushSize = this.brushRadius * 2 + 1;
        const startX = Math.max(0, x - this.brushRadius);
        const endX = Math.min(this.width, x + this.brushRadius + 1);
        const startY = Math.max(0, y - this.brushRadius);
        const endY = Math.min(this.height, y + this.brushRadius + 1);
        
        for (let cy = startY; cy < endY; cy++) {
            for (let cx = startX; cx < endX; cx++) {
                const bx = cx - x + this.brushRadius;
                const by = cy - y + this.brushRadius;
                
                if (bx >= 0 && bx < brushSize && by >= 0 && by < brushSize) {
                    const brushIndex = by * brushSize + bx;
                    const canvasIndex = cy * this.width + cx;
                    this.thermalData[canvasIndex] += this.brush.data[brushIndex] * this.brushIntensity;
                }
            }
        }
        
        // Center dot
        const centerIndex = y * this.width + x;
        this.thermalData[centerIndex] += this.brushIntensity * BrushConfig.thermal.centerMultiplier;
    }
    
    flushBrushBatch() {
        if (!this.useGPU || !this.gpuCompute || this.brushBatch.length === 0) return;
        
        try {
            // Process all batched brush applications
            for (const brush of this.brushBatch) {
                this.gpuCompute.applyBrush(brush.x, brush.y, {
                    brushRadius: this.brushRadius,
                    brushIntensity: this.brushIntensity,
                    centerMultiplier: BrushConfig.thermal.centerMultiplier
                });
            }
        } catch (error) {
            console.warn('GPU batch flush failed, falling back to CPU:', error);
            this.useGPU = false;
            // Process remaining batch with CPU
            for (const brush of this.brushBatch) {
                this.applyBrushCPU(brush.x, brush.y);
            }
        }
        
        this.brushBatch.length = 0;
    }
    
    // Optimized Gaussian blur with GPU/CPU hybrid approach
    applyGaussianBlur() {
        if (this.useGPU && this.gpuCompute && this.gpuCompute.supported) {
            try {
                this.gpuCompute.applyGaussianBlur(this.blurSigma);
            } catch (error) {
                console.warn('GPU blur failed, falling back to CPU:', error);
                this.useGPU = false;
                this.applyGaussianBlurCPU();
            }
        } else {
            this.applyGaussianBlurCPU();
        }
    }
    
    applyGaussianBlurCPU() {
        if (!this.gaussianKernel) {
            this.initializeGaussianKernel();
        }
        
        if (!this.tempBuffer) {
            this.tempBuffer = new Float32Array(this.thermalData.length);
        }
        
        const kernel = this.gaussianKernel;
        const radius = this.gaussianRadius;
        const temp = this.tempBuffer;
        
        // Horizontal pass - optimized with bounds checking outside inner loop
        for (let y = 0; y < this.height; y++) {
            const rowOffset = y * this.width;
            
            for (let x = 0; x < this.width; x++) {
                let sum = 0;
                const startX = Math.max(0, x - radius);
                const endX = Math.min(this.width - 1, x + radius);
                
                // Use direct array access for better performance
                for (let nx = startX; nx <= endX; nx++) {
                    const weight = kernel[nx - x + radius];
                    sum += this.thermalData[rowOffset + nx] * weight;
                }
                
                temp[rowOffset + x] = sum;
            }
        }
        
        // Vertical pass - optimized with pre-calculated offsets
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                let sum = 0;
                const startY = Math.max(0, y - radius);
                const endY = Math.min(this.height - 1, y + radius);
                
                for (let ny = startY; ny <= endY; ny++) {
                    const weight = kernel[ny - y + radius];
                    sum += temp[ny * this.width + x] * weight;
                }
                
                this.thermalData[y * this.width + x] = sum;
            }
        }
    }
    
    initializeGaussianKernel() {
        const sigma = BrushConfig.thermal.blurSigma;
        this.gaussianRadius = Math.min(Math.ceil(sigma * BrushConfig.thermal.sigmaMultiplier), BrushConfig.thermal.maxGaussianRadius);
        const radius = this.gaussianRadius;
        
        this.gaussianKernel = new Float32Array(radius * 2 + 1);
        const twoSigmaSquared = 2 * sigma * sigma;
        let sum = 0;
        
        // Calculate kernel weights
        for (let i = -radius; i <= radius; i++) {
            const weight = Math.exp(-(i * i) / twoSigmaSquared);
            this.gaussianKernel[i + radius] = weight;
            sum += weight;
        }
        
        // Normalize kernel to prevent brightness changes
        for (let i = 0; i < this.gaussianKernel.length; i++) {
            this.gaussianKernel[i] /= sum;
        }
    }
    
    thermalColormap(value) {
        // Clamp to 0-1
        value = Math.max(0, Math.min(1, value));
        
        // Thermal colormap: gray -> red -> orange -> white
        if (value < BrushConfig.visual.colormap.firstTransition) {
            const t = value / BrushConfig.visual.colormap.firstTransition;
            return {
                r: Math.floor(128 + (255 - 128) * t),
                g: Math.floor(128 * (1 - t)),
                b: Math.floor(128 * (1 - t))
            };
        } else if (value < BrushConfig.visual.colormap.secondTransition) {
            const t = (value - BrushConfig.visual.colormap.firstTransition) / BrushConfig.visual.colormap.firstTransition;
            return {
                r: 255,
                g: Math.floor(128 * t),
                b: 0
            };
        } else {
            const remainingRange = 1.0 - BrushConfig.visual.colormap.secondTransition;
            const t = (value - BrushConfig.visual.colormap.secondTransition) / remainingRange;
            return {
                r: 255,
                g: Math.floor(128 + 127 * t),
                b: Math.floor(255 * t)
            };
        }
    }
    
    updatePersistentMask() {
        if (this.useGPU && this.gpuCompute && this.gpuCompute.supported) {
            try {
                this.gpuCompute.updateMaxTracking();
                this.gpuCompute.updatePersistentMask(this.threshold);
            } catch (error) {
                console.warn('GPU persistent mask failed, falling back to CPU:', error);
                this.useGPU = false;
                this.updatePersistentMaskCPU();
            }
        } else {
            this.updatePersistentMaskCPU();
        }
    }
    
    updatePersistentMaskCPU() {
        // CPU path - persistently track peak temperature per pixel
        const thr = this.threshold;
        const len = this.thermalData.length;
        for (let i = 0; i < len; i++) {
            const v = this.thermalData[i];
            if (v > this.maxThresholded[i]) {
                this.maxThresholded[i] = v;
            }
            if (v >= thr) {
                this.persistentMask[i] = 1;
            }
        }
    }
    
    applyThermalDecay() {
        if (this.useGPU && this.gpuCompute && this.gpuCompute.supported) {
            try {
                this.gpuCompute.applyDecay(BrushConfig.thermal.decayRate);
            } catch (error) {
                console.warn('GPU decay failed, falling back to CPU:', error);
                this.useGPU = false;
                this.applyThermalDecayCPU();
            }
        } else {
            this.applyThermalDecayCPU();
        }
    }
    
    applyThermalDecayCPU() {
        // CPU path
        const decayRate = BrushConfig.thermal.decayRate;
        for (let i = 0; i < this.thermalData.length; i++) {
            this.thermalData[i] *= decayRate;
        }
    }
    
    render() {
        // Sync GPU data to CPU for rendering, throttled by config to avoid stalling
        if (this.useGPU && this.gpuCompute && this.gpuCompute.supported) {
            const syncEvery = Math.max(1, BrushConfig.performance?.gpuSyncInterval || 1);
            const syncMasksEvery = Math.max(syncEvery, BrushConfig.performance?.gpuMaskSyncInterval || (syncEvery * 3));
            try {
                // Always keep thermal reasonably fresh
                if ((this.frameCounter % syncEvery) === 0) {
                    const thermal = this.gpuCompute.downloadThermalData();
                    if (thermal && thermal.length === this.thermalData.length) {
                        this.thermalData.set(thermal);
                    }
                }
                // Max/persistent are used for overlays; pull them less often
                if ((this.frameCounter % syncMasksEvery) === 0) {
                    const maxData = this.gpuCompute.downloadMaxData();
                    if (maxData && maxData.length === this.maxThresholded.length) {
                        this.maxThresholded.set(maxData);
                    }
                    const persistent = this.gpuCompute.downloadPersistentData();
                    if (persistent && persistent.length === this.persistentMask.length) {
                        this.persistentMask.set(persistent);
                    }
                }
            } catch (error) {
                console.warn('GPU render sync failed, using current CPU data:', error);
                this.useGPU = false;
            }
        }
        
        const imageData = this.ctx.createImageData(this.width, this.height);
        const data = imageData.data;
        
        const overlayCfg = BrushConfig.visual?.overlay || { alphaMode: 'temperature', alphaScale: 1.0 };
        const mode = overlayCfg.alphaMode;
        const alphaScale = Math.max(0, Math.min(1, overlayCfg.alphaScale ?? 1.0));

        // Apply thermal colormap (vectorized for better performance)
        const len = this.thermalData.length;
        for (let i = 0; i < len; i++) {
            const raw = this.thermalData[i];
            const color = this.thermalColormap(raw);
            const pixelIndex = i * 4;

            data[pixelIndex] = color.r;
            data[pixelIndex + 1] = color.g;
            data[pixelIndex + 2] = color.b;

            let a;
            if (mode === 'opaque') {
                a = 255;
            } else {
                const t = Math.max(0, Math.min(1, raw));
                a = Math.floor(255 * t * alphaScale);
            }
            data[pixelIndex + 3] = a;
        }
        
        this.ctx.putImageData(imageData, 0, 0);
        
        // Draw contours in background overlay
        if (window.bg && typeof window.bg.updateContourOverlay === 'function') {
            const interval = Math.max(1, (BrushConfig.performance && BrushConfig.performance.contourInterval) || 1);
            if ((this.frameCounter % interval) === 0) {
                window.bg.updateContourOverlay({
                    thermalData: this.thermalData,
                    maxData: this.maxThresholded,
                    persistentMask: this.persistentMask,
                    width: this.width,
                    height: this.height,
                    threshold: this.threshold,
                    step: Math.max(1, (BrushConfig.performance.contourSkipPixels | 0)),
                    thresholdColor: BrushConfig.visual.contour.thresholdColor,
                    persistentColor: BrushConfig.visual.contour.persistentColor
                });
            }
        }
        
        // Draw laser positions
        this.drawLaserPositions();
        
        // Update and draw particles
        const particleCfg = BrushConfig.visual?.particles || {};
        const fadeRate = particleCfg.fadeRate ?? 0.02;
        const size = particleCfg.size ?? 2;
        const recirculationFlow = particleCfg.recirculationFlow ?? 0;
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.vy += recirculationFlow; // Apply recirculation flow
            p.x += p.vx;
            p.y += p.vy;
            p.alpha -= fadeRate; // Fade out
            if (p.alpha <= 0 || p.x < -50 || p.x > this.width + 50 || p.y < -50 || p.y > this.height + 50) {
                this.particles.splice(i, 1);
                continue;
            }
            // Get or create sprite
            const key = `${p.color}_${size}`;
            if (!this.particleSprites.has(key)) {
                const cvs = document.createElement('canvas');
                cvs.width = size * 2;
                cvs.height = size * 2;
                const sctx = cvs.getContext('2d');
                sctx.fillStyle = `rgb(${p.color})`;
                sctx.beginPath();
                sctx.arc(size, size, size, 0, Math.PI * 2);
                sctx.fill();
                this.particleSprites.set(key, cvs);
            }
            this.ctx.save();
            this.ctx.globalAlpha = p.alpha;
            this.ctx.drawImage(this.particleSprites.get(key), p.x - size, p.y - size);
            this.ctx.restore();
        }
        
        // Add new particles from brush positions
        const numPerPosition = particleCfg.numPerPosition ?? 2.5;
        const velMin = particleCfg.velocity?.min ?? 1;
        const velMax = particleCfg.velocity?.max ?? 5;
        const colors = particleCfg.colors ?? ['234,130,11', '141,76,12', '255,255,255'];
        const startAlpha = particleCfg.startAlpha ?? 1;
        const maxParticles = particleCfg.maxParticles ?? 100;
        for (const pos of this.brushPositions) {
            const baseNum = Math.floor(numPerPosition);
            const extra = Math.random() < (numPerPosition - baseNum) ? 1 : 0;
            const numParticles = Math.max(1, baseNum + extra);
            for (let i = 0; i < numParticles; i++) {
                const angle = Math.random() * Math.PI * 2;
                const velocity = velMin + Math.random() * (velMax - velMin);
                this.particles.push({
                    x: pos.x,
                    y: pos.y,
                    vx: Math.cos(angle) * velocity,
                    vy: Math.sin(angle) * velocity,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    alpha: startAlpha
                });
            }
        }
        // Keep max particles
        while (this.particles.length > maxParticles) {
            this.particles.shift();
        }
        this.brushPositions = [];
        
        // Update debug info (throttled for performance)
        if (this.frameCounter % (BrushConfig.performance?.debugUpdateInterval || 15) === 0) {
            this.updateDebugInfo();
        }
    }
    
    // drawContours removed; contours are rendered by the background overlay
    
    updateDebugInfo() {
        const debug = document.getElementById('debug');
        if (!debug) return;
        
        // Cheaper debug computations: sample arrays instead of full scans
        const step = Math.max(1, BrushConfig.performance?.debugSampleStep || 1);
        let aboveThreshold = 0;
        let persistentArea = 0;
        let maxTemp = 0;
        for (let i = 0; i < this.thermalData.length; i += step) {
            const v = this.thermalData[i];
            if (v >= this.threshold) aboveThreshold++;
            if (v > maxTemp) maxTemp = v;
            if (this.persistentMask[i]) persistentArea++;
        }
        const frameTime = this.performanceStats?.frameTime || 0;
        const fps = this.performanceStats?.fps || 0;
        
        const gpuParticles = (window.bg && window.bg._gpuParticlesEnabled) ? 'On' : 'Off';
        const particleCount = (window.bg && Array.isArray(window.bg.topLayerCircles)) ? window.bg.topLayerCircles.length : 0;
        debug.innerHTML = `
            <div style="color: ${this.useGPU ? '#4f4' : '#ff4'}; font-weight: bold;">GPU: ${this.useGPU ? 'Accelerated' : 'CPU Mode'}</div>
            <div style="color: #4ff; font-weight: bold;">FPS: ${fps}</div>
            GPU Particles: ${gpuParticles} (${particleCount})<br>
            Queue: ${this.positionQueue.length}<br>
            Threshold: ${this.threshold.toFixed(2)}<br>
            Above Threshold: ${aboveThreshold}<br>
            Persistent Area: ${persistentArea}<br>
            Max Temp: ${maxTemp.toFixed(3)}<br>
            Frame Time: ${frameTime.toFixed(1)}ms
        `;

        // Also reflect GPU status in the small overlay created at startup
        const gpuStatus = document.getElementById('gpuStatus');
        if (gpuStatus) {
            gpuStatus.innerHTML = `GPU: ${this.useGPU ? '<span style="color: #4f4">Accelerated</span>' : '<span style=\"color: #ff4\">CPU Mode</span>'}`;
        }
    }
    
    drawLaserPositions(){
        if (this.positionQueue.length === 0) return;
        
        this.ctx.save();
        this.ctx.fillStyle = BrushConfig.visual.laser.color;
        this.ctx.globalAlpha = BrushConfig.visual.laser.alpha;
        
        const radius = BrushConfig.visual.laser.radius;
        
        // Draw a dot for each position in the queue
        for (const pos of this.positionQueue) {
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
            this.ctx.fill();
        }
        
        this.ctx.restore();
    }



    animate() {
        // Performance timing
        const frameStart = performance.now();
        
        // If paused (during freeze & wipe), skip all updates but keep the RAF loop alive
        if (this._paused) {
            requestAnimationFrame(() => this.animate());
            return;
        }

        this.frameCounter++;
        
        // Process queue
        let processed = 0;
        while (this.positionQueue.length > 0 && processed < this.maxPositionsPerFrame) {
            const pos = this.positionQueue.shift();
            this.applyBrush(pos.x, pos.y);
            this.brushPositions.push(pos);
            
            if (window.bg && typeof window.bg.onBrushPosition === 'function') {
                window.bg.onBrushPosition(pos);
            }
            processed++;
        }
        
        // Flush any remaining brush batch for GPU
        if (this.useGPU) {
            this.flushBrushBatch();
        }
        
        // Apply thermal decay
        this.applyThermalDecay();
        
        // Apply blur every few frames
        if (this.frameCounter % BrushConfig.thermal.blurInterval === 0) {
            this.applyGaussianBlur();
        }
        
        // Update persistent mask
        this.updatePersistentMask();
        
        // Clamp thermal data to 0-1 to prevent overflow
        for (let i = 0; i < this.thermalData.length; i++) {
            this.thermalData[i] = Math.max(0, Math.min(1, this.thermalData[i]));
        }
        
        // Render
        this.render();
        
        // Update performance stats
        const frameEnd = performance.now();
        this.performanceStats.frameTime = frameEnd - frameStart;
        this.performanceStats.lastFrameStart = frameStart;

        // Adapt background animation based on CPU frame time
        const pauseBg = BrushConfig.performance?.pauseBackgroundOnSlowCPU;
        const slowMs = Math.max(1, BrushConfig.performance?.slowCpuFrameMs ?? 22);
        if (pauseBg && window.bg && typeof window.bg.start === 'function' && typeof window.bg.stop === 'function') {
            if (this.performanceStats.frameTime > slowMs) {
                this._slowFrameCount++;
                this._fastFrameCount = 0;
            } else {
                this._fastFrameCount++;
                if (this._slowFrameCount > 0) this._slowFrameCount--;
            }

            // Hysteresis: pause after 10 consecutive slow frames; resume after 60 fast frames
            if (!this._bgPausedByAdaptive && this._slowFrameCount >= 10) {
                window.bg.stop();
                this._bgPausedByAdaptive = true;
            } else if (this._bgPausedByAdaptive && this._fastFrameCount >= 60) {
                window.bg.start();
                this._bgPausedByAdaptive = false;
                this._fastFrameCount = 0;
            }
        }
        
        // Calculate FPS
        this.performanceStats.frameCount++;
        const now = frameEnd;
        if (now - this.performanceStats.lastFpsTime >= 1000) {
            this.performanceStats.fps = this.performanceStats.frameCount;
            this.performanceStats.frameCount = 0;
            this.performanceStats.lastFpsTime = now;
        }
        
        requestAnimationFrame(() => this.animate());
    }
}

// Start the app
window.thermalBrush = new ThermalBrush();

// Freeze current frame, overlay it, recreate background, then wipe overlay left-to-right
ThermalBrush.prototype.freezeFrameAndWipe = function() {
    if (this._freezing) return;
    this._freezing = true;

    // Sync GPU data before clearing
    if (this.useGPU && this.gpuCompute && this.gpuCompute.supported) {
        try {
            this.syncFromGPU();
        } catch (error) {
            console.warn('GPU freeze sync failed:', error);
            this.useGPU = false;
        }
    }

    // 1) Capture current composite view: draw bgCanvas + main canvas into overlay
    const bgCanvas = document.getElementById('bgCanvas');
    this.overlayCtx.clearRect(0, 0, this.width, this.height);
    if (bgCanvas) this.overlayCtx.drawImage(bgCanvas, 0, 0);
    this.overlayCtx.drawImage(this.canvas, 0, 0);



    // 2) Pause any further drawing by stopping background animation and setting a pause flag
    this._paused = true;
    if (window.bg && typeof window.bg.stop === 'function') {
        window.bg.stop();
    }

    // 2b) Reset all simulation arrays/state to zero so the new layer starts clean
    if (this.tempBuffer) this.tempBuffer.fill(0);
    if (this.thermalData) this.thermalData.fill(0);
    if (this.persistentMask) this.persistentMask.fill(0);
    if (this.maxThresholded) this.maxThresholded.fill(0);
    this.positionQueue.length = 0;
    this.lastPos = null;
    this.prevSmooth = null;
    this.isDrawing = false;
    
    // Clear GPU data as well
    if (this.useGPU && this.gpuCompute && this.gpuCompute.supported) {
        try {
            this.gpuCompute.clear();
            this.brushBatch.length = 0;
        } catch (error) {
            console.warn('GPU clear failed:', error);
            this.useGPU = false;
        }
    }
    
    // Clear the foreground canvas so no old frame remains under the overlay
    this.ctx.clearRect(0, 0, this.width, this.height);
    // Clear background contour overlay so no old contours persist
    if (window.bg && window.bg._contourCtx && window.bg._contourCanvas) {
        window.bg._contourCtx.clearRect(0, 0, window.bg._contourCanvas.width, window.bg._contourCanvas.height);
    }

    // 3) Recreate a fresh background (clear and redraw baked layer and top circles)
    if (window.bg && typeof window.bg._drawBackground === 'function') {
        // Reset top layer circles, redraw background, and restart animation loop paused
        if (Array.isArray(window.bg.topLayerCircles)) window.bg.topLayerCircles.length = 0;
        if (typeof window.bg._initTopLayer === 'function') window.bg._initTopLayer();
        window.bg._drawBackground();
    }

    // 4) Wipe overlay from left to right to reveal new background and resumed simulation rendering beneath
    const totalWidth = this.width;
    let wiped = 0;
    const wipeStep = Math.max(1, Math.floor(totalWidth / 120)); // ~2s at 60fps
    const wipe = () => {
        // Clear a vertical strip from overlay
        this.overlayCtx.clearRect(wiped, 0, wipeStep, this.height);
        wiped += wipeStep;
        if (wiped < totalWidth) {
            requestAnimationFrame(wipe);
        } else {
            // Done wiping: remove overlay image entirely
            this.overlayCtx.clearRect(0, 0, this.width, this.height);
            this._paused = false;
            if (window.bg && typeof window.bg.start === 'function') {
                window.bg.start();
            }
            this._freezing = false;
        }
    };
    requestAnimationFrame(wipe);
};