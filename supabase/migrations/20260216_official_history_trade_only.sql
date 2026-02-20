-- Record previous hour official prices for all active ticket types (always-on hourly)
DROP FUNCTION IF EXISTS public.record_previous_hour_official_prices();
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
  -- Normal instruments
  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
  SELECT i.id, i.ticket_type_id, public.get_official_price_by_ticket_type_at(i.ticket_type_id, v_ts), v_ts
  FROM public.support_instruments i
  WHERE i.ticket_type_id IS NOT NULL
    AND COALESCE(i.resolution_status, '') <> 'RESOLVED'
    AND NOT EXISTS (
      SELECT 1 FROM public.official_price_history h
      WHERE h.ticket_type_id = i.ticket_type_id AND h.created_at = v_ts
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
