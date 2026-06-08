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
    <div className="flex flex-col items-center justify-center min-h-[90vh] px-5 py-10">
      {/* Hero area */}
      <div className="text-center mb-10 max-w-xs">
        {/* Lips icon */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-50 border border-rose-100 mb-5 shadow-sm">
          <svg className="w-8 h-8 text-rose-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3.5c-2.5 0-4.5 1-6 2.5C4.5 7.5 3 9 3 11c0 1.5.7 2.8 2 3.7C6 16 8.5 17 12 17s6-1 7-2.3c1.3-.9 2-2.2 2-3.7 0-2-1.5-3.5-3-5C16.5 4.5 14.5 3.5 12 3.5z" opacity=".15"/>
            <path d="M17.5 7.5C15.8 5.9 14 5 12 5S8.2 5.9 6.5 7.5C5.3 8.6 4 10.2 4 12c0 1.2.6 2.2 1.6 3 1.2.9 3.4 1.8 6.4 1.8s5.2-.9 6.4-1.8c1-.8 1.6-1.8 1.6-3 0-1.8-1.3-3.4-2.5-4.5zm-5.5 7c-2.3 0-4.4-.7-5.5-1.6-.7-.5-1-1.1-1-1.9 0-1.2 1-2.5 2-3.4C8.8 6.8 10.3 6 12 6s3.2.8 4.5 1.7c1 .9 2 2.2 2 3.4 0 .8-.3 1.4-1 1.9-1.1.9-3.2 1.5-5.5 1.5z"/>
            <path d="M12 9.5c-1 0-2 .3-2.8.8-.2.1-.2.4 0 .5.3.2.8.4 1.5.6.4.1.9.1 1.3.1s.9 0 1.3-.1c.7-.2 1.2-.4 1.5-.6.2-.1.2-.4 0-.5-.8-.5-1.8-.8-2.8-.8z"/>
          </svg>
        </div>
        <h1 className="font-serif text-3xl font-semibold text-charcoal mb-2.5">
          {t('capture.title')}
        </h1>
        <p className="text-sm text-gray-500 leading-relaxed">
          <span className="sm:hidden">{t('capture.descMobile')}</span>
          <span className="hidden sm:inline">{t('capture.descDesktop')}</span>
        </p>
      </div>

      {/* Photo guide */}
      <div className="mb-8 w-full max-w-xs">
        <p className="text-[11px] font-medium text-gray-400 text-center mb-3 uppercase tracking-wide">Как должно выглядеть фото</p>
        <div className="grid grid-cols-3 gap-2">
          {/* Good */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-full aspect-[3/4] rounded-xl bg-emerald-50 border-2 border-emerald-300 flex items-center justify-center relative overflow-hidden">
              <svg viewBox="0 0 60 80" className="w-10 h-14" fill="none">
                <ellipse cx="30" cy="38" rx="20" ry="28" fill="#fde8d0" stroke="#d4956a" strokeWidth="1.5"/>
                <ellipse cx="22" cy="32" rx="3" ry="3.5" fill="#333"/>
                <ellipse cx="38" cy="32" rx="3" ry="3.5" fill="#333"/>
                <circle cx="30" cy="42" r="1.5" fill="#d4956a"/>
                <path d="M24 50 Q30 56 36 50" stroke="#d4956a" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <span className="text-[10px] text-gray-500 text-center leading-tight">Лицо прямо,<br/>хорошее освещение</span>
          </div>

          {/* Too dark */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-full aspect-[3/4] rounded-xl bg-gray-900 border-2 border-gray-600 flex items-center justify-center relative overflow-hidden">
              <svg viewBox="0 0 60 80" className="w-10 h-14 opacity-15" fill="none">
                <ellipse cx="30" cy="38" rx="20" ry="28" fill="#aaa" stroke="#888" strokeWidth="1.5"/>
                <ellipse cx="22" cy="32" rx="3" ry="3.5" fill="#555"/>
                <ellipse cx="38" cy="32" rx="3" ry="3.5" fill="#555"/>
              </svg>
              <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                <span className="text-white text-[9px] font-bold leading-none">✕</span>
              </div>
            </div>
            <span className="text-[10px] text-gray-500 text-center leading-tight">Слишком<br/>темно</span>
          </div>

          {/* Wrong angle */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-full aspect-[3/4] rounded-xl bg-amber-50 border-2 border-amber-300 flex items-center justify-center relative overflow-hidden">
              <svg viewBox="0 0 60 80" className="w-10 h-14" fill="none" style={{ transform: 'rotate(-28deg)' }}>
                <ellipse cx="30" cy="38" rx="20" ry="28" fill="#fde8d0" stroke="#d4956a" strokeWidth="1.5"/>
                <ellipse cx="22" cy="32" rx="3" ry="3.5" fill="#333"/>
                <ellipse cx="38" cy="32" rx="3" ry="3.5" fill="#333"/>
                <circle cx="30" cy="42" r="1.5" fill="#d4956a"/>
              </svg>
              <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                <span className="text-white text-[9px] font-bold leading-none">✕</span>
              </div>
            </div>
            <span className="text-[10px] text-gray-500 text-center leading-tight">Неправильный<br/>угол</span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        {/* PRIMARY — Camera scan */}
        <button
          onClick={onStartGuidedCapture}
          className="flex items-center gap-3 w-full bg-charcoal hover:bg-charcoal/90 active:scale-[0.98] text-white rounded-2xl px-5 py-4 transition-all duration-150 shadow-sm"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/10 flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </span>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold leading-tight">Камера — 3-ракурсный скан</p>
            <p className="text-[11px] text-white/50 mt-0.5">Рекомендуется · точнее результат</p>
          </div>
          <svg className="w-4 h-4 text-white/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">{t('capture.or') ?? 'или'}</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* SECONDARY — Upload photo */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-3 w-full bg-white hover:bg-gray-50 active:scale-[0.98] border border-gray-200 text-charcoal rounded-2xl px-5 py-4 transition-all duration-150 shadow-sm"
        >
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 flex-shrink-0">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </span>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-gray-800 leading-tight">Загрузить фото</p>
            <p className="text-[11px] text-gray-400 mt-0.5">1–3 снимка · фронт + профили</p>
          </div>
          <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Drop Zone — desktop */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`hidden sm:flex items-center justify-center mt-4 w-full max-w-xs border-2 border-dashed rounded-2xl py-5 text-center transition-all duration-150 ${
          dragOver ? 'border-rose-300 bg-rose-50' : 'border-gray-200 bg-transparent'
        }`}
      >
        <p className="text-gray-400 text-xs">{t('capture.dropHint')}</p>
      </div>

      {cameraError && (
        <div className="mt-4 w-full max-w-xs px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs">
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

      <p className="mt-8 text-[11px] text-gray-400 max-w-xs text-center leading-relaxed">
        {t('capture.privacyNotice')}
      </p>
    </div>
  );
}
