-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. CORE ECONOMY & PROFILES
-- ==========================================

-- PROFILES (Extends Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- WALLETS
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  token_balance NUMERIC(20, 2) DEFAULT 0 CHECK (token_balance >= 0),
  reputation_balance INTEGER DEFAULT 0 CHECK (reputation_balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- LEDGER ENTRIES (Append-only)
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(20, 2) NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('TOKEN', 'REP')),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('MINT', 'BURN', 'TRANSFER', 'REWARD', 'MARKET_ENTRY', 'MARKET_PAYOUT')),
  reference_id UUID,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- MISSIONS
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

-- MISSION SUBMISSIONS
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

-- SUPPORT INSTRUMENTS
CREATE TABLE IF NOT EXISTS public.support_instruments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BOND', 'INDEX', 'MILESTONE')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MID', 'HIGH')),
  yield_rate NUMERIC(5, 2),
  status TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'RESOLVED')),
  lockup_period_days INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- SUPPORT POSITIONS
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

-- ==========================================
-- 2. TICKET MARKET (New)
-- ==========================================

-- TICKET TYPES
CREATE TABLE IF NOT EXISTS public.ticket_types (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  total_supply INTEGER,
  creator_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USER TICKET BALANCES
CREATE TABLE IF NOT EXISTS public.user_ticket_balances (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
  balance INTEGER DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, ticket_type_id)
);

-- TICKET LISTINGS
CREATE TABLE IF NOT EXISTS public.ticket_listings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  seller_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_per_unit NUMERIC(20, 2) NOT NULL CHECK (price_per_unit >= 0),
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'CANCELLED')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TICKET TRANSACTIONS
CREATE TABLE IF NOT EXISTS public.ticket_transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  listing_id UUID REFERENCES public.ticket_listings(id),
  buyer_id UUID REFERENCES public.profiles(id) NOT NULL,
  seller_id UUID REFERENCES public.profiles(id) NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) NOT NULL,
  quantity INTEGER NOT NULL,
  price_per_unit NUMERIC(20, 2) NOT NULL,
  total_price NUMERIC(20, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 3. RLS POLICIES
-- ==========================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ticket_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_transactions ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Wallets
DROP POLICY IF EXISTS "Users can view own wallet" ON public.wallets;
CREATE POLICY "Users can view own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- Ledger
DROP POLICY IF EXISTS "Users can view own ledger" ON public.ledger_entries;
CREATE POLICY "Users can view own ledger" ON public.ledger_entries FOR SELECT USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

-- Missions
DROP POLICY IF EXISTS "Missions are viewable by everyone" ON public.missions;
CREATE POLICY "Missions are viewable by everyone" ON public.missions FOR SELECT USING (true);

-- Mission Submissions
DROP POLICY IF EXISTS "Users can view own submissions" ON public.mission_submissions;
CREATE POLICY "Users can view own submissions" ON public.mission_submissions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create submissions" ON public.mission_submissions;
CREATE POLICY "Users can create submissions" ON public.mission_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Support Instruments
DROP POLICY IF EXISTS "Instruments are viewable by everyone" ON public.support_instruments;
CREATE POLICY "Instruments are viewable by everyone" ON public.support_instruments FOR SELECT USING (true);

-- Support Positions
DROP POLICY IF EXISTS "Users can view own positions" ON public.support_positions;
CREATE POLICY "Users can view own positions" ON public.support_positions FOR SELECT USING (auth.uid() = user_id);

-- Ticket Market
DROP POLICY IF EXISTS "Ticket types are viewable by everyone" ON public.ticket_types;
CREATE POLICY "Ticket types are viewable by everyone" ON public.ticket_types FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can view own ticket balances" ON public.user_ticket_balances;
CREATE POLICY "Users can view own ticket balances" ON public.user_ticket_balances FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can view active listings" ON public.ticket_listings;
CREATE POLICY "Anyone can view active listings" ON public.ticket_listings FOR SELECT USING (status = 'ACTIVE' OR auth.uid() = seller_id);

DROP POLICY IF EXISTS "Users can view their own transactions" ON public.ticket_transactions;
CREATE POLICY "Users can view their own transactions" ON public.ticket_transactions FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- ==========================================
-- 4. FUNCTIONS & TRIGGERS
-- ==========================================

-- Handle New User (Profile + Wallet)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  -- Create Profile
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'username', 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url'
  );
  
  -- Create Wallet (Sign-up bonus: 100 tokens)
  INSERT INTO public.wallets (user_id, token_balance, reputation_balance)
  VALUES (new.id, 100, 0); 
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Enter Support Position RPC
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
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id, token_balance INTO v_wallet_id, v_balance
  FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;

  IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient funds'; END IF;

  UPDATE public.wallets
  SET token_balance = token_balance - p_amount, updated_at = NOW()
  WHERE id = v_wallet_id;

  INSERT INTO public.support_positions (instrument_id, user_id, amount_invested)
  VALUES (p_instrument_id, v_user_id, p_amount)
  RETURNING id INTO v_position_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, reference_id, description)
  VALUES (v_wallet_id, -p_amount, 'TOKEN', 'MARKET_ENTRY', v_position_id, 'Entry into support instrument');

  RETURN jsonb_build_object('success', true, 'position_id', v_position_id, 'new_balance', v_balance - p_amount);
END;
$$;

-- ==========================================
-- 5. SEED DATA (Only if empty)
-- ==========================================

-- Missions
INSERT INTO public.missions (title, description, reward_tokens, reward_rep, type)
SELECT 'Alpha Feedback', 'Play the latest build and submit detailed feedback.', 50, 10, 'PLAYTEST'
WHERE NOT EXISTS (SELECT 1 FROM public.missions WHERE title = 'Alpha Feedback');

INSERT INTO public.missions (title, description, reward_tokens, reward_rep, type)
SELECT 'Bug Hunter', 'Report a critical bug in the DeltaDash simulation.', 100, 20, 'FEEDBACK'
WHERE NOT EXISTS (SELECT 1 FROM public.missions WHERE title = 'Bug Hunter');

-- Support Instruments
INSERT INTO public.support_instruments (title, description, type, risk_level, yield_rate, lockup_period_days)
SELECT 'DeltaDash Stability Bond', 'Protocol-backed bond supporting server costs.', 'BOND', 'LOW', 5.00, 30
WHERE NOT EXISTS (SELECT 1 FROM public.support_instruments WHERE title = 'DeltaDash Stability Bond');

INSERT INTO public.support_instruments (title, description, type, risk_level, yield_rate, lockup_period_days)
SELECT 'Core Dev Index', 'Support the core engineering team.', 'INDEX', 'MID', 15.00, 60
WHERE NOT EXISTS (SELECT 1 FROM public.support_instruments WHERE title = 'Core Dev Index');

-- Ticket Types
INSERT INTO public.ticket_types (title, description, total_supply)
SELECT 'Piastri Win - Monaco 2024', 'Pays out if Oscar Piastri wins the 2024 Monaco Grand Prix', 1000
WHERE NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE title = 'Piastri Win - Monaco 2024');

INSERT INTO public.ticket_types (title, description, total_supply)
SELECT 'Norris Podium - Silverstone', 'Pays out if Lando Norris finishes Top 3 at Silverstone', 1000
WHERE NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE title = 'Norris Podium - Silverstone');
