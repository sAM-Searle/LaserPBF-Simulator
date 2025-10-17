// GPU-accelerated thermal simulation using WebGL2 compute shaders
class GPUCompute {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.canvas = document.createElement('canvas');
        this.supported = false;
        
        try {
            this.gl = this.canvas.getContext('webgl2');
            
            if (!this.gl) {
                console.warn('WebGL2 not supported, falling back to CPU');
                return;
            }
            
            // Check for required extensions
            if (!this.gl.getExtension('EXT_color_buffer_float')) {
                console.warn('Float textures not supported, falling back to CPU');
                return;
            }
            
            this.setupFramebuffers();
            this.setupShaders();
            this.setupGeometry();
            
            this.supported = true;
            console.log('GPU compute initialized successfully');
        } catch (error) {
            console.warn('GPU compute initialization failed:', error);
            this.supported = false;
            this.gl = null;
        }
    }
    
    setupFramebuffers() {
        if (!this.gl) throw new Error('WebGL2 context not available');
        
    // Create textures for thermal data (ping-pong buffers for blur)
    this.thermalTexA = this.createFloatTexture(this.width, this.height);
    this.thermalTexB = this.createFloatTexture(this.width, this.height);
    // Ping-pong for max tracking and persistent mask to avoid read-write hazards
    this.maxTexA = this.createFloatTexture(this.width, this.height);
    this.maxTexB = this.createFloatTexture(this.width, this.height);
    this.persistentTexA = this.createByteTexture(this.width, this.height);
    this.persistentTexB = this.createByteTexture(this.width, this.height);
        
    // Framebuffers
    this.fbA = this.createFramebuffer(this.thermalTexA);
    this.fbB = this.createFramebuffer(this.thermalTexB);
    this.maxFbA = this.createFramebuffer(this.maxTexA);
    this.maxFbB = this.createFramebuffer(this.maxTexB);
    this.persistentFbA = this.createFramebuffer(this.persistentTexA);
    this.persistentFbB = this.createFramebuffer(this.persistentTexB);
        
        // Verify framebuffers are complete
        const gl = this.gl;
        const checkFramebuffer = (fb, name) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error(`Framebuffer ${name} incomplete: ${status}`);
            }
        };
        
        checkFramebuffer(this.fbA, 'Thermal A');
        checkFramebuffer(this.fbB, 'Thermal B');
        checkFramebuffer(this.maxFbA, 'Max A');
        checkFramebuffer(this.maxFbB, 'Max B');
        checkFramebuffer(this.persistentFbA, 'Persistent A');
        checkFramebuffer(this.persistentFbB, 'Persistent B');

        // Initialize all buffers to zero
        const clearFb = (fb) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        };
        [this.fbA, this.fbB, this.maxFbA, this.maxFbB, this.persistentFbA, this.persistentFbB].forEach(clearFb);
    }
    
    createFloatTexture(w, h) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }
    
    createByteTexture(w, h) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }
    
    createFramebuffer(texture) {
        const gl = this.gl;
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        return fb;
    }
    
    setupShaders() {
        const gl = this.gl;
        if (!gl) throw new Error('WebGL2 context not available');
        
        // Vertex shader (shared). Bind attribute to location 0 explicitly for robustness.
        const vertexShader = this.createShader(gl.VERTEX_SHADER, `#version 300 es
            precision highp float;
            layout(location = 0) in vec2 a_position;
            out vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = (a_position + 1.0) * 0.5;
            }
        `);
        
        // Brush application shader
        const brushFragShader = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_thermalData;
            uniform vec2 u_brushPos;
            uniform float u_brushRadius;
            uniform float u_brushIntensity;
            uniform float u_centerMultiplier;
            uniform vec2 u_resolution;
            in vec2 v_texCoord;
            out float outColor;
            
            void main() {
                vec2 pixelPos = v_texCoord * u_resolution;
                float dist = distance(pixelPos, u_brushPos);
                
                float currentValue = texture(u_thermalData, v_texCoord).r;
                float brushValue = 0.0;
                
                if (dist <= u_brushRadius) {
                    float intensity = 1.0 - (dist / u_brushRadius);
                    brushValue = intensity * u_brushIntensity;
                    
                    // Center boost
                    if (dist < 1.0) {
                        brushValue += u_brushIntensity * u_centerMultiplier;
                    }
                }
                
                outColor = currentValue + brushValue;
            }
        `);
        
        // Gaussian blur shader (separable)
        const blurFragShader = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_texture;
            uniform vec2 u_direction; // (1,0) for horizontal, (0,1) for vertical
            uniform float u_sigma;
            uniform vec2 u_resolution;
            in vec2 v_texCoord;
            out float outColor;
            
            void main() {
                vec2 texelSize = 1.0 / u_resolution;
                float radius = ceil(u_sigma * 3.0);
                
                float sum = 0.0;
                float weightSum = 0.0;
                
                for (float i = -radius; i <= radius; i++) {
                    vec2 offset = i * u_direction * texelSize;
                    float weight = exp(-(i * i) / (2.0 * u_sigma * u_sigma));
                    sum += texture(u_texture, v_texCoord + offset).r * weight;
                    weightSum += weight;
                }
                
                outColor = sum / weightSum;
            }
        `);
        
        // Decay shader
        const decayFragShader = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_thermalData;
            uniform float u_decayRate;
            in vec2 v_texCoord;
            out float outColor;
            
            void main() {
                outColor = texture(u_thermalData, v_texCoord).r * u_decayRate;
            }
        `);
        
        // Max tracking shader
        const maxTrackingFragShader = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_thermalData;
            uniform sampler2D u_maxData;
            in vec2 v_texCoord;
            out float outColor;
            
            void main() {
                float current = texture(u_thermalData, v_texCoord).r;
                float maxVal = texture(u_maxData, v_texCoord).r;
                outColor = max(current, maxVal);
            }
        `);
        
        // Persistent mask shader
        const persistentFragShader = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_thermalData;
            uniform sampler2D u_persistentMask;
            uniform float u_threshold;
            in vec2 v_texCoord;
            out float outColor;
            
            void main() {
                float thermal = texture(u_thermalData, v_texCoord).r;
                float persistent = texture(u_persistentMask, v_texCoord).r;
                outColor = (thermal >= u_threshold) ? 1.0 : persistent;
            }
        `);
        
        // Create shader programs
        this.brushProgram = this.createProgram(vertexShader, brushFragShader);
        this.blurProgram = this.createProgram(vertexShader, blurFragShader);
        this.decayProgram = this.createProgram(vertexShader, decayFragShader);
        this.maxTrackingProgram = this.createProgram(vertexShader, maxTrackingFragShader);
        this.persistentProgram = this.createProgram(vertexShader, persistentFragShader);
        
        // Get uniform locations
        this.setupUniforms();
    }
    
    setupUniforms() {
        const gl = this.gl;
        
        // Brush uniforms
        gl.useProgram(this.brushProgram);
        this.brushUniforms = {
            thermalData: gl.getUniformLocation(this.brushProgram, 'u_thermalData'),
            brushPos: gl.getUniformLocation(this.brushProgram, 'u_brushPos'),
            brushRadius: gl.getUniformLocation(this.brushProgram, 'u_brushRadius'),
            brushIntensity: gl.getUniformLocation(this.brushProgram, 'u_brushIntensity'),
            centerMultiplier: gl.getUniformLocation(this.brushProgram, 'u_centerMultiplier'),
            resolution: gl.getUniformLocation(this.brushProgram, 'u_resolution')
        };
        
        // Blur uniforms
        gl.useProgram(this.blurProgram);
        this.blurUniforms = {
            texture: gl.getUniformLocation(this.blurProgram, 'u_texture'),
            direction: gl.getUniformLocation(this.blurProgram, 'u_direction'),
            sigma: gl.getUniformLocation(this.blurProgram, 'u_sigma'),
            resolution: gl.getUniformLocation(this.blurProgram, 'u_resolution')
        };
        
        // Decay uniforms
        gl.useProgram(this.decayProgram);
        this.decayUniforms = {
            thermalData: gl.getUniformLocation(this.decayProgram, 'u_thermalData'),
            decayRate: gl.getUniformLocation(this.decayProgram, 'u_decayRate')
        };
        
        // Max tracking uniforms
        gl.useProgram(this.maxTrackingProgram);
        this.maxTrackingUniforms = {
            thermalData: gl.getUniformLocation(this.maxTrackingProgram, 'u_thermalData'),
            maxData: gl.getUniformLocation(this.maxTrackingProgram, 'u_maxData')
        };
        
        // Persistent uniforms
        gl.useProgram(this.persistentProgram);
        this.persistentUniforms = {
            thermalData: gl.getUniformLocation(this.persistentProgram, 'u_thermalData'),
            persistentMask: gl.getUniformLocation(this.persistentProgram, 'u_persistentMask'),
            threshold: gl.getUniformLocation(this.persistentProgram, 'u_threshold')
        };
    }
    
    setupGeometry() {
        const gl = this.gl;
        
        // Full-screen quad
        const positions = new Float32Array([
            -1, -1,  1, -1,  -1,  1,
             1, -1,   1,  1,  -1,  1
        ]);
        
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        
        // VAO for all programs
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    
    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }
    
    createProgram(vertexShader, fragmentShader) {
        const gl = this.gl;
        const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }
        
        return program;
    }
    
    // GPU operations
    applyBrush(x, y, config) {
        if (!this.supported || !this.gl) return;
        
        const gl = this.gl;
        gl.useProgram(this.brushProgram);
        gl.bindVertexArray(this.vao);
        
        // Set uniforms
        gl.uniform1i(this.brushUniforms.thermalData, 0);
        gl.uniform2f(this.brushUniforms.brushPos, x, y);
        gl.uniform1f(this.brushUniforms.brushRadius, config.brushRadius);
        gl.uniform1f(this.brushUniforms.brushIntensity, config.brushIntensity);
        gl.uniform1f(this.brushUniforms.centerMultiplier, config.centerMultiplier);
        gl.uniform2f(this.brushUniforms.resolution, this.width, this.height);
        
        // Bind input texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.thermalTexA);
        
        // Render to output texture
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        
        // Swap textures
        [this.thermalTexA, this.thermalTexB] = [this.thermalTexB, this.thermalTexA];
        [this.fbA, this.fbB] = [this.fbB, this.fbA];
        
        return true;
    }
    
    applyGaussianBlur(sigma) {
        if (!this.supported) return false;
        
        const gl = this.gl;
        gl.useProgram(this.blurProgram);
        gl.bindVertexArray(this.vao);
        
        // Horizontal pass
        gl.uniform1i(this.blurUniforms.texture, 0);
        gl.uniform2f(this.blurUniforms.direction, 1, 0);
        gl.uniform1f(this.blurUniforms.sigma, sigma);
        gl.uniform2f(this.blurUniforms.resolution, this.width, this.height);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.thermalTexA);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        
        // Vertical pass
        gl.uniform2f(this.blurUniforms.direction, 0, 1);
        gl.bindTexture(gl.TEXTURE_2D, this.thermalTexB);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        
        return true;
    }
    
    applyDecay(decayRate) {
        if (!this.supported) return false;
        
        const gl = this.gl;
        gl.useProgram(this.decayProgram);
        gl.bindVertexArray(this.vao);
        
        gl.uniform1i(this.decayUniforms.thermalData, 0);
        gl.uniform1f(this.decayUniforms.decayRate, decayRate);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.thermalTexA);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbB);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        
        // Swap
        [this.thermalTexA, this.thermalTexB] = [this.thermalTexB, this.thermalTexA];
        [this.fbA, this.fbB] = [this.fbB, this.fbA];
        
        return true;
    }
    
    updateMaxTracking() {
        if (!this.supported) return false;
        
        const gl = this.gl;
        gl.useProgram(this.maxTrackingProgram);
        gl.bindVertexArray(this.vao);
        
        gl.uniform1i(this.maxTrackingUniforms.thermalData, 0);
        gl.uniform1i(this.maxTrackingUniforms.maxData, 1);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.thermalTexA);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.maxTexA);
        
        // Write to B then swap so A holds latest
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.maxFbB);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        [this.maxTexA, this.maxTexB] = [this.maxTexB, this.maxTexA];
        [this.maxFbA, this.maxFbB] = [this.maxFbB, this.maxFbA];
        
        return true;
    }
    
    updatePersistentMask(threshold) {
        if (!this.supported) return false;
        
        const gl = this.gl;
        gl.useProgram(this.persistentProgram);
        gl.bindVertexArray(this.vao);
        
        gl.uniform1i(this.persistentUniforms.thermalData, 0);
        gl.uniform1i(this.persistentUniforms.persistentMask, 1);
        gl.uniform1f(this.persistentUniforms.threshold, threshold);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.thermalTexA);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.persistentTexA);
        
        // Write to B then swap so A holds latest
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.persistentFbB);
        gl.viewport(0, 0, this.width, this.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        [this.persistentTexA, this.persistentTexB] = [this.persistentTexB, this.persistentTexA];
        [this.persistentFbA, this.persistentFbB] = [this.persistentFbB, this.persistentFbA];
        
        return true;
    }
    
    // Data transfer methods
    uploadThermalData(data) {
        if (!this.supported || !this.gl || !data) return;
        
        try {
            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, this.thermalTexA);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RED, gl.FLOAT, data);
        } catch (error) {
            console.warn('GPU thermal data upload failed:', error);
        }
    }
    
    downloadThermalData() {
        if (!this.supported || !this.gl) return null;
        
        try {
            const gl = this.gl;
            const data = new Float32Array(this.width * this.height);
            
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA);
            gl.readPixels(0, 0, this.width, this.height, gl.RED, gl.FLOAT, data);
            
            return data;
        } catch (error) {
            console.warn('GPU thermal data download failed:', error);
            return null;
        }
    }
    
    downloadMaxData() {
        if (!this.supported) return null;
        
        const gl = this.gl;
        const data = new Float32Array(this.width * this.height);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.maxFbA);
        gl.readPixels(0, 0, this.width, this.height, gl.RED, gl.FLOAT, data);
        
        return data;
    }
    
    downloadPersistentData() {
        if (!this.supported) return null;
        
        const gl = this.gl;
        const data = new Uint8Array(this.width * this.height);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.persistentFbA);
        gl.readPixels(0, 0, this.width, this.height, gl.RED, gl.UNSIGNED_BYTE, data);
        
        return data;
    }
    
    clear() {
        if (!this.supported) return;
        
        const gl = this.gl;
        
        // Clear all textures
        [this.fbA, this.fbB, this.maxFbA, this.maxFbB, this.persistentFbA, this.persistentFbB].forEach(fb => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        });
    }
}

window.GPUCompute = GPUCompute;