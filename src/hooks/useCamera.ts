import { useCallback, useRef, useState } from 'react';
import { getCurrentLang } from '../lib/language';
import ru from '../locales/ru';
import en from '../locales/en';

export interface CameraState {
  stream: MediaStream | null;
  isActive: boolean;
  error: string | null;
}

export interface UseCameraOptions {
  /** Optional override for requested camera constraints. */
  videoConstraints?: MediaTrackConstraints;
  /** Emit extra diagnostics to console. */
  debug?: boolean;
}

const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

export function useCamera(options: UseCameraOptions = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CameraState>({
    stream: null,
    isActive: false,
    error: null,
  });

  const attachStreamToVideo = useCallback(async (stream: MediaStream) => {
    const video = videoRef.current;
    if (!video) return;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    try {
      await video.play();
    } catch (err) {
      // Browser can momentarily block playback while switching elements.
      if (options.debug) {
        console.warn('[Camera] video.play() was temporarily blocked:', err);
      }
    }
  }, [options.debug]);

  const setVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (node && state.stream) {
        void attachStreamToVideo(state.stream);
      }
    },
    [attachStreamToVideo, state.stream],
  );

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { ...DEFAULT_VIDEO_CONSTRAINTS, ...options.videoConstraints },
        audio: false,
      });

      await attachStreamToVideo(stream);

      setState({ stream, isActive: true, error: null });
    } catch (err) {
      if (options.debug) {
        console.error('[Camera] Failed to start camera:', err);
      }
      const tCam = (key: string) => {
        const lang = getCurrentLang();
        return (lang === 'en' ? en : ru)[key] ?? key;
      };
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? tCam('camera.notAllowed')
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? tCam('camera.notFound')
            : tCam('camera.genericError');
      setState({ stream: null, isActive: false, error: message });
    }
  }, [attachStreamToVideo, options.debug, options.videoConstraints]);

  const stopCamera = useCallback(() => {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setState({ stream: null, isActive: false, error: null });
  }, [state.stream]);

  /** Capture current video frame as ImageData + canvas snapshot.
   *  mirror=true flips horizontally so the result matches the mirrored preview. */
  const captureFrame = useCallback((mirror = true): {
    canvas: HTMLCanvasElement;
    imageData: ImageData;
  } | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    if (mirror) ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { canvas, imageData };
  }, []);

  return { videoRef: setVideoRef, ...state, startCamera, stopCamera, captureFrame };
}
