class ThermalBrush {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.width = BrushConfig.canvas.width;
        this.height = BrushConfig.canvas.height;
        
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
        this.maxPositionsPerFrame = BrushConfig.performance.maxPositionsPerFrame;
        
        // Frame counter for timing
        this.frameCounter = 0;
        
        // Smoothing properties
        this.smoothAlpha = BrushConfig.smoothing.alpha;
        this.prevSmooth = null;
        
        // Create brush
        this.brush = this.createFeatheredBrush(this.brushRadius);
        
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
        });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.draw(mouseEvent);
        });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopDrawing();
        });
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
    
    // Optimized Gaussian blur with pre-computed kernel and efficient memory access
    applyGaussianBlur() {
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
        // Persistently track peak temperature per pixel (independent of threshold)
        // and mark pixels that have ever crossed the threshold.
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
        const decayRate = BrushConfig.thermal.decayRate;
        for (let i = 0; i < this.thermalData.length; i++) {
            this.thermalData[i] *= decayRate;
        }
    }
    
    render() {
        const imageData = this.ctx.createImageData(this.width, this.height);
        const data = imageData.data;
        
        const overlayCfg = BrushConfig.visual?.overlay || { alphaMode: 'temperature', alphaScale: 1.0 };
        const mode = overlayCfg.alphaMode;
        const alphaScale = Math.max(0, Math.min(1, overlayCfg.alphaScale ?? 1.0));

        // Apply thermal colormap
        for (let i = 0; i < this.thermalData.length; i++) {
            const raw = this.thermalData[i];
            const color = this.thermalColormap(raw);
            const pixelIndex = i * 4;

            data[pixelIndex] = color.r;     // R
            data[pixelIndex + 1] = color.g; // G
            data[pixelIndex + 2] = color.b; // B

            let a;
            if (mode === 'opaque') {
                a = 255;
            } else { // 'temperature'
                const t = Math.max(0, Math.min(1, raw));
                a = Math.floor(255 * t * alphaScale);
            }
            data[pixelIndex + 3] = a;
        }
        
        this.ctx.putImageData(imageData, 0, 0);
        
        // Draw contours in background overlay instead of foreground
        if (window.bg && typeof window.bg.updateContourOverlay === 'function') {
            // Optional: throttle overlay updates using a frame interval; default to every frame if not configured
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
        
        // Update debug info
        this.updateDebugInfo();
    }
    
    // drawContours removed; contours are rendered by the background overlay
    
    updateDebugInfo() {
        const debug = document.getElementById('debug');
        const aboveThreshold = this.thermalData.filter(v => v >= this.threshold).length;
        const persistentArea = this.persistentMask.filter(v => v > 0).length;
        
        debug.innerHTML = `
            Queue: ${this.positionQueue.length}<br>
            Threshold: ${this.threshold.toFixed(2)}<br>
            Above Threshold: ${aboveThreshold}<br>
            Persistent Area: ${persistentArea}
        `;
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
            // Inform background of the actual applied position
            if (window.bg && typeof window.bg.onBrushPosition === 'function') {
                window.bg.onBrushPosition(pos);
            }
            processed++;
        }
        
        // Apply thermal decay
        this.applyThermalDecay();
        
        // Apply blur every few frames to maintain performance
        if (this.frameCounter % BrushConfig.thermal.blurInterval === 0) {
            this.applyGaussianBlur();
        }
        
        // Update persistent mask
        this.updatePersistentMask();
        
        // Render
        this.render();
        
        // Continue animation
        requestAnimationFrame(() => this.animate());
    }
}

// Start the app
window.thermalBrush = new ThermalBrush();

// Freeze current frame, overlay it, recreate background, then wipe overlay left-to-right
ThermalBrush.prototype.freezeFrameAndWipe = function() {

    if (this.tempBuffer) this.tempBuffer.fill(0);
    if (this.thermalData) this.thermalData.fill(0);

    // 1) Capture current composite view: draw bgCanvas + main canvas into overlay
    const bgCanvas = document.getElementById('bgCanvas');
    this.overlayCtx.clearRect(0, 0, this.width, this.height);
    if (bgCanvas) this.overlayCtx.drawImage(bgCanvas, 0, 0);
    this.overlayCtx.drawImage(this.canvas, 0, 0);
    if (this.persistentMask) this.persistentMask.fill(0);
    if (this.maxThresholded) this.maxThresholded.fill(0);



    // 2) Pause any further drawing by stopping background animation and setting a pause flag
    if (this._freezing) return;
    this._freezing = true;
    this._paused = true;
    if (window.bg && typeof window.bg.stop === 'function') {
        window.bg.stop();
    }

    // 2b) Reset all simulation arrays/state to zero so the new layer starts clean

    this.positionQueue.length = 0;
    this.lastPos = null;
    this.prevSmooth = null;
    this.isDrawing = false;
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