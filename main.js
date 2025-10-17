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
        this.smoothedPos = null;  // EMA smoothed position
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
        const brushType = BrushConfig.brush.type;
        const falloffPower = BrushConfig.brush.falloffPower;
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - center;
                const dy = y - center;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance <= radius) {
                    let intensity;
                    if (brushType === 'gaussian') {
                        // Gaussian falloff
                        const sigma = radius / 3;
                        intensity = Math.exp(-(distance * distance) / (2 * sigma * sigma));
                    } else {
                        // Linear falloff
                        intensity = 1.0 - (distance / radius);
                    }
                    
                    // Apply falloff power for edge sharpness control
                    intensity = Math.pow(intensity, falloffPower);
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
        this.smoothedPos = { x: pos.x, y: pos.y }; // Initialize smoothed position
        this.positionQueue.push(pos);
    }
    
    draw(e) {
        if (!this.isDrawing) return;
        
        const rawPos = this.getEventPos(e);
        
        // Apply exponential moving average for smoothing
        const alpha = BrushConfig.performance.smoothingFactor;
        this.smoothedPos = {
            x: alpha * rawPos.x + (1 - alpha) * this.smoothedPos.x,
            y: alpha * rawPos.y + (1 - alpha) * this.smoothedPos.y
        };
        
        // Use smoothed position for drawing
        const pos = {
            x: Math.round(this.smoothedPos.x),
            y: Math.round(this.smoothedPos.y)
        };
        
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
                    const heatToAdd = this.brush.data[brushIndex] * this.brushIntensity;
                    
                    if (BrushConfig.thermal.heatAccumulation) {
                        // Accumulate heat
                        this.thermalData[canvasIndex] = Math.min(
                            this.thermalData[canvasIndex] + heatToAdd,
                            BrushConfig.thermal.maxTemperature
                        );
                    } else {
                        // Replace with higher temperature
                        this.thermalData[canvasIndex] = Math.max(
                            this.thermalData[canvasIndex],
                            heatToAdd + BrushConfig.thermal.ambientTemperature
                        );
                    }
                }
            }
        }
        
        // Center dot with configurable boost
        const centerIndex = y * this.width + x;
        const centerBoost = this.brushIntensity * BrushConfig.brush.centerBoostMultiplier;
        if (BrushConfig.thermal.heatAccumulation) {
            this.thermalData[centerIndex] = Math.min(
                this.thermalData[centerIndex] + centerBoost,
                BrushConfig.thermal.maxTemperature
            );
        } else {
            this.thermalData[centerIndex] = Math.max(
                this.thermalData[centerIndex],
                centerBoost + BrushConfig.thermal.ambientTemperature
            );
        }
    }
    
    // Simple box blur (much faster than Gaussian on CPU)
    applyBoxBlur() {
        const temp = new Float32Array(this.thermalData.length);
        const radius = 2; // Small radius for performance
        
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
        
        // Vertical pass with optional cooling
        const coolingRate = BrushConfig.thermal.coolingRate;
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
                
                // Apply cooling rate and ensure minimum ambient temperature
                let finalValue = (sum / count) * coolingRate;
                this.thermalData[y * this.width + x] = Math.max(finalValue, BrushConfig.thermal.ambientTemperature);
            }
        }
    }
    
    thermalColormap(value) {
        // Clamp to 0-1 range
        value = Math.max(0, Math.min(1, value));
        
        const colormap = BrushConfig.visual.colormap;
        
        // Thermal colormap using configurable colors and transitions
        if (value < colormap.firstTransition) {
            const t = value / colormap.firstTransition;
            const cold = colormap.coldColor;
            const warm = colormap.warmColor;
            return {
                r: Math.floor(cold.r + (warm.r - cold.r) * t),
                g: Math.floor(cold.g + (warm.g - cold.g) * t),
                b: Math.floor(cold.b + (warm.b - cold.b) * t)
            };
        } else if (value < colormap.secondTransition) {
            const t = (value - colormap.firstTransition) / colormap.firstTransition;
            const warm = colormap.warmColor;
            const hot = colormap.hotColor;
            return {
                r: Math.floor(warm.r + (hot.r - warm.r) * t),
                g: Math.floor(warm.g + (hot.g - warm.g) * t),
                b: Math.floor(warm.b + (hot.b - warm.b) * t)
            };
        } else {
            const t = (value - colormap.secondTransition) / colormap.thirdTransition;
            const hot = colormap.hotColor;
            const max = colormap.maxColor;
            return {
                r: Math.floor(hot.r + (max.r - hot.r) * t),
                g: Math.floor(hot.g + (max.g - hot.g) * t),
                b: Math.floor(hot.b + (max.b - hot.b) * t)
            };
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
        
        // Draw position queue on top layer
        if (BrushConfig.visual.queue.showQueue) {
            this.drawPositionQueue();
        }
        
        // Update debug info
        this.updateDebugInfo();
    }
    
    drawContours() {
        this.ctx.strokeStyle = BrushConfig.visual.contour.strokeColor;
        this.ctx.lineWidth = BrushConfig.visual.contour.lineWidth;
        
        // Simple contour detection - just draw points above threshold
        const skipPixels = Math.max(1, BrushConfig.performance.contourSkipPixels);
        for (let y = 0; y < this.height; y += skipPixels) {
            for (let x = 0; x < this.width; x += skipPixels) {
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
    
    drawPositionQueue() {
        const queueConfig = BrushConfig.visual.queue;
        const maxDots = Math.min(this.positionQueue.length, queueConfig.maxDotsShown);
        
        // Save current context state
        this.ctx.save();
        
        // Set drawing properties
        this.ctx.fillStyle = queueConfig.dotColor;
        
        // Draw dots for positions in queue
        for (let i = 0; i < maxDots; i++) {
            const pos = this.positionQueue[i];
            
            if (queueConfig.fadeEffect) {
                // Apply fade effect - newer positions (front of queue) are more opaque
                const alpha = 1.0 - (i / maxDots) * 0.7; // Fade from 1.0 to 0.3
                this.ctx.globalAlpha = alpha;
            }
            
            // Draw dot
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, queueConfig.dotSize, 0, 2 * Math.PI);
            this.ctx.fill();
        }
        
        // Restore context state
        this.ctx.restore();
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
    
    updatePersistentMask() {
        for (let i = 0; i < this.thermalData.length; i++) {
            if (this.thermalData[i] >= this.threshold) {
                this.persistentMask[i] = 1;
            }
        }
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