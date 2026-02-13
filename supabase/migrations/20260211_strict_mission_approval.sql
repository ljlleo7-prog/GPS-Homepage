-- Secure Mission Approval System
-- 1. Updates process_mission_payout to ENFORCE explicit payout amounts.
-- 2. Creates a helper function for developers to safely approve submissions.

-- 1. Strict Payout Trigger
CREATE OR REPLACE FUNCTION public.process_mission_payout() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
  v_wallet_id UUID;
  v_mission_title TEXT;
BEGIN
  -- Only proceed if status changed to APPROVED
  IF NEW.status = 'APPROVED' AND (OLD.status IS DISTINCT FROM 'APPROVED') THEN
    
    -- ENFORCEMENT: Payout amounts MUST be set explicitly.
    -- We do NOT fall back to defaults anymore to ensure Developer confirmation.
    IF NEW.payout_tokens IS NULL OR NEW.payout_rep IS NULL THEN
      RAISE EXCEPTION 'Cannot approve submission without explicit payout_tokens and payout_rep amounts.';
    END IF;

    -- Get Mission Title for Ledger
    SELECT title INTO v_mission_title FROM public.missions WHERE id = NEW.mission_id;

    -- Get User Wallet
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = NEW.user_id;
    
    IF v_wallet_id IS NULL THEN
       -- Try to ensure wallet exists (lazy fix) or raise error
       -- For now, raise error as wallet should exist
       RAISE EXCEPTION 'Wallet not found for user %', NEW.user_id;
    END IF;

    -- Update Wallet (Tokens + Rep)
    UPDATE public.wallets
    SET token_balance = token_balance + NEW.payout_tokens,
        reputation_balance = reputation_balance + NEW.payout_rep,
        updated_at = NOW()
    WHERE id = v_wallet_id;

    -- Ledger Entry (Tokens)
    IF NEW.payout_tokens > 0 THEN
      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description, reference_id)
      VALUES (v_wallet_id, NEW.payout_tokens, 'TOKEN', 'REWARD', 'Mission Reward: ' || COALESCE(v_mission_title, 'Unknown Mission'), NEW.id);
    END IF;

    -- Ledger Entry (Rep)
    IF NEW.payout_rep > 0 THEN
      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description, reference_id)
      VALUES (v_wallet_id, NEW.payout_rep, 'REP', 'REWARD', 'Mission Reward: ' || COALESCE(v_mission_title, 'Unknown Mission'), NEW.id);
    END IF;

  END IF;
  
  RETURN NEW;
END;
$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS trigger_mission_payout ON public.mission_submissions;
CREATE TRIGGER trigger_mission_payout
  AFTER UPDATE ON public.mission_submissions
  FOR EACH ROW
  EXECUTE PROCEDURE public.process_mission_payout();


-- 2. Developer Approval Function
-- This is the designated way for developers/admins to approve missions.
CREATE OR REPLACE FUNCTION public.approve_mission_submission(
  p_submission_id UUID,
  p_payout_tokens NUMERIC,
  p_payout_rep INTEGER,
  p_feedback TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.mission_submissions%ROWTYPE;
  v_developer_status TEXT;
BEGIN
  -- 1. Check Permissions (Caller must be Approved Developer)
  SELECT developer_status INTO v_developer_status
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_developer_status != 'APPROVED' THEN
    RAISE EXCEPTION 'Permission Denied: Only Approved Developers can approve submissions.';
  END IF;

  -- 2. Check Submission exists and is PENDING
  SELECT * INTO v_submission FROM public.mission_submissions WHERE id = p_submission_id;
  
  IF v_submission.id IS NULL THEN
    RAISE EXCEPTION 'Submission not found.';
  END IF;

  IF v_submission.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Submission is already approved.';
  END IF;

  -- 3. Update Submission (Trigger will handle payout)
  UPDATE public.mission_submissions
  SET 
    status = 'APPROVED',
    payout_tokens = p_payout_tokens,
    payout_rep = p_payout_rep,
    admin_feedback = COALESCE(p_feedback, admin_feedback),
    updated_at = NOW()
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('success', true, 'submission_id', p_submission_id);
END;
$$;

-- 3. Developer Rejection Function
-- Safely reject a mission submission and optionally record feedback
CREATE OR REPLACE FUNCTION public.reject_mission_submission(
  p_submission_id UUID,
  p_feedback TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.mission_submissions%ROWTYPE;
  v_developer_status TEXT;
BEGIN
  -- Permission check
  SELECT developer_status INTO v_developer_status
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_developer_status != 'APPROVED' THEN
    RAISE EXCEPTION 'Permission Denied: Only Approved Developers can reject submissions.';
  END IF;

  -- Ensure submission exists
  SELECT * INTO v_submission FROM public.mission_submissions WHERE id = p_submission_id;
  IF v_submission.id IS NULL THEN
    RAISE EXCEPTION 'Submission not found.';
  END IF;

  -- Update status and feedback
  UPDATE public.mission_submissions
  SET 
    status = 'REJECTED',
    admin_feedback = COALESCE(p_feedback, admin_feedback),
    updated_at = NOW()
  WHERE id = p_submission_id;

  RETURN jsonb_build_object('success', true, 'submission_id', p_submission_id);
END;
$$;
