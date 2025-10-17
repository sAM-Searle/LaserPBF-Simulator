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
        threshold: 0.5
    },
    
    // Thermal simulation parameters
    thermal: {
        blurSigma: 2,           // Reduced for phone performance
        blurRadius: 9,          // Box blur radius for performance
        blurInterval: 1,        // Apply blur every 3rd frame
        sigmaMultiplier: 2.5,   // Multiplier for calculating gaussian radius
        maxGaussianRadius: 15,  // Maximum gaussian radius for performance
        decayRate: 0.995,       // Thermal decay rate per frame
        centerMultiplier: 2     // Center point intensity multiplier
    },
    
    // Performance settings
    performance: {
        maxPositionsPerFrame: 10,    // Reduced for phones
        contourSkipPixels: 2        // Skip pixels for contour rendering
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
            secondTransition: 0.66,  // Red to orange transition
            thirdTransition: 0.34    // Orange to white transition (remaining)
        },
        
        // Contour rendering
        contour: {
            strokeColor: 'red',
            lineWidth: 1,
            thresholdColor: 'red',
            persistentColor: 'black'
        },
        
        // Laser position visualization
        laser: {
            radius: 1,
            color: '#00ff00',  // Bright green
            alpha: 0.1
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