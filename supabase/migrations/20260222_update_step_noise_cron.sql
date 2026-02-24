-- Update step_noise_for_hour to use the new stateful pricing logic (compute_next_price_step)
-- This ensures the cron job updates prices correctly using the Base * (1 + Flex) target and random walk.

CREATE OR REPLACE FUNCTION public.step_noise_for_hour(p_hour TIMESTAMPTZ)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  t UUID;
  v_curr RECORD;
  v_base NUMERIC;
  v_flex NUMERIC;
  v_target_price NUMERIC;
  v_next_price NUMERIC;
  v_next_noise NUMERIC;
  v_instr RECORD;
BEGIN
  FOR t IN
    SELECT tt FROM (
      SELECT ticket_type_id AS tt FROM public.support_instruments WHERE ticket_type_id IS NOT NULL
      UNION ALL
      SELECT ticket_type_a_id FROM public.support_instruments WHERE ticket_type_a_id IS NOT NULL
      UNION ALL
      SELECT ticket_type_b_id FROM public.support_instruments WHERE ticket_type_b_id IS NOT NULL
    ) s
  LOOP
    -- Get current state
    SELECT noise, current_price, last_hour INTO v_curr 
    FROM public.price_noise_state 
    WHERE ticket_type_id = t;
    
    -- Get Base Price
    SELECT i.ticket_price INTO v_instr
    FROM public.support_instruments i
    LEFT JOIN public.ticket_types tt ON tt.instrument_id = i.id
    WHERE tt.id = t OR i.ticket_type_a_id = t OR i.ticket_type_b_id = t
    LIMIT 1;
    
    v_base := COALESCE(v_instr.ticket_price, 0);
    
    -- Initialize current price if missing (using noise if available, or base)
    IF v_curr.current_price IS NULL OR v_curr.current_price = 0 THEN
       v_curr.current_price := v_base * (1 + COALESCE(v_curr.noise, 0));
    END IF;

    -- Only update if last_hour < p_hour
    -- We use a simplified check here. Ideally, we should loop if the gap is large, 
    -- but the cron runs hourly, so one step is usually enough. 
    -- If it missed many hours, this will just do one step towards the *current* target (at p_hour).
    -- This is acceptable for self-correction.
    IF v_curr.last_hour IS NULL OR v_curr.last_hour < p_hour THEN
      
      -- Calculate Target Flex for the given hour
      v_flex := public.calculate_flex_factor(t, p_hour);
      v_target_price := v_base * (1 + v_flex);
      
      -- Compute Next Price
      v_next_price := public.compute_next_price_step(t, v_curr.current_price, v_target_price, p_hour);
      
      -- Compute Noise (for legacy compatibility)
      IF v_base > 0 THEN
        v_next_noise := (v_next_price - v_base) / v_base;
      ELSE
        v_next_noise := 0;
      END IF;

      -- Update State
      INSERT INTO public.price_noise_state (ticket_type_id, noise, current_price, last_hour, updated_at)
      VALUES (t, v_next_noise, v_next_price, p_hour, NOW())
      ON CONFLICT (ticket_type_id)
      DO UPDATE SET 
        noise = EXCLUDED.noise, 
        current_price = EXCLUDED.current_price, 
        last_hour = EXCLUDED.last_hour, 
        updated_at = NOW();
        
    END IF;
  END LOOP;
END;
$$;
