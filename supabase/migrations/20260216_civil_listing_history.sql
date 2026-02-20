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

CREATE OR REPLACE FUNCTION public.record_previous_hour_civil_listing_prices()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $rec$
DECLARE
  v_ts TIMESTAMPTZ := date_trunc('hour', NOW()) - INTERVAL '1 hour';
  v_rows INTEGER := 0;
BEGIN
  INSERT INTO public.civil_listing_price_history (ticket_type_id, avg_price, created_at)
  SELECT 
    ticket_type_id,
    CASE WHEN SUM(quantity) > 0 THEN SUM(price_per_unit * quantity) / SUM(quantity) ELSE AVG(price_per_unit) END AS avg_price,
    v_ts
  FROM public.ticket_listings
  WHERE created_at <= v_ts + INTERVAL '1 hour'
    AND (
      (status = 'ACTIVE' AND (updated_at IS NULL OR updated_at > v_ts + INTERVAL '1 hour'))
      OR (status = 'SOLD' AND updated_at > v_ts + INTERVAL '1 hour')
    )
  GROUP BY ticket_type_id
  ON CONFLICT (ticket_type_id, created_at) DO UPDATE
    SET avg_price = EXCLUDED.avg_price;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'processed', COALESCE(v_rows, 0));
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

CREATE OR REPLACE FUNCTION public.get_civil_avg_price(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
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
