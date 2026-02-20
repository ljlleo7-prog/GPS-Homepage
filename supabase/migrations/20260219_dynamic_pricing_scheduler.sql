CREATE OR REPLACE FUNCTION public.step_noise_for_hour(p_hour TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_t UUID;
  v_state RECORD;
  v_next NUMERIC;
BEGIN
  FOR v_t IN
    SELECT t.id
    FROM public.ticket_types t
    JOIN public.support_instruments i ON i.id = t.instrument_id
  LOOP
    SELECT noise, last_hour INTO v_state
    FROM public.price_noise_state
    WHERE ticket_type_id = v_t;
    IF NOT FOUND THEN
      v_state := ROW(0::NUMERIC, p_hour - INTERVAL '1 hour');
    END IF;
    IF v_state.last_hour < p_hour THEN
      v_next := public.compute_noise_step(v_t, COALESCE(v_state.noise, 0), p_hour);
      INSERT INTO public.price_noise_state (ticket_type_id, noise, last_hour, updated_at)
      VALUES (v_t, v_next, p_hour, NOW())
      ON CONFLICT (ticket_type_id)
      DO UPDATE SET noise = EXCLUDED.noise, last_hour = EXCLUDED.last_hour, updated_at = NOW();
    END IF;
  END LOOP;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('hourly_noise_step');
SELECT cron.schedule(
  'hourly_noise_step',
  '1 * * * *',
  $$ SELECT public.step_noise_for_hour(date_trunc('hour', NOW())); $$
);
SELECT cron.unschedule('hourly_official_price_tasks');
SELECT cron.schedule(
  'hourly_official_price_tasks',
  '5 * * * *',
  $$ SELECT public.record_previous_hour_official_prices(); SELECT public.compress_price_histories(); $$
);
