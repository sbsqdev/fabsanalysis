import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string || 'placeholder-anon-key'

if (!import.meta.env.VITE_SUPABASE_URL) {
  console.warn('[supabase] VITE_SUPABASE_URL not set — auth will not work. Add it to .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type { User, Session } from '@supabase/supabase-js'
