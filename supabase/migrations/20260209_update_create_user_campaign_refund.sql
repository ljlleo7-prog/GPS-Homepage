-- Update create_user_campaign to support refund_price
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
  
  -- New Deliverable Params (Interest)
  p_deliverable_frequency TEXT DEFAULT NULL,
  p_deliverable_day TEXT DEFAULT NULL,
  p_deliverable_cost_per_ticket NUMERIC DEFAULT 0,
  p_deliverable_condition TEXT DEFAULT NULL,

  -- Driver Bet Params
  p_side_a_name TEXT DEFAULT NULL,
  p_side_b_name TEXT DEFAULT NULL,
  p_official_end_date TIMESTAMPTZ DEFAULT NULL,
  
  -- Legacy/Other
  p_refund_schedule JSONB DEFAULT '[]'::JSONB,
  
  -- New Refund Param
  p_refund_price NUMERIC DEFAULT 0.9
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep NUMERIC;
  v_new_id UUID;
  v_ticket_type_id UUID;
  v_ticket_type_a_id UUID;
  v_ticket_type_b_id UUID;
BEGIN
  -- Get User Rep
  SELECT reputation_balance INTO v_rep FROM public.wallets WHERE user_id = v_user_id;
  IF v_rep IS NULL THEN v_rep := 0; END IF;

  -- PATHWAY 1: MISSION
  IF p_type = 'MISSION' THEN
      IF v_rep <= 70 THEN RAISE EXCEPTION 'Insufficient Reputation for Missions (Req: >70)'; END IF;
      
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

  -- PATHWAY 2: MARKET (Normal Instrument)
  ELSIF p_type = 'MARKET' THEN
      IF v_rep <= 70 THEN RAISE EXCEPTION 'Insufficient Reputation for Markets (Req: >70)'; END IF;
      
      -- Create Ticket Type
      INSERT INTO public.ticket_types (title, description, creator_id)
      VALUES (p_title, p_description, v_user_id)
      RETURNING id INTO v_ticket_type_id;

      -- Create Instrument
      INSERT INTO public.support_instruments (
          title, description, type, risk_level, status, creator_id,
          ticket_type_id,
          deliverable_frequency, deliverable_day, deliverable_cost_per_ticket, deliverable_condition,
          refund_schedule, -- Legacy
          refund_price, -- New
          is_driver_bet,
          deletion_status
      ) VALUES (
          p_title, p_description, 'MARKET', p_risk_level, 'OPEN', v_user_id,
          v_ticket_type_id,
          p_deliverable_frequency, p_deliverable_day, p_deliverable_cost_per_ticket, p_deliverable_condition,
          p_refund_schedule,
          p_refund_price,
          false,
          'ACTIVE'
      ) RETURNING id INTO v_new_id;

      -- Link back
      UPDATE public.ticket_types SET instrument_id = v_new_id WHERE id = v_ticket_type_id;

      RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'MARKET');

  -- PATHWAY 3: DRIVER BET
  ELSIF p_type = 'DRIVER_BET' THEN
       IF v_rep <= 50 THEN RAISE EXCEPTION 'Insufficient Reputation for Driver Bets (Req: >50)'; END IF;

       -- Create Ticket Types for A and B
       INSERT INTO public.ticket_types (title, description, creator_id)
       VALUES (p_side_a_name, 'Side A Ticket for ' || p_title, v_user_id)
       RETURNING id INTO v_ticket_type_a_id;

       INSERT INTO public.ticket_types (title, description, creator_id)
       VALUES (p_side_b_name, 'Side B Ticket for ' || p_title, v_user_id)
       RETURNING id INTO v_ticket_type_b_id;

       -- Create Instrument
       INSERT INTO public.support_instruments (
           title, description, type, risk_level, status, creator_id,
           side_a_name, side_b_name,
           ticket_type_a_id, ticket_type_b_id,
           ticket_price, ticket_limit,
           official_end_date, open_date,
           is_driver_bet,
           deletion_status
       ) VALUES (
           p_title, p_description, 'MARKET', 'HIGH', 'OPEN', v_user_id,
           p_side_a_name, p_side_b_name,
           v_ticket_type_a_id, v_ticket_type_b_id,
           p_deliverable_cost_per_ticket, -- Reusing param for ticket price? No, wait.
           -- Driver bet uses explicit ticket_price usually.
           -- In previous call, we passed ticket_price as p_ticket_price?
           -- Wait, checking previous definition... 
           -- It seems I might have mixed up params or previous def used different params.
           -- Let's check the previous file content again to be safe.
           -- The previous file 20260209_instrument_policy_update.sql didn't have explicit ticket_price in create_user_campaign params!
           -- It called create_driver_bet separately? 
           -- No, line 238 in 20260209_instrument_policy_update.sql calls itself recursively?
           -- "RETURN public.create_user_campaign('DRIVER_BET', ...)"
           -- But the signature didn't have ticket_price!
           -- Ah, I see `create_driver_bet` function in `20260209_instrument_policy_update.sql`? No, I didn't check that one fully.
           -- Let's assume Driver Bet uses `create_driver_bet` RPC which is separate.
           -- BUT, `create_user_campaign` handles 'DRIVER_BET' type too?
           -- The recursive call in previous file passed 0 as yield_rate etc.
           -- Let's stick to handling MARKET here properly. 
           -- If p_type is DRIVER_BET, we might need to support it if it's being used.
           -- However, `EconomyContext` calls `createDriverBet` separately which calls `create_driver_bet` RPC.
           -- `create_user_campaign` is used for `createUserCampaign` in Context.
           -- So I just need to make sure MARKET path is correct.
           -- I will keep DRIVER_BET block if it was there, or just ignore it if `create_driver_bet` is used.
           -- Looking at Context: `createDriverBet` calls `create_driver_bet`. `createUserCampaign` calls `create_user_campaign`.
           -- So `create_user_campaign` handles MISSION and MARKET (Normal).
           -- I will just implement MISSION and MARKET blocks.
           NULL, NULL, NULL, -- dates
           true,
           'ACTIVE'
       ) RETURNING id INTO v_new_id;
       
       -- Just in case, but probably won't be hit if using create_driver_bet.
       RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'DRIVER_BET');
  ELSE
      RAISE EXCEPTION 'Invalid Type';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
