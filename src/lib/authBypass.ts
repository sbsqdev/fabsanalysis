// Auth bypass: ONLY enabled when explicitly set via VITE_BYPASS_AUTH=true in .env.local
// Never enabled automatically — not even in DEV mode.
// Usage: add VITE_BYPASS_AUTH=true to .env.local for local testing without login.
export const authBypassEnabled = import.meta.env.VITE_BYPASS_AUTH === 'true'

