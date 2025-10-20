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

        // Tracks whether a pixel is currently at/above threshold (boolean as 0/1)
        this.aboveThreshold = new Uint8Array(this.width * this.height);
        // Tracks the maximum intensity a pixel has reached while at/above threshold
        this.maxThresholded = new Float32Array(this.width * this.height);
        this.maxMolten = new Float32Array(this.width * this.height);
        this.isThereMolten = false;
        // Parameters from config
        this.brushRadius = BrushConfig.brush.radius;
        this.blurSigma = BrushConfig.thermal.blurSigma;
        this.threshold = BrushConfig.brush.threshold;
        this.brushIntensity = BrushConfig.brush.intensity;
        // centerMultiplier may have been removed from config; provide a sensible default
        this.centerMultiplier = (BrushConfig.thermal && typeof BrushConfig.thermal.centerMultiplier === 'number') ? BrushConfig.thermal.centerMultiplier : 1.0;
        
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
    // Precompute diffused brush variants (Gaussian-blur of base kernel)
    this.maxPositionsPerFrame = Math.max(1, BrushConfig.performance?.maxPositionsPerFrame || 1);
    this.brushVariants = [];
    this.brushVariantRadii = [];

    // Precompute per-step decay factor so we can bake it into brush variants
    const configuredDecay = (BrushConfig.thermal && typeof BrushConfig.thermal.decayRate === 'number') ? BrushConfig.thermal.decayRate : 1.0;
    this._configuredDecay = configuredDecay;
    this._stepDecay = Math.pow(configuredDecay, 1 / Math.max(1, this.maxPositionsPerFrame));

    try {
            const base = this.brush;

            // We'll create variants by computing a single padded separable gaussian blur of the base kernel
            // and linearly interpolating intermediate variants between the base and the blurred result.
            if (!this.gaussianKernel) this.initializeGaussianKernel();
            // Create one maximum-blur variant (single pass with padding equal to kernel radius)
            const blurredMax = this.createBlurredVariant(base);
            const outSize = blurredMax.size;

            // Create padded base array matching outSize
            const pad = Math.floor((outSize - base.size) / 2);
            const basePadded = new Float32Array(outSize * outSize);
            for (let by = 0; by < base.size; by++) {
                for (let bx = 0; bx < base.size; bx++) {
                    basePadded[(by + pad) * outSize + (bx + pad)] = base.data[by * base.size + bx];
                }
            }

            for (let i = 0; i < this.maxPositionsPerFrame; i++) {
                const t = (this.maxPositionsPerFrame === 1) ? 0 : (i / (this.maxPositionsPerFrame - 1));
                // Interpolate between basePadded and blurredMax.data
                const data = new Float32Array(outSize * outSize);
                for (let k = 0; k < data.length; k++) {
                    data[k] = basePadded[k] * (1 - t) + blurredMax.data[k] * t;
                }

                // Bake step-decay scaling into the precomputed variant so we don't need to
                // multiply the entire thermal field per-position in the animate loop.
                const variantDecayScale = Math.pow(this._stepDecay, i);
                if (variantDecayScale !== 1.0) {
                    for (let k = 0; k < data.length; k++) data[k] *= variantDecayScale;
                }

                this.brushVariants.push({ data, size: outSize });
                this.brushVariantRadii.push(Math.floor((outSize - 1) / 2));
            }
        } catch (e) {
            // fallback: single variant equals base
            this.brushVariants = [ this.brush ];
            this.brushVariantRadii = [ this.brushRadius ];
        }

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

    // Create a blurred variant of a square brush kernel using the precomputed separable gaussian kernel
    // Performs a single padded separable convolution and returns the padded blurred result
    createBlurredVariant(baseBrush) {
        // baseBrush: { data: Float32Array, size: number }
        const baseSize = baseBrush.size;
        const kernel = this.gaussianKernel;
        const kRadius = Math.floor(kernel.length / 2);

        // Pad by kernel radius so blurred output can expand naturally
        const pad = kRadius;
        const outSize = baseSize + pad * 2;

        // Create padded source and copy base brush into the center
        const src = new Float32Array(outSize * outSize);
        for (let by = 0; by < baseSize; by++) {
            for (let bx = 0; bx < baseSize; bx++) {
                src[(by + pad) * outSize + (bx + pad)] = baseBrush.data[by * baseSize + bx];
            }
        }

        const temp = new Float32Array(outSize * outSize);
        const out = new Float32Array(outSize * outSize);

        // Horizontal pass: src -> temp
        for (let y = 0; y < outSize; y++) {
            for (let x = 0; x < outSize; x++) {
                let s = 0;
                const startX = Math.max(0, x - kRadius);
                const endX = Math.min(outSize - 1, x + kRadius);
                for (let nx = startX; nx <= endX; nx++) {
                    const kIdx = nx - x + kRadius;
                    s += src[y * outSize + nx] * kernel[kIdx];
                }
                temp[y * outSize + x] = s;
            }
        }

        // Vertical pass: temp -> out
        for (let y = 0; y < outSize; y++) {
            for (let x = 0; x < outSize; x++) {
                let s = 0;
                const startY = Math.max(0, y - kRadius);
                const endY = Math.min(outSize - 1, y + kRadius);
                for (let ny = startY; ny <= endY; ny++) {
                    const kIdx = ny - y + kRadius;
                    s += temp[ny * outSize + x] * kernel[kIdx];
                }
                out[y * outSize + x] = s;
            }
        }

        return { data: out, size: outSize };
    }
    
    setupEvents() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());

        // // Pointer events (more reliable across devices and when the pointer leaves the element)
        // this.canvas.addEventListener('pointerdown', (e) => {
        //     // Try to capture the pointer so we keep receiving events even if the cursor leaves the canvas
        //     try { this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
        //     this.startDrawing(e);
        // });
        // this.canvas.addEventListener('pointermove', (e) => this.draw(e));
        // this.canvas.addEventListener('pointerup', (e) => {
        //     try { this.canvas.releasePointerCapture && this.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
        //     this.stopDrawing();
        // });

        // Ensure we stop drawing if pointer/mouse is released anywhere in the document
        document.addEventListener('pointerup', () => this.stopDrawing());
        
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
            // CPU path: pick a precomputed variant based on current queue length or a round-robin index
            // Caller (animate) will pass variant -> fallback here to base
            this.applyBrushCPU(x, y, this.brush);
        }
    }
    
    applyBrushCPU(x, y, brushObj) {
        // brushObj is expected to be { data: Float32Array, size: number }
        const brush = brushObj || this.brush;
        const brushSizeLocal = brush.size;
        // Derive local radius from the brush size
        const localRadius = Math.floor((brushSizeLocal - 1) / 2);

        // Compute bounds using localRadius so larger/smaller variants are applied correctly
        const startX = Math.max(0, x - localRadius);
        const endX = Math.min(this.width, x + localRadius + 1);
        const startY = Math.max(0, y - localRadius);
        const endY = Math.min(this.height, y + localRadius + 1);

        for (let cy = startY; cy < endY; cy++) {
            for (let cx = startX; cx < endX; cx++) {
                const bx = cx - x + localRadius;
                const by = cy - y + localRadius;

                if (bx >= 0 && bx < brushSizeLocal && by >= 0 && by < brushSizeLocal) {
                    const brushIndex = by * brushSizeLocal + bx;
                    const canvasIndex = cy * this.width + cx;
                    // Apply brush influence scaled by configured intensity
                    this.thermalData[canvasIndex] += brush.data[brushIndex] * this.brushIntensity;
                }
            }
        }

        // Center dot: ensure we still use the exact x,y canvas index
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            const centerIndex = y * this.width + x;
            this.thermalData[centerIndex] += this.brushIntensity * this.centerMultiplier;
        }
    }
    
    flushBrushBatch() {
        if (!this.useGPU || !this.gpuCompute || this.brushBatch.length === 0) return;
        
        try {
            // Process all batched brush applications
            for (const brush of this.brushBatch) {
                // Determine radius from variant if present
                const variantIdx = (typeof brush.variant === 'number') ? Math.max(0, Math.min(this.brushVariants.length - 1, brush.variant)) : 0;
                const variantRadius = this.brushVariantRadii[variantIdx] || this.brushRadius;
                this.gpuCompute.applyBrush(brush.x, brush.y, {
                    brushRadius: variantRadius,
                    brushIntensity: this.brushIntensity,
                    centerMultiplier: this.centerMultiplier,
                    variantIndex: variantIdx
                });
            }
        } catch (error) {
            console.warn('GPU batch flush failed, falling back to CPU:', error);
            this.useGPU = false;
            // Process remaining batch with CPU
            for (const b of this.brushBatch) {
                const vi = (typeof b.variant === 'number') ? Math.max(0, Math.min(this.brushVariants.length - 1, b.variant)) : 0;
                const vb = this.brushVariants[vi] || this.brush;
                this.applyBrushCPU(b.x, b.y, vb);
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
        // Use configured multipliers when present, otherwise fall back to reasonable defaults
        const sigmaMultiplier = (BrushConfig.thermal && typeof BrushConfig.thermal.sigmaMultiplier === 'number') ? BrushConfig.thermal.sigmaMultiplier : 2.5;
        const maxGaussianRadius = (BrushConfig.thermal && typeof BrushConfig.thermal.maxGaussianRadius === 'number') ? BrushConfig.thermal.maxGaussianRadius : 30;
        this.gaussianRadius = Math.min(Math.ceil(sigma * sigmaMultiplier), maxGaussianRadius);
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
        this.updatePersistentMaskCPU();
    }
    
    updatePersistentMaskCPU() {
        // CPU path - persistently track peak temperature per pixel
        const thr = this.threshold;
        const len = this.thermalData.length;
        this.isThereMolten = false;
        for (let i = 0; i < len; i++) {
            const v = this.thermalData[i];
            if (v > this.maxThresholded[i]) {
                this.maxThresholded[i] = v;
            }
            if (v >= thr) {
                this.isThereMolten = true;
                this.persistentMask[i] = 1;

                if (v > this.maxMolten[i]) {
                 this.maxMolten[i] = v;
                }
            }
            
            if (v < thr) {
                this.maxMolten[i] = 0;
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
                // Persistent mask is pulled less often; max tracking handled on CPU
                if ((this.frameCounter % syncMasksEvery) === 0) {
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
        if (window.bg && typeof window.bg.updateContourOverlay === 'function'&& this.isThereMolten) {
            window.bg.updateContourOverlay({
                width: this.width,
                height: this.height,
                molten_pixels: this.maxMolten,
         });
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
            // Select variant based on processed index (clamped)
            const variantIndex = Math.min(processed, this.brushVariants.length - 1);
            const variantBrush = this.brushVariants[variantIndex] || this.brush;

            if (this.useGPU && this.gpuCompute && this.gpuCompute.supported) {
                // Include variant index so GPU flush can decide behavior if desired
                this.brushBatch.push({ x: pos.x, y: pos.y, variant: variantIndex });
                if (this.brushBatch.length >= this.maxBatchSize) this.flushBrushBatch();
            } else {
                // CPU path: apply using the precomputed variant
                this.applyBrushCPU(pos.x, pos.y, variantBrush);
            }

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

        // Always apply the configured full-frame decay once per frame (now handled centrally in animate)
        if (this._configuredDecay && this._configuredDecay !== 1.0) {
            this.applyThermalDecay();
        }
        
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
    if (this.aboveThreshold) this.aboveThreshold.fill(0);
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