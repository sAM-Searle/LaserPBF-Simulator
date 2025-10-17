// Configuration file for Thermal Brush Simulator parameters
// Don't modify the values that are here
const BrushConfig = {
    // Canvas dimensions
    canvas: {
        width: 800,
        height: 600
    },
    
    // Brush properties
    brush: {
        radius: 9,
        intensity: 0.1,
        threshold: 0.5,
        centerBoostMultiplier: 2,   // Extra intensity at brush center
        type: 'gaussian',           // 'gaussian' or 'linear'
        falloffPower: 1.0           // Controls brush edge sharpness
    },
    
    // Thermal simulation parameters
    thermal: {
        blurSigma: 100,           
        blurRadius: 21,          
        blurInterval: 1,
        coolingRate: 0.99,         // Heat dissipation per frame (0.99 = 1% cooling)
        heatAccumulation: true,     // Whether heat accumulates or replaces
        maxTemperature: 2.0,        // Maximum thermal value cap
        ambientTemperature: 0.0     // Base temperature level
    },
    
    // Performance settings
    performance: {
        maxPositionsPerFrame: 20,    
        contourSkipPixels: 2,       
        smoothingFactor: 0.2,       
        renderContours: true,       
        contourOpacity: 1,         
        thermalOpacity: 0.8         // Opacity for thermal brush strokes
    },
    
    // Visual appearance
    visual: {
        // Thermal colormap thresholds and colors
        colormap: {
            firstTransition: 0.33,   // Gray to red transition
            secondTransition: 0.80,  // Red to orange transition
            thirdTransition: 0.20,   // Orange to white transition (remaining)
            
            // Color definitions (RGB 0-255)
            coldColor: { r: 128, g: 128, b: 128 },      // Gray
            warmColor: { r: 255, g: 0, b: 0 },          // Red
            hotColor: { r: 255, g: 128, b: 0 },         // Orange
            maxColor: { r: 255, g: 255, b: 255 }        // White
        },
        
        // Contour rendering
        contour: {
            strokeColor: 'red',
            lineWidth: 1,
            thresholdColor: 'red',
            persistentColor: 'black'
        },
        
        // Position queue visualization
        queue: {
            showQueue: true,        // Enable/disable queue visualization
            dotColor: 'blue',       // Color of queue position dots
            dotSize: 2,             // Size of queue dots in pixels
            maxDotsShown: 100,       // Maximum number of queue dots to show
            fadeEffect: true        // Whether dots fade based on queue position
        },
        
        // Background settings
        background: {
            color: '#fffbfbff'      // Gray background
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