-- Ensure instrument_id is always populated when inserting into official_price_history
-- Some code paths may only know ticket_type_id; this trigger fills instrument_id via ticket_types mapping.
CREATE OR REPLACE FUNCTION public.ensure_official_history_instrument()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr_id UUID;
BEGIN
  IF NEW.instrument_id IS NULL THEN
    SELECT instrument_id INTO v_instr_id
    FROM public.ticket_types
    WHERE id = NEW.ticket_type_id;
    IF v_instr_id IS NOT NULL THEN
      NEW.instrument_id := v_instr_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_official_history_instrument ON public.official_price_history;
CREATE TRIGGER trg_fill_official_history_instrument
BEFORE INSERT ON public.official_price_history
FOR EACH ROW
EXECUTE FUNCTION public.ensure_official_history_instrument();

