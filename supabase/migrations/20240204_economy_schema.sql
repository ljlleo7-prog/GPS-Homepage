-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES (Extends Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. WALLETS
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  token_balance NUMERIC(20, 2) DEFAULT 0 CHECK (token_balance >= 0),
  reputation_balance INTEGER DEFAULT 0 CHECK (reputation_balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. LEDGER ENTRIES (Append-only)
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(20, 2) NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('TOKEN', 'REP')),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('MINT', 'BURN', 'TRANSFER', 'REWARD', 'MARKET_ENTRY', 'MARKET_PAYOUT')),
  reference_id UUID, -- Can reference mission_submission_id, position_id, etc.
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MISSIONS
CREATE TABLE IF NOT EXISTS public.missions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reward_tokens NUMERIC(20, 2) DEFAULT 0,
  reward_rep INTEGER DEFAULT 0,
  type TEXT CHECK (type IN ('FEEDBACK', 'PLAYTEST', 'IDEA')),
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  creator_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. MISSION SUBMISSIONS
CREATE TABLE IF NOT EXISTS public.mission_submissions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  mission_id UUID REFERENCES public.missions(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  admin_feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SUPPORT INSTRUMENTS
CREATE TABLE IF NOT EXISTS public.support_instruments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BOND', 'INDEX', 'MILESTONE')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MID', 'HIGH')),
  yield_rate NUMERIC(5, 2), -- e.g., 5.00 for 5%
  status TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'RESOLVED')),
  lockup_period_days INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- 7. SUPPORT POSITIONS
CREATE TABLE IF NOT EXISTS public.support_positions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  instrument_id UUID REFERENCES public.support_instruments(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  amount_invested NUMERIC(20, 2) NOT NULL CHECK (amount_invested > 0),
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'PAYOUT_RECEIVED')),
  payout_amount NUMERIC(20, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS POLICIES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_positions ENABLE ROW LEVEL SECURITY;

-- Profiles: Public read, self update
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Wallets: Users can view their own wallet. NO INSERT/UPDATE from client directly.
CREATE POLICY "Users can view own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- Ledger: Users can view their own entries. NO INSERT/UPDATE from client.
CREATE POLICY "Users can view own ledger" ON public.ledger_entries FOR SELECT USING (
  wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid())
);

-- Missions: Public read. Only admins (service role) create.
CREATE POLICY "Missions are viewable by everyone" ON public.missions FOR SELECT USING (true);

-- Mission Submissions: Users can see their own. Users can create.
CREATE POLICY "Users can view own submissions" ON public.mission_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create submissions" ON public.mission_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Support Instruments: Public read.
CREATE POLICY "Instruments are viewable by everyone" ON public.support_instruments FOR SELECT USING (true);

-- Support Positions: Users can view their own.
CREATE POLICY "Users can view own positions" ON public.support_positions FOR SELECT USING (auth.uid() = user_id);

-- FUNCTIONS & TRIGGERS

-- Auto-create wallet on profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (new.id, new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  
  INSERT INTO public.wallets (user_id, token_balance, reputation_balance)
  VALUES (new.id, 100, 0); -- Sign-up bonus: 100 tokens
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- RPC: Enter Support Position (Buy)
-- This ensures atomic transaction: Deduct Balance -> Create Position -> Create Ledger Entry
CREATE OR REPLACE FUNCTION enter_support_position(p_instrument_id UUID, p_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_wallet_id UUID;
  v_balance NUMERIC;
  v_position_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get wallet and lock row for update
  SELECT id, token_balance INTO v_wallet_id, v_balance
  FROM public.wallets
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  -- Deduct balance
  UPDATE public.wallets
  SET token_balance = token_balance - p_amount,
      updated_at = NOW()
  WHERE id = v_wallet_id;

  -- Create Position
  INSERT INTO public.support_positions (instrument_id, user_id, amount_invested)
  VALUES (p_instrument_id, v_user_id, p_amount)
  RETURNING id INTO v_position_id;

  -- Ledger Entry
  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, reference_id, description)
  VALUES (v_wallet_id, -p_amount, 'TOKEN', 'MARKET_ENTRY', v_position_id, 'Entry into support instrument');

  RETURN jsonb_build_object('success', true, 'position_id', v_position_id, 'new_balance', v_balance - p_amount);
END;
$$;

-- Seed Data
INSERT INTO public.missions (title, description, reward_tokens, reward_rep, type)
VALUES 
('Alpha Feedback', 'Play the latest build and submit detailed feedback.', 50, 10, 'PLAYTEST'),
('Bug Hunter', 'Report a critical bug in the DeltaDash simulation.', 100, 20, 'FEEDBACK'),
('Feature Proposal', 'Submit a well-documented idea for the 2026 season mechanics.', 30, 5, 'IDEA');

INSERT INTO public.support_instruments (title, description, type, risk_level, yield_rate, lockup_period_days)
VALUES 
('DeltaDash Stability Bond', 'Protocol-backed bond supporting server costs.', 'BOND', 'LOW', 5.00, 30),
('Core Dev Index', 'Support the core engineering team.', 'INDEX', 'MID', 15.00, 60),
('2026 Season Launch', 'Will the 2026 Season update launch before March 1st?', 'MILESTONE', 'HIGH', 0, 90);
