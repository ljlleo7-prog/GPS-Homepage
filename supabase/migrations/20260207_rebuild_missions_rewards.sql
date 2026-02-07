-- Migration to rebuild missions table rewards structure
-- Includes:
-- 1. Updates to functions dependent on to-be-dropped columns
-- 2. Dropping static reward columns
-- 3. Adding triggers for reward limits

-- 1. Ensure range columns exist (idempotent)
ALTER TABLE public.missions 
ADD COLUMN IF NOT EXISTS reward_min INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS reward_max INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS reward_rep_min INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS reward_rep_max INTEGER DEFAULT 0;

-- 2. Migrate existing data (if any static values exist)
UPDATE public.missions
SET 
  reward_min = COALESCE(reward_tokens, 0),
  reward_max = COALESCE(reward_tokens, 0),
  reward_rep_min = COALESCE(reward_rep, 0),
  reward_rep_max = COALESCE(reward_rep, 0)
WHERE reward_min = 0 AND reward_max = 0 AND (reward_tokens > 0 OR reward_rep > 0);

-- 3. Update 'process_mission_payout' to remove references to reward_tokens/reward_rep
CREATE OR REPLACE FUNCTION public.process_mission_payout() 
RETURNS TRIGGER AS $$
DECLARE
  v_mission_tokens_min NUMERIC(20, 2);
  v_mission_rep_min INTEGER;
  v_final_tokens NUMERIC(20, 2);
  v_final_rep INTEGER;
  v_wallet_id UUID;
  v_mission_title TEXT;
BEGIN
  -- Only proceed if status changed to APPROVED
  IF NEW.status = 'APPROVED' AND (OLD.status IS DISTINCT FROM 'APPROVED') THEN
    
    -- Get Mission Title for Ledger
    SELECT title INTO v_mission_title FROM public.missions WHERE id = NEW.mission_id;

    -- 1. Determine Payout Amounts
    -- Use specific payout if provided, otherwise default to reward_min (guaranteed minimum)
    IF NEW.payout_tokens IS NOT NULL THEN
      v_final_tokens := NEW.payout_tokens;
    ELSE
      SELECT reward_min INTO v_mission_tokens_min FROM public.missions WHERE id = NEW.mission_id;
      v_final_tokens := COALESCE(v_mission_tokens_min, 0);
    END IF;

    IF NEW.payout_rep IS NOT NULL THEN
      v_final_rep := NEW.payout_rep;
    ELSE
      SELECT reward_rep_min INTO v_mission_rep_min FROM public.missions WHERE id = NEW.mission_id;
      v_final_rep := COALESCE(v_mission_rep_min, 0);
    END IF;

    -- 2. Get User Wallet
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = NEW.user_id;
    
    -- 3. Update Wallet (Tokens + Rep)
    UPDATE public.wallets
    SET token_balance = token_balance + v_final_tokens,
        reputation_balance = reputation_balance + v_final_rep,
        updated_at = NOW()
    WHERE id = v_wallet_id;

    -- 4. Ledger Entry (Tokens)
    IF v_final_tokens > 0 THEN
      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_final_tokens, 'TOKEN', 'REWARD', 'Mission Reward: ' || COALESCE(v_mission_title, 'Unknown Mission'));
    END IF;

    -- 5. Ledger Entry (Rep)
    IF v_final_rep > 0 THEN
      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_final_rep, 'REP', 'REWARD', 'Mission Reward: ' || COALESCE(v_mission_title, 'Unknown Mission'));
    END IF;

  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Update 'create_user_campaign' to remove references to reward_tokens/reward_rep
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
  SELECT reputation_balance INTO v_rep
  FROM public.wallets
  WHERE user_id = v_user_id;

  IF v_rep IS NULL OR v_rep <= 70 THEN
    RAISE EXCEPTION 'Insufficient Reputation. Requires > 70 Rep.';
  END IF;

  IF p_type = 'MISSION' THEN
    -- Updated INSERT to use only range columns
    INSERT INTO public.missions (
      title, description, 
      is_variable_reward, reward_min, reward_max, 
      reward_rep_min, reward_rep_max,
      status, type, creator_id
    ) VALUES (
      p_title, p_description, 
      true, p_reward_min, p_reward_max,
      0, 5, -- Default Rep Range for Community Missions: 0-5
      'PENDING_APPROVAL', 'COMMUNITY', v_user_id
    ) RETURNING id INTO v_new_id;
    
    RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'MISSION');

  ELSIF p_type = 'MARKET' THEN
    INSERT INTO public.support_instruments (
      title, description, type, risk_level, 
      yield_rate, lockup_period_days, 
      status, creator_id
    ) VALUES (
      p_title, p_description, 'MILESTONE', 'HIGH',
      p_yield_rate, p_lockup_days,
      'PENDING', v_user_id
    ) RETURNING id INTO v_new_id;

    RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'MARKET');
    
  ELSE
    RAISE EXCEPTION 'Invalid campaign type';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Drop obsolete trigger/function 'update_mission_reward' (relied on static token calc)
DROP TRIGGER IF EXISTS update_reward_on_submission ON public.mission_submissions;
DROP FUNCTION IF EXISTS public.update_mission_reward();

-- 6. Drop static columns to enforce "no static single reward"
ALTER TABLE public.missions 
DROP COLUMN IF EXISTS reward_tokens,
DROP COLUMN IF EXISTS reward_rep;

-- 7. Create Trigger Function for Limits
CREATE OR REPLACE FUNCTION public.check_mission_reward_limits()
RETURNS TRIGGER AS $$
DECLARE
  v_dev_status TEXT;
BEGIN
  -- Get developer status of the creator
  SELECT developer_status INTO v_dev_status
  FROM public.profiles
  WHERE id = NEW.creator_id;

  -- Check limit for non-developers
  IF v_dev_status IS DISTINCT FROM 'APPROVED' THEN
    IF NEW.reward_rep_max > 5 THEN
      RAISE EXCEPTION 'Non-developers cannot set reputation reward upper bound > 5. Current limit: 5.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Create Trigger
DROP TRIGGER IF EXISTS trg_check_mission_reward_limits ON public.missions;
CREATE TRIGGER trg_check_mission_reward_limits
BEFORE INSERT OR UPDATE ON public.missions
FOR EACH ROW
EXECUTE FUNCTION public.check_mission_reward_limits();
