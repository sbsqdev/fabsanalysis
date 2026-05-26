import { useRef, useState, useCallback } from 'react';
import { useT } from '../lib/language';
import type { AngleCapture, CaptureAngle } from '../types';

interface Props {
  onImageReady: (canvas: HTMLCanvasElement, imageData: ImageData, source: 'photo' | 'camera') => void;
  onMultiPhotoReady?: (captures: AngleCapture[]) => void;
  cameraError: string | null;
  onStartGuidedCapture: () => void;
}

type SlotAngle = 'front' | 'left' | 'right';

interface PhotoSlot {
  angle: SlotAngle;
  canvas: HTMLCanvasElement | null;
}

function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Not an image'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

export default function CaptureScreen({
  onImageReady,
  onMultiPhotoReady,
  cameraError,
  onStartGuidedCapture,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slotFileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [slots, setSlots] = useState<PhotoSlot[]>([
    { angle: 'front', canvas: null },
    { angle: 'left', canvas: null },
    { angle: 'right', canvas: null },
  ]);
  const [multiMode, setMultiMode] = useState(false);
  const [activeSlot, setActiveSlot] = useState<SlotAngle | null>(null);
  const t = useT();

  const processFiles = useCallback(async (files: File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 3);
    if (imageFiles.length === 0) return;

    if (imageFiles.length === 1) {
      // Single file: use existing single-photo flow
      const canvas = await fileToCanvas(imageFiles[0]);
      const ctx = canvas.getContext('2d')!;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      onImageReady(canvas, imageData, 'photo');
      return;
    }

    // Multiple files: enter multi-photo assignment mode
    const canvases = await Promise.all(imageFiles.map(fileToCanvas));
    const ANGLES: SlotAngle[] = ['front', 'left', 'right'];
    setSlots(ANGLES.map((angle, i) => ({
      angle,
      canvas: canvases[i] ?? null,
    })));
    setMultiMode(true);
  }, [onImageReady]);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      await processFiles(Array.from(fileList));
    },
    [processFiles],
  );

  const handleSlotFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeSlot) return;
    try {
      const canvas = await fileToCanvas(file);
      setSlots((prev) => prev.map((s) => s.angle === activeSlot ? { ...s, canvas } : s));
    } catch { /* ignore */ }
    setActiveSlot(null);
  }, [activeSlot]);

  const handleStartAnalysis = useCallback(() => {
    const frontSlot = slots.find((s) => s.angle === 'front');
    if (!frontSlot?.canvas) return;

    const captures: AngleCapture[] = slots
      .filter((s) => s.canvas !== null)
      .map((s) => {
        const ctx = s.canvas!.getContext('2d')!;
        const imageData = ctx.getImageData(0, 0, s.canvas!.width, s.canvas!.height);
        return { canvas: s.canvas!, imageData, angle: s.angle as CaptureAngle, mirrored: false };
      });

    if (onMultiPhotoReady && captures.length > 1) {
      onMultiPhotoReady(captures);
    } else {
      const front = captures[0];
      onImageReady(front.canvas, front.imageData, 'photo');
    }
  }, [slots, onMultiPhotoReady, onImageReady]);

  const slotLabel = (angle: SlotAngle) => {
    if (angle === 'front') return t('capture.multiPhotoSlotFront');
    if (angle === 'left') return t('capture.multiPhotoSlotLeft');
    return t('capture.multiPhotoSlotRight');
  };

  if (multiMode) {
    const frontReady = slots.find((s) => s.angle === 'front')?.canvas != null;
    return (
      <div className="flex flex-col items-center justify-start pt-8 sm:pt-12 px-4 pb-8 min-h-screen">
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{t('capture.multiPhotoTitle')}</h1>
          <p className="text-sm text-gray-500 max-w-sm">{t('capture.multiPhotoHint')}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-8 w-full max-w-md">
          {slots.map((slot) => (
            <div key={slot.angle} className="flex-1 flex flex-col items-center gap-2">
              <div
                className="relative w-full aspect-[3/4] rounded-xl overflow-hidden border-2 border-dashed border-gray-200 bg-gray-50 cursor-pointer hover:border-brand-400 transition-colors"
                onClick={() => {
                  setActiveSlot(slot.angle);
                  slotFileInputRef.current?.click();
                }}
              >
                {slot.canvas ? (
                  <img
                    src={slot.canvas.toDataURL()}
                    alt={slotLabel(slot.angle)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="text-xs">{t('capture.multiPhotoAdd')}</span>
                  </div>
                )}
                {slot.canvas && (
                  <button
                    className="absolute bottom-2 left-2 right-2 text-[10px] bg-black/50 text-white rounded-lg py-1 hover:bg-black/70 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveSlot(slot.angle);
                      slotFileInputRef.current?.click();
                    }}
                  >
                    {t('capture.multiPhotoChange')}
                  </button>
                )}
              </div>
              <span className="text-xs font-medium text-gray-600">{slotLabel(slot.angle)}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 w-full max-w-sm">
          <button
            onClick={handleStartAnalysis}
            disabled={!frontReady}
            className="btn-primary w-full py-3.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('capture.multiPhotoAnalyze')}
          </button>
          <button
            onClick={() => setMultiMode(false)}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            ← Назад
          </button>
        </div>

        <input
          ref={slotFileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleSlotFileChange}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-start sm:justify-center pt-8 sm:pt-0 sm:min-h-[80vh] px-4 pb-8">
      {/* Header */}
      <div className="text-center mb-6 sm:mb-10">
        <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-brand-100 mb-3 sm:mb-4">
          <svg className="w-6 h-6 sm:w-8 sm:h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{t('capture.title')}</h1>
        <p className="text-sm sm:text-base text-gray-500 max-w-md px-2">
          <span className="sm:hidden">{t('capture.descMobile')}</span>
          <span className="hidden sm:inline">{t('capture.descDesktop')}</span>
        </p>
      </div>

      {/* Input Options */}
      <div className="flex flex-col gap-3 mb-6 sm:mb-8 w-full max-w-sm">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="relative h-12 w-full rounded-xl overflow-hidden bg-zinc-900 transition-all duration-200 group"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-amber-400 via-brand-500 to-amber-600 opacity-30 group-hover:opacity-60 blur-sm transition-opacity duration-500" />
          <div className="relative flex items-center justify-center gap-2.5 h-full">
            <svg className="w-4.5 h-4.5 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span className="text-white font-medium text-sm">{t('capture.uploadPhoto')}</span>
          </div>
        </button>

        <button
          onClick={onStartGuidedCapture}
          className="relative h-14 w-full rounded-xl overflow-hidden bg-zinc-900 transition-all duration-200 group"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-50 group-hover:opacity-80 blur-sm transition-opacity duration-500" />
          <div className="relative flex flex-col items-center justify-center h-full gap-0.5">
            <div className="flex items-center gap-2.5">
              <svg className="w-4.5 h-4.5 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-white font-medium text-sm">{t('capture.cameraBtn')}</span>
            </div>
            <span className="text-[10px] text-white/60 font-medium tracking-wide uppercase">{t('capture.recommended')}</span>
          </div>
        </button>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`hidden sm:block w-full max-w-lg border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-200'
        }`}
      >
        <p className="text-gray-400 text-sm">
          {t('capture.dropHint')}
        </p>
      </div>

      {cameraError && (
        <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {cameraError}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <p className="mt-6 text-xs text-gray-400 max-w-md text-center hidden sm:block">
        {t('capture.privacyNotice')}
      </p>
    </div>
  );
}
