-- Enable UUID extension (Required for ID generation)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 0. CLEANUP (Safe drops to ensure clean state)
-- ==========================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ==========================================
-- 1. PROFILES & CORE ECONOMY
-- ==========================================

-- PROFILES: Public user data
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- WALLETS: Holds Tokens and Reputation
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  token_balance NUMERIC(20, 2) DEFAULT 0 CHECK (token_balance >= 0),
  reputation_balance INTEGER DEFAULT 0 CHECK (reputation_balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- LEDGER: Audit trail for all transactions
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(20, 2) NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('TOKEN', 'REP')),
  operation_type TEXT NOT NULL, -- MINT, BURN, TRANSFER, REWARD, MARKET_ENTRY, MARKET_PAYOUT
  reference_id UUID,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- MISSIONS: Community tasks
CREATE TABLE IF NOT EXISTS public.missions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reward_tokens NUMERIC(20, 2) DEFAULT 0,
  reward_rep INTEGER DEFAULT 0,
  type TEXT CHECK (type IN ('FEEDBACK', 'PLAYTEST', 'IDEA')),
  status TEXT DEFAULT 'ACTIVE',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- MISSION SUBMISSIONS
CREATE TABLE IF NOT EXISTS public.mission_submissions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  mission_id UUID REFERENCES public.missions(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING',
  admin_feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SUPPORT INSTRUMENTS (Bonds, Indices)
CREATE TABLE IF NOT EXISTS public.support_instruments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BOND', 'INDEX', 'MILESTONE')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MID', 'HIGH')),
  yield_rate NUMERIC(5, 2),
  status TEXT DEFAULT 'OPEN',
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
  status TEXT DEFAULT 'ACTIVE',
  payout_amount NUMERIC(20, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 2. TICKET MARKET (New Feature)
-- ==========================================

-- TICKET TYPES: The assets being traded (e.g., "Piastri Win")
CREATE TABLE IF NOT EXISTS public.ticket_types (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  total_supply INTEGER,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USER TICKET BALANCES: Who owns what
CREATE TABLE IF NOT EXISTS public.user_ticket_balances (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
  balance INTEGER DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, ticket_type_id)
);

-- TICKET LISTINGS: Active sell orders
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

-- TICKET TRANSACTIONS: History
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
-- 3. ROW LEVEL SECURITY (RLS)
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

-- Profiles Policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Wallet/Ledger Policies
DROP POLICY IF EXISTS "Users can view own wallet" ON public.wallets;
CREATE POLICY "Users can view own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own ledger" ON public.ledger_entries;
CREATE POLICY "Users can view own ledger" ON public.ledger_entries FOR SELECT USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

-- Market Policies
DROP POLICY IF EXISTS "Instruments are viewable by everyone" ON public.support_instruments;
CREATE POLICY "Instruments are viewable by everyone" ON public.support_instruments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Ticket types are viewable by everyone" ON public.ticket_types;
CREATE POLICY "Ticket types are viewable by everyone" ON public.ticket_types FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can view active listings" ON public.ticket_listings;
CREATE POLICY "Anyone can view active listings" ON public.ticket_listings FOR SELECT USING (status = 'ACTIVE' OR auth.uid() = seller_id);

-- ==========================================
-- 4. AUTOMATION (Triggers & Functions)
-- ==========================================

-- Function: Handle New User Registration
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Create Profile
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'username', 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url'
  );
  
  -- 2. Create Wallet (Sign-up bonus: 100 tokens)
  INSERT INTO public.wallets (user_id, token_balance, reputation_balance)
  VALUES (new.id, 100, 0); 
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Run handle_new_user on sign up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ==========================================
-- 5. SEED DATA (Initial Content)
-- ==========================================

-- Missions
INSERT INTO public.missions (title, description, reward_tokens, reward_rep, type)
SELECT 'Alpha Feedback', 'Play the latest build and submit detailed feedback.', 50, 10, 'PLAYTEST'
WHERE NOT EXISTS (SELECT 1 FROM public.missions WHERE title = 'Alpha Feedback');

-- Support Instruments
INSERT INTO public.support_instruments (title, description, type, risk_level, yield_rate, lockup_period_days)
SELECT 'DeltaDash Stability Bond', 'Protocol-backed bond.', 'BOND', 'LOW', 5.00, 30
WHERE NOT EXISTS (SELECT 1 FROM public.support_instruments WHERE title = 'DeltaDash Stability Bond');

-- Ticket Types (The requested market items)
INSERT INTO public.ticket_types (title, description, total_supply)
SELECT 'Piastri Win - Monaco 2024', 'Pays out if Piastri wins Monaco.', 1000
WHERE NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE title = 'Piastri Win - Monaco 2024');

INSERT INTO public.ticket_types (title, description, total_supply)
SELECT 'Norris Podium - Silverstone', 'Pays out if Norris Top 3.', 1000
WHERE NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE title = 'Norris Podium - Silverstone');
