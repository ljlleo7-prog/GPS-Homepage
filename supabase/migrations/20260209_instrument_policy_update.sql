-- ==============================================================================
-- INSTRUMENT POLICY UPDATE & BET RECLAIM (REVISED)
-- Description: 
-- 1. Reclaims orphaned bets by mapping old creator IDs via username.
-- 2. Updates support_instruments schema with new policy fields.
-- 3. Implements dual-pathway creation logic (REP 70+ vs REP 50+).
-- 4. Sets up Deliverable System (Inbox, Auto-issue logic).
-- 5. Updates API compatibility.
-- ==============================================================================

-- 1. RECLAIM ORPHANED BETS
-- Logic: Map old creator_id -> username (backup) -> new creator_id (current)
DO $$
DECLARE
    r RECORD;
    v_old_creator_id UUID;
    v_username TEXT;
    v_new_creator_id UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_support_instruments_20260208') 
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_profiles_20260208') THEN
        
        FOR r IN SELECT id, creator_id FROM backup_support_instruments_20260208 WHERE creator_id IS NOT NULL
        LOOP
            -- 1. Get Username from Backup Profile
            SELECT username INTO v_username 
            FROM backup_profiles_20260208 
            WHERE id = r.creator_id;

            IF v_username IS NOT NULL THEN
                -- 2. Get New ID from Current Profile
                SELECT id INTO v_new_creator_id 
                FROM public.profiles 
                WHERE username = v_username;

                -- 3. Update Instrument if found and currently unowned (or just force update if we trust the map)
                IF v_new_creator_id IS NOT NULL THEN
                    UPDATE public.support_instruments
                    SET creator_id = v_new_creator_id
                    WHERE id = r.id AND (creator_id IS NULL OR creator_id != v_new_creator_id);
                END IF;
            END IF;
        END LOOP;
        
        RAISE NOTICE 'Orphaned bets reclaimed via username mapping.';
    END IF;
END $$;

-- 2. SCHEMA UPDATES (support_instruments)
DO $$
BEGIN
    -- deliverable_frequency
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'deliverable_frequency') THEN
        ALTER TABLE public.support_instruments ADD COLUMN deliverable_frequency TEXT CHECK (deliverable_frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'));
    END IF;

    -- deliverable_day (e.g., 'Monday', '15', '01-01')
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'deliverable_day') THEN
        ALTER TABLE public.support_instruments ADD COLUMN deliverable_day TEXT;
    END IF;

    -- deliverable_cost_per_ticket (amount per ticket %)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'deliverable_cost_per_ticket') THEN
        ALTER TABLE public.support_instruments ADD COLUMN deliverable_cost_per_ticket NUMERIC(5, 2); 
    END IF;

    -- deliverable_condition
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'deliverable_condition') THEN
        ALTER TABLE public.support_instruments ADD COLUMN deliverable_condition TEXT;
    END IF;
    
    -- Ensure refund_schedule exists (from previous fix, but good to ensure)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'refund_schedule') THEN
        ALTER TABLE public.support_instruments ADD COLUMN refund_schedule JSONB DEFAULT '[]'::JSONB;
    END IF;
END $$;

-- 3. DELIVERABLE SYSTEM TABLES
CREATE TABLE IF NOT EXISTS public.instrument_deliverables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instrument_id UUID REFERENCES public.support_instruments(id) ON DELETE CASCADE NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ISSUED', 'MISSED', 'SKIPPED')),
    cost_amount NUMERIC(20, 2), -- The total cost incurred
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.instrument_deliverables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public View Deliverables" ON public.instrument_deliverables;
CREATE POLICY "Public View Deliverables" ON public.instrument_deliverables FOR SELECT USING (true);

-- 4. UPDATE CAMPAIGN CREATION LOGIC (Unified)
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

  -- Current Dynamic Pricing Params (Normal instruments)
  p_ticket_price NUMERIC DEFAULT 1,
  p_ticket_limit INTEGER DEFAULT 1000000,
  p_open_date TIMESTAMPTZ DEFAULT NOW(),
  p_official_end_date TIMESTAMPTZ DEFAULT NULL,
  p_dynamic_noise_pct NUMERIC DEFAULT 1,
  p_dynamic_flex_demand_pct NUMERIC DEFAULT 0,
  p_dynamic_flex_time_pct NUMERIC DEFAULT 0,
  p_demand_saturation_units INTEGER DEFAULT 500,

  -- Driver Bet Params
  p_side_a_name TEXT DEFAULT NULL,
  p_side_b_name TEXT DEFAULT NULL,
  p_driver_bet_official_end_date TIMESTAMPTZ DEFAULT NULL,
  
  -- Legacy/Other
  p_refund_schedule JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep NUMERIC;
  v_new_id UUID;
  v_ticket_type_a_id UUID;
  v_ticket_type_b_id UUID;
  v_ticket_type_id UUID;
  v_noise NUMERIC := COALESCE(p_dynamic_noise_pct, 1);
  v_flex_d NUMERIC := COALESCE(p_dynamic_flex_demand_pct, 0);
  v_flex_t NUMERIC := COALESCE(p_dynamic_flex_time_pct, 0);
BEGIN
  -- Get User Rep
  SELECT reputation_balance INTO v_rep FROM public.wallets WHERE user_id = v_user_id;
  IF v_rep IS NULL THEN v_rep := 0; END IF;

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
          v_ticket_type_a_id, v_ticket_type_b_id, p_driver_bet_official_end_date
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

      IF UPPER(p_risk_level) = 'LOW' THEN
        v_noise := LEAST(v_noise, 0.5);
        v_flex_d := LEAST(v_flex_d, 0.005);
        v_flex_t := LEAST(v_flex_t, 0.005);
      ELSIF UPPER(p_risk_level) = 'MID' THEN
        v_noise := LEAST(v_noise, 1.0);
        v_flex_d := LEAST(v_flex_d, 0.01);
        v_flex_t := LEAST(v_flex_t, 0.01);
      ELSE
        v_noise := LEAST(v_noise, 50.0);
        v_flex_d := LEAST(v_flex_d, 0.5);
        v_flex_t := LEAST(v_flex_t, 0.5);
      END IF;

      INSERT INTO public.support_instruments (
          title, description, type, risk_level, 
          yield_rate, lockup_period_days, status, creator_id,
          deliverable_frequency, deliverable_day, 
          deliverable_cost_per_ticket, deliverable_condition,
          refund_schedule,
          ticket_price, ticket_limit, open_date, official_end_date,
          dynamic_noise_pct, dynamic_flex_demand_pct, dynamic_flex_time_pct, demand_saturation_units
      ) VALUES (
          p_title, p_description, 'MILESTONE', p_risk_level,
          p_yield_rate, p_lockup_days, 'PENDING', v_user_id,
          p_deliverable_frequency, p_deliverable_day,
          p_deliverable_cost_per_ticket, p_deliverable_condition,
          p_refund_schedule,
          COALESCE(p_ticket_price, 1), COALESCE(p_ticket_limit, 1000000), COALESCE(p_open_date, NOW()), p_official_end_date,
          v_noise, v_flex_d, v_flex_t, COALESCE(p_demand_saturation_units, 500)
      ) RETURNING id INTO v_new_id;

      -- Create Ticket Type for this instrument
      INSERT INTO public.ticket_types (title, description, total_supply, creator_id, instrument_id)
      VALUES (p_title, 'Ticket for ' || p_title, COALESCE(p_ticket_limit, 1000000), v_user_id, v_new_id)
      RETURNING id INTO v_ticket_type_id;
      UPDATE public.support_instruments SET ticket_type_id = v_ticket_type_id WHERE id = v_new_id;

      RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'MARKET');

  ELSE
      RAISE EXCEPTION 'Invalid campaign type';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. API COMPATIBILITY WRAPPER (Update create_marketing_campaign_v2 to use new logic)
-- Note: This is tricky because the old frontend doesn't send the new deliverable params yet.
-- We will allow NULLs in the wrapper but the core function might reject if we are strict.
-- However, we enforced "All deliverable fields... are required" above.
-- This means the FRONTEND MUST BE UPDATED before this works for new campaigns.
-- For legacy calls, it will fail with "All deliverable fields... are required".
-- This is intended behavior for "re-establishing policy".
CREATE OR REPLACE FUNCTION public.create_marketing_campaign_v2(
  p_title TEXT,
  p_description TEXT,
  p_refund_schedule JSONB DEFAULT '[]'::JSONB,
  p_is_driver_bet BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
BEGIN
  -- We redirect to the new function. 
  -- IF it's a driver bet, we map it.
  -- IF it's a normal market, we map it, BUT it will fail if new params are missing.
  -- This forces the UI update.
  
  IF p_is_driver_bet THEN
      RETURN public.create_user_campaign(
          'DRIVER_BET', p_title, p_description,
          0, 0, 'HIGH', 0, 0,
          NULL, NULL, 0, NULL, -- Deliverables (not needed for driver bet)
          'Side A', 'Side B', NOW() + INTERVAL '7 days', -- Defaults for legacy driver bet call
          p_refund_schedule
      );
  ELSE
      -- Normal Market: Will fail validation unless we provide defaults.
      -- But user said "user must specify...".
      -- So we return an error if called via old API?
      -- Or we default to some values?
      -- Better to fail and prompt UI update.
      RETURN public.create_user_campaign(
          'MARKET', p_title, p_description,
          0, 0, 'HIGH', 0, 0,
          NULL, NULL, 0, NULL, -- Missing deliverables!
          NULL, NULL, NULL,
          p_refund_schedule
      );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. AUTO-ISSUE FUNCTION (Draft Logic)
CREATE OR REPLACE FUNCTION public.process_overdue_deliverables()
RETURNS void AS $$
DECLARE
    r RECORD;
    v_dev_count INTEGER;
    v_cost_per_dev NUMERIC;
BEGIN
    FOR r IN SELECT * FROM public.instrument_deliverables 
             WHERE status = 'PENDING' AND due_date < NOW() - INTERVAL '1 day'
    LOOP
        v_cost_per_dev := 100; -- Placeholder
        SELECT COUNT(*) INTO v_dev_count FROM public.profiles WHERE developer_status = 'APPROVED';
        
        IF v_dev_count > 0 THEN
            v_cost_per_dev := v_cost_per_dev / v_dev_count;
            UPDATE public.wallets 
            SET token_balance = token_balance - v_cost_per_dev
            WHERE user_id IN (SELECT id FROM public.profiles WHERE developer_status = 'APPROVED');
            
            UPDATE public.instrument_deliverables 
            SET status = 'MISSED', updated_at = NOW() 
            WHERE id = r.id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. DEVELOPER INBOX VIEW
CREATE OR REPLACE VIEW public.developer_deliverables_inbox AS
SELECT 
    d.*,
    i.title as instrument_title,
    i.creator_id,
    p.username as creator_name
FROM public.instrument_deliverables d
JOIN public.support_instruments i ON d.instrument_id = i.id
JOIN public.profiles p ON i.creator_id = p.id
WHERE d.status = 'PENDING';

RAISE NOTICE 'Instrument Policy Updated Successfully';
