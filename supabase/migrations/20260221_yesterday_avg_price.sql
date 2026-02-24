
-- Function to get yesterday's average price for a ticket type
-- It tries to find it in the daily history first, then falls back to calculating from hourly history
CREATE OR REPLACE FUNCTION public.get_yesterday_avg_price(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_avg NUMERIC;
  v_yesterday DATE := CURRENT_DATE - 1;
BEGIN
  -- 1. Try to get from daily history (if compression ran)
  SELECT avg_price INTO v_avg
  FROM public.official_price_daily_history
  WHERE ticket_type_id = p_ticket_type_id
    AND day = v_yesterday;

  -- 2. If not found, calculate from hourly history (if compression hasn't ran or data is still there)
  IF v_avg IS NULL THEN
    SELECT AVG(price) INTO v_avg
    FROM public.official_price_history
    WHERE ticket_type_id = p_ticket_type_id
      AND DATE(created_at) = v_yesterday;
  END IF;

  RETURN v_avg;
END;
$$;
