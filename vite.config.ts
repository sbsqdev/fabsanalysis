import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import analyzeHandler from './api/analyze';
import transformHandler from './api/transform';
import analysesHandler from './api/analyses';
import verifyKaspiHandler from './api/verifyKaspi';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''),
    },
    plugins: [
      react(),
      {
        name: 'local-ai-api',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith('/api/analyze')) {
              const env = loadEnv(mode, process.cwd(), '');
              const key = (env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || '').trim();
              if (!process.env.OPENAI_API_KEY && key) {
                process.env.OPENAI_API_KEY = key;
              }
              const model = (env.OPENAI_MODEL || env.VITE_OPENAI_MODEL || '').trim();
              if (!process.env.OPENAI_MODEL && model) {
                process.env.OPENAI_MODEL = model;
              }
              await analyzeHandler(req, res);
              return;
            }

            if (req.url?.startsWith('/api/transform')) {
              const env = loadEnv(mode, process.cwd(), '');
              if (!process.env.FAL_KEY && env.FAL_KEY) {
                process.env.FAL_KEY = env.FAL_KEY;
              }
              if (!process.env.FAL_MODEL && env.FAL_MODEL) {
                process.env.FAL_MODEL = env.FAL_MODEL;
              }
              await transformHandler(req, res);
              return;
            }

            if (req.url?.startsWith('/api/verifyKaspi')) {
              const env = loadEnv(mode, process.cwd(), '');
              if (!process.env.SUPABASE_URL && env.SUPABASE_URL) process.env.SUPABASE_URL = env.SUPABASE_URL;
              if (!process.env.SUPABASE_SERVICE_KEY && env.SUPABASE_SERVICE_KEY) process.env.SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
              if (!process.env.OPENAI_API_KEY && env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
              await verifyKaspiHandler(req, res);
              return;
            }

            if (req.url?.startsWith('/api/analyses')) {
              const env = loadEnv(mode, process.cwd(), '');
              if (!process.env.SUPABASE_URL && env.SUPABASE_URL) {
                process.env.SUPABASE_URL = env.SUPABASE_URL;
              }
              if (!process.env.SUPABASE_SERVICE_KEY && env.SUPABASE_SERVICE_KEY) {
                process.env.SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
              }
              await analysesHandler(req, res);
              return;
            }

            next();
          });
        },
      },
    ],
    base: '/',
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Heavy WASM runtime — load only when SAM/MediaPipe is actually needed
            if (id.includes('node_modules/onnxruntime-web')) return 'vendor-onnx';
            // PDF export — only triggered by button click
            if (id.includes('node_modules/html2canvas')) return 'vendor-html2canvas';
            // Supabase client — auth, always needed but small-ish
            if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
            // React core — tiny, keep in main bundle
          },
        },
      },
    },
    server: {
      port: 5173,
      open: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  };
});
