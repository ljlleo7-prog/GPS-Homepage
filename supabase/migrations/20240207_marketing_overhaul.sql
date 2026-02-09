-- 1. DEVELOPER REPUTATION TRIGGER
-- Ensures reputation hits 80 when status becomes APPROVED, even on manual updates.
CREATE OR REPLACE FUNCTION public.sync_developer_reputation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.developer_status = 'APPROVED' AND (OLD.developer_status IS DISTINCT FROM 'APPROVED') THEN
    UPDATE public.wallets
    SET reputation_balance = GREATEST(reputation_balance, 80)
    WHERE user_id = NEW.id;
    
    -- Optional: Log to ledger
    INSERT INTO public.ledger_entries (
      wallet_id, amount, currency, operation_type, description
    ) 
    SELECT id, 80, 'REP', 'SYSTEM', 'Developer Status Sync'
    FROM public.wallets
    WHERE user_id = NEW.id
    AND NOT EXISTS (
        SELECT 1 FROM public.ledger_entries 
        WHERE wallet_id = public.wallets.id 
        AND description = 'Developer Status Sync' 
        AND created_at > NOW() - INTERVAL '1 minute'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_developer_rep ON public.profiles;
CREATE TRIGGER trigger_sync_developer_rep
AFTER UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_developer_reputation();

-- 2. SCHEMA UPDATES FOR MARKETING CAMPAIGNS

-- Link Support Instruments to Ticket Types (One-to-One)
ALTER TABLE public.support_instruments 
ADD COLUMN IF NOT EXISTS ticket_type_id UUID REFERENCES public.ticket_types(id),
ADD COLUMN IF NOT EXISTS refund_schedule JSONB DEFAULT '[]'::JSONB, -- Array of {date, amount}
ADD COLUMN IF NOT EXISTS is_driver_bet BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS deletion_status TEXT DEFAULT 'ACTIVE' CHECK (deletion_status IN ('ACTIVE', 'DELISTED_MARKET', 'DELETED_EVERYWHERE'));

-- Add instrument_id to Ticket Types for reverse lookup
ALTER TABLE public.ticket_types
ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES public.support_instruments(id);

-- 3. CAMPAIGN CREATION FUNCTION (Updated)
CREATE OR REPLACE FUNCTION public.create_marketing_campaign_v2(
  p_title TEXT,
  p_description TEXT,
  p_refund_schedule JSONB,
  p_is_driver_bet BOOLEAN
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep NUMERIC;
  v_instrument_id UUID;
  v_ticket_type_id UUID;
  v_risk_level TEXT;
  v_is_dev BOOLEAN;
BEGIN
  -- 1. Check Reputation > 70
  v_rep := public.get_my_reputation();
  IF v_rep IS NULL OR v_rep <= 70 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient Reputation (>70 required)');
  END IF;

  -- 2. Determine Risk Level
  SELECT (developer_status = 'APPROVED') INTO v_is_dev FROM public.profiles WHERE id = v_user_id;
  
  IF p_is_driver_bet THEN
    IF v_is_dev THEN
      v_risk_level := 'MID'; -- Devs can set lower risk? Or maybe still High? User said "unless developer approved". Assuming Devs can approve their own.
    ELSE
      v_risk_level := 'HIGH';
    END IF;
  ELSE
    v_risk_level := 'LOW'; -- Default low for non-driver bets? Or user selects? 
    -- User said: "low and mid risks are mainly for development". 
    -- Let's default to MID for user campaigns, HIGH for driver bets.
    v_risk_level := 'MID';
  END IF;

  -- 3. Create Ticket Type (The Asset)
  INSERT INTO public.ticket_types (
    title, description, total_supply, creator_id
  ) VALUES (
    p_title, p_description, NULL, v_user_id -- NULL supply means infinite/mint-on-demand
  ) RETURNING id INTO v_ticket_type_id;

  -- 4. Create Support Instrument (The Logic)
  INSERT INTO public.support_instruments (
    title, description, type, risk_level, status, creator_id, 
    ticket_type_id, refund_schedule, is_driver_bet, deletion_status
  ) VALUES (
    p_title, p_description, 'MARKET', v_risk_level, 'OPEN', v_user_id,
    v_ticket_type_id, p_refund_schedule, p_is_driver_bet, 'ACTIVE'
  ) RETURNING id INTO v_instrument_id;

  -- 5. Link back
  UPDATE public.ticket_types 
  SET instrument_id = v_instrument_id 
  WHERE id = v_ticket_type_id;

  RETURN jsonb_build_object('success', true, 'id', v_instrument_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. BUY CAMPAIGN TICKET (Minting)
-- Note: Core logic is now maintained in later migration 20260209_dev_pool_interest_split.sql

-- 5. DELETE CAMPAIGN (Soft & Hard)
CREATE OR REPLACE FUNCTION public.delete_marketing_campaign(
  p_instrument_id UUID,
  p_mode TEXT -- 'MARKET' (Soft) or 'EVERYWHERE' (Hard)
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_instrument RECORD;
  v_holder RECORD;
  v_refund_cost NUMERIC;
BEGIN
  -- 1. Get Instrument
  SELECT * INTO v_instrument 
  FROM public.support_instruments 
  WHERE id = p_instrument_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Campaign not found');
  END IF;

  -- 2. Auth Check (Creator Only)
  IF v_instrument.creator_id != v_user_id THEN
    -- Allow Admins too?
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  IF p_mode = 'MARKET' THEN
    -- Soft Delete: Prevent new minting, allow trading
    UPDATE public.support_instruments
    SET deletion_status = 'DELISTED_MARKET'
    WHERE id = p_instrument_id;
    
    RETURN jsonb_build_object('success', true, 'message', 'Campaign delisted from primary market');
    
  ELSIF p_mode = 'EVERYWHERE' THEN
    -- Hard Delete: Refund 1 token per ticket to all holders
    UPDATE public.support_instruments
    SET deletion_status = 'DELETED_EVERYWHERE'
    WHERE id = p_instrument_id;

    -- Loop through all holders of this ticket type
    FOR v_holder IN 
      SELECT user_id, balance 
      FROM public.user_ticket_balances 
      WHERE ticket_type_id = v_instrument.ticket_type_id AND balance > 0
    LOOP
      -- Refund
      v_refund_cost := v_holder.balance * 1.0;
      
      UPDATE public.wallets
      SET token_balance = token_balance + v_refund_cost
      WHERE user_id = v_holder.user_id;
      
      -- Log Refund
      INSERT INTO public.ledger_entries (
        wallet_id, amount, currency, operation_type, description
      ) 
      SELECT id, v_refund_cost, 'TOKEN', 'REFUND', 'Campaign Deleted Refund: ' || v_instrument.title
      FROM public.wallets
      WHERE user_id = v_holder.user_id;
      
      -- Zero out balance
      UPDATE public.user_ticket_balances
      SET balance = 0
      WHERE user_id = v_holder.user_id AND ticket_type_id = v_instrument.ticket_type_id;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'message', 'Campaign deleted and refunded');
  ELSE
    RETURN jsonb_build_object('success', false, 'message', 'Invalid deletion mode');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
