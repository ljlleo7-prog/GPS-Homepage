CREATE OR REPLACE FUNCTION public.ensure_initial_official_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr_id UUID;
  v_is_driver BOOLEAN;
  v_exists BOOLEAN;
  v_ts TIMESTAMPTZ;
BEGIN
  v_instr_id := NEW.instrument_id;
  SELECT COALESCE(is_driver_bet, false) INTO v_is_driver
  FROM public.support_instruments
  WHERE id = v_instr_id;
  IF v_is_driver THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.official_price_history WHERE ticket_type_id = NEW.id) INTO v_exists;
  IF NOT v_exists THEN
    v_ts := date_trunc('hour', NOW());
    INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
    VALUES (v_instr_id, NEW.id, 1, v_ts);
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
$$;
