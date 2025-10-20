const assert = require('assert');
const BrushConfig = require('../config.js');

const maxPositionsPerFrame = Math.max(1, BrushConfig.performance.maxPositionsPerFrame || 1);
const maxDelayFrames = Math.max(0, BrushConfig.performance.maxDelayFrames || 0);
const decayRate = (BrushConfig.thermal && typeof BrushConfig.thermal.decayRate === 'number')
    ? BrushConfig.thermal.decayRate
    : 1.0;

const stepDecay = Math.pow(decayRate, 1 / maxPositionsPerFrame);

function computeDelay(frameStamp, enqueuedFrame) {
    return Math.max(0, Math.min(frameStamp - enqueuedFrame, maxDelayFrames));
}

function computeIntensityScale(processedIndex, delayFrames) {
    const stepScale = Math.pow(stepDecay, processedIndex);
    const delayScale = Math.pow(decayRate, delayFrames);
    return stepScale * delayScale;
}

function approxEqual(a, b, epsilon = 1e-12) {
    return Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b));
}

// Delay computation should behave intuitively
assert.strictEqual(computeDelay(5, 5), 0, 'No delay when processed in the same frame');
assert.strictEqual(computeDelay(5, 3), 2, 'Delay equals frame difference when below cap');
assert.strictEqual(computeDelay(10, -5), Math.min(15, maxDelayFrames), 'Negative enqueue frames clamp at cap');
assert.strictEqual(computeDelay(500, 0), maxDelayFrames, 'Delay clamps to configured maximum');

// Intensity scaling should match the analytical expectation: decay^(delay + processed/maxPositionsPerFrame)
const samples = [
    { processed: 0, delay: 0 },
    { processed: Math.floor(maxPositionsPerFrame / 2), delay: 1 },
    { processed: maxPositionsPerFrame - 1, delay: 3 },
    { processed: Math.floor(maxPositionsPerFrame / 3), delay: 5 }
];

for (const { processed, delay } of samples) {
    const expected = Math.pow(decayRate, delay + processed / maxPositionsPerFrame);
    const actual = computeIntensityScale(processed, delay);
    assert(
        approxEqual(actual, expected),
        `Intensity scale mismatch for processed=${processed}, delay=${delay}: expected ${expected}, got ${actual}`
    );
}

console.log('All intensity scaling tests passed.');
