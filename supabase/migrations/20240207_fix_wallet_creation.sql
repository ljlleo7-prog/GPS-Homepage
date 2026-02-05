-- ==========================================
-- FIX WALLET CREATION
-- ==========================================

-- 1. Create a function to ensure wallet exists (safe for frontend to call)
CREATE OR REPLACE FUNCTION public.ensure_wallet_exists()
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
BEGIN
  -- Check if wallet exists
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id;
  
  IF v_wallet_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'message', 'Wallet already exists', 'id', v_wallet_id);
  END IF;

  -- Ensure Profile exists first (just in case)
  INSERT INTO public.profiles (id) VALUES (v_user_id) ON CONFLICT (id) DO NOTHING;

  -- Create wallet
  INSERT INTO public.wallets (user_id, token_balance, reputation_balance)
  VALUES (v_user_id, 1000, 60)
  RETURNING id INTO v_wallet_id;
  
  -- Log initial ledger entry
  INSERT INTO public.ledger_entries (
    wallet_id, amount, currency, operation_type, description
  ) VALUES (
    v_wallet_id, 1000, 'TOKEN', 'MINT', 'Initial Sign-up Bonus'
  );
  
  INSERT INTO public.ledger_entries (
    wallet_id, amount, currency, operation_type, description
  ) VALUES (
    v_wallet_id, 60, 'REP', 'MINT', 'Initial Reputation'
  );

  RETURN jsonb_build_object('success', true, 'message', 'Wallet created', 'id', v_wallet_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Backfill for existing users (Optional but helpful)
DO $$
DECLARE
  r RECORD;
  v_wallet_id UUID;
BEGIN
  FOR r IN SELECT id FROM auth.users LOOP
    -- Ensure profile
    INSERT INTO public.profiles (id) VALUES (r.id) ON CONFLICT (id) DO NOTHING;
    
    -- Ensure wallet
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = r.id) THEN
      INSERT INTO public.wallets (user_id, token_balance, reputation_balance)
      VALUES (r.id, 1000, 60)
      RETURNING id INTO v_wallet_id;
      
      -- Ledger
      INSERT INTO public.ledger_entries (
        wallet_id, amount, currency, operation_type, description
      ) VALUES (
        v_wallet_id, 1000, 'TOKEN', 'MINT', 'Initial Sign-up Bonus'
      );
      INSERT INTO public.ledger_entries (
        wallet_id, amount, currency, operation_type, description
      ) VALUES (
        v_wallet_id, 60, 'REP', 'MINT', 'Initial Reputation'
      );
    END IF;
  END LOOP;
END $$;
