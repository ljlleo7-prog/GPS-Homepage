-- Consolidated dynamic pricing: functions, RLS policies, initial history, and pg_cron scheduling
-- This file overrides fragmented definitions and sets up a self-contained hour-to-hour system.

-- 1) Tables required by dynamic pricing (idempotent)
CREATE TABLE IF NOT EXISTS public.price_noise_state (
  ticket_type_id UUID PRIMARY KEY REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  noise NUMERIC NOT NULL DEFAULT 0,
  last_hour TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.official_price_history (
  instrument_id UUID REFERENCES public.support_instruments(id) ON DELETE CASCADE,
  ticket_type_id UUID NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.official_price_history ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.official_price_daily_history (
  instrument_id UUID REFERENCES public.support_instruments(id) ON DELETE CASCADE,
  ticket_type_id UUID NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  avg_price NUMERIC NOT NULL,
  PRIMARY KEY (instrument_id, ticket_type_id, day)
);
ALTER TABLE public.official_price_daily_history ENABLE ROW LEVEL SECURITY;

-- Ensure required dynamic pricing columns exist and sane defaults are set
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='support_instruments' AND column_name='dynamic_noise_pct'
  ) THEN
    EXECUTE 'ALTER TABLE public.support_instruments ADD COLUMN dynamic_noise_pct NUMERIC DEFAULT 1';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='support_instruments' AND column_name='dynamic_flex_pct'
  ) THEN
    EXECUTE 'ALTER TABLE public.support_instruments ADD COLUMN dynamic_flex_pct NUMERIC DEFAULT 0';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='support_instruments' AND column_name='dynamic_flex_time_pct'
  ) THEN
    EXECUTE 'ALTER TABLE public.support_instruments ADD COLUMN dynamic_flex_time_pct NUMERIC DEFAULT 0';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='support_instruments' AND column_name='dynamic_flex_demand_pct'
  ) THEN
    EXECUTE 'ALTER TABLE public.support_instruments ADD COLUMN dynamic_flex_demand_pct NUMERIC DEFAULT 0';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='support_instruments' AND column_name='demand_saturation_units'
  ) THEN
    EXECUTE 'ALTER TABLE public.support_instruments ADD COLUMN demand_saturation_units INTEGER DEFAULT 500';
  END IF;
  EXECUTE 'ALTER TABLE public.support_instruments ALTER COLUMN dynamic_noise_pct SET DEFAULT 1';
  EXECUTE 'ALTER TABLE public.support_instruments ALTER COLUMN dynamic_flex_time_pct SET DEFAULT 0';
  -- Drop deprecated duplicate flex column to avoid confusion
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='support_instruments' AND column_name='dynamic_flex_pct'
  ) THEN
    EXECUTE 'ALTER TABLE public.support_instruments DROP COLUMN dynamic_flex_pct';
  END IF;
END;
$$ LANGUAGE plpgsql;

UPDATE public.support_instruments
SET dynamic_noise_pct = COALESCE(dynamic_noise_pct, 1)
WHERE dynamic_noise_pct IS NULL;

-- 2) RLS policies for SECURITY DEFINER functions (targeted to postgres only)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'official_price_history' AND policyname = 'Official history insert by definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Official history insert by definer" ON public.official_price_history FOR INSERT TO postgres WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'official_price_history' AND policyname = 'Official history select (public)'
  ) THEN
    EXECUTE 'CREATE POLICY "Official history select (public)" ON public.official_price_history FOR SELECT USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'official_price_daily_history' AND policyname = 'Official daily history select (public)'
  ) THEN
    EXECUTE 'CREATE POLICY "Official daily history select (public)" ON public.official_price_daily_history FOR SELECT USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'user_ticket_balances' AND policyname = 'Noise read by definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Noise read by definer" ON public.user_ticket_balances FOR SELECT TO postgres USING (true)';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Owner adjustments moved to end of file to avoid undefined-function errors during migration

-- 3) Initial official price for non-driver instruments (1 TKN)
CREATE OR REPLACE FUNCTION public.ensure_initial_official_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_driver BOOLEAN;
  v_ts TIMESTAMPTZ;
BEGIN
  SELECT COALESCE(is_driver_bet, false) INTO v_is_driver
  FROM public.support_instruments
  WHERE id = NEW.instrument_id;
  IF v_is_driver THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.official_price_history WHERE ticket_type_id = NEW.id) THEN
    v_ts := date_trunc('hour', NOW());
    INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
    VALUES (NEW.instrument_id, NEW.id, 1, v_ts);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_initial_official_price ON public.ticket_types;
CREATE TRIGGER trg_initial_official_price
AFTER INSERT ON public.ticket_types
FOR EACH ROW
EXECUTE FUNCTION public.ensure_initial_official_price();

DO $$
BEGIN
  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
  SELECT t.instrument_id, t.id, 1, date_trunc('hour', NOW())
  FROM public.ticket_types t
  JOIN public.support_instruments i ON i.id = t.instrument_id
  LEFT JOIN public.official_price_history h ON h.ticket_type_id = t.id
  WHERE COALESCE(i.is_driver_bet, false) = false
    AND h.ticket_type_id IS NULL;
END;
$$ LANGUAGE plpgsql;

-- 4) Canonical noise step: OU mean reversion + md5 hour seed + sigma floor
CREATE OR REPLACE FUNCTION public.compute_noise_step(p_ticket_type_id UUID, p_noise NUMERIC, p_hour TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_noise_pct NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_sat INTEGER;
  v_limit INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_progress NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_demand_factor NUMERIC;
  v_theta NUMERIC;
  v_sigma NUMERIC;
  v_eps DOUBLE PRECISION;
  v_bytes BYTEA;
  v_u1 DOUBLE PRECISION;
  v_u2 DOUBLE PRECISION;
  v_u3 DOUBLE PRECISION;
  v_distance NUMERIC;
  v_sigma_floor NUMERIC;
  v_tscale NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  LEFT JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN p_noise;
  END IF;
  v_noise_pct := COALESCE(v_instr.dynamic_noise_pct, 0) / 100.0;
  v_noise_pct := v_noise_pct / 2.0;
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, 0);
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 500);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (p_hour - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(1, v_elapsed / v_total_interval)) END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  IF v_limit IS NULL OR v_limit = 0 OR v_limit >= v_sat * 10 THEN
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_sat::NUMERIC)));
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_tscale := (0.5 * v_time_factor + 0.5 * v_demand_factor);
  v_theta := 0.05 + 0.15 * v_tscale;
  v_distance := GREATEST(0, LEAST(1, abs(p_noise) / NULLIF(v_noise_pct,0)));
  v_sigma := v_noise_pct * (0.6 + 0.4 * (1 - v_tscale)) * (0.7 + 0.3 * (1 - v_distance));
  v_sigma_floor := v_noise_pct * 0.15;
  IF v_sigma < v_sigma_floor THEN
    v_sigma := v_sigma_floor;
  END IF;
  v_bytes := decode(md5(p_ticket_type_id::text || to_char(p_hour, 'YYYYMMDDHH24')), 'hex');
  v_u1 := get_byte(v_bytes, 0) / 255.0;
  v_u2 := get_byte(v_bytes, 1) / 255.0;
  v_u3 := get_byte(v_bytes, 2) / 255.0;
  v_eps := (v_u1 + v_u2 + v_u3 - 1.5) * 2.0;
  RETURN GREATEST(
    -v_noise_pct,
    LEAST(
      v_noise_pct,
      p_noise + (-v_theta * p_noise)
               + v_sigma * v_eps::NUMERIC
               + (CASE WHEN p_noise >= 0 THEN -1 ELSE 1 END) * (v_sigma * 0.10 * v_distance)
    )
  );
END;
$$;

-- 5) Noise retrieval (persists hourly noise)
CREATE OR REPLACE FUNCTION public.get_ticket_noise(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
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

-- 6) Official price calculators (at time, now, and for purchase)
CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type_at(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_sat INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_progress NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_demand_factor NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  LEFT JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_base := COALESCE(v_instr.ticket_price, 1.0);
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, 0);
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 500);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (p_at - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(1, v_elapsed / v_total_interval)) END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  v_demand_ratio := (v_total_sold::NUMERIC / v_sat::NUMERIC);
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_noise := public.get_ticket_noise(p_ticket_type_id, p_at);
  v_price := v_base * (1 + (v_flex_d * 100) * v_demand_factor + (v_flex_t * 100) * v_time_factor) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_sat INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_progress NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_demand_factor NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  LEFT JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_base := COALESCE(v_instr.ticket_price, 1.0);
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, 0);
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 500);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (NOW() - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(1, v_elapsed / v_total_interval)) END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  v_demand_ratio := (v_total_sold::NUMERIC / v_sat::NUMERIC);
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_noise := public.get_ticket_noise(p_ticket_type_id, NOW());
  v_price := v_base * (1 + (v_flex_d * 100) * v_demand_factor + (v_flex_t * 100) * v_time_factor) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_official_price_for_purchase(p_ticket_type_id UUID, p_quantity INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_sat INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_progress NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_demand_factor NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  LEFT JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_base := COALESCE(v_instr.ticket_price, 1.0);
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, 0);
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 500);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (NOW() - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(1, v_elapsed / v_total_interval)) END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  v_demand_ratio := ((v_total_sold + GREATEST(p_quantity, 0))::NUMERIC / v_sat::NUMERIC);
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_noise := public.get_ticket_noise(p_ticket_type_id, NOW());
  v_price := v_base * (1 + (v_flex_d * 100) * v_demand_factor + (v_flex_t * 100) * v_time_factor) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;

-- 7) Hourly recording and compression (authoritative history only)
CREATE OR REPLACE FUNCTION public.record_previous_hour_official_prices()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $rec$
DECLARE
  v_ts TIMESTAMPTZ := date_trunc('hour', NOW()) - INTERVAL '1 hour';
  v_rows INTEGER := 0;
  v_last INTEGER := 0;
BEGIN
  -- Normal instruments (via ticket_types)
  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
  SELECT i.id, t.id, public.get_official_price_by_ticket_type_at(t.id, v_ts), v_ts
  FROM public.support_instruments i
  JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE COALESCE(i.is_driver_bet, false) = false
    AND COALESCE(i.resolution_status, '') <> 'RESOLVED'
    AND NOT EXISTS (
      SELECT 1 FROM public.official_price_history h
      WHERE h.ticket_type_id = t.id AND h.created_at = v_ts
    );
  GET DIAGNOSTICS v_last = ROW_COUNT;
  v_rows := v_rows + COALESCE(v_last, 0);

  -- Driver bet A
  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
  SELECT i.id, i.ticket_type_a_id, public.get_official_price_by_ticket_type_at(i.ticket_type_a_id, v_ts), v_ts
  FROM public.support_instruments i
  WHERE i.ticket_type_a_id IS NOT NULL
    AND COALESCE(i.resolution_status, '') <> 'RESOLVED'
    AND NOT EXISTS (
      SELECT 1 FROM public.official_price_history h
      WHERE h.ticket_type_id = i.ticket_type_a_id AND h.created_at = v_ts
    );
  GET DIAGNOSTICS v_last = ROW_COUNT;
  v_rows := v_rows + COALESCE(v_last, 0);

  -- Driver bet B
  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
  SELECT i.id, i.ticket_type_b_id, public.get_official_price_by_ticket_type_at(i.ticket_type_b_id, v_ts), v_ts
  FROM public.support_instruments i
  WHERE i.ticket_type_b_id IS NOT NULL
    AND COALESCE(i.resolution_status, '') <> 'RESOLVED'
    AND NOT EXISTS (
      SELECT 1 FROM public.official_price_history h
      WHERE h.ticket_type_id = i.ticket_type_b_id AND h.created_at = v_ts
    );
  GET DIAGNOSTICS v_last = ROW_COUNT;
  v_rows := v_rows + COALESCE(v_last, 0);

  RETURN jsonb_build_object('success', true, 'recorded_at', v_ts, 'rows', COALESCE(v_rows, 0));
END;
$rec$;

CREATE OR REPLACE FUNCTION public.compress_price_histories()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $cmp$
DECLARE
  v_rows INTEGER := 0;
BEGIN
  INSERT INTO public.official_price_daily_history (instrument_id, ticket_type_id, day, avg_price)
  SELECT instrument_id, ticket_type_id, DATE(created_at) AS day, AVG(price) AS avg_price
  FROM public.official_price_history
  WHERE created_at < NOW() - INTERVAL '24 hours'
  GROUP BY instrument_id, ticket_type_id, DATE(created_at)
  ON CONFLICT (instrument_id, ticket_type_id, day) DO UPDATE
    SET avg_price = EXCLUDED.avg_price;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  DELETE FROM public.official_price_history
  WHERE created_at < NOW() - INTERVAL '24 hours';
  DELETE FROM public.official_price_daily_history
  WHERE day < CURRENT_DATE - INTERVAL '30 days';
  RETURN jsonb_build_object('success', true, 'processed', COALESCE(v_rows, 0));
END;
$cmp$;

-- Canonical civil avg price RPC (ACTIVE listings, weighted by quantity)
CREATE OR REPLACE FUNCTION public.get_civil_avg_price(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $avg$
DECLARE
  v_avg NUMERIC;
BEGIN
  SELECT CASE WHEN SUM(quantity) > 0 THEN SUM(price_per_unit * quantity) / SUM(quantity) ELSE AVG(price_per_unit) END
  INTO v_avg
  FROM public.ticket_listings
  WHERE ticket_type_id = p_ticket_type_id
    AND status = 'ACTIVE';
  RETURN v_avg;
END;
$avg$;

-- Canonical ticket trend (civil from listing history, official from history/daily)
CREATE OR REPLACE FUNCTION public.get_ticket_price_trend(
  p_ticket_type_id UUID,
  p_interval TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_start TIMESTAMPTZ;
  v_official JSONB;
  v_civil JSONB;
  v_now TIMESTAMPTZ;
  v_price NUMERIC;
BEGIN
  IF p_interval = '1d' THEN
    v_start := NOW() - INTERVAL '1 day';
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', t, 'price', avg_price) ORDER BY t),
      '[]'::jsonb
    ) INTO v_official
    FROM (
      SELECT date_trunc('hour', created_at) AS t, AVG(price) AS avg_price
      FROM public.official_price_history
      WHERE ticket_type_id = p_ticket_type_id
        AND created_at >= v_start
        AND created_at < date_trunc('hour', NOW())
      GROUP BY 1
      ORDER BY 1
    ) s;
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', t, 'price', avg_price) ORDER BY t),
      '[]'::jsonb
    ) INTO v_civil
    FROM (
      SELECT date_trunc('hour', created_at) AS t, AVG(avg_price) AS avg_price
      FROM public.civil_listing_price_history
      WHERE ticket_type_id = p_ticket_type_id
        AND created_at >= v_start
        AND created_at < date_trunc('hour', NOW())
      GROUP BY 1
      ORDER BY 1
    ) c;
  ELSIF p_interval = '1w' THEN
    v_start := NOW() - INTERVAL '7 days';
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', t, 'price', avg_price) ORDER BY t),
      '[]'::jsonb
    ) INTO v_official
    FROM (
      SELECT date_trunc('hour', created_at) AS t, AVG(price) AS avg_price
      FROM public.official_price_history
      WHERE ticket_type_id = p_ticket_type_id
        AND created_at >= v_start
        AND created_at < date_trunc('hour', NOW())
      GROUP BY 1
      ORDER BY 1
    ) s;
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', t, 'price', avg_price) ORDER BY t),
      '[]'::jsonb
    ) INTO v_civil
    FROM (
      SELECT date_trunc('hour', created_at) AS t, AVG(avg_price) AS avg_price
      FROM public.civil_listing_price_history
      WHERE ticket_type_id = p_ticket_type_id
        AND created_at >= v_start
        AND created_at < date_trunc('hour', NOW())
      GROUP BY 1
      ORDER BY 1
    ) c;
  ELSE
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', day, 'price', avg_price) ORDER BY day),
      '[]'::jsonb
    ) INTO v_official
    FROM public.official_price_daily_history
    WHERE ticket_type_id = p_ticket_type_id
      AND day >= (CURRENT_DATE - INTERVAL '30 days')
      AND day < CURRENT_DATE;
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', day, 'price', avg_price) ORDER BY day),
      '[]'::jsonb
    ) INTO v_civil
    FROM public.civil_listing_price_daily_history
    WHERE ticket_type_id = p_ticket_type_id
      AND day >= (CURRENT_DATE - INTERVAL '30 days');
  END IF;

  IF p_interval IN ('1d', '1w') THEN
    v_now := date_trunc('hour', NOW());
    SELECT CASE WHEN SUM(quantity) > 0 THEN SUM(price_per_unit * quantity) / SUM(quantity) ELSE AVG(price_per_unit) END
    INTO v_price
    FROM public.ticket_listings
    WHERE ticket_type_id = p_ticket_type_id
      AND status = 'ACTIVE';
    IF v_price IS NOT NULL THEN
      v_civil := v_civil || jsonb_build_array(jsonb_build_object('t', v_now, 'price', v_price));
    END IF;
    v_price := public.get_official_price_by_ticket_type_at(p_ticket_type_id, v_now);
    v_official := v_official || jsonb_build_array(jsonb_build_object('t', v_now, 'price', v_price));
  ELSE
    v_now := date_trunc('day', NOW());
    v_price := public.get_official_price_by_ticket_type_at(p_ticket_type_id, v_now);
    v_official := v_official || jsonb_build_array(jsonb_build_object('t', v_now, 'price', v_price));
  END IF;

  RETURN jsonb_build_object('official', v_official, 'civil', v_civil);
END;
$func$;
CREATE TABLE IF NOT EXISTS public.civil_listing_price_history (
  ticket_type_id UUID NOT NULL REFERENCES public.ticket_types(id),
  avg_price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_type_id, created_at)
);
ALTER TABLE public.civil_listing_price_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'civil_listing_price_history' 
      AND policyname = 'Civil listing price history is viewable by everyone'
  ) THEN
    EXECUTE 'CREATE POLICY "Civil listing price history is viewable by everyone" ON public.civil_listing_price_history FOR SELECT USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'civil_listing_price_history' 
      AND policyname = 'Civil listing insert by definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Civil listing insert by definer" ON public.civil_listing_price_history FOR INSERT TO postgres WITH CHECK (true)';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.civil_listing_price_daily_history (
  ticket_type_id UUID NOT NULL REFERENCES public.ticket_types(id),
  day DATE NOT NULL,
  avg_price NUMERIC NOT NULL,
  PRIMARY KEY (ticket_type_id, day)
);
ALTER TABLE public.civil_listing_price_daily_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'civil_listing_price_daily_history' 
      AND policyname = 'Civil listing daily price history is viewable by everyone'
  ) THEN
    EXECUTE 'CREATE POLICY "Civil listing daily price history is viewable by everyone" ON public.civil_listing_price_daily_history FOR SELECT USING (true)';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.record_current_hour_civil_listing_prices()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $rec$
DECLARE
  v_ts TIMESTAMPTZ := date_trunc('hour', NOW());
  v_rows INTEGER := 0;
BEGIN
  INSERT INTO public.civil_listing_price_history (ticket_type_id, avg_price, created_at)
  SELECT 
    ticket_type_id,
    CASE WHEN SUM(quantity) > 0 THEN SUM(price_per_unit * quantity) / SUM(quantity) ELSE AVG(price_per_unit) END AS avg_price,
    v_ts
  FROM public.ticket_listings
  WHERE status = 'ACTIVE'
  GROUP BY ticket_type_id
  ON CONFLICT (ticket_type_id, created_at) DO UPDATE
    SET avg_price = EXCLUDED.avg_price;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'recorded_at', v_ts, 'rows', COALESCE(v_rows, 0));
END;
$rec$;

CREATE OR REPLACE FUNCTION public.compact_listing_price_history()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $cmp$
DECLARE
  v_rows INTEGER := 0;
BEGIN
  INSERT INTO public.civil_listing_price_daily_history (ticket_type_id, day, avg_price)
  SELECT ticket_type_id, DATE(created_at) AS day, AVG(avg_price) AS avg_price
  FROM public.civil_listing_price_history
  WHERE created_at < NOW() - INTERVAL '24 hours'
  GROUP BY ticket_type_id, DATE(created_at)
  ON CONFLICT (ticket_type_id, day) DO UPDATE
    SET avg_price = EXCLUDED.avg_price;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  DELETE FROM public.civil_listing_price_daily_history
  WHERE day < CURRENT_DATE - INTERVAL '30 days';
  RETURN jsonb_build_object('success', true, 'processed', COALESCE(v_rows, 0));
END;
$cmp$;

CREATE OR REPLACE FUNCTION public.civil_listing_bump_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ts TIMESTAMPTZ := date_trunc('hour', NOW());
  v_avg NUMERIC;
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    SELECT CASE WHEN SUM(quantity) > 0 THEN SUM(price_per_unit * quantity) / SUM(quantity) ELSE AVG(price_per_unit) END
    INTO v_avg
    FROM public.ticket_listings
    WHERE ticket_type_id = NEW.ticket_type_id
      AND status = 'ACTIVE';
    IF v_avg IS NOT NULL THEN
      INSERT INTO public.civil_listing_price_history (ticket_type_id, avg_price, created_at)
      VALUES (NEW.ticket_type_id, v_avg, v_ts)
      ON CONFLICT (ticket_type_id, created_at) DO UPDATE
        SET avg_price = EXCLUDED.avg_price;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_civil_listing_on_upsert ON public.ticket_listings;
CREATE TRIGGER trg_civil_listing_on_upsert
AFTER INSERT OR UPDATE OF status, quantity, price_per_unit ON public.ticket_listings
FOR EACH ROW
EXECUTE FUNCTION public.civil_listing_bump_on_change();

-- 8) Hourly stepping across all ticket types (robust discovery)
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

-- 9) pg_cron scheduling (safe unschedule by jobid, then schedule clean jobs)
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('hourly_noise_step','hourly_official_price_tasks','hourly_civil_listing_prices','hourly_civil_listing_compact') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'hourly_noise_step',
    '1 * * * *',
    'SELECT public.step_noise_for_hour(date_trunc(''hour'', NOW()));'
  );
  PERFORM cron.schedule(
    'hourly_official_price_tasks',
    '5 * * * *',
    'SELECT public.record_previous_hour_official_prices(); SELECT public.compress_price_histories();'
  );
  PERFORM cron.schedule(
    'hourly_civil_listing_prices',
    '2 * * * *',
    'SELECT public.record_current_hour_civil_listing_prices();'
  );
  PERFORM cron.schedule(
    'hourly_civil_listing_compact',
    '7 * * * *',
    'SELECT public.compact_listing_price_history();'
  );
END;
$$ LANGUAGE plpgsql;

-- Set function owners to postgres (after all functions are created)
ALTER FUNCTION public.compute_noise_step(uuid, numeric, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.get_ticket_noise(uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.get_official_price_by_ticket_type_at(uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.get_official_price_by_ticket_type(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_official_price_for_purchase(uuid, integer) OWNER TO postgres;
ALTER FUNCTION public.record_previous_hour_official_prices() OWNER TO postgres;
ALTER FUNCTION public.compress_price_histories() OWNER TO postgres;
ALTER FUNCTION public.record_current_hour_civil_listing_prices() OWNER TO postgres;
ALTER FUNCTION public.compact_listing_price_history() OWNER TO postgres;
ALTER FUNCTION public.civil_listing_bump_on_change() OWNER TO postgres;
ALTER FUNCTION public.get_civil_avg_price(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_ticket_price_trend(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.step_noise_for_hour(timestamptz) OWNER TO postgres;
ALTER FUNCTION public.ensure_initial_official_price() OWNER TO postgres;
