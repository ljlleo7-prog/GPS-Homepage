CREATE OR REPLACE FUNCTION public.get_authoritative_official_price(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_price NUMERIC;
BEGIN
  SELECT price INTO v_price
  FROM public.official_price_history
  WHERE ticket_type_id = p_ticket_type_id
  ORDER BY created_at DESC
  LIMIT 1;
  RETURN v_price;
END;
$$;
