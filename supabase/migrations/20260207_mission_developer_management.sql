
-- Upgrade Mission System for Developer Management
-- 1. Add Deadline and Reputation Ranges to Missions
-- 2. Update RLS/Policies if needed

-- 1. Add Columns to Missions Table
ALTER TABLE public.missions 
ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reward_rep_min INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS reward_rep_max INTEGER DEFAULT 0;

-- 2. Update Trigger for Payouts (ensure it handles the new logic if needed)
-- The existing 'process_mission_payout' trigger uses 'payout_tokens' and 'payout_rep' from the submission row.
-- This is already correct for the new requirement where devs choose the exact amount.
-- However, we should ensure the trigger properly credits the user.

CREATE OR REPLACE FUNCTION public.process_mission_payout() 
RETURNS TRIGGER AS $$
DECLARE
  v_mission_tokens NUMERIC(20, 2);
  v_mission_rep INTEGER;
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

    -- 5. Ledger Entry (Rep) - If we track Rep in ledger (Schema says currency enum 'TOKEN'|'REP')
    IF v_final_rep > 0 THEN
      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_final_rep, 'REP', 'REWARD', 'Mission Reward: ' || COALESCE(v_mission_title, 'Unknown Mission'));
    END IF;

  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RLS Policies
-- Ensure 'developers' (users with high rep or explicit role) can UPDATE missions.
-- Currently, we use `creator_id`.
-- Let's create a policy that allows the creator to UPDATE their own missions.
DROP POLICY IF EXISTS "Creators can update own missions" ON public.missions;
CREATE POLICY "Creators can update own missions" ON public.missions 
FOR UPDATE 
USING (auth.uid() = creator_id)
WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creators can delete own missions" ON public.missions;
CREATE POLICY "Creators can delete own missions" ON public.missions 
FOR DELETE 
USING (auth.uid() = creator_id);

