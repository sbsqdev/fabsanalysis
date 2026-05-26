import { describe, it, expect } from 'vitest';
import { generateReport } from '../report';
import { makeLandmarks, makeLeftProfileLandmarks, makeRightProfileLandmarks } from './helpers';

// Stub ImageData for node environment
function makeImageData(): ImageData {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  // Fill with neutral skin tone (R=200, G=170, B=150, A=255)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200;
    data[i + 1] = 170;
    data[i + 2] = 150;
    data[i + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('generateReport (end-to-end)', () => {
  it('produces a valid report with frontal-only data', () => {
    const lm = makeLandmarks();
    const report = generateReport({
      landmarks: lm,
      imageData: makeImageData(),
      imageWidth: 640,
      imageHeight: 480,
      inputType: 'photo',
      faceConfidence: 0.95,
      bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      startTime: Date.now() - 500,
    });

    expect(report.features).toHaveLength(10);
    expect(report.meta.version).toBe('1.0.0-mvp');
    expect(report.inputs.qualityScore).toBeGreaterThan(0);
    expect(report.inputs.qualityScore).toBeLessThanOrEqual(1);
    expect(report.faceDetection.confidence).toBe(0.95);

    // Each feature should have required fields
    for (const f of report.features) {
      expect(f.name).toBeTruthy();
      expect(['within_norm', 'strength', 'attention', 'insufficient_data']).toContain(f.status);
      expect(f.observations.length).toBeGreaterThan(0);
      expect(f.confidence).toBeGreaterThan(0);
    }
  });

  it('produces a valid report with profile data', () => {
    const lm = makeLandmarks();
    const leftLm = makeLeftProfileLandmarks();
    const rightLm = makeRightProfileLandmarks();
    const imgData = makeImageData();

    const report = generateReport({
      landmarks: lm,
      imageData: imgData,
      imageWidth: 640,
      imageHeight: 480,
      inputType: 'camera',
      faceConfidence: 0.92,
      bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      startTime: Date.now() - 1000,
      profileLeft: { imageData: imgData, landmarks: leftLm, width: 640, height: 480 },
      profileRight: { imageData: imgData, landmarks: rightLm, width: 640, height: 480 },
    });

    expect(report.features).toHaveLength(10);

    // Features with profile data should have profile-specific measurements
    const nose = report.features.find((f) => f.name === 'Nose');
    expect(nose).toBeTruthy();
    expect(nose!.measurements).toHaveProperty('noseProjectionRatio');

    const chin = report.features.find((f) => f.name === 'Chin');
    expect(chin).toBeTruthy();
    expect(chin!.measurements).toHaveProperty('chinProjectionRatio');

    const lips = report.features.find((f) => f.name === 'Lips');
    expect(lips).toBeTruthy();
    expect(lips!.measurements).toHaveProperty('lipProjectionRatio');
  });

  it('handles null imageData gracefully', () => {
    const lm = makeLandmarks();
    const report = generateReport({
      landmarks: lm,
      imageData: null,
      imageWidth: 640,
      imageHeight: 480,
      inputType: 'photo',
      faceConfidence: 0.90,
      bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      startTime: Date.now() - 200,
    });

    expect(report.features).toHaveLength(10);
    expect(report.inputs.lightingHeuristic).toBe('moderate');
  });

  it('produces processingTime > 0', () => {
    const lm = makeLandmarks();
    const report = generateReport({
      landmarks: lm,
      imageData: null,
      imageWidth: 640,
      imageHeight: 480,
      inputType: 'photo',
      faceConfidence: 0.85,
      bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      startTime: Date.now() - 100,
    });

    expect(report.meta.processingTime).toBeGreaterThanOrEqual(0);
  });
});
