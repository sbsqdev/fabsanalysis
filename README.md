# FABS — Facial Analysis 

React + Vite фронтенд с Node.js бэкендом для анализа лица. Использует MediaPipe для детектирования landmarks, OpenAI GPT для инсайтов и FAL.ai для визуализаций. Авторизация и БД — Supabase.

## Подробнее о стеке

| Слой | Технологии |
|---|---|
| Frontend | React 18, TypeScript, Vite, TailwindCSS, React Router v6 |
| Backend | Node.js (Express) — production; Vite middleware — dev |
| AI | OpenAI GPT-4o-mini, FAL.ai flux-kontext |
| Auth + DB | Supabase (`face_analyses`, `profiles`) |
| Computer Vision | MediaPipe FaceLandmarker (478 landmarks) |

## Быстрый старт

```bash
# Установить зависимости
npm install

# Запустить dev-сервер (с API middleware)
npm run dev
```

Dev-сервер поднимается на `http://localhost:5173`.

В режиме разработки auth bypass включён автоматически — можно тестировать без регистрации.

## Переменные окружения

Создай файл `.env.local` в корне проекта:

```env
OPENAI_API_KEY=sk-...
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
FAL_KEY=...
FAL_MODEL=fal-ai/flux-kontext-lora/inpaint
```

Пример всех переменных — в `.env.example`.

## Структура API

| Эндпоинт | Файл | Назначение |
|---|---|---|
| `POST /api/analyze` | `api/analyze.ts` | GPT инсайты (SSE стриминг) |
| `POST /api/transform` | `api/transform.ts` | FAL.ai визуализация |
| `GET/POST /api/analyses` | `api/analyses.ts` | История анализов |

## Ключевые файлы

```
src/
├── components/
│   ├── App.tsx                   # Главный оркестратор, логика сохранения анализов
│   ├── FeatureCard.tsx           # Карточки фич + ProfileAngleCanvas
│   └── ScanningScreen.tsx        # MediaPipe + MobileSAM профили
├── analysis/
│   ├── report.ts                 # Генерация отчёта по landmarks
│   └── profileContourDetector.ts # 4-stage pipeline контура профиля
├── pages/
│   ├── DashboardPage.tsx         # История анализов
│   └── AnalysisDetailPage.tsx    # Детальный отчёт /analysis/:id
└── lib/
    ├── analysisStore.ts          # Supabase client для сохранения
    └── authBypass.ts             # Test-mode без авторизации

server/
└── app.mjs                       # Production Express сервер

api/
├── analyze.ts
├── transform.ts
└── analyses.ts
```

## Auth Bypass (test-mode)

В `npm run dev` авторизация пропускается автоматически — роут `/` редиректит сразу на `/analysis`.

Для временного теста в production:
```bash
VITE_BYPASS_AUTH=true npx vite build
```

В обычном production-деплое `VITE_BYPASS_AUTH` не выставлять.

## Сборка

```bash
npx vite build   # собирает в dist/
```

> Используется `npx vite build` вместо `npm run build` — пропускает tsc проверку типов.

## О моделях по анализу

- **ProfileAngleCanvas** — рисует MobileSAM-маску и углы из профильных landmarks; fallback на brightness-threshold силуэт при отсутствии landmarks
- **Sparse array landmarks** — `new Array<NormalizedLandmark>(478)` с дырками (`undefined`), не заполненный нулями
- **Сохранение анализов** — Supabase client напрямую из фронта (не через `/api/analyses`), авторизация через сессию
- **Thumbnail** — сжимается до 320px JPEG перед сохранением в БД

## Supabase

Таблицы:
- `face_analyses` — `id`, `user_id`, `created_at`, `image_url`, `analysis_result`
- `profiles` — профили пользователей

RLS: пользователи читают и пишут только свои записи в `face_analyses`.
