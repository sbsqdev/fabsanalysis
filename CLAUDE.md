# CLAUDE.md — Beauty Platform / FABS Facial Analysis

## Обзор проекта
React + Vite фронтенд с Node.js бэкендом. Анализ лица через MediaPipe, OpenAI GPT, FAL.ai визуализации. Авторизация и БД — Supabase.

## Стек
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, React Router v6
- **Backend**: Node.js (server/app.mjs) — production; Vite middleware — dev
- **AI**: OpenAI GPT-4o-mini (`/api/analyze`), FAL.ai flux-kontext (`/api/transform`)
- **Auth + DB**: Supabase (таблицы: `face_analyses`, `profiles`)
- **CV**: MediaPipe FaceLandmarker (468/478 landmarks)

## Продакшн сервер (Yandex Cloud)
- **IP**: `94.131.85.92`
- **URL**: `https://94-131-85-92.sslip.io`
- **SSH**: `ssh -l fabanalysis 94.131.85.92`
- **Проект на сервере**: `~/beauty-platform/`
- **PM2 процесс**: `beauty-platform` (запускает `server/app.mjs` на порту 4173)
- **Nginx**: проксирует 80/443 → localhost:4173, `client_max_body_size 50m`
- **SSL**: Let's Encrypt через certbot, авторенью через systemd

## Деплой новых изменений

### Только фронтенд (большинство изменений UI):
```bash
cd ~/Documents/beauty-platform
npx vite build
rsync -av dist/ fabanalysis@94.131.85.92:~/beauty-platform/dist/
```

### Фронтенд + бэкенд (изменения в server/ или api/):
```bash
cd ~/Documents/beauty-platform
npx vite build
rsync -av --exclude='node_modules' --exclude='.git' --exclude='.env*' . fabanalysis@94.131.85.92:~/beauty-platform/
ssh -l fabanalysis 94.131.85.92 "cd ~/beauty-platform && pm2 restart beauty-platform"
```

### Только бэкенд (изменения в server/app.mjs):
```bash
rsync -av server/ fabanalysis@94.131.85.92:~/beauty-platform/server/
ssh -l fabanalysis 94.131.85.92 "pm2 restart beauty-platform"
```

## Локальная разработка
```bash
npm run dev        # Vite dev server на :5173 с API middleware
```
- Env vars: `.env.local` (не коммитится)
- API роуты подхватываются через `vite.config.ts` middleware
- `OPENAI_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `FAL_KEY` — в `.env.local`

## Тестовый проход без регистрации (Auth bypass)
- Цель: быстро тестировать UI/флоу анализа без логина/регистрации.
- Реализация:
  - `src/lib/authBypass.ts`: `authBypassEnabled = import.meta.env.DEV || import.meta.env.VITE_BYPASS_AUTH === 'true'`
  - `src/components/auth/ProtectedRoute.tsx`: при `authBypassEnabled` пропускает auth/access guard
  - `src/App.tsx`: при `authBypassEnabled` роут `/` делает редирект на `/analysis`
- Поведение:
  - В локальном dev (`npm run dev`) bypass включён автоматически.
  - В production bypass выключен по умолчанию (потому что `import.meta.env.DEV === false`).
  - Для временного теста в production можно включить явно: `VITE_BYPASS_AUTH=true` перед `vite build`.
- Важно:
  - Не считать это багом: это осознанный test-mode.
  - Для обычного боевого деплоя не выставлять `VITE_BYPASS_AUTH=true`.

## Переменные окружения на сервере
Файл: `~/beauty-platform/.env`
```
OPENAI_API_KEY=...
VITE_SUPABASE_URL=https://mhjtoliyyiazhegixxpq.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
FAL_KEY=...
FAL_MODEL=fal-ai/flux-kontext-lora/inpaint
```

## Структура API
| Эндпоинт | Файл | Назначение |
|---|---|---|
| POST `/api/analyze` | `api/analyze.ts` | GPT инсайты (SSE стриминг) |
| POST `/api/transform` | `api/transform.ts` | FAL.ai визуализация |
| GET/POST `/api/analyses` | `api/analyses.ts` | История анализов (таблица `face_analyses`) |

## Supabase
- **Проект**: `mhjtoliyyiazhegixxpq`
- **Dashboard**: https://supabase.com/dashboard/project/mhjtoliyyiazhegixxpq
- **SQL Editor**: https://supabase.com/dashboard/project/mhjtoliyyiazhegixxpq/sql/new
- **Таблицы**: `profiles` (id, email, phone, subscription_status), `face_analyses` (id, user_id, created_at, image_url, analysis_result), `subscriptions`
- **RLS**: пользователи читают/пишут только свои записи
- **Email autoconfirm**: ВЫКЛЮЧЕН (mailer_autoconfirm=false) — после регистрации нужно подтвердить email
- **MVP**: все новые пользователи получают subscription_status='pro' через триггер на auth.users
- Сохранение анализов: напрямую через Supabase client из `src/components/App.tsx` (через `src/lib/analysisStore.ts`)

## Ключевые файлы
- `src/components/App.tsx` — главный оркестратор, логика сохранения анализов
- `src/analysis/report.ts` — генерация отчёта по landmarks
- `src/analysis/profileContourDetector.ts` — 4-stage pipeline контура профиля
- `src/components/FeatureCard.tsx` — карточки фич + ProfileAngleCanvas (MobileSAM mask + contour landmarks, fallback brightness-threshold)
- `src/components/ScanningScreen.tsx` — фронт MediaPipe + профили через MobileSAM (`SAM_ACCEPT_THRESHOLD=0.25`)
- `src/pages/DashboardPage.tsx` — история анализов в личном кабинете
- `src/pages/AnalysisDetailPage.tsx` — детальный отчёт `/analysis/:id`
- `server/app.mjs` — production Express сервер (раздаёт dist/ + проксирует API)

## Важные архитектурные решения
- **ProfileAngleCanvas**: рисует MobileSAM-маску и углы из профильных landmarks; fallback на brightness-threshold силуэт при отсутствии landmarks
- **Sparse array landmarks**: `new Array<NormalizedLandmark>(478)` с дырками (undefined), не заполненный нулями
- **Сохранение анализов**: Supabase client напрямую (не через `/api/analyses`) — авторизация через сессию
- **Thumbnail**: сжимается до 320px JPEG перед сохранением в БД
- **Билд на сервере**: `npx vite build` (без `npm run build` — пропускает tsc проверку типов)

## PM2 команды на сервере
```bash
pm2 status                    # статус процессов
pm2 logs beauty-platform      # логи
pm2 restart beauty-platform   # перезапуск
pm2 save                      # сохранить конфиг
```

## Nginx команды на сервере
```bash
sudo nginx -t                        # проверка конфига
sudo systemctl reload nginx          # перезагрузка без даунтайма
sudo nano /etc/nginx/sites-available/beauty-platform  # редактировать конфиг
```

## Демо аккаунт
- Email: `admin@fabs.demo`
- Password: `admin123`
- Создан в Supabase Dashboard → Authentication → Users
