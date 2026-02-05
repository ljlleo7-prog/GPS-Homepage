-- Migration for Market Campaigns and Variable Rewards

-- 1. Add creator_id and variable reward columns to missions
ALTER TABLE public.missions 
ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS reward_min NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS reward_max NUMERIC DEFAULT 0;

-- 2. Add creator_id to support_instruments for user-generated bets/campaigns
ALTER TABLE public.support_instruments
ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES auth.users(id);

-- 3. Function to calculate dynamic reward based on supply (submissions)
CREATE OR REPLACE FUNCTION public.update_mission_reward()
RETURNS TRIGGER AS $$
DECLARE
  v_mission_id UUID;
  v_min NUMERIC;
  v_max NUMERIC;
  v_count INTEGER;
  v_new_reward NUMERIC;
BEGIN
  -- Determine mission_id (handle INSERT/DELETE)
  IF (TG_OP = 'DELETE') THEN
    v_mission_id := OLD.mission_id;
  ELSE
    v_mission_id := NEW.mission_id;
  END IF;

  -- Get mission details
  SELECT reward_min, reward_max INTO v_min, v_max
  FROM public.missions
  WHERE id = v_mission_id AND is_variable_reward = true;

  -- Only proceed if it's a variable reward mission
  IF FOUND THEN
    -- Count active submissions (PENDING or APPROVED)
    SELECT count(*) INTO v_count
    FROM public.mission_submissions
    WHERE mission_id = v_mission_id AND status IN ('PENDING', 'APPROVED');

    -- Formula: Decay from Max to Min over 10 submissions
    -- Reward = Max - (Count * (Max - Min) / 10)
    -- Clamped at Min
    
    IF v_count >= 10 THEN
      v_new_reward := v_min;
    ELSE
      v_new_reward := v_max - (v_count::NUMERIC * (v_max - v_min) / 10.0);
    END IF;

    -- Ensure we don't go below min (redundant with IF but safe) or above max
    v_new_reward := GREATEST(v_min, LEAST(v_max, v_new_reward));

    -- Update the mission's current displayed reward
    UPDATE public.missions
    SET reward_tokens = FLOOR(v_new_reward) -- Round down to integer
    WHERE id = v_mission_id;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Trigger to update reward on submission changes
DROP TRIGGER IF EXISTS update_reward_on_submission ON public.mission_submissions;
CREATE TRIGGER update_reward_on_submission
AFTER INSERT OR DELETE OR UPDATE OF status
ON public.mission_submissions
FOR EACH ROW
EXECUTE FUNCTION public.update_mission_reward();

-- 5. Function to create a user campaign (Mission or Market Instrument)
-- This allows Rep > 70 users to create content
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
    INSERT INTO public.missions (
      title, description, reward_tokens, reward_rep, 
      is_variable_reward, reward_min, reward_max, 
      status, type, creator_id
    ) VALUES (
      p_title, p_description, p_reward_max, 5, -- Start at Max reward, fixed 5 Rep
      true, p_reward_min, p_reward_max,
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
