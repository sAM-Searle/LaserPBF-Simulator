// Configuration file for Thermal Brush Simulator parameters
const BrushConfig = {
    // Canvas dimensions
    canvas: {
        width: 800,
        height: 600
    },
    
    // Brush properties
    brush: {
        radius: 20,
        intensity: 0.1,
        threshold: 0.95
    },
    
    // Thermal simulation parameters (kept minimal)
    thermal: {
        // Controls blur applied to the thermal field (affects smoothness/perf)
        blurSigma: 3,
        blurRadius: 9,
        // How often to apply the blur (frames). 1 = every frame.
        blurInterval: 1,
        // Per-frame decay applied to thermal values (0..1). Values <1 slowly fade.
        decayRate: 0.99
    },
    
    // Performance settings
    performance: {
        maxPositionsPerFrame: 10,    // Reduced for phones
        contourSkipPixels: 1,        // Skip pixels for contour rendering (>=1 recommended on CPU)
        contourInterval: 0,          // Frames between contour overlay updates (increase to lighten CPU)
        debugUpdateInterval: 30,     // Update debug info every N frames
        debugSampleStep: 1,          // Sample every Nth pixel for debug stats to reduce cost
        
        // GPU acceleration settings
        useGPU: true,               // Enable GPU acceleration if available
        gpuBatchSize: 10,         // Number of brush applications to batch for GPU
        gpuFallback: true,          // Automatically fallback to CPU if GPU fails
        gpuSyncInterval: 1,     // Frames between GPU->CPU thermal sync (higher = less CPU but more latency)
        gpuMaskSyncInterval: 1,     // Frames between GPU->CPU max/persistent syncs
        pauseBackgroundOnSlowCPU: false, // If true, pause animated background when CPU frames are slow
        slowCpuFrameMs: 22          // Threshold in ms to consider frame slow (about half refresh @ 60Hz)
    },
    
    // Smoothing settings
    smoothing: {
        alpha: 0.9,  // 0..1, higher = smoother but laggier
        useBresenham: true  // Use Bresenham's line algorithm for precise line drawing
    },
    
    // Visual appearance
    visual: {
        // Thermal colormap thresholds
        colormap: {
            firstTransition: 0.33,   // Gray to red transition
            secondTransition: 0.80,   // Red to orange transition (increased to eliminate white)
            thirdTransition: 0.95  // Orange to white transition (remaining) - now unused
        },
        
        // Contour rendering
        contour: {
            strokeColor: 'red',
            lineWidth: 20,
            // Rendering mode for threshold hits: 'color' | 'grayscale'
            thresholdMode: 'color',
            thresholdColor: 'black',
            // Rendering mode for persistent mask: 'color' | 'grayscale'
            persistentMode: 'grayscale',
            persistentColor: 'gray',
            // Controls alpha scaling for contour overlay (0..1). 1.0 = unchanged
            alphaScale: 0,
            // Grayscale mapping controls for both modes when set to 'grayscale'
            grayGamma: 1.3,          // non-linear contrast for grayscale mapping
            grayMin: 70,              // minimum gray value (0..255)
            grayMax: 180,            // maximum gray value (0..255)
            // Minimum value for a change to be visualized in the contour overlay
            minimumChangeValue: 75,   // Set to your desired threshold (e.g., 0.01)
        },
        
        // Laser position visualization
        laser: {
            radius: 1,
            color: '#00ff00',  // Bright green
            alpha: 0.1
        },

        // Foreground overlay behavior (how alpha is computed)
        overlay: {
            // 'temperature' uses temperature to drive alpha (cool = transparent, hot = opaque), 'opaque' forces full opacity
            alphaMode: 'temperature',
            // Additional scale factor applied to computed alpha (0..1). 1.0 = no change
            alphaScale: 1.0
        },

        // Square overlay configuration
        squareOverlay: {
            enabled: true,       // Toggle square overlay on/off
            size: 300,           // Size in pixels
            color: "#00ff00",    // Any CSS color (hex, rgb, named)
            lineWidth: 4,        // Border thickness
            alpha: 0.5           // Transparency (0 = fully transparent, 1 = opaque)
        },

        // Particle effects for brush visualization
        particles: {
            numPerPosition: 5,                 // Average number of particles created per brush position (can be fractional)
            velocity: { min: 1, max: 5 },        // Velocity range (pixels per frame)
            fadeRate: 0.02,                      // Alpha decrease per frame
            maxParticles: 50,                   // Maximum number of particles
            size: 3,                             // Particle radius
            colors: ['234,130,11', '141,76,12', '255,255,255'],  // RGB values for red, orange, white
            startAlpha: 1,                       // Starting alpha value
            recirculationFlow: -0.3               // Y acceleration (pixels per frame squared)
        }
    },

    // Background animation settings
    background: {
        enabled: true,           // Toggle background layer on/off
        animate: true,           // Animate the top layer circles
        showFPS: false,          // Show FPS counter on background canvas
        pushRadius: 45,         // Mouse interaction radius
        bgCircleCount: 20000,    // Number of static background circles
        topCircleCount: 1000,     // Number of animated top-layer circles
        baseColor: '#363636ff',  // Base fill color for background
        // Interaction mode: 'thermalBrush' routes mouse moves to ThermalBrush.apply via queue; 'circles' keeps original circle-push interaction
        interactionMode: 'thermalBrush',
        // Use GPU for animating top-layer particles (if available)
        useGpuParticles: true,
        // How often to sync GPU particle positions back for CPU drawing (frames)
        gpuParticleSyncInterval: 1,
        // Prerendered sprite settings for top-layer circles
        sprites: {
            enabled: true,
            radiusStep: 0.5,   // quantize radius to reduce cache size
            grayStep: 5        // quantize gray to reduce cache size
        },
        // Fully GPU-rendered top-layer (point sprites). Overrides sprite path when on.
        renderTopOnGPU: true,
        // Visual controls for background rendering
        visual: {
            // Static (baked) circle layer
            static: {
                radiusMin: 3,            // min radius (px)
                radiusMax: 5,            // max radius (px)
                outerScale: 1.1,         // outerRadius = radius * outerScale
                grayMin: 100,            // inner gray range (R=G=B)
                grayMax: 200,
                highlightOffsetScale: 0.3, // inner light offset: x - radius * scale
                mainDarkScale: 0.2,      // outer color darkness factor (gray * scale)
                shadowOffset: 5,         // px offset for shadow placement
                shadowAlphaInner: 0.5,   // radial gradient inner alpha
                shadowAlphaOuter: 0.1    // radial gradient outer alpha
            },
            // Top (animated) circle layer
            top: {
                radiusMin: 3,
                radiusMax: 5,
                outerScale: 1.1,
                grayMin: 150,
                grayMax: 300,            // values > 255 are clamped by browser
                highlightOffsetScale: 0.3,
                mainDarkScale: 0.3,
                shadowOffset: 1,
                shadowAlphaInner: 1,
                shadowAlphaOuter: 0.3
            }
        },
        // Motion/interaction controls for top layer
        motion: {
            pushStrengthBase: 10,      // base multiplier for push distance
            forceVariationMin: 0.2,    // multiplier min for randomness
            forceVariationMax: 1.8,    // multiplier max for randomness
            angleVariationMaxRad: 2.09439510239, // ~120deg (pi/1.5) total span +/-60deg
            driftMax: 4,               // max random drift per update (px)
            randomKickChance: 0.1,     // probability of random kick per circle per frame
            randomKickMax: 15,         // max random kick distance (px)
            deleteChance: 0.05          // probability (0..1) to delete particle instead of moving it
        },
        // Region where top particles are allowed (and spawned)
        // type: 'circle' uses a centered circle with radiusRatio of min(width,height)
        // type: 'rect' uses a centered rectangle with widthRatio/heightRatio of canvas
        topRegion: {
            type: 'circle',
            radiusRatio: 0.35,      // circle radius as fraction of min(canvasWidth, canvasHeight)
            widthRatio: 0.6,        // used when type === 'rect'
            heightRatio: 0.6        // used when type === 'rect'
        }
    },
    
    // Debug settings
    debug: {
        enabled: false,
        logInputPositions: false

    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BrushConfig;
}