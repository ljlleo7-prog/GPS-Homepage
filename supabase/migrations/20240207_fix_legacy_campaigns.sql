-- Fix for legacy campaigns and position migration
-- 1. Add 'MIGRATED' status to support_positions
ALTER TABLE public.support_positions DROP CONSTRAINT IF EXISTS support_positions_status_check;
ALTER TABLE public.support_positions ADD CONSTRAINT support_positions_status_check 
  CHECK (status IN ('ACTIVE', 'CLOSED', 'PAYOUT_RECEIVED', 'MIGRATED'));

DO $$
DECLARE
  v_rec RECORD;
  v_ticket_type_id UUID;
BEGIN
  -- 2. Backfill Ticket Types for Instruments (Idempotent: only where ticket_type_id is NULL)
  -- Exclude Driver Bets as they have their own ticket types (A/B)
  FOR v_rec IN SELECT * FROM public.support_instruments WHERE ticket_type_id IS NULL AND (is_driver_bet IS FALSE OR is_driver_bet IS NULL) LOOP
    -- Create Ticket Type
    INSERT INTO public.ticket_types (title, description, total_supply, creator_id, instrument_id)
    VALUES (v_rec.title, v_rec.description, NULL, v_rec.creator_id, v_rec.id)
    RETURNING id INTO v_ticket_type_id;

    -- Update Instrument
    UPDATE public.support_instruments
    SET ticket_type_id = v_ticket_type_id
    WHERE id = v_rec.id;
  END LOOP;

  -- 3. Migrate Support Positions to User Ticket Balances
  -- Only migrate ACTIVE positions
  FOR v_rec IN 
    SELECT sp.id as position_id, sp.user_id, sp.amount_invested, si.ticket_type_id 
    FROM public.support_positions sp
    JOIN public.support_instruments si ON sp.instrument_id = si.id
    WHERE sp.status = 'ACTIVE'
    AND si.ticket_type_id IS NOT NULL
  LOOP
    -- Upsert balance (1 Token = 1 Ticket)
    INSERT INTO public.user_ticket_balances (user_id, ticket_type_id, balance)
    VALUES (v_rec.user_id, v_rec.ticket_type_id, v_rec.amount_invested::integer)
    ON CONFLICT (user_id, ticket_type_id) 
    DO UPDATE SET balance = user_ticket_balances.balance + EXCLUDED.balance;
    
    -- Mark position as MIGRATED to prevent double-counting
    UPDATE public.support_positions
    SET status = 'MIGRATED'
    WHERE id = v_rec.position_id;
  END LOOP;
END $$;
