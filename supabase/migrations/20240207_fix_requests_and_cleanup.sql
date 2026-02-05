-- Fix request_developer_access function signature
CREATE OR REPLACE FUNCTION public.request_developer_access()
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT developer_status INTO v_status FROM public.profiles WHERE id = v_user_id;
  
  IF v_status = 'APPROVED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Already approved');
  END IF;
  
  IF v_status = 'PENDING' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Request already pending');
  END IF;

  UPDATE public.profiles
  SET developer_status = 'PENDING'
  WHERE id = v_user_id;
  
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to maintain max 50 ledger entries per wallet
CREATE OR REPLACE FUNCTION public.trim_ledger_entries()
RETURNS TRIGGER AS $$
DECLARE
  v_count INTEGER;
  v_keep_count INTEGER := 50;
BEGIN
  -- Count records for this wallet
  SELECT count(*) INTO v_count
  FROM public.ledger_entries
  WHERE wallet_id = NEW.wallet_id;
  
  -- If count exceeds limit, delete oldest
  IF v_count > v_keep_count THEN
    DELETE FROM public.ledger_entries
    WHERE id IN (
      SELECT id
      FROM public.ledger_entries
      WHERE wallet_id = NEW.wallet_id
      ORDER BY created_at DESC
      OFFSET v_keep_count
    );
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_trim_ledger ON public.ledger_entries;
CREATE TRIGGER trigger_trim_ledger
AFTER INSERT ON public.ledger_entries
FOR EACH ROW
EXECUTE FUNCTION public.trim_ledger_entries();
