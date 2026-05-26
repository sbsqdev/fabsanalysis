-- ============================================================
-- Beauty Platform / ProFace — Supabase Database Schema
-- Project: mhjtoliyyiazhegixxpq
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── Profiles ────────────────────────────────────────────────────
-- One row per user. Created automatically on signup (or via upsert in signUp()).
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'pending',
  -- Values: 'pro' (has access after Kaspi payment) | 'pending' (awaiting payment)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Face Analyses ────────────────────────────────────────────────
-- Saved analysis results per user
CREATE TABLE IF NOT EXISTS public.face_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  image_url TEXT,
  analysis_result JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS face_analyses_user_id_idx ON public.face_analyses(user_id);
CREATE INDEX IF NOT EXISTS face_analyses_created_at_idx ON public.face_analyses(created_at DESC);

-- ── Row Level Security ───────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_analyses ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update their own row
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Analyses: users read/insert their own
CREATE POLICY "Users can read own analyses"
  ON public.face_analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON public.face_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own analyses"
  ON public.face_analyses FOR DELETE
  USING (auth.uid() = user_id);

-- ── Auto-create profile on signup (trigger) ─────────────────────
-- This runs server-side so it works even with email confirmation enabled

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, phone, subscription_status)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    'pending'  -- requires Kaspi payment verification to become 'pro'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Subscriptions (for future payment integration) ───────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  stripe_customer_id TEXT,
  stripe_payment_intent_id TEXT,
  kaspi_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Values: 'active' | 'pending' | 'refunded'
  amount_tenge INTEGER,  -- 3000
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_idx ON public.subscriptions(user_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);
