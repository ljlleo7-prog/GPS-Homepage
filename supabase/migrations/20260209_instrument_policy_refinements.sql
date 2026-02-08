-- ==============================================================================
-- INSTRUMENT POLICY REFINEMENTS & BOND LOGIC
-- Description:
-- 1. Updates create_user_campaign to remove refund schedule and add Bond logic.
-- 2. Bond (100 Tokens) is charged for Normal Instruments and distributed to developers.
-- 3. Updates legacy AI instruments to fit new schema.
-- ==============================================================================

-- 1. UPDATE CAMPAIGN CREATION LOGIC (Refined)
CREATE OR REPLACE FUNCTION public.create_user_campaign(
  p_type TEXT, -- 'MISSION', 'MARKET' (Normal), 'DRIVER_BET'
  p_title TEXT,
  p_description TEXT,
  
  -- Mission Params
  p_reward_min NUMERIC DEFAULT 0,
  p_reward_max NUMERIC DEFAULT 0,
  
  -- Market/Instrument Params
  p_risk_level TEXT DEFAULT 'HIGH', -- LOW, MID, HIGH
  p_yield_rate NUMERIC DEFAULT 0,
  p_lockup_days INTEGER DEFAULT 0,
  
  -- New Deliverable Params
  p_deliverable_frequency TEXT DEFAULT NULL,
  p_deliverable_day TEXT DEFAULT NULL,
  p_deliverable_cost_per_ticket NUMERIC DEFAULT 0,
  p_deliverable_condition TEXT DEFAULT NULL,

  -- Driver Bet Params
  p_side_a_name TEXT DEFAULT NULL,
  p_side_b_name TEXT DEFAULT NULL,
  p_official_end_date TIMESTAMPTZ DEFAULT NULL,
  
  -- Legacy (Ignored)
  p_refund_schedule JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep NUMERIC;
  v_balance NUMERIC;
  v_new_id UUID;
  v_ticket_type_a_id UUID;
  v_ticket_type_b_id UUID;
  v_bond_amount NUMERIC := 100; -- Fixed Creation Bond
  v_dev_count INTEGER;
  v_share_per_dev NUMERIC;
BEGIN
  -- Get User Rep and Balance
  SELECT reputation_balance, token_balance INTO v_rep, v_balance 
  FROM public.wallets 
  WHERE user_id = v_user_id;
  
  IF v_rep IS NULL THEN v_rep := 0; END IF;
  IF v_balance IS NULL THEN v_balance := 0; END IF;

  -- PATHWAY 1: MISSION
  IF p_type = 'MISSION' THEN
      IF v_rep <= 70 THEN RAISE EXCEPTION 'Insufficient Reputation for Missions (Req: >70)'; END IF;
      
      INSERT INTO public.missions (
          title, description, reward_rep, is_variable_reward, 
          reward_min, reward_max, status, type, creator_id,
          reward_rep_min, reward_rep_max -- Defaults
      ) VALUES (
          p_title, p_description, 5, true, 
          p_reward_min, p_reward_max, 'PENDING_APPROVAL', 'COMMUNITY', v_user_id,
          0, 5
      ) RETURNING id INTO v_new_id;
      
      RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'MISSION');

  -- PATHWAY 2: DRIVER BET (REP 50+)
  ELSIF p_type = 'DRIVER_BET' THEN
      IF v_rep <= 50 THEN RAISE EXCEPTION 'Insufficient Reputation for Driver Bets (Req: >50)'; END IF;
      
      -- Create Ticket Types for Sides A and B
      INSERT INTO public.ticket_types (title, description, total_supply, creator_id)
      VALUES (p_side_a_name, 'Side A for ' || p_title, 1000000, v_user_id)
      RETURNING id INTO v_ticket_type_a_id;

      INSERT INTO public.ticket_types (title, description, total_supply, creator_id)
      VALUES (p_side_b_name, 'Side B for ' || p_title, 1000000, v_user_id)
      RETURNING id INTO v_ticket_type_b_id;

      INSERT INTO public.support_instruments (
          title, description, type, risk_level, 
          status, creator_id,
          is_driver_bet, side_a_name, side_b_name, 
          ticket_type_a_id, ticket_type_b_id, official_end_date
      ) VALUES (
          p_title, p_description, 'MILESTONE', 'HIGH', -- Driver bets are high risk
          'OPEN', v_user_id,
          true, p_side_a_name, p_side_b_name,
          v_ticket_type_a_id, v_ticket_type_b_id, p_official_end_date
      ) RETURNING id INTO v_new_id;

      -- Link Back
      UPDATE public.ticket_types SET instrument_id = v_new_id WHERE id IN (v_ticket_type_a_id, v_ticket_type_b_id);

      RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'DRIVER_BET');

  -- PATHWAY 3: NORMAL INSTRUMENT (REP 70+)
  ELSIF p_type = 'MARKET' THEN
      IF v_rep <= 70 THEN RAISE EXCEPTION 'Insufficient Reputation for Instruments (Req: >70)'; END IF;
      
      -- Validate Deliverables
      IF p_risk_level IS NULL OR p_deliverable_frequency IS NULL OR p_deliverable_day IS NULL 
         OR p_deliverable_cost_per_ticket IS NULL OR p_deliverable_condition IS NULL THEN
         RAISE EXCEPTION 'All deliverable fields (Risk, Frequency, Day, Amount, Condition) are required.';
      END IF;

      -- Check Balance for Bond
      IF v_balance < v_bond_amount THEN
          RAISE EXCEPTION 'Insufficient Balance for Creation Bond (Req: % Tokens)', v_bond_amount;
      END IF;

      -- Deduct Bond
      UPDATE public.wallets SET token_balance = token_balance - v_bond_amount WHERE user_id = v_user_id;
      
      -- Distribute Bond to Developers
      SELECT COUNT(*) INTO v_dev_count FROM public.profiles WHERE developer_status = 'APPROVED';
      
      IF v_dev_count > 0 THEN
          v_share_per_dev := v_bond_amount / v_dev_count;
          UPDATE public.wallets 
          SET token_balance = token_balance + v_share_per_dev 
          WHERE user_id IN (SELECT id FROM public.profiles WHERE developer_status = 'APPROVED');
          
          -- Log Ledger for Creator
          INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
          VALUES ((SELECT id FROM public.wallets WHERE user_id = v_user_id), -v_bond_amount, 'TOKEN', 'FEE', 'Creation Bond for Instrument');
      ELSE
          -- Burn if no devs? Or keep in system? For now, just burn/deduct.
          NULL; 
      END IF;

      INSERT INTO public.support_instruments (
          title, description, type, risk_level, 
          yield_rate, lockup_period_days, status, creator_id,
          deliverable_frequency, deliverable_day, 
          deliverable_cost_per_ticket, deliverable_condition,
          refund_schedule -- Keeping column but inserting empty/null
      ) VALUES (
          p_title, p_description, 'MILESTONE', p_risk_level,
          p_yield_rate, p_lockup_days, 'PENDING', v_user_id,
          p_deliverable_frequency, p_deliverable_day,
          p_deliverable_cost_per_ticket, p_deliverable_condition,
          '[]'::JSONB
      ) RETURNING id INTO v_new_id;

      -- Create Ticket Type for this instrument
      INSERT INTO public.ticket_types (title, description, total_supply, creator_id, instrument_id)
      VALUES (p_title, 'Ticket for ' || p_title, 1000000, v_user_id, v_new_id);

      RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'MARKET');

  ELSE
      RAISE EXCEPTION 'Invalid campaign type';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. UPDATE LEGACY AI INSTRUMENTS
-- Logic: Update non-driver-bet instruments that have missing deliverable info.
-- We identify them by missing deliverable_frequency and not being driver bets.
DO $$
BEGIN
    UPDATE public.support_instruments
    SET 
        deliverable_frequency = 'MONTHLY',
        deliverable_day = '1st',
        deliverable_cost_per_ticket = 5.00,
        deliverable_condition = 'Standard monthly yield generation based on market performance.',
        risk_level = COALESCE(risk_level, 'LOW'),
        refund_schedule = '[]'::JSONB -- Clear any legacy refund schedules
    WHERE 
        (is_driver_bet IS FALSE OR is_driver_bet IS NULL)
        AND deliverable_frequency IS NULL;
        
    RAISE NOTICE 'Legacy AI instruments updated to new schema.';
END $$;
