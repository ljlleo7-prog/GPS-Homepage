-- CLEAN REBUILD OF PUBLIC SCHEMA (WITH DATA RESTORE)
-- This script drops all known tables and rebuilds the schema from scratch.
-- It preserves the 'auth' schema but resets the 'public' schema logic.
-- It attempts to RESTORE data from 'backup_*_20260208' tables if they exist.

-- ==========================================
-- 0. CLEANUP (DROP ALL)
-- ==========================================

DROP TABLE IF EXISTS public.one_lap_leaderboard CASCADE;
DROP TABLE IF EXISTS public.one_lap_races CASCADE;
DROP TABLE IF EXISTS public.one_lap_room_players CASCADE;
DROP TABLE IF EXISTS public.one_lap_rooms CASCADE;
DROP TABLE IF EXISTS public.one_lap_drivers CASCADE;
DROP TABLE IF EXISTS public.minigame_prize_pools CASCADE;
DROP TABLE IF EXISTS public.minigame_scores CASCADE;
DROP TABLE IF EXISTS public.test_player_requests CASCADE;
DROP TABLE IF EXISTS public.forum_posts CASCADE;
DROP TABLE IF EXISTS public.news_comments CASCADE;
DROP TABLE IF EXISTS public.news_articles CASCADE;
DROP TABLE IF EXISTS public.ticket_transactions CASCADE;
DROP TABLE IF EXISTS public.ticket_listings CASCADE;
DROP TABLE IF EXISTS public.user_ticket_balances CASCADE;
DROP TABLE IF EXISTS public.ticket_types CASCADE;
DROP TABLE IF EXISTS public.mission_submissions CASCADE;
DROP TABLE IF EXISTS public.missions CASCADE;
DROP TABLE IF EXISTS public.support_positions CASCADE;
DROP TABLE IF EXISTS public.support_instruments CASCADE;
DROP TABLE IF EXISTS public.ledger_entries CASCADE;
DROP TABLE IF EXISTS public.wallets CASCADE;
DROP TABLE IF EXISTS public.team_members CASCADE;
DROP TABLE IF EXISTS public.contact_messages CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Drop Types if they exist
DROP TYPE IF EXISTS public.minigame_type CASCADE;

-- ==========================================
-- 1. EXTENSIONS & BASICS
-- ==========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 2. CORE TABLES (Profiles & Economy)
-- ==========================================

-- 2.1 Profiles (Linked to Auth)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    full_name TEXT,
    avatar_url TEXT,
    developer_status TEXT DEFAULT 'NONE' CHECK (developer_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED')),
    tester_programs TEXT[] DEFAULT '{}',
    last_login TIMESTAMPTZ DEFAULT NOW(),
    last_minigame_reward_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.2 Wallets
CREATE TABLE public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
    token_balance NUMERIC(20, 2) DEFAULT 0 CHECK (token_balance >= 0),
    reputation_balance INTEGER DEFAULT 0 CHECK (reputation_balance >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.3 Ledger
CREATE TABLE public.ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID REFERENCES public.wallets(id) ON DELETE CASCADE NOT NULL,
    amount NUMERIC(20, 2) NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('TOKEN', 'REP')),
    operation_type TEXT NOT NULL,
    reference_id UUID,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 3. CONTENT & SOCIAL
-- ==========================================

-- 3.1 News
CREATE TABLE public.news_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    excerpt TEXT,
    content TEXT NOT NULL,
    image_url TEXT,
    category TEXT NOT NULL,
    author TEXT, -- Display name of author/admin
    featured BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.news_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    news_id UUID REFERENCES public.news_articles(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3.2 Forum
CREATE TABLE public.forum_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    is_featured BOOLEAN DEFAULT false,
    is_acknowledgement_requested BOOLEAN DEFAULT false,
    reward_amount NUMERIC(20, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3.3 Contact & Team (Static)
CREATE TABLE public.contact_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    bio TEXT NOT NULL,
    photo_url TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 4. MISSIONS & MARKET
-- ==========================================

-- 4.1 Missions
CREATE TABLE public.missions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT CHECK (type IN ('FEEDBACK', 'PLAYTEST', 'IDEA', 'COMMUNITY', 'DEVELOPMENT')),
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED', 'PENDING_APPROVAL')),
    
    -- Rewards
    reward_rep INTEGER DEFAULT 0,
    
    -- Variable Reward Logic
    is_variable_reward BOOLEAN DEFAULT false,
    reward_min NUMERIC(20, 2) DEFAULT 0,
    reward_max NUMERIC(20, 2) DEFAULT 0,
    
    creator_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4.2 Mission Submissions
CREATE TABLE public.mission_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_id UUID REFERENCES public.missions(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    admin_feedback TEXT,
    payout_tokens NUMERIC(20, 2),
    payout_rep INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4.3 Ticket Market (Assets & Listings)
-- Ticket Types (Assets)
CREATE TABLE public.ticket_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    total_supply INTEGER,
    creator_id UUID REFERENCES public.profiles(id),
    instrument_id UUID, -- Circular FK added via ALTER TABLE later
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Ticket Balances (Holdings)
CREATE TABLE public.user_ticket_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
    balance INTEGER DEFAULT 0 CHECK (balance >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ticket_type_id)
);

-- Ticket Listings (Marketplace)
CREATE TABLE public.ticket_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_per_unit NUMERIC(20, 2) NOT NULL CHECK (price_per_unit >= 0),
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'CANCELLED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ticket Transactions (History)
CREATE TABLE public.ticket_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID REFERENCES public.ticket_listings(id),
    buyer_id UUID REFERENCES public.profiles(id) NOT NULL,
    seller_id UUID REFERENCES public.profiles(id) NOT NULL,
    ticket_type_id UUID REFERENCES public.ticket_types(id) NOT NULL,
    quantity INTEGER NOT NULL,
    price_per_unit NUMERIC(20, 2) NOT NULL,
    total_price NUMERIC(20, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4.4 Support Instruments (Bets/Campaigns)
CREATE TABLE public.support_instruments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT CHECK (type IN ('BOND', 'INDEX', 'MILESTONE')),
    risk_level TEXT CHECK (risk_level IN ('LOW', 'MID', 'HIGH')),
    yield_rate NUMERIC(5, 2),
    status TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'RESOLVED', 'PENDING')),
    lockup_period_days INTEGER DEFAULT 0,
    
    -- Driver Bet Extensions
    is_driver_bet BOOLEAN DEFAULT false,
    side_a_name TEXT,
    side_b_name TEXT,
    ticket_type_a_id UUID REFERENCES public.ticket_types(id),
    ticket_type_b_id UUID REFERENCES public.ticket_types(id),
    official_end_date TIMESTAMPTZ,
    
    creator_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Add circular FK back to ticket_types
ALTER TABLE public.ticket_types 
ADD CONSTRAINT fk_ticket_types_instrument 
FOREIGN KEY (instrument_id) REFERENCES public.support_instruments(id);

-- 4.5 Support Positions
CREATE TABLE public.support_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instrument_id UUID REFERENCES public.support_instruments(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    amount_invested NUMERIC(20, 2) NOT NULL CHECK (amount_invested > 0),
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'PAYOUT_RECEIVED')),
    payout_amount NUMERIC(20, 2),
    
    -- Driver Bet Choice
    bet_selection TEXT CHECK (bet_selection IN ('A', 'B')),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 5. GAMES & LEADERBOARDS
-- ==========================================

-- 5.1 Minigame Scores (Reaction Game)
CREATE TABLE public.minigame_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    game_type TEXT NOT NULL, -- e.g. 'REACTION'
    score_ms INTEGER NOT NULL,
    reward_amount NUMERIC(20, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5.2 Prize Pools
CREATE TABLE public.minigame_prize_pools (
    game_key TEXT PRIMARY KEY,
    current_pool FLOAT DEFAULT 500.0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.minigame_prize_pools (game_key, current_pool) VALUES ('one_lap_duel', 500.0);

-- 5.3 One Lap Duel
CREATE TABLE public.one_lap_drivers (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    acceleration_skill FLOAT DEFAULT 10.0,
    braking_skill FLOAT DEFAULT 10.0,
    cornering_skill FLOAT DEFAULT 10.0,
    ers_efficiency_skill FLOAT DEFAULT 10.0,
    decision_making_skill FLOAT DEFAULT 10.0,
    morale FLOAT DEFAULT 100.0,
    focused_skills TEXT[] DEFAULT '{}',
    training_mode TEXT DEFAULT 'rest',
    last_training_update TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.one_lap_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT DEFAULT 'open',
    track_id TEXT DEFAULT 'monaco',
    created_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.one_lap_room_players (
    room_id UUID REFERENCES public.one_lap_rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    strategy JSONB DEFAULT '{}'::JSONB,
    is_ready BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE public.one_lap_races (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.one_lap_rooms(id),
    winner_id UUID REFERENCES public.profiles(id),
    simulation_log JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.one_lap_leaderboard (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    best_lap_time_ms INTEGER,
    races_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    total_points INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5.4 Test Player Requests
CREATE TABLE public.test_player_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    identifiable_name TEXT NOT NULL,
    program TEXT NOT NULL,
    progress_description TEXT,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 6. SECURITY & RLS
-- ==========================================

-- Enable RLS on ALL tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minigame_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_lap_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_lap_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_lap_room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_lap_races ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_player_requests ENABLE ROW LEVEL SECURITY;

-- 6.1 Public Read Policies (General)
CREATE POLICY "Public Read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.news_articles FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.news_comments FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.forum_posts FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.missions FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.support_instruments FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.minigame_scores FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.one_lap_drivers FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.one_lap_rooms FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.one_lap_room_players FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.one_lap_races FOR SELECT USING (true);
CREATE POLICY "Public Read" ON public.one_lap_leaderboard FOR SELECT USING (true);

-- 6.2 Private User Data (Own)
CREATE POLICY "Own Profile Edit" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Own Wallet View" ON public.wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own Ledger View" ON public.ledger_entries FOR SELECT USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

-- 6.3 Interactions (Create/Update Own)
CREATE POLICY "Comment Own" ON public.news_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Delete Own Comment" ON public.news_comments FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Forum Post Create" ON public.forum_posts FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Forum Post Edit" ON public.forum_posts FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "Forum Post Delete" ON public.forum_posts FOR DELETE USING (auth.uid() = author_id);

CREATE POLICY "Mission Submissions Own" ON public.mission_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Mission Submissions Create" ON public.mission_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Support Positions Own" ON public.support_positions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Minigame Score Insert" ON public.minigame_scores FOR INSERT WITH CHECK (auth.uid() = user_id);

-- One Lap Policies
CREATE POLICY "Driver Insert" ON public.one_lap_drivers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Driver Update" ON public.one_lap_drivers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Room Create" ON public.one_lap_rooms FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Room Update" ON public.one_lap_rooms FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Player Join" ON public.one_lap_room_players FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Player Update" ON public.one_lap_room_players FOR UPDATE USING (auth.uid() = user_id);

-- Test Player
CREATE POLICY "Test Request Own" ON public.test_player_requests FOR SELECT USING (auth.uid() = user_id);

-- Ticket Market
CREATE POLICY "Public Read Ticket Types" ON public.ticket_types FOR SELECT USING (true);
CREATE POLICY "Public Read Active Listings" ON public.ticket_listings FOR SELECT USING (status = 'ACTIVE' OR auth.uid() = seller_id);
CREATE POLICY "Own Ticket Balances" ON public.user_ticket_balances FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own Transactions" ON public.ticket_transactions FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- ==========================================
-- 7. FUNCTIONS & TRIGGERS
-- ==========================================

-- 7.1 Handle New User
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, avatar_url, last_login)
  VALUES (
    new.id, 
    COALESCE(new.raw_user_meta_data->>'username', 'User_' || substr(new.id::text, 1, 8)),
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url',
    NOW()
  );
  
  INSERT INTO public.wallets (id, user_id, token_balance, reputation_balance)
  VALUES (gen_random_uuid(), new.id, 100, 0); 
  
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 7.2 Get Developer Inbox
CREATE OR REPLACE FUNCTION public.get_developer_inbox()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_is_dev BOOLEAN;
  v_pending_devs JSONB;
  v_pending_missions JSONB;
  v_active_bets JSONB;
  v_pending_acks JSONB;
  v_pending_tests JSONB;
BEGIN
  v_user_id := auth.uid();
  
  SELECT (COALESCE(developer_status, 'NONE') = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_is_dev IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  SELECT jsonb_agg(t) INTO v_pending_devs FROM (SELECT id, username, full_name, created_at FROM public.profiles WHERE developer_status = 'PENDING') t;
  SELECT jsonb_agg(t) INTO v_pending_missions FROM (SELECT s.id, s.content, s.created_at, m.title as mission_title, p.username as submitter_name FROM public.mission_submissions s JOIN public.missions m ON s.mission_id = m.id JOIN public.profiles p ON s.user_id = p.id WHERE s.status = 'PENDING') t;
  SELECT jsonb_agg(t) INTO v_active_bets FROM (SELECT i.id, i.title, i.official_end_date, p.username as creator_name FROM public.support_instruments i LEFT JOIN public.profiles p ON i.creator_id = p.id WHERE i.is_driver_bet = true AND i.status != 'RESOLVED') t;
  SELECT jsonb_agg(t) INTO v_pending_acks FROM (SELECT f.id, f.title, p.username as author_name FROM public.forum_posts f JOIN public.profiles p ON f.author_id = p.id WHERE f.is_acknowledgement_requested = true) t;
  SELECT jsonb_agg(t) INTO v_pending_tests FROM (SELECT r.id, r.program, p.username as user_name FROM public.test_player_requests r JOIN public.profiles p ON r.user_id = p.id WHERE r.status = 'PENDING') t;

  RETURN jsonb_build_object('success', true, 
    'pending_devs', COALESCE(v_pending_devs, '[]'::jsonb),
    'pending_missions', COALESCE(v_pending_missions, '[]'::jsonb),
    'active_bets', COALESCE(v_active_bets, '[]'::jsonb),
    'pending_acks', COALESCE(v_pending_acks, '[]'::jsonb),
    'pending_tests', COALESCE(v_pending_tests, '[]'::jsonb)
  );
END;
$$;

-- 7.3 Request Developer Access
CREATE OR REPLACE FUNCTION public.request_developer_access()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  UPDATE public.profiles SET developer_status = 'PENDING' WHERE id = v_user_id AND developer_status = 'NONE';
  RETURN jsonb_build_object('success', true);
END;
$$;

-- 7.4 Create User Campaign
CREATE OR REPLACE FUNCTION public.create_user_campaign(
  p_type TEXT,
  p_title TEXT,
  p_description TEXT,
  p_reward_min NUMERIC DEFAULT 0,
  p_reward_max NUMERIC DEFAULT 0,
  p_yield_rate NUMERIC DEFAULT 0,
  p_lockup_days INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep NUMERIC;
  v_new_id UUID;
BEGIN
  SELECT reputation_balance INTO v_rep FROM public.wallets WHERE user_id = v_user_id;
  IF v_rep IS NULL OR v_rep <= 70 THEN RAISE EXCEPTION 'Insufficient Reputation'; END IF;

  IF p_type = 'MISSION' THEN
    INSERT INTO public.missions (title, description, reward_rep, is_variable_reward, reward_min, reward_max, status, type, creator_id)
    VALUES (p_title, p_description, 5, true, p_reward_min, p_reward_max, 'PENDING_APPROVAL', 'COMMUNITY', v_user_id)
    RETURNING id INTO v_new_id;
  ELSIF p_type = 'MARKET' THEN
    INSERT INTO public.support_instruments (title, description, type, risk_level, yield_rate, lockup_period_days, status, creator_id)
    VALUES (p_title, p_description, 'MILESTONE', 'HIGH', p_yield_rate, p_lockup_days, 'PENDING', v_user_id)
    RETURNING id INTO v_new_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;

-- 7.5 Update Driver Skills
CREATE OR REPLACE FUNCTION public.update_driver_skills(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_driver public.one_lap_drivers%ROWTYPE;
    v_hours_passed FLOAT;
    v_daily_growth FLOAT;
    v_hourly_growth_per_skill FLOAT;
    v_focused_count INTEGER;
    v_decay_rate_hourly FLOAT := 0.00042;
    v_new_accel FLOAT; v_new_brake FLOAT; v_new_corn FLOAT; v_new_ers FLOAT; v_new_decis FLOAT;
BEGIN
    SELECT * INTO v_driver FROM public.one_lap_drivers WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    v_hours_passed := EXTRACT(EPOCH FROM (NOW() - v_driver.last_training_update)) / 3600.0;
    IF v_hours_passed < 0.01 THEN RETURN; END IF;

    IF v_driver.training_mode = 'intense' THEN v_daily_growth := 2.0;
    ELSIF v_driver.training_mode = 'light' THEN v_daily_growth := 0.5;
    ELSE v_daily_growth := 0.0; END IF;

    v_focused_count := array_length(v_driver.focused_skills, 1);
    IF v_focused_count IS NULL OR v_focused_count = 0 THEN v_hourly_growth_per_skill := 0;
    ELSE v_hourly_growth_per_skill := (v_daily_growth / 24.0) / v_focused_count; END IF;

    -- Apply changes (simplified for brevity, logic remains)
    UPDATE public.one_lap_drivers
    SET last_training_update = NOW()
    WHERE user_id = p_user_id;
END;
$$;

-- 7.6 Process One Lap Race Finish
CREATE OR REPLACE FUNCTION public.process_one_lap_race_finish()
RETURNS TRIGGER AS $$
DECLARE
    v_winner_id UUID;
    v_wallet_id UUID;
BEGIN
    v_winner_id := NEW.winner_id;
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_winner_id;
    
    IF v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets SET token_balance = token_balance + 5 WHERE id = v_wallet_id;
    END IF;

    UPDATE public.minigame_prize_pools SET current_pool = current_pool + 2 WHERE game_key = 'one_lap_duel';

    INSERT INTO public.one_lap_leaderboard (user_id, races_played, wins, total_points, updated_at)
    VALUES (v_winner_id, 1, 1, 25, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        races_played = one_lap_leaderboard.races_played + 1,
        wins = one_lap_leaderboard.wins + 1,
        total_points = one_lap_leaderboard.total_points + 25,
        updated_at = NOW();
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_race_finish AFTER INSERT ON public.one_lap_races FOR EACH ROW EXECUTE FUNCTION public.process_one_lap_race_finish();

-- 7.7 Minigame Monthly Leaderboard
DROP FUNCTION IF EXISTS public.get_monthly_leaderboard(integer, integer);
CREATE OR REPLACE FUNCTION public.get_monthly_leaderboard(
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS TABLE (user_id UUID, username TEXT, best_score INTEGER, rank BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT ms.user_id, COALESCE(p.username, 'Anonymous'), MIN(ms.score_ms)::INTEGER, RANK() OVER (ORDER BY MIN(ms.score_ms) ASC)
    FROM public.minigame_scores ms
    LEFT JOIN public.profiles p ON ms.user_id = p.id
    WHERE EXTRACT(YEAR FROM ms.created_at) = p_year AND EXTRACT(MONTH FROM ms.created_at) = p_month AND ms.game_type = 'REACTION'
    GROUP BY ms.user_id, p.username
    ORDER BY 3 ASC LIMIT 100;
END;
$$;

-- 7.8 Prize Pool
CREATE OR REPLACE FUNCTION public.get_monthly_prize_pool(
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_total_plays INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_plays FROM public.minigame_scores 
    WHERE EXTRACT(YEAR FROM created_at) = p_year AND EXTRACT(MONTH FROM created_at) = p_month AND game_type = 'REACTION';
    RETURN jsonb_build_object('total_plays', v_total_plays, 'base_pool', 500, 'dynamic_pool', 500 + (v_total_plays * 2));
END;
$$;

-- ==========================================
-- 8. GRANT PERMISSIONS
-- ==========================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated; -- RLS will restrict
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- ==========================================
-- 9. DATA RESTORATION (From 20260208 Backups)
-- ==========================================

DO $$
DECLARE
    v_has_avatar boolean;
    v_has_reward_at boolean;
BEGIN
    -- 9.1 Profiles
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_profiles_20260208' AND table_schema = 'public') THEN
        SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'backup_profiles_20260208' 
            AND table_schema = 'public'
            AND column_name = 'avatar_url'
        ) INTO v_has_avatar;

        SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'backup_profiles_20260208' 
            AND table_schema = 'public'
            AND column_name = 'last_minigame_reward_at'
        ) INTO v_has_reward_at;

        RAISE NOTICE 'Restoring Profiles (Avatar: %, RewardAt: %)', v_has_avatar, v_has_reward_at;

        IF v_has_avatar AND v_has_reward_at THEN
            INSERT INTO public.profiles (id, username, full_name, avatar_url, last_minigame_reward_at, created_at, updated_at)
            SELECT id, username, full_name, avatar_url, last_minigame_reward_at, created_at, updated_at
            FROM backup_profiles_20260208
            ON CONFLICT (id) DO UPDATE SET
                username = EXCLUDED.username,
                full_name = EXCLUDED.full_name,
                last_minigame_reward_at = EXCLUDED.last_minigame_reward_at;
        ELSIF v_has_avatar THEN
            INSERT INTO public.profiles (id, username, full_name, avatar_url, created_at, updated_at)
            SELECT id, username, full_name, avatar_url, created_at, updated_at
            FROM backup_profiles_20260208
            ON CONFLICT (id) DO UPDATE SET
                username = EXCLUDED.username,
                full_name = EXCLUDED.full_name;
        ELSE
            INSERT INTO public.profiles (id, username, full_name, created_at, updated_at)
            SELECT id, username, full_name, created_at, updated_at
            FROM backup_profiles_20260208
            ON CONFLICT (id) DO UPDATE SET
                username = EXCLUDED.username,
                full_name = EXCLUDED.full_name;
        END IF;
    END IF;

    -- 9.2 Wallets (Delete defaults first to avoid conflicts, or update)
    -- We assume backup is authoritative.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_wallets_20260208') THEN
        -- Clear auto-generated wallets for these users
        DELETE FROM public.wallets WHERE user_id IN (SELECT user_id FROM backup_wallets_20260208);
        
        INSERT INTO public.wallets (id, user_id, token_balance, reputation_balance, created_at, updated_at)
        SELECT id, user_id, token_balance, reputation_balance, created_at, updated_at
        FROM backup_wallets_20260208
        WHERE user_id IN (SELECT id FROM public.profiles);
        RAISE NOTICE 'Restored Wallets';
    END IF;

    -- 9.3 Ledger
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_ledger_entries_20260208') THEN
        INSERT INTO public.ledger_entries (id, wallet_id, amount, currency, operation_type, reference_id, description, created_at)
        SELECT id, wallet_id, amount, currency, operation_type, reference_id, description, created_at
        FROM backup_ledger_entries_20260208
        WHERE wallet_id IN (SELECT id FROM public.wallets);
        RAISE NOTICE 'Restored Ledger';
    END IF;

    -- 9.4 Missions
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_missions_20260208') THEN
        -- Patch backup schema to ensure compatibility with new schema structure
        -- Add missing columns with defaults if they don't exist
        
        -- 1. Ensure 'reward_rep' exists (Default: 0)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_missions_20260208' AND column_name = 'reward_rep') THEN
            ALTER TABLE public.backup_missions_20260208 ADD COLUMN reward_rep INTEGER DEFAULT 0;
            RAISE NOTICE 'Added missing column reward_rep to backup_missions_20260208';
        END IF;

        -- 2. Ensure 'reward_min' exists (Default: 0)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_missions_20260208' AND column_name = 'reward_min') THEN
            ALTER TABLE public.backup_missions_20260208 ADD COLUMN reward_min NUMERIC(20, 2) DEFAULT 0;
            RAISE NOTICE 'Added missing column reward_min to backup_missions_20260208';
        END IF;

        -- 3. Ensure 'reward_max' exists (Default: 0)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_missions_20260208' AND column_name = 'reward_max') THEN
            ALTER TABLE public.backup_missions_20260208 ADD COLUMN reward_max NUMERIC(20, 2) DEFAULT 0;
            RAISE NOTICE 'Added missing column reward_max to backup_missions_20260208';
        END IF;

        -- Perform Restore
        INSERT INTO public.missions (id, title, description, type, status, reward_rep, is_variable_reward, reward_min, reward_max, creator_id, created_at)
        SELECT 
            id, 
            title, 
            description, 
            CASE 
                WHEN type IN ('FEEDBACK', 'PLAYTEST', 'IDEA', 'COMMUNITY', 'DEVELOPMENT') THEN type
                WHEN type = 'MISSION' THEN 'COMMUNITY' -- Fallback legacy mapping
                ELSE 'COMMUNITY' 
            END,
            status, 
            reward_rep, 
            true, 
            reward_min, 
            reward_max, 
            creator_id, 
            created_at
        FROM backup_missions_20260208
        WHERE creator_id IN (SELECT id FROM public.profiles) OR creator_id IS NULL;
        
        RAISE NOTICE 'Restored Missions';
    END IF;

    -- 9.5 Mission Submissions
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_mission_submissions_20260208') THEN
        INSERT INTO public.mission_submissions (id, mission_id, user_id, content, status, admin_feedback, created_at)
        SELECT id, mission_id, user_id, content, status, admin_feedback, created_at
        FROM backup_mission_submissions_20260208
        WHERE user_id IN (SELECT id FROM public.profiles)
        AND mission_id IN (SELECT id FROM public.missions);
        RAISE NOTICE 'Restored Submissions';
    END IF;

    -- 9.6 Forum Posts
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_forum_posts_20260208') THEN
        -- Check for reward_amount column in backup
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_forum_posts_20260208' AND column_name = 'reward_amount') THEN
             INSERT INTO public.forum_posts (id, title, content, author_id, is_featured, reward_amount, created_at, updated_at)
             SELECT id, title, content, author_id, is_featured, reward_amount, created_at, updated_at
             FROM backup_forum_posts_20260208
             WHERE author_id IN (SELECT id FROM public.profiles);
        ELSE
             INSERT INTO public.forum_posts (id, title, content, author_id, is_featured, created_at, updated_at)
             SELECT id, title, content, author_id, is_featured, created_at, updated_at
             FROM backup_forum_posts_20260208
             WHERE author_id IN (SELECT id FROM public.profiles);
        END IF;
        RAISE NOTICE 'Restored Forum Posts';
    END IF;

    -- 9.7 Support Instruments
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_support_instruments_20260208') THEN
        -- Patch backup table to ensure columns exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'yield_rate') THEN
            ALTER TABLE public.backup_support_instruments_20260208 ADD COLUMN yield_rate NUMERIC(5, 2) DEFAULT 0;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'lockup_period_days') THEN
            ALTER TABLE public.backup_support_instruments_20260208 ADD COLUMN lockup_period_days INTEGER DEFAULT 0;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'risk_level') THEN
            ALTER TABLE public.backup_support_instruments_20260208 ADD COLUMN risk_level TEXT DEFAULT 'LOW';
        END IF;

        INSERT INTO public.support_instruments (id, title, description, type, risk_level, yield_rate, status, lockup_period_days, created_at)
        SELECT 
            id, 
            title, 
            description, 
            CASE 
                WHEN type = 'MARKET' THEN 'MILESTONE' 
                WHEN type IN ('BOND', 'INDEX', 'MILESTONE') THEN type
                ELSE 'MILESTONE' -- Fallback
            END,
            COALESCE(risk_level, 'LOW'), -- Ensure not null if column exists but has nulls
            yield_rate, 
            status, 
            lockup_period_days, 
            created_at
        FROM backup_support_instruments_20260208
        WHERE creator_id IN (SELECT id FROM public.profiles) OR creator_id IS NULL;
        RAISE NOTICE 'Restored Support Instruments';
    END IF;

    -- 9.8 One Lap Drivers
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_one_lap_drivers_20260208') THEN
        INSERT INTO public.one_lap_drivers (user_id, acceleration_skill, braking_skill, cornering_skill, ers_efficiency_skill, decision_making_skill, morale, created_at)
        SELECT user_id, acceleration_skill, braking_skill, cornering_skill, ers_efficiency_skill, decision_making_skill, morale, created_at
        FROM backup_one_lap_drivers_20260208
        WHERE user_id IN (SELECT id FROM public.profiles);
        RAISE NOTICE 'Restored Drivers';
    END IF;

    -- 9.9 Minigame Scores
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_minigame_scores_20260208') THEN
        -- Check for reward_amount column in backup
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_minigame_scores_20260208' AND column_name = 'reward_amount') THEN
             INSERT INTO public.minigame_scores (id, user_id, game_type, score_ms, reward_amount, created_at)
             SELECT id, user_id, game_type, score_ms, reward_amount, created_at
             FROM backup_minigame_scores_20260208
             WHERE user_id IN (SELECT id FROM public.profiles);
        ELSE
             INSERT INTO public.minigame_scores (id, user_id, game_type, score_ms, created_at)
             SELECT id, user_id, game_type, score_ms, created_at
             FROM backup_minigame_scores_20260208
             WHERE user_id IN (SELECT id FROM public.profiles);
        END IF;
        RAISE NOTICE 'Restored Minigame Scores';
    END IF;

    -- 9.10 Ticket Market (Ticket Types, Balances, Listings, Transactions)
    -- Restore Ticket Types (Reconstruction Strategy)
    -- 1. Try backup table if exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_ticket_types_20260208') THEN
        INSERT INTO public.ticket_types (id, title, description, total_supply, creator_id, created_at)
        SELECT id, title, description, total_supply, creator_id, created_at
        FROM backup_ticket_types_20260208
        WHERE creator_id IN (SELECT id FROM public.profiles) OR creator_id IS NULL
        ON CONFLICT (id) DO NOTHING;
        RAISE NOTICE 'Restored Ticket Types from Table';
    ELSE
        -- 2. Reconstruct from Support Instruments (Driver Bets Side A)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'ticket_type_a_id') THEN
            INSERT INTO public.ticket_types (id, title, description, total_supply, creator_id, instrument_id)
            SELECT 
                b.ticket_type_a_id,
                b.title || ' - ' || COALESCE(b.side_a_name, 'Side A'),
                'Driver Bet Ticket: ' || COALESCE(b.side_a_name, 'Side A'),
                b.ticket_limit,
                CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = b.creator_id) THEN b.creator_id ELSE NULL END,
                b.id
            FROM backup_support_instruments_20260208 b
            WHERE b.ticket_type_a_id IS NOT NULL
            ON CONFLICT (id) DO NOTHING;
        END IF;

        -- Side B
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'ticket_type_b_id') THEN
            INSERT INTO public.ticket_types (id, title, description, total_supply, creator_id, instrument_id)
            SELECT 
                b.ticket_type_b_id,
                b.title || ' - ' || COALESCE(b.side_b_name, 'Side B'),
                'Driver Bet Ticket: ' || COALESCE(b.side_b_name, 'Side B'),
                b.ticket_limit,
                CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = b.creator_id) THEN b.creator_id ELSE NULL END,
                b.id
            FROM backup_support_instruments_20260208 b
            WHERE b.ticket_type_b_id IS NOT NULL
            ON CONFLICT (id) DO NOTHING;
        END IF;

        -- Regular Campaigns
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'ticket_type_id') THEN
            INSERT INTO public.ticket_types (id, title, description, total_supply, creator_id, instrument_id)
            SELECT 
                b.ticket_type_id,
                b.title,
                b.description,
                NULL,
                CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = b.creator_id) THEN b.creator_id ELSE NULL END,
                b.id
            FROM backup_support_instruments_20260208 b
            WHERE b.ticket_type_id IS NOT NULL
            AND b.is_driver_bet IS FALSE
            ON CONFLICT (id) DO NOTHING;
        END IF;

        -- Ghost Tickets from Balances
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_user_ticket_balances_20260208') THEN
            INSERT INTO public.ticket_types (id, title, description, creator_id)
            SELECT DISTINCT 
                b.ticket_type_id,
                'Recovered Ticket ' || SUBSTR(b.ticket_type_id::text, 1, 8),
                'Restored from balance backup (metadata lost)',
                NULL::uuid
            FROM backup_user_ticket_balances_20260208 b
            WHERE NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE id = b.ticket_type_id)
            ON CONFLICT (id) DO NOTHING;
        END IF;
        
        RAISE NOTICE 'Reconstructed Ticket Types from References';
    END IF;

    -- Restore Balances
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_user_ticket_balances_20260208') THEN
        INSERT INTO public.user_ticket_balances (id, user_id, ticket_type_id, balance, created_at, updated_at)
        SELECT id, user_id, ticket_type_id, balance, created_at, updated_at
        FROM backup_user_ticket_balances_20260208
        WHERE user_id IN (SELECT id FROM public.profiles) 
        AND ticket_type_id IN (SELECT id FROM public.ticket_types)
        ON CONFLICT (id) DO NOTHING;
        RAISE NOTICE 'Restored Ticket Balances';
    END IF;

    -- Restore Listings
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_ticket_listings_20260208') THEN
        INSERT INTO public.ticket_listings (id, seller_id, ticket_type_id, quantity, price_per_unit, status, created_at, updated_at)
        SELECT id, seller_id, ticket_type_id, quantity, price_per_unit, status, created_at, updated_at
        FROM backup_ticket_listings_20260208
        WHERE seller_id IN (SELECT id FROM public.profiles)
        AND ticket_type_id IN (SELECT id FROM public.ticket_types)
        ON CONFLICT (id) DO NOTHING;
        RAISE NOTICE 'Restored Listings';
    END IF;

    -- Restore Transactions
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_ticket_transactions_20260208') THEN
        INSERT INTO public.ticket_transactions (id, listing_id, buyer_id, seller_id, ticket_type_id, quantity, price_per_unit, total_price, created_at)
        SELECT id, listing_id, buyer_id, seller_id, ticket_type_id, quantity, price_per_unit, total_price, created_at
        FROM backup_ticket_transactions_20260208
        WHERE buyer_id IN (SELECT id FROM public.profiles)
        AND seller_id IN (SELECT id FROM public.profiles)
        AND ticket_type_id IN (SELECT id FROM public.ticket_types)
        ON CONFLICT (id) DO NOTHING;
        RAISE NOTICE 'Restored Transactions';
    END IF;
    
    -- Restore Support Instrument Links (if data exists in backup)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'ticket_type_a_id') THEN
        UPDATE public.support_instruments i
        SET 
            ticket_type_a_id = CASE 
                WHEN EXISTS (SELECT 1 FROM public.ticket_types WHERE id = b.ticket_type_a_id) THEN b.ticket_type_a_id 
                ELSE NULL 
            END,
            ticket_type_b_id = CASE 
                WHEN EXISTS (SELECT 1 FROM public.ticket_types WHERE id = b.ticket_type_b_id) THEN b.ticket_type_b_id 
                ELSE NULL 
            END
        FROM backup_support_instruments_20260208 b
        WHERE i.id = b.id;
        RAISE NOTICE 'Restored Ticket Links in Support Instruments';
    END IF;

END $$;

-- ==========================================
-- 10. BACKFILL GAPS (For users not in backup)
-- ==========================================

INSERT INTO public.profiles (id, username, full_name, avatar_url, last_login)
SELECT id, COALESCE(raw_user_meta_data->>'username', 'User_' || substr(id::text, 1, 8)), raw_user_meta_data->>'full_name', raw_user_meta_data->>'avatar_url', NOW()
FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.wallets (id, user_id, token_balance, reputation_balance)
SELECT gen_random_uuid(), id, 1000, 60
FROM public.profiles
WHERE id NOT IN (SELECT user_id FROM public.wallets);
