import { useCallback, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { NormalizedLandmark } from '../types';
import { getCurrentLang } from '../lib/language';
import ruData from '../locales/ru';
import enData from '../locales/en';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const GPU_TIMEOUT_MS = 3000;

export interface FaceMeshResult {
  landmarks: NormalizedLandmark[];
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

// Module-level singleton — survives component remounts
let _landmarker: FaceLandmarker | null = null;
let _delegate: 'GPU' | 'CPU' | null = null;
let _initPromise: Promise<void> | null = null;

export function useFaceMesh() {
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(!!_landmarker);
  const [error, setError] = useState<string | null>(null);
  const delegateRef = useRef<'GPU' | 'CPU' | null>(_delegate);

  const initialize = useCallback(async () => {
    if (_landmarker) {
      setIsReady(true);
      return;
    }

    if (_initPromise) {
      await _initPromise;
      delegateRef.current = _delegate;
      setIsReady(true);
      return;
    }

    setIsLoading(true);
    setError(null);

    _initPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      const createLandmarker = (delegate: 'GPU' | 'CPU') =>
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'IMAGE',
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });

      // Try GPU with a timeout — on iOS Safari it often hangs rather than rejects
      const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
      if (gpuAvailable) {
        const gpuTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('GPU timeout')), GPU_TIMEOUT_MS),
        );
        try {
          _landmarker = await Promise.race([createLandmarker('GPU'), gpuTimeout]);
          _delegate = 'GPU';
        } catch (gpuErr) {
          console.warn('GPU delegate failed/timeout, falling back to CPU:', gpuErr);
          _landmarker = await createLandmarker('CPU');
          _delegate = 'CPU';
        }
      } else {
        _landmarker = await createLandmarker('CPU');
        _delegate = 'CPU';
      }
    })();

    try {
      await _initPromise;
      delegateRef.current = _delegate;
      setIsReady(true);
    } catch (err) {
      _initPromise = null;
      console.error('FaceMesh init error:', err);
      const lang = getCurrentLang();
      const dict = lang === 'en' ? enData : ruData;
      setError(dict['facemesh.loadError'] ?? ruData['facemesh.loadError']);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const detect = useCallback(
    (source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): FaceMeshResult | null => {
      if (!_landmarker) return null;

      try {
        const result = _landmarker.detect(source);
        if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;

        const rawLandmarks = result.faceLandmarks[0];
        const landmarks: NormalizedLandmark[] = rawLandmarks.map((lm) => ({
          x: lm.x,
          y: lm.y,
          z: lm.z ?? 0,
        }));

        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const lm of landmarks) {
          if (lm.x < minX) minX = lm.x;
          if (lm.x > maxX) maxX = lm.x;
          if (lm.y < minY) minY = lm.y;
          if (lm.y > maxY) maxY = lm.y;
        }

        const bbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        const confidence = Math.min(1, bbox.width * bbox.height * 4 + 0.5);

        return { landmarks, confidence, bbox };
      } catch (err) {
        console.error('Face detection error:', err);
        return null;
      }
    },
    [],
  );

  return { initialize, detect, isLoading, isReady, error, usedDelegate: delegateRef.current };
}
