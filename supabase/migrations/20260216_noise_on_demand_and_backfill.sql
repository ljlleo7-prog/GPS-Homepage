-- Persist noise step on-demand and backfill noise pct for driver bets

CREATE OR REPLACE FUNCTION public.get_ticket_noise(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_hour TIMESTAMPTZ := date_trunc('hour', p_at);
  v_state RECORD;
  v_next NUMERIC;
BEGIN
  SELECT noise, last_hour INTO v_state
  FROM public.price_noise_state
  WHERE ticket_type_id = p_ticket_type_id;
  
  IF NOT FOUND OR v_state.last_hour < v_hour THEN
    v_next := public.compute_noise_step(p_ticket_type_id, COALESCE(v_state.noise, 0), v_hour);
    INSERT INTO public.price_noise_state (ticket_type_id, noise, last_hour, updated_at)
    VALUES (p_ticket_type_id, v_next, v_hour, NOW())
    ON CONFLICT (ticket_type_id)
    DO UPDATE SET noise = EXCLUDED.noise, last_hour = EXCLUDED.last_hour, updated_at = NOW();
    RETURN v_next;
  END IF;
  
  RETURN v_state.noise;
END;
$$;

-- Backfill: ensure driver bets have small non-zero noise pct
UPDATE public.support_instruments
SET dynamic_noise_pct = 1
WHERE COALESCE(is_driver_bet, false) = true
  AND COALESCE(dynamic_noise_pct, 0) = 0;

-- Seed noise state for current hour for all driver bet ticket types
DO $$
DECLARE
  t UUID;
  v_hour TIMESTAMPTZ := date_trunc('hour', NOW());
BEGIN
  FOR t IN
    SELECT tt FROM (
      SELECT ticket_type_a_id AS tt FROM public.support_instruments WHERE COALESCE(is_driver_bet, false) = true AND ticket_type_a_id IS NOT NULL
      UNION ALL
      SELECT ticket_type_b_id FROM public.support_instruments WHERE COALESCE(is_driver_bet, false) = true AND ticket_type_b_id IS NOT NULL
    ) s
  LOOP
    PERFORM 1;
    INSERT INTO public.price_noise_state (ticket_type_id, noise, last_hour, updated_at)
    VALUES (t, public.compute_noise_step(t, 0, v_hour), v_hour, NOW())
    ON CONFLICT (ticket_type_id) DO NOTHING;
  END LOOP;
END $$;
