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
    // Ping-pong for persistent mask to avoid read-write hazards
    this.persistentTexA = this.createByteTexture(this.width, this.height);
    this.persistentTexB = this.createByteTexture(this.width, this.height);
        
    // Framebuffers
    this.fbA = this.createFramebuffer(this.thermalTexA);
    this.fbB = this.createFramebuffer(this.thermalTexB);
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
    // Max tracking removed - using CPU fallback for max tracking
        checkFramebuffer(this.persistentFbA, 'Persistent A');
        checkFramebuffer(this.persistentFbB, 'Persistent B');

        // Initialize all buffers to zero
        const clearFb = (fb) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        };
    [this.fbA, this.fbB, this.persistentFbA, this.persistentFbB].forEach(clearFb);
    }
    
    createFloatTexture(w, h) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
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
            precision mediump float;
            uniform sampler2D u_thermalData;
            uniform vec2 u_brushPos;
            uniform float u_brushRadius;
            uniform float u_brushIntensity;
            uniform float u_centerMultiplier;
            uniform vec2 u_resolution;
            in vec2 v_texCoord;
            out vec4 outColor;
            
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
                
                outColor = vec4(currentValue + brushValue, 0.0, 0.0, 1.0);
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
            out vec4 outColor;
            
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
                
                outColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
            }
        `);
        
        // Decay shader
        const decayFragShader = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_thermalData;
            uniform float u_decayRate;
            in vec2 v_texCoord;
            out vec4 outColor;
            
            void main() {
                outColor = vec4(texture(u_thermalData, v_texCoord).r * u_decayRate, 0.0, 0.0, 1.0);
            }
        `);
        
        // Max tracking shader removed - max tracking will be performed on CPU
        
        // Persistent mask shader
        const persistentFragShader = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_thermalData;
            uniform sampler2D u_persistentMask;
            uniform float u_threshold;
            in vec2 v_texCoord;
            out vec4 outColor;
            
            void main() {
                float thermal = texture(u_thermalData, v_texCoord).r;
                float persistent = texture(u_persistentMask, v_texCoord).r;
                outColor = vec4((thermal >= u_threshold) ? 1.0 : persistent, 0.0, 0.0, 1.0);
            }
        `);
        
        // Create shader programs
        this.brushProgram = this.createProgram(vertexShader, brushFragShader);
        this.blurProgram = this.createProgram(vertexShader, blurFragShader);
        this.decayProgram = this.createProgram(vertexShader, decayFragShader);
    // this.maxTrackingProgram intentionally omitted
        this.persistentProgram = this.createProgram(vertexShader, persistentFragShader);

        // Particle update shaders (X and Y components in separate passes)
        const particleUpdateXFrag = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_posX;
            uniform sampler2D u_posY;
            uniform vec2 u_pushCenter;
            uniform float u_pushRadius;
            uniform float u_baseStrength;
            uniform float u_forceVarMin;
            uniform float u_forceVarMax;
            uniform float u_angleVarMax;
            uniform float u_driftMax;
            uniform vec2 u_particleResolution; // (width, 1)
            // Region clamp (circle or rect)
            uniform float u_regionType; // 0=circle, 1=rect
            uniform vec2 u_regionCenter;
            uniform float u_regionR;
            uniform vec2 u_regionHalfWH;
            uniform float u_time; // seconds
            in vec2 v_texCoord;
            out vec4 outColor;

            float rand(vec2 co) {
                return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
            }

            void main(){
                // Sample current pos
                vec2 uv = vec2(v_texCoord.x, 0.5);
                float px = texture(u_posX, uv).r;
                float py = texture(u_posY, uv).r;

                // Compute push
                vec2 toCenter = vec2(px, py) - u_pushCenter;
                float dist = length(toCenter);
                vec2 pos = vec2(px, py);
                if (dist > 0.0 && dist < u_pushRadius) {
                    float pushForce = (u_pushRadius - dist) / u_pushRadius;
                    float r = rand(vec2(v_texCoord.x, u_time));
                    float forceVar = mix(u_forceVarMin, u_forceVarMax, r);
                    float pushDist = pushForce * u_baseStrength * forceVar;
                    float baseAngle = atan(toCenter.y, toCenter.x);
                    float angleVar = (r - 0.5) * u_angleVarMax;
                    float ang = baseAngle + angleVar;
                    vec2 nd = vec2(cos(ang), sin(ang));
                    // Drift
                    float r2 = rand(vec2(v_texCoord.x + 0.37, u_time + 0.91));
                    float driftAng = r2 * 6.28318530718; // 2*pi
                    vec2 drift = vec2(cos(driftAng), sin(driftAng)) * (u_driftMax * (r2 - 0.5));
                    pos += nd * pushDist + drift;
                }

                // Clamp to region
                if (u_regionType < 0.5) {
                    // circle
                    vec2 d = pos - u_regionCenter;
                    float rr = u_regionR;
                    float d2 = dot(d, d);
                    if (d2 > rr*rr) {
                        float len = max(1e-6, sqrt(d2));
                        pos = u_regionCenter + d * (rr / len);
                    }
                } else {
                    // rect
                    vec2 c = u_regionCenter;
                    vec2 h = u_regionHalfWH;
                    pos.x = clamp(pos.x, c.x - h.x, c.x + h.x);
                    pos.y = clamp(pos.y, c.y - h.y, c.y + h.y);
                }

                outColor = vec4(pos.x, 0.0, 0.0, 1.0); // X component
            }
        `);

        const particleUpdateYFrag = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_posX;
            uniform sampler2D u_posY;
            uniform vec2 u_pushCenter;
            uniform float u_pushRadius;
            uniform float u_baseStrength;
            uniform float u_forceVarMin;
            uniform float u_forceVarMax;
            uniform float u_angleVarMax;
            uniform float u_driftMax;
            uniform vec2 u_particleResolution; // (width, 1)
            // Region clamp (circle or rect)
            uniform float u_regionType; // 0=circle, 1=rect
            uniform vec2 u_regionCenter;
            uniform float u_regionR;
            uniform vec2 u_regionHalfWH;
            uniform float u_time; // seconds
            in vec2 v_texCoord;
            out vec4 outColor;

            float rand(vec2 co) {
                return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
            }

            void main(){
                // Sample current pos
                vec2 uv = vec2(v_texCoord.x, 0.5);
                float px = texture(u_posX, uv).r;
                float py = texture(u_posY, uv).r;

                // Compute push
                vec2 toCenter = vec2(px, py) - u_pushCenter;
                float dist = length(toCenter);
                vec2 pos = vec2(px, py);
                if (dist > 0.0 && dist < u_pushRadius) {
                    float pushForce = (u_pushRadius - dist) / u_pushRadius;
                    float r = rand(vec2(v_texCoord.x, u_time));
                    float forceVar = mix(u_forceVarMin, u_forceVarMax, r);
                    float pushDist = pushForce * u_baseStrength * forceVar;
                    float baseAngle = atan(toCenter.y, toCenter.x);
                    float angleVar = (r - 0.5) * u_angleVarMax;
                    float ang = baseAngle + angleVar;
                    vec2 nd = vec2(cos(ang), sin(ang));
                    // Drift
                    float r2 = rand(vec2(v_texCoord.x + 0.37, u_time + 0.91));
                    float driftAng = r2 * 6.28318530718;
                    vec2 drift = vec2(cos(driftAng), sin(driftAng)) * (u_driftMax * (r2 - 0.5));
                    pos += nd * pushDist + drift;
                }

                // Clamp to region
                if (u_regionType < 0.5) {
                    // circle
                    vec2 d = pos - u_regionCenter;
                    float rr = u_regionR;
                    float d2 = dot(d, d);
                    if (d2 > rr*rr) {
                        float len = max(1e-6, sqrt(d2));
                        pos = u_regionCenter + d * (rr / len);
                    }
                } else {
                    // rect
                    vec2 c = u_regionCenter;
                    vec2 h = u_regionHalfWH;
                    pos.x = clamp(pos.x, c.x - h.x, c.x + h.x);
                    pos.y = clamp(pos.y, c.y - h.y, c.y + h.y);
                }

                outColor = vec4(pos.y, 0.0, 0.0, 1.0); // Y component
            }
        `);

        this.particleUpdateXProgram = this.createProgram(vertexShader, particleUpdateXFrag);
        this.particleUpdateYProgram = this.createProgram(vertexShader, particleUpdateYFrag);

        // Particle render shaders (point sprites)
        const particleRenderVert = this.createShader(gl.VERTEX_SHADER, `#version 300 es
            precision highp float;
            uniform sampler2D u_posX;
            uniform sampler2D u_posY;
            uniform sampler2D u_radius;
            uniform sampler2D u_gray;
            uniform vec2 u_resolution; // canvas size in px
            uniform float u_outerScale;
            uniform float u_count; // particle count
            out float v_gray;
            out float v_radius;
            void main(){
                // Map vertex id to 1D texture coordinate
                float idx = float(gl_VertexID) + 0.5;
                float u = idx / u_count;
                vec2 uv = vec2(u, 0.5);
                float px = texture(u_posX, uv).r;
                float py = texture(u_posY, uv).r;
                float r = texture(u_radius, uv).r;
                float g = texture(u_gray, uv).r;
                // Convert to NDC (origin top-left)
                float x_ndc = (px / u_resolution.x) * 2.0 - 1.0;
                float y_ndc = 1.0 - (py / u_resolution.y) * 2.0;
                gl_Position = vec4(x_ndc, y_ndc, 0.0, 1.0);
                gl_PointSize = max(1.0, r * 2.0 * u_outerScale);
                v_gray = g;
                v_radius = r;
            }
        `);

        const particleRenderFrag = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
            precision highp float;
            in float v_gray;
            in float v_radius;
            uniform float u_darkScale;
            uniform float u_highlightOffset; // 0..1, fraction of radius toward top-left
            out vec4 outColor;
            void main(){
                // gl_PointCoord in [0,1]
                vec2 pc = gl_PointCoord - vec2(0.5);
                float dist = length(pc);
                if (dist > 0.5) { discard; }
                // Simple radial shading with slight highlight toward top-left
                vec2 hlDir = normalize(vec2(-1.0, -1.0));
                float hl = dot(normalize(pc + 1e-6), hlDir);
                float t = smoothstep(0.5, 0.0, dist);
                float grayCenter = v_gray;
                float grayEdge = v_gray * u_darkScale;
                float base = mix(grayEdge, grayCenter, t);
                base += (u_highlightOffset * 0.15) * max(0.0, hl);
                base = clamp(base, 0.0, 255.0);
                vec3 col = vec3(base/255.0);
                float alpha = 1.0; // could be tuned if needed
                outColor = vec4(col, alpha);
            }
        `);

        this.particleRenderProgram = this.createProgram(particleRenderVert, particleRenderFrag);
        
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
        
        // Max tracking removed: handled on CPU; no GPU uniforms to set here.
        
        // Persistent uniforms
        gl.useProgram(this.persistentProgram);
        this.persistentUniforms = {
            thermalData: gl.getUniformLocation(this.persistentProgram, 'u_thermalData'),
            persistentMask: gl.getUniformLocation(this.persistentProgram, 'u_persistentMask'),
            threshold: gl.getUniformLocation(this.persistentProgram, 'u_threshold')
        };

        // Particle uniforms
        if (this.particleUpdateXProgram && this.particleUpdateYProgram) {
            gl.useProgram(this.particleUpdateXProgram);
            this.particleXUniforms = {
                posX: gl.getUniformLocation(this.particleUpdateXProgram, 'u_posX'),
                posY: gl.getUniformLocation(this.particleUpdateXProgram, 'u_posY'),
                pushCenter: gl.getUniformLocation(this.particleUpdateXProgram, 'u_pushCenter'),
                pushRadius: gl.getUniformLocation(this.particleUpdateXProgram, 'u_pushRadius'),
                baseStrength: gl.getUniformLocation(this.particleUpdateXProgram, 'u_baseStrength'),
                forceVarMin: gl.getUniformLocation(this.particleUpdateXProgram, 'u_forceVarMin'),
                forceVarMax: gl.getUniformLocation(this.particleUpdateXProgram, 'u_forceVarMax'),
                angleVarMax: gl.getUniformLocation(this.particleUpdateXProgram, 'u_angleVarMax'),
                driftMax: gl.getUniformLocation(this.particleUpdateXProgram, 'u_driftMax'),
                particleResolution: gl.getUniformLocation(this.particleUpdateXProgram, 'u_particleResolution'),
                regionType: gl.getUniformLocation(this.particleUpdateXProgram, 'u_regionType'),
                regionCenter: gl.getUniformLocation(this.particleUpdateXProgram, 'u_regionCenter'),
                regionR: gl.getUniformLocation(this.particleUpdateXProgram, 'u_regionR'),
                regionHalfWH: gl.getUniformLocation(this.particleUpdateXProgram, 'u_regionHalfWH'),
                time: gl.getUniformLocation(this.particleUpdateXProgram, 'u_time')
            };
            gl.useProgram(this.particleUpdateYProgram);
            this.particleYUniforms = {
                posX: gl.getUniformLocation(this.particleUpdateYProgram, 'u_posX'),
                posY: gl.getUniformLocation(this.particleUpdateYProgram, 'u_posY'),
                pushCenter: gl.getUniformLocation(this.particleUpdateYProgram, 'u_pushCenter'),
                pushRadius: gl.getUniformLocation(this.particleUpdateYProgram, 'u_pushRadius'),
                baseStrength: gl.getUniformLocation(this.particleUpdateYProgram, 'u_baseStrength'),
                forceVarMin: gl.getUniformLocation(this.particleUpdateYProgram, 'u_forceVarMin'),
                forceVarMax: gl.getUniformLocation(this.particleUpdateYProgram, 'u_forceVarMax'),
                angleVarMax: gl.getUniformLocation(this.particleUpdateYProgram, 'u_angleVarMax'),
                driftMax: gl.getUniformLocation(this.particleUpdateYProgram, 'u_driftMax'),
                particleResolution: gl.getUniformLocation(this.particleUpdateYProgram, 'u_particleResolution'),
                regionType: gl.getUniformLocation(this.particleUpdateYProgram, 'u_regionType'),
                regionCenter: gl.getUniformLocation(this.particleUpdateYProgram, 'u_regionCenter'),
                regionR: gl.getUniformLocation(this.particleUpdateYProgram, 'u_regionR'),
                regionHalfWH: gl.getUniformLocation(this.particleUpdateYProgram, 'u_regionHalfWH'),
                time: gl.getUniformLocation(this.particleUpdateYProgram, 'u_time')
            };
        }

        // Particle render uniforms
        if (this.particleRenderProgram) {
            gl.useProgram(this.particleRenderProgram);
            this.particleRenderUniforms = {
                posX: gl.getUniformLocation(this.particleRenderProgram, 'u_posX'),
                posY: gl.getUniformLocation(this.particleRenderProgram, 'u_posY'),
                radius: gl.getUniformLocation(this.particleRenderProgram, 'u_radius'),
                gray: gl.getUniformLocation(this.particleRenderProgram, 'u_gray'),
                resolution: gl.getUniformLocation(this.particleRenderProgram, 'u_resolution'),
                outerScale: gl.getUniformLocation(this.particleRenderProgram, 'u_outerScale'),
                darkScale: gl.getUniformLocation(this.particleRenderProgram, 'u_darkScale'),
                highlightOffset: gl.getUniformLocation(this.particleRenderProgram, 'u_highlightOffset'),
                count: gl.getUniformLocation(this.particleRenderProgram, 'u_count')
            };
        }
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
    const cm = (config && typeof config.centerMultiplier === 'number') ? config.centerMultiplier : 1.0;
    gl.uniform1f(this.brushUniforms.centerMultiplier, cm);
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
        // Max tracking is handled on CPU now; GPU no-op
        return false;
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
            // Convert to RGBA format
            const rgbaData = new Float32Array(this.width * this.height * 4);
            for (let i = 0; i < data.length; i++) {
                rgbaData[i * 4] = data[i]; // R
                rgbaData[i * 4 + 1] = 0.0; // G
                rgbaData[i * 4 + 2] = 0.0; // B
                rgbaData[i * 4 + 3] = 1.0; // A
            }
            
            gl.bindTexture(gl.TEXTURE_2D, this.thermalTexA);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, rgbaData);
        } catch (error) {
            console.warn('GPU thermal data upload failed:', error);
        }
    }
    
    downloadThermalData() {
        if (!this.supported || !this.gl) return null;
        
        try {
            const gl = this.gl;
            const data = new Float32Array(this.width * this.height * 4);
            
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA);
            gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, data);
            
            // Extract R channel
            const result = new Float32Array(this.width * this.height);
            for (let i = 0; i < result.length; i++) {
                result[i] = data[i * 4];
            }
            
            return result;
        } catch (error) {
            console.warn('GPU thermal data download failed:', error);
            return null;
        }
    }
    
    downloadMaxData() {
        // GPU max tracking removed; return null to indicate not available
        return null;
    }
    
    downloadPersistentData() {
        if (!this.supported) return null;
        
        const gl = this.gl;
        const data = new Uint8Array(this.width * this.height * 4);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.persistentFbA);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        
        // Extract R channel
        const result = new Uint8Array(this.width * this.height);
        for (let i = 0; i < result.length; i++) {
            result[i] = data[i * 4];
        }
        
        return result;
    }
    
    clear() {
        if (!this.supported) return;
        
        const gl = this.gl;
        
        // Clear all textures (max tracking removed)
        [this.fbA, this.fbB, this.persistentFbA, this.persistentFbB].forEach(fb => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        });
    }

    // ===== Particle compute API =====
    initParticles(count, opts = {}) {
        if (!this.supported) return false;
        const gl = this.gl;
        this.particleCount = Math.max(1, count | 0);
        this.particleTexWidth = this.particleCount;
        this.particleTexHeight = 1;

        // Create position textures (ping-pong) and FBOs
        this.pPosX_A = this.createFloatTexture(this.particleTexWidth, this.particleTexHeight);
        this.pPosX_B = this.createFloatTexture(this.particleTexWidth, this.particleTexHeight);
        this.pPosY_A = this.createFloatTexture(this.particleTexWidth, this.particleTexHeight);
        this.pPosY_B = this.createFloatTexture(this.particleTexWidth, this.particleTexHeight);
        this.pPosX_FbA = this.createFramebuffer(this.pPosX_A);
        this.pPosX_FbB = this.createFramebuffer(this.pPosX_B);
        this.pPosY_FbA = this.createFramebuffer(this.pPosY_A);
        this.pPosY_FbB = this.createFramebuffer(this.pPosY_B);

        // Initialize with provided positions or zeros
        const initPos = opts.positions instanceof Float32Array ? opts.positions : null;
        if (initPos && initPos.length >= this.particleCount * 2) {
            // Pack X and Y separately as RGBA
            const xsRGBA = new Float32Array(this.particleTexWidth * this.particleTexHeight * 4);
            const ysRGBA = new Float32Array(this.particleTexWidth * this.particleTexHeight * 4);
            for (let i = 0; i < this.particleCount; i++) {
                xsRGBA[i * 4] = initPos[i * 2];
                ysRGBA[i * 4] = initPos[i * 2 + 1];
            }
            gl.bindTexture(gl.TEXTURE_2D, this.pPosX_A);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.particleTexWidth, this.particleTexHeight, gl.RGBA, gl.FLOAT, xsRGBA);
            gl.bindTexture(gl.TEXTURE_2D, this.pPosY_A);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.particleTexWidth, this.particleTexHeight, gl.RGBA, gl.FLOAT, ysRGBA);
        } else {
            // Clear to zeros
            const zeroRGBA = new Float32Array(this.particleTexWidth * this.particleTexHeight * 4);
            gl.bindTexture(gl.TEXTURE_2D, this.pPosX_A);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.particleTexWidth, this.particleTexHeight, gl.RGBA, gl.FLOAT, zeroRGBA);
            gl.bindTexture(gl.TEXTURE_2D, this.pPosY_A);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.particleTexWidth, this.particleTexHeight, gl.RGBA, gl.FLOAT, zeroRGBA);
        }

        // Attributes (radius, gray) - static textures
        const radii = (opts.radii instanceof Float32Array) ? opts.radii : null;
        const grays = (opts.grays instanceof Float32Array) ? opts.grays : null;
        // Create attribute textures (as 1D textures stored in 2D with height=1)
        this.pRadiusTex = this.createFloatTexture(this.particleTexWidth, 1);
        this.pGrayTex = this.createFloatTexture(this.particleTexWidth, 1);
        if (radii && radii.length >= this.particleCount) {
            const radiiRGBA = new Float32Array(this.particleTexWidth * 4);
            for (let i = 0; i < this.particleCount; i++) {
                radiiRGBA[i * 4] = radii[i];
            }
            gl.bindTexture(gl.TEXTURE_2D, this.pRadiusTex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.particleTexWidth, 1, gl.RGBA, gl.FLOAT, radiiRGBA);
        } else {
            const onesRGBA = new Float32Array(this.particleTexWidth * 4);
            for (let i = 0; i < this.particleCount; i++) {
                onesRGBA[i * 4] = 3.0;
            }
            gl.bindTexture(gl.TEXTURE_2D, this.pRadiusTex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.particleTexWidth, 1, gl.RGBA, gl.FLOAT, onesRGBA);
        }
        if (grays && grays.length >= this.particleCount) {
            const graysRGBA = new Float32Array(this.particleTexWidth * 4);
            for (let i = 0; i < this.particleCount; i++) {
                graysRGBA[i * 4] = grays[i];
            }
            gl.bindTexture(gl.TEXTURE_2D, this.pGrayTex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.particleTexWidth, 1, gl.RGBA, gl.FLOAT, graysRGBA);
        } else {
            const gdefRGBA = new Float32Array(this.particleTexWidth * 4);
            for (let i = 0; i < this.particleCount; i++) {
                gdefRGBA[i * 4] = 200.0;
            }
            gl.bindTexture(gl.TEXTURE_2D, this.pGrayTex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.particleTexWidth, 1, gl.RGBA, gl.FLOAT, gdefRGBA);
        }

        // Region
        this.pRegion = {
            type: (opts.region && opts.region.type === 'rect') ? 1 : 0,
            cx: (opts.region && opts.region.cx) || (this.width * 0.5),
            cy: (opts.region && opts.region.cy) || (this.height * 0.5),
            r: (opts.region && opts.region.r) || (Math.min(this.width, this.height) * 0.35),
            halfW: (opts.region && opts.region.halfW) || (this.width * 0.3),
            halfH: (opts.region && opts.region.halfH) || (this.height * 0.3)
        };

        return true;
    }

    stepParticles(params) {
        if (!this.supported || !this.pPosX_A || !this.pPosY_A) return false;
        const gl = this.gl;
        const W = this.particleTexWidth;
        const H = this.particleTexHeight;
        const timeSec = (params && typeof params.time === 'number') ? params.time : (performance.now() * 0.001);

        // Common uniforms
        const setCommonUniforms = (isX) => {
            const prog = isX ? this.particleUpdateXProgram : this.particleUpdateYProgram;
            const U = isX ? this.particleXUniforms : this.particleYUniforms;
            gl.useProgram(prog);
            gl.bindVertexArray(this.vao);
            gl.uniform1i(U.posX, 0);
            gl.uniform1i(U.posY, 1);
            gl.uniform2f(U.pushCenter, params.pushCenter.x, params.pushCenter.y);
            gl.uniform1f(U.pushRadius, params.pushRadius);
            gl.uniform1f(U.baseStrength, params.baseStrength);
            gl.uniform1f(U.forceVarMin, params.forceVarMin);
            gl.uniform1f(U.forceVarMax, params.forceVarMax);
            gl.uniform1f(U.angleVarMax, params.angleVarMax);
            gl.uniform1f(U.driftMax, params.driftMax);
            gl.uniform2f(U.particleResolution, W, H);
            gl.uniform1f(U.regionType, this.pRegion.type);
            gl.uniform2f(U.regionCenter, this.pRegion.cx, this.pRegion.cy);
            gl.uniform1f(U.regionR, this.pRegion.r);
            gl.uniform2f(U.regionHalfWH, this.pRegion.halfW, this.pRegion.halfH);
            gl.uniform1f(U.time, timeSec);
        };

        // Bind inputs
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.pPosX_A);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.pPosY_A);

        // Pass X
        setCommonUniforms(true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pPosX_FbB);
        gl.viewport(0, 0, W, H);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        // Swap X
        [this.pPosX_A, this.pPosX_B] = [this.pPosX_B, this.pPosX_A];
        [this.pPosX_FbA, this.pPosX_FbB] = [this.pPosX_FbB, this.pPosX_FbA];

        // Rebind inputs for Y pass (X updated is now in pPosX_A)
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.pPosX_A);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.pPosY_A);

        // Pass Y
        setCommonUniforms(false);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pPosY_FbB);
        gl.viewport(0, 0, W, H);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        // Swap Y
        [this.pPosY_A, this.pPosY_B] = [this.pPosY_B, this.pPosY_A];
        [this.pPosY_FbA, this.pPosY_FbB] = [this.pPosY_FbB, this.pPosY_FbA];

        return true;
    }

    downloadParticlePositions() {
        if (!this.supported || !this.pPosX_FbA || !this.pPosY_FbA) return null;
        const gl = this.gl;
        const W = this.particleTexWidth;
        const H = this.particleTexHeight;
        const xsRGBA = new Float32Array(W * H * 4);
        const ysRGBA = new Float32Array(W * H * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pPosX_FbA);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, xsRGBA);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.pPosY_FbA);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, ysRGBA);
        const out = new Float32Array(this.particleCount * 2);
        for (let i = 0; i < this.particleCount; i++) {
            out[i * 2] = xsRGBA[i * 4];
            out[i * 2 + 1] = ysRGBA[i * 4];
        }
        return out;
    }

    renderParticles(params = {}) {
        if (!this.supported || !this.pPosX_A || !this.pRadiusTex || !this.particleRenderProgram) return false;
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); // draw to canvas
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.particleRenderProgram);
        gl.bindVertexArray(this.vao);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        // Clear with transparent
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Bind textures
        gl.uniform1i(this.particleRenderUniforms.posX, 0);
        gl.uniform1i(this.particleRenderUniforms.posY, 1);
        gl.uniform1i(this.particleRenderUniforms.radius, 2);
        gl.uniform1i(this.particleRenderUniforms.gray, 3);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pPosX_A);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.pPosY_A);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.pRadiusTex);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.pGrayTex);

        // Params
        const outerScale = (params.outerScale != null) ? params.outerScale : 1.3;
        const darkScale = (params.darkScale != null) ? params.darkScale : 0.3;
        const highlightOffset = (params.highlightOffset != null) ? params.highlightOffset : 0.3;
        gl.uniform2f(this.particleRenderUniforms.resolution, this.width, this.height);
        gl.uniform1f(this.particleRenderUniforms.outerScale, outerScale);
        gl.uniform1f(this.particleRenderUniforms.darkScale, darkScale);
        gl.uniform1f(this.particleRenderUniforms.highlightOffset, highlightOffset);
        gl.uniform1f(this.particleRenderUniforms.count, this.particleCount);

        // Draw N points
        gl.drawArrays(gl.POINTS, 0, this.particleCount);
        return true;
    }
}

window.GPUCompute = GPUCompute;