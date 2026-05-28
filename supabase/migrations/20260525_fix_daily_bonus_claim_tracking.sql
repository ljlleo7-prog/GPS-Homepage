-- Separate daily bonus claims from passive presence tracking

ALTER TABLE public.wallets
ADD COLUMN IF NOT EXISTS last_daily_bonus TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.claim_daily_bonus()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
  v_last_daily_bonus TIMESTAMPTZ;
  v_current_rep INTEGER := 0;
  v_bonus_amount NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT id, last_daily_bonus, COALESCE(reputation_balance, 0)
  INTO v_wallet_id, v_last_daily_bonus, v_current_rep
  FROM public.wallets
  WHERE user_id = v_user_id;

  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Wallet not found');
  END IF;

  IF v_last_daily_bonus IS NOT NULL AND v_last_daily_bonus::DATE = CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'message', 'Already claimed today');
  END IF;

  v_bonus_amount := 10 + (v_current_rep * 0.5);

  UPDATE public.wallets
  SET token_balance = token_balance + v_bonus_amount,
      last_daily_bonus = NOW(),
      updated_at = NOW()
  WHERE id = v_wallet_id;

  INSERT INTO public.ledger_entries (
    wallet_id, amount, currency, operation_type, description
  ) VALUES (
    v_wallet_id, v_bonus_amount, 'TOKEN', 'REWARD', 'Daily Login Bonus'
  );

  RETURN jsonb_build_object('success', true, 'amount', v_bonus_amount);
END;
$$;
