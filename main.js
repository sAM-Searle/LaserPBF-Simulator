class ThermalBrush {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.width = BrushConfig.canvas.width;
        this.height = BrushConfig.canvas.height;
        
        // Thermal data - using Float32Array for performance
        this.thermalData = new Float32Array(this.width * this.height);
        this.persistentMask = new Uint8Array(this.width * this.height);
        
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
        
        // Create brush
        this.brush = this.createFeatheredBrush(this.brushRadius);
        
        // Setup events
        this.setupEvents();
        
        // Start animation loop
        this.animate();
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
    
    addLinePositions(start, end) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
            const steps = Math.max(1, Math.ceil(distance));
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const x = Math.floor(start.x + dx * t);
                const y = Math.floor(start.y + dy * t);
                this.positionQueue.push({ x, y });
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
        this.thermalData[centerIndex] += this.brushIntensity * 2;
    }
    
    // Simple box blur (much faster than Gaussian on CPU)
    applyBoxBlur() {
        const temp = new Float32Array(this.thermalData.length);
        const radius = BrushConfig.thermal.blurRadius; // Small radius for performance
        
        // Horizontal pass
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                let sum = 0;
                let count = 0;
                
                for (let i = -radius; i <= radius; i++) {
                    const nx = x + i;
                    if (nx >= 0 && nx < this.width) {
                        sum += this.thermalData[y * this.width + nx];
                        count++;
                    }
                }
                temp[y * this.width + x] = sum / count;
            }
        }
        
        // Vertical pass
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                let sum = 0;
                let count = 0;
                
                for (let i = -radius; i <= radius; i++) {
                    const ny = y + i;
                    if (ny >= 0 && ny < this.height) {
                        sum += temp[ny * this.width + x];
                        count++;
                    }
                }
                this.thermalData[y * this.width + x] = sum / count;
            }
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
            const t = (value - BrushConfig.visual.colormap.secondTransition) / BrushConfig.visual.colormap.thirdTransition;
            return {
                r: 255,
                g: Math.floor(128 + 127 * t),
                b: Math.floor(255 * t)
            };
        }
    }
    
    updatePersistentMask() {
        for (let i = 0; i < this.thermalData.length; i++) {
            if (this.thermalData[i] >= this.threshold) {
                this.persistentMask[i] = 1;
            }
        }
    }
    
    render() {
        const imageData = this.ctx.createImageData(this.width, this.height);
        const data = imageData.data;
        
        // Apply thermal colormap
        for (let i = 0; i < this.thermalData.length; i++) {
            const color = this.thermalColormap(this.thermalData[i]);
            const pixelIndex = i * 4;
            
            data[pixelIndex] = color.r;     // R
            data[pixelIndex + 1] = color.g; // G
            data[pixelIndex + 2] = color.b; // B
            data[pixelIndex + 3] = 255;     // A
        }
        
        this.ctx.putImageData(imageData, 0, 0);
        
        // Draw contours (simplified for performance)
        this.drawContours();
        
        // Update debug info
        this.updateDebugInfo();
    }
    
    drawContours() {
        this.ctx.strokeStyle = BrushConfig.visual.contour.strokeColor;
        this.ctx.lineWidth = BrushConfig.visual.contour.lineWidth;
        
        // Simple contour detection - just draw points above threshold
        for (let y = 0; y < this.height; y += BrushConfig.performance.contourSkipPixels) { // Skip pixels for performance
            for (let x = 0; x < this.width; x += BrushConfig.performance.contourSkipPixels) {
                const index = y * this.width + x;
                if (this.thermalData[index] >= this.threshold) {
                    this.ctx.fillStyle = BrushConfig.visual.contour.thresholdColor;
                    this.ctx.fillRect(x, y, 1, 1);
                }
                if (this.persistentMask[index]) {
                    this.ctx.fillStyle = BrushConfig.visual.contour.persistentColor;
                    this.ctx.fillRect(x, y, 1, 1);
                }
            }
        }
    }
    
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
    
    animate() {
        // Process queue
        let processed = 0;
        while (this.positionQueue.length > 0 && processed < this.maxPositionsPerFrame) {
            const pos = this.positionQueue.shift();
            this.applyBrush(pos.x, pos.y);
            processed++;
        }
        
        // Apply blur every few frames to maintain performance
        if (Date.now() % BrushConfig.thermal.blurInterval === 0) { // Configurable interval
            this.applyBoxBlur();
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
new ThermalBrush();