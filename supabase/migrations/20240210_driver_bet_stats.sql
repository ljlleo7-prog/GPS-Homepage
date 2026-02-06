-- Get Ticket Sales Stats for all Driver Bets
-- Returns a JSON object keyed by instrument_id, containing side_a_sold and side_b_sold
CREATE OR REPLACE FUNCTION public.get_driver_bet_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stats JSONB;
BEGIN
  SELECT jsonb_object_agg(
      id,
      jsonb_build_object(
          'side_a_sold', (SELECT COALESCE(SUM(balance), 0) FROM public.user_ticket_balances WHERE ticket_type_id = i.ticket_type_a_id),
          'side_b_sold', (SELECT COALESCE(SUM(balance), 0) FROM public.user_ticket_balances WHERE ticket_type_id = i.ticket_type_b_id)
      )
  ) INTO v_stats
  FROM public.support_instruments i
  WHERE i.is_driver_bet = true;

  RETURN COALESCE(v_stats, '{}'::jsonb);
END;
$$;
