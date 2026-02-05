
-- ==========================================
-- MISSION SYSTEM UPGRADE
-- 1. Variable Rewards
-- 2. Admin Approval Workflow
-- ==========================================

-- 1. Update Missions Table
-- Add flag to indicate if rewards are variable (decided at approval time)
ALTER TABLE public.missions 
ADD COLUMN IF NOT EXISTS is_variable_reward BOOLEAN DEFAULT false;

-- 2. Update Mission Submissions Table
-- Add columns to store the ACTUAL awarded amount
ALTER TABLE public.mission_submissions 
ADD COLUMN IF NOT EXISTS payout_tokens NUMERIC(20, 2),
ADD COLUMN IF NOT EXISTS payout_rep INTEGER;

-- 3. Create Payout Function
CREATE OR REPLACE FUNCTION public.process_mission_payout() 
RETURNS TRIGGER AS $$
DECLARE
  v_mission_tokens NUMERIC(20, 2);
  v_mission_rep INTEGER;
  v_final_tokens NUMERIC(20, 2);
  v_final_rep INTEGER;
  v_wallet_id UUID;
BEGIN
  -- Only proceed if status changed to APPROVED
  IF NEW.status = 'APPROVED' AND (OLD.status IS DISTINCT FROM 'APPROVED') THEN
    
    -- 1. Determine Payout Amounts
    -- If admin specified payout in the submission update, use that.
    -- Otherwise, fall back to the default reward in the missions table.
    IF NEW.payout_tokens IS NOT NULL THEN
      v_final_tokens := NEW.payout_tokens;
    ELSE
      SELECT reward_tokens INTO v_mission_tokens FROM public.missions WHERE id = NEW.mission_id;
      v_final_tokens := COALESCE(v_mission_tokens, 0);
    END IF;

    IF NEW.payout_rep IS NOT NULL THEN
      v_final_rep := NEW.payout_rep;
    ELSE
      SELECT reward_rep INTO v_mission_rep FROM public.missions WHERE id = NEW.mission_id;
      v_final_rep := COALESCE(v_mission_rep, 0);
    END IF;

    -- 2. Get User's Wallet
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = NEW.user_id;
    
    IF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'Wallet not found for user %', NEW.user_id;
    END IF;

    -- 3. Update Wallet Balance
    UPDATE public.wallets 
    SET 
      token_balance = token_balance + v_final_tokens,
      reputation_balance = reputation_balance + v_final_rep,
      updated_at = NOW()
    WHERE id = v_wallet_id;

    -- 4. Create Ledger Entry
    INSERT INTO public.ledger_entries (
      wallet_id, 
      amount, 
      currency, 
      operation_type, 
      reference_id, 
      description
    ) VALUES (
      v_wallet_id,
      v_final_tokens,
      'TOKEN',
      'REWARD',
      NEW.id,
      'Mission Reward: ' || NEW.mission_id
    );

    -- If there is reputation reward, log it too (optional, or mix in description)
    IF v_final_rep > 0 THEN
       -- We typically track Tokens in ledger, but Rep is just a counter. 
       -- If we want to track Rep in ledger, we need to support it. 
       -- The schema says currency CHECK (currency IN ('TOKEN', 'REP')).
       INSERT INTO public.ledger_entries (
        wallet_id, 
        amount, 
        currency, 
        operation_type, 
        reference_id, 
        description
      ) VALUES (
        v_wallet_id,
        v_final_rep,
        'REP',
        'REWARD',
        NEW.id,
        'Mission Reputation: ' || NEW.mission_id
      );
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create Trigger
DROP TRIGGER IF EXISTS trigger_mission_payout ON public.mission_submissions;

CREATE TRIGGER trigger_mission_payout
  AFTER UPDATE ON public.mission_submissions
  FOR EACH ROW
  EXECUTE PROCEDURE public.process_mission_payout();

-- 5. Seed Data Update (Example)
-- Update existing missions to be variable if needed, or create a new variable mission
INSERT INTO public.missions (title, description, reward_tokens, reward_rep, type, is_variable_reward)
SELECT 'Bug Hunter', 'Find and report bugs. Reward depends on severity.', 0, 0, 'FEEDBACK', true
WHERE NOT EXISTS (SELECT 1 FROM public.missions WHERE title = 'Bug Hunter');

-- ==========================================
-- 6. MISSING RLS POLICIES
-- ==========================================

-- Missions: Everyone can view
DROP POLICY IF EXISTS "Missions are viewable by everyone" ON public.missions;
CREATE POLICY "Missions are viewable by everyone" ON public.missions FOR SELECT USING (true);

-- Submissions: Users can view their own
DROP POLICY IF EXISTS "Users can view own submissions" ON public.mission_submissions;
CREATE POLICY "Users can view own submissions" ON public.mission_submissions FOR SELECT USING (auth.uid() = user_id);

-- Submissions: Users can create submissions
DROP POLICY IF EXISTS "Users can create submissions" ON public.mission_submissions;
CREATE POLICY "Users can create submissions" ON public.mission_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);
