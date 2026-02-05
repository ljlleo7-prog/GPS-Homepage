-- ==============================================================================
-- CONSOLIDATED UPDATE SCRIPT - 2024-02-07
-- This script applies all recent changes for Reputation, Market Campaigns, and Forum.
-- It is idempotent (safe to run multiple times).
-- ==============================================================================

-- 1. ENSURE EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. UPDATE PROFILES (Add developer_status if missing)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'developer_status') THEN
        ALTER TABLE public.profiles ADD COLUMN developer_status TEXT DEFAULT 'NONE' CHECK (developer_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED'));
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'last_login') THEN
        ALTER TABLE public.profiles ADD COLUMN last_login TIMESTAMPTZ;
    END IF;
END $$;

-- 3. UPDATE MISSIONS (Add variable reward columns)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'reward_min') THEN
        ALTER TABLE public.missions ADD COLUMN reward_min NUMERIC(20, 2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'reward_max') THEN
        ALTER TABLE public.missions ADD COLUMN reward_max NUMERIC(20, 2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'is_variable_reward') THEN
        ALTER TABLE public.missions ADD COLUMN is_variable_reward BOOLEAN DEFAULT false;
    END IF;
    -- Ensure creator_id exists (renaming created_by if it exists from an old migration)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'created_by') THEN
        ALTER TABLE public.missions RENAME COLUMN created_by TO creator_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'creator_id') THEN
        ALTER TABLE public.missions ADD COLUMN creator_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- 4. UPDATE MISSION SUBMISSIONS (Add payout tracking)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mission_submissions' AND column_name = 'payout_tokens') THEN
        ALTER TABLE public.mission_submissions ADD COLUMN payout_tokens NUMERIC(20, 2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mission_submissions' AND column_name = 'payout_rep') THEN
        ALTER TABLE public.mission_submissions ADD COLUMN payout_rep INTEGER;
    END IF;
END $$;

-- 4.1 UPDATE SUPPORT INSTRUMENTS (Add creator_id for user campaigns)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'creator_id') THEN
        ALTER TABLE public.support_instruments ADD COLUMN creator_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- 4.2 UPDATE TICKET TYPES (Ensure creator_id exists)
DO $$
BEGIN
    -- Handle potential rename from created_by if older version exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_types' AND column_name = 'created_by') THEN
        ALTER TABLE public.ticket_types RENAME COLUMN created_by TO creator_id;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_types' AND column_name = 'creator_id') THEN
        ALTER TABLE public.ticket_types ADD COLUMN creator_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- 5. ENSURE TICKET TABLES EXIST (from 20240205_ticket_market.sql)
CREATE TABLE IF NOT EXISTS public.ticket_types (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  total_supply INTEGER,
  creator_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_ticket_balances (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
  balance INTEGER DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, ticket_type_id)
);

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

-- 6. CREATE FORUM TABLES (New Feature)
CREATE TABLE IF NOT EXISTS public.forum_posts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  is_featured BOOLEAN DEFAULT false,
  reward_amount NUMERIC(20, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. FUNCTIONS

-- 7.1 Get My Reputation Helper
CREATE OR REPLACE FUNCTION public.get_my_reputation()
RETURNS INTEGER AS $$
DECLARE
  v_rep INTEGER;
BEGIN
  SELECT reputation_balance INTO v_rep
  FROM public.wallets
  WHERE user_id = auth.uid();
  
  RETURN COALESCE(v_rep, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7.2 Developer Approval
CREATE OR REPLACE FUNCTION public.approve_developer_access(
  target_user_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_wallet_id UUID;
BEGIN
  SELECT (developer_status = 'APPROVED') INTO v_is_admin
  FROM public.profiles
  WHERE id = v_caller_id;
  
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Only approved developers can approve access.';
  END IF;

  UPDATE public.profiles
  SET developer_status = 'APPROVED'
  WHERE id = target_user_id;
  
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = target_user_id;
  
  UPDATE public.wallets
  SET reputation_balance = 80
  WHERE id = v_wallet_id;
  
  INSERT INTO public.ledger_entries (
    wallet_id, amount, currency, operation_type, description
  ) VALUES (
    v_wallet_id, 80, 'REP', 'REWARD', 'Developer Status Approved'
  );
  
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7.3 Daily Login Bonus
CREATE OR REPLACE FUNCTION public.claim_daily_bonus()
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_last_login TIMESTAMPTZ;
  v_current_rep INTEGER;
  v_bonus_amount NUMERIC;
  v_wallet_id UUID;
BEGIN
  SELECT last_login INTO v_last_login FROM public.profiles WHERE id = v_user_id;
  
  IF v_last_login IS NOT NULL AND v_last_login::DATE = CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'message', 'Already claimed today');
  END IF;
  
  SELECT id, reputation_balance INTO v_wallet_id, v_current_rep
  FROM public.wallets WHERE user_id = v_user_id;
  
  v_bonus_amount := 10 + (COALESCE(v_current_rep, 0) * 0.5);
  
  UPDATE public.wallets
  SET token_balance = token_balance + v_bonus_amount
  WHERE id = v_wallet_id;
  
  UPDATE public.profiles
  SET last_login = NOW()
  WHERE id = v_user_id;
  
  INSERT INTO public.ledger_entries (
    wallet_id, amount, currency, operation_type, description
  ) VALUES (
    v_wallet_id, v_bonus_amount, 'TOKEN', 'REWARD', 'Daily Login Bonus'
  );
  
  RETURN jsonb_build_object('success', true, 'amount', v_bonus_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7.4 Create User Campaign (Missions/Markets) - UPDATED SIGNATURE
CREATE OR REPLACE FUNCTION public.create_user_campaign(
  p_type TEXT, -- 'MISSION' or 'MARKET'
  p_title TEXT,
  p_description TEXT,
  p_reward_min NUMERIC DEFAULT 0, -- For Mission
  p_reward_max NUMERIC DEFAULT 0, -- For Mission
  p_yield_rate NUMERIC DEFAULT 0, -- For Market
  p_lockup_days INTEGER DEFAULT 0 -- For Market
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep NUMERIC;
  v_new_id UUID;
BEGIN
  -- Check Reputation > 70
  v_rep := public.get_my_reputation();
  
  IF v_rep IS NULL OR v_rep <= 70 THEN
    RAISE EXCEPTION 'Insufficient Reputation. Requires > 70 Rep.';
  END IF;

  IF p_type = 'MISSION' THEN
    INSERT INTO public.missions (
      title, description, reward_tokens, creator_id, status, is_variable_reward, reward_min, reward_max, type
    ) VALUES (
      p_title, p_description, p_reward_min, v_user_id, 'ACTIVE', true, p_reward_min, p_reward_max, 'IDEA'
    ) RETURNING id INTO v_new_id;
    
  ELSIF p_type = 'MARKET' THEN
    -- For market campaigns, we create a ticket_type (asset) or support_instrument?
    -- User said "market campaigns... releasing a bet". This sounds like support_instrument or ticket_type.
    -- In EconomyContext, it seemed to support both?
    -- Let's stick to Ticket Types as per recent development.
    -- Wait, EconomyContext createUserCampaign called this function.
    -- If p_yield_rate > 0, it might be a Support Instrument.
    -- Let's support both logic if possible, or stick to one.
    -- Given the parameters (yield_rate, lockup_days), this is definitely a Support Instrument (Bond/Index).
    
    INSERT INTO public.support_instruments (
      title, description, type, risk_level, yield_rate, lockup_period_days, status, creator_id
    ) VALUES (
      p_title, p_description, 'BOND', 'MID', p_yield_rate, p_lockup_days, 'OPEN', v_user_id
    ) RETURNING id INTO v_new_id;
    
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7.5 Process Mission Payout (Trigger)
CREATE OR REPLACE FUNCTION public.process_mission_payout()
RETURNS TRIGGER AS $$
DECLARE
  v_wallet_id UUID;
  v_mission_reward_tokens NUMERIC;
  v_mission_reward_rep INTEGER;
  v_is_variable BOOLEAN;
  v_final_tokens NUMERIC;
  v_final_rep INTEGER;
BEGIN
  -- Only run when status changes to APPROVED
  IF NEW.status = 'APPROVED' AND OLD.status != 'APPROVED' THEN
    
    SELECT reward_tokens, reward_rep, is_variable_reward 
    INTO v_mission_reward_tokens, v_mission_reward_rep, v_is_variable
    FROM public.missions 
    WHERE id = NEW.mission_id;

    IF v_is_variable THEN
      v_final_tokens := COALESCE(NEW.payout_tokens, v_mission_reward_tokens, 0);
      v_final_rep := COALESCE(NEW.payout_rep, v_mission_reward_rep, 0);
    ELSE
      v_final_tokens := COALESCE(v_mission_reward_tokens, 0);
      v_final_rep := COALESCE(v_mission_reward_rep, 0);
    END IF;

    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = NEW.user_id;

    UPDATE public.wallets
    SET 
      token_balance = token_balance + v_final_tokens,
      reputation_balance = reputation_balance + v_final_rep
    WHERE id = v_wallet_id;

    INSERT INTO public.ledger_entries (
      wallet_id, amount, currency, operation_type, description, reference_id
    ) VALUES 
    (v_wallet_id, v_final_tokens, 'TOKEN', 'REWARD', 'Mission Approved: ' || NEW.mission_id, NEW.id),
    (v_wallet_id, v_final_rep, 'REP', 'REWARD', 'Mission Approved: ' || NEW.mission_id, NEW.id);
    
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_mission_submission_approved ON public.mission_submissions;
CREATE TRIGGER on_mission_submission_approved
  AFTER UPDATE ON public.mission_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.process_mission_payout();

-- 7.6 Variable Reward Updater (Trigger) - DECAY LOGIC
CREATE OR REPLACE FUNCTION public.update_mission_reward()
RETURNS TRIGGER AS $$
DECLARE
  v_mission_id UUID;
  v_min NUMERIC;
  v_max NUMERIC;
  v_count INTEGER;
  v_new_reward NUMERIC;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_mission_id := OLD.mission_id;
  ELSE
    v_mission_id := NEW.mission_id;
  END IF;

  SELECT reward_min, reward_max INTO v_min, v_max
  FROM public.missions
  WHERE id = v_mission_id AND is_variable_reward = true;

  IF FOUND THEN
    SELECT count(*) INTO v_count
    FROM public.mission_submissions
    WHERE mission_id = v_mission_id AND status IN ('PENDING', 'APPROVED');

    -- Reward = Max - (Count * (Max - Min) / 10)
    IF v_count >= 10 THEN
      v_new_reward := v_min;
    ELSE
      v_new_reward := v_max - (v_count::NUMERIC * (v_max - v_min) / 10.0);
    END IF;

    v_new_reward := GREATEST(v_min, LEAST(v_max, v_new_reward));

    UPDATE public.missions
    SET reward_tokens = FLOOR(v_new_reward)
    WHERE id = v_mission_id;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS update_reward_on_submission ON public.mission_submissions;
CREATE TRIGGER update_reward_on_submission
AFTER INSERT OR DELETE OR UPDATE OF status
ON public.mission_submissions
FOR EACH ROW
EXECUTE FUNCTION public.update_mission_reward();

-- 7.7 Reward Forum Post
CREATE OR REPLACE FUNCTION public.reward_forum_post(
  p_post_id UUID,
  p_amount NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_author_id UUID;
  v_current_reward NUMERIC;
  v_wallet_id UUID;
  v_caller_id UUID := auth.uid();
  v_is_dev BOOLEAN;
BEGIN
  SELECT (developer_status = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_is_dev IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Only approved developers can reward posts.';
  END IF;

  SELECT author_id, reward_amount INTO v_author_id, v_current_reward
  FROM public.forum_posts
  WHERE id = p_post_id;

  IF v_author_id IS NULL THEN
    RAISE EXCEPTION 'Post not found.';
  END IF;

  UPDATE public.forum_posts
  SET 
    is_featured = true,
    reward_amount = COALESCE(reward_amount, 0) + p_amount
  WHERE id = p_post_id;

  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_author_id;

  UPDATE public.wallets
  SET token_balance = token_balance + p_amount
  WHERE id = v_wallet_id;

  INSERT INTO public.ledger_entries (
    wallet_id, 
    amount, 
    currency, 
    operation_type, 
    description
  ) VALUES (
    v_wallet_id,
    p_amount,
    'TOKEN',
    'REWARD',
    'Forum Post Reward'
  );

  RETURN jsonb_build_object('success', true, 'new_total_reward', v_current_reward + p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 8. RLS POLICIES (Consolidated)

-- Enable RLS
ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ticket_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;

-- 8.1 Ticket Types
DROP POLICY IF EXISTS "Ticket types are viewable by everyone" ON public.ticket_types;
CREATE POLICY "Ticket types are viewable by everyone" ON public.ticket_types FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users with Rep >= 70 can create ticket types" ON public.ticket_types;
CREATE POLICY "Users with Rep >= 70 can create ticket types" 
ON public.ticket_types 
FOR INSERT 
WITH CHECK (
  auth.uid() = creator_id AND
  public.get_my_reputation() >= 70
);

-- 8.2 Ticket Balances
DROP POLICY IF EXISTS "Users can view own ticket balances" ON public.user_ticket_balances;
CREATE POLICY "Users can view own ticket balances" ON public.user_ticket_balances FOR SELECT USING (auth.uid() = user_id);

-- 8.3 Ticket Listings
DROP POLICY IF EXISTS "Anyone can view active listings" ON public.ticket_listings;
CREATE POLICY "Anyone can view active listings" ON public.ticket_listings FOR SELECT USING (status = 'ACTIVE' OR auth.uid() = seller_id);

DROP POLICY IF EXISTS "Users with Rep >= 50 can create listings" ON public.ticket_listings;
CREATE POLICY "Users with Rep >= 50 can create listings" 
ON public.ticket_listings 
FOR INSERT 
WITH CHECK (
  auth.uid() = seller_id AND
  public.get_my_reputation() >= 50
);

-- 8.4 Forum Posts
DROP POLICY IF EXISTS "Anyone can view forum posts" ON public.forum_posts;
CREATE POLICY "Anyone can view forum posts" ON public.forum_posts FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users with Rep >= 50 can create posts" ON public.forum_posts;
CREATE POLICY "Users with Rep >= 50 can create posts" 
ON public.forum_posts 
FOR INSERT 
WITH CHECK (
  auth.uid() = author_id AND
  public.get_my_reputation() >= 50
);

-- 8.5 Missions (Reputation Gating)
DROP POLICY IF EXISTS "Users with Rep >= 30 can view missions" ON public.missions;
CREATE POLICY "Users with Rep >= 30 can view missions" 
ON public.missions 
FOR SELECT 
USING (
  public.get_my_reputation() >= 30
);

DROP POLICY IF EXISTS "Users with Rep >= 70 can create missions" ON public.missions;
CREATE POLICY "Users with Rep >= 70 can create missions" 
ON public.missions 
FOR INSERT 
WITH CHECK (
  auth.uid() = creator_id AND
  public.get_my_reputation() >= 70
);
