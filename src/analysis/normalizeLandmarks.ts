/**
 * Landmark normalization utilities.
 *
 * Ensures landmarks are in a canonical (non-mirrored) coordinate frame
 * before any metric calculations. Also provides side-consistency checks
 * for profile captures.
 */

import type { NormalizedLandmark, CaptureAngle } from '../types';
import * as L from './landmarks';

// ─── Mirror normalization ──────────────────────────────────────────────────

/**
 * If the capture was mirrored (selfie-mode), flip x-coordinates to canonical frame.
 * For non-mirrored captures this is a no-op (returns input as-is).
 */
export function normalizeLandmarksToCanonical(
  landmarks: NormalizedLandmark[],
  _angle: CaptureAngle,
  mirrored: boolean,
): NormalizedLandmark[] {
  if (!mirrored) return landmarks;

  // Flip horizontally: x' = 1 - x.  y and z remain unchanged.
  return landmarks.map((lm) => ({
    x: 1 - lm.x,
    y: lm.y,
    z: lm.z,
  }));
}

// ─── Profile direction detection ───────────────────────────────────────────

/**
 * Detect which direction a face is pointing by comparing the nose tip
 * x-position to the jaw midpoint x-position.
 *
 * In MediaPipe canonical coordinates (non-mirrored):
 * - If nose tip is LEFT of jaw midpoint → face points left (user's left profile visible)
 * - If nose tip is RIGHT of jaw midpoint → face points right (user's right profile visible)
 * - If roughly centered → frontal
 *
 * @returns 'left' | 'right' | 'frontal'
 */
export function detectProfileDirection(
  landmarks: NormalizedLandmark[],
): 'left' | 'right' | 'frontal' {
  if (!landmarks || landmarks.length < 478) return 'frontal';

  const noseTipX = landmarks[L.NOSE.tip].x;
  const jawMidX = (landmarks[L.JAW.rightAngle].x + landmarks[L.JAW.leftAngle].x) / 2;
  const faceWidth = Math.abs(landmarks[L.JAW.rightAngle].x - landmarks[L.JAW.leftAngle].x);

  if (faceWidth === 0) return 'frontal';

  const offset = (noseTipX - jawMidX) / faceWidth;

  // Threshold: if nose deviates > 15% of face width from center, it's a profile
  if (offset < -0.15) return 'left';
  if (offset > 0.15) return 'right';
  return 'frontal';
}

// ─── Side-consistency validation ───────────────────────────────────────────

export interface ProfileValidation {
  /** Detected direction of the face */
  detected: 'left' | 'right' | 'frontal';
  /** Declared angle from the capture step */
  declared: CaptureAngle;
  /** Whether detection matches declaration */
  consistent: boolean;
  /** Warning message if inconsistent */
  warning?: string;
}

/**
 * Validate that a profile capture's declared angle matches the detected
 * face direction.  If inconsistent, returns a warning (caller decides
 * whether to auto-swap or just log).
 */
export function validateProfileSide(
  landmarks: NormalizedLandmark[],
  declaredAngle: CaptureAngle,
): ProfileValidation {
  const detected = detectProfileDirection(landmarks);

  if (declaredAngle === 'front') {
    return {
      detected,
      declared: declaredAngle,
      consistent: detected === 'frontal',
      warning: detected !== 'frontal'
        ? `Фронтальный снимок, но лицо повёрнуто (${detected})`
        : undefined,
    };
  }

  const consistent = detected === declaredAngle;
  return {
    detected,
    declared: declaredAngle,
    consistent,
    warning: !consistent
      ? `Заявлен ${declaredAngle} профиль, но детекция показала ${detected}. Метки профилей могут быть перепутаны.`
      : undefined,
  };
}
