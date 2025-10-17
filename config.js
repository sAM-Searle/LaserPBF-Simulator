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
        blurRadius: 2,          // Box blur radius for performance
        blurInterval: 3         // Apply blur every 3rd frame
    },
    
    // Performance settings
    performance: {
        maxPositionsPerFrame: 20,    // Reduced for phones
        contourSkipPixels: 2        // Skip pixels for contour rendering
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