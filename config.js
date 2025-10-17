// Configuration file for Thermal Brush Simulator parameters
const BrushConfig = {
    // Canvas dimensions
    canvas: {
        width: 800,
        height: 600
    },
    
    // Brush properties
    brush: {
        radius: 5,
        intensity: 0.5,
        threshold: 0.8
    },
    
    // Thermal simulation parameters
    thermal: {
        blurSigma: 2,           // Reduced for phone performance
        blurRadius: 9,          // Box blur radius for performance
        blurInterval: 1,        // Apply blur every 3rd frame
        sigmaMultiplier: 2.5,   // Multiplier for calculating gaussian radius
        maxGaussianRadius: 15,  // Maximum gaussian radius for performance
        decayRate: 0.995,       // Thermal decay rate per frame
        centerMultiplier: 1     // Center point intensity multiplier
    },
    
    // Performance settings
    performance: {
        maxPositionsPerFrame: 10,    // Reduced for phones
        contourSkipPixels: 0,       // Skip pixels for contour rendering
        contourInterval: 1          // Frames between contour overlay updates
    },
    
    // Smoothing settings
    smoothing: {
        alpha: 0.8,  // 0..1, higher = smoother but laggier
        useBresenham: true  // Use Bresenham's line algorithm for precise line drawing
    },
    
    // Visual appearance
    visual: {
        // Thermal colormap thresholds
        colormap: {
            firstTransition: 0.33,   // Gray to red transition
            secondTransition: 0.99,  // Red to orange transition
            thirdTransition: 0.01   // Orange to white transition (remaining)
        },
        
        // Contour rendering
        contour: {
            strokeColor: 'red',
            lineWidth: 5,
            // Rendering mode for threshold hits: 'color' | 'grayscale'
            thresholdMode: 'color',
            thresholdColor: 'red',
            // Rendering mode for persistent mask: 'color' | 'grayscale'
            persistentMode: 'grayscale',
            persistentColor: 'gray',
            // Grayscale mapping controls for both modes when set to 'grayscale'
            grayGamma: 1,          // non-linear contrast for grayscale mapping
            grayMin: 15,              // minimum gray value (0..255)
            grayMax: 200,            // maximum gray value (0..255)
            // Optional ceiling for normalization of max temperature values
            // If > 0, normalization uses min(observedMax, grayMaxCeiling)
            grayMaxCeiling: 1.2
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
        }
    },

    // Background animation settings
    background: {
        enabled: true,           // Toggle background layer on/off
        animate: true,           // Animate the top layer circles
        showFPS: false,          // Show FPS counter on background canvas
        pushRadius: 35,         // Mouse interaction radius
        bgCircleCount: 20000,    // Number of static background circles
    topCircleCount: 700,     // Number of animated top-layer circles
        baseColor: '#363636ff',  // Base fill color for background
        // Interaction mode: 'thermalBrush' routes mouse moves to ThermalBrush.apply via queue; 'circles' keeps original circle-push interaction
        interactionMode: 'thermalBrush',
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
                shadowOffset: 5,
                shadowAlphaInner: 0.6,
                shadowAlphaOuter: 0.1
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
            randomKickMax: 15          // max random kick distance (px)
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
        enabled: true
    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BrushConfig;
}