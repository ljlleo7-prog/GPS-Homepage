-- Reclaim Orphaned Data RPC (V2 - Comprehensive)
-- This function allows the CURRENT USER to "adopt" data that has lost its link to a profile.
-- It covers Wallets, Forums, Minigames, Tickets, One Lap Duel, etc.

CREATE OR REPLACE FUNCTION public.reclaim_orphaned_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_old_wallet_id UUID;
  v_new_wallet_id UUID;
  v_reclaimed_count INTEGER := 0;
  v_total_reclaimed INTEGER := 0;
  v_msg TEXT := '';
  r RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  -- ==============================================================================
  -- 1. HANDLE WALLETS (Merge Logic)
  -- ==============================================================================
  -- Find the "orphaned" wallet with the highest balance.
  SELECT id, user_id, token_balance, reputation_balance INTO r 
  FROM public.wallets 
  WHERE user_id NOT IN (SELECT id FROM public.profiles)
  ORDER BY token_balance DESC 
  LIMIT 1;

  IF r.id IS NOT NULL THEN
      -- Find the current user's wallet
      SELECT id INTO v_new_wallet_id FROM public.wallets WHERE user_id = v_user_id;

      IF v_new_wallet_id IS NOT NULL THEN
          -- MERGE: Add orphaned balance to new wallet
          UPDATE public.wallets
          SET token_balance = token_balance + r.token_balance,
              reputation_balance = reputation_balance + r.reputation_balance
          WHERE id = v_new_wallet_id;

          -- Re-link Ledger Entries from old wallet to new wallet
          UPDATE public.ledger_entries
          SET wallet_id = v_new_wallet_id
          WHERE wallet_id = r.id;

          -- Delete the old wallet (now empty/merged)
          DELETE FROM public.wallets WHERE id = r.id;
          
          v_msg := v_msg || 'Wallet merged (' || r.token_balance || ' tokens). ';
      ELSE
          -- No new wallet? Just adopt the old one.
          UPDATE public.wallets 
          SET user_id = v_user_id 
          WHERE id = r.id;
          v_msg := v_msg || 'Wallet adopted. ';
      END IF;
      v_total_reclaimed := v_total_reclaimed + 1;
  END IF;

  -- ==============================================================================
  -- 2. HANDLE MINIGAME SCORES (Critical for Leaderboard)
  -- ==============================================================================
  -- These reference auth.users usually, but we check against profiles for consistency
  WITH rows AS (
    UPDATE public.minigame_scores 
    SET user_id = v_user_id 
    WHERE user_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN 
      v_msg := v_msg || v_reclaimed_count || ' scores reclaimed. '; 
      v_total_reclaimed := v_total_reclaimed + v_reclaimed_count;
  END IF;

  -- ==============================================================================
  -- 3. HANDLE FORUM POSTS
  -- ==============================================================================
  WITH rows AS (
    UPDATE public.forum_posts 
    SET author_id = v_user_id 
    WHERE author_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN 
      v_msg := v_msg || v_reclaimed_count || ' posts reclaimed. ';
      v_total_reclaimed := v_total_reclaimed + v_reclaimed_count;
  END IF;

  -- ==============================================================================
  -- 4. HANDLE FORUM COMMENTS
  -- ==============================================================================
  WITH rows AS (
    UPDATE public.forum_comments 
    SET user_id = v_user_id 
    WHERE user_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN 
      v_msg := v_msg || v_reclaimed_count || ' comments reclaimed. ';
      v_total_reclaimed := v_total_reclaimed + v_reclaimed_count;
  END IF;

  -- ==============================================================================
  -- 5. HANDLE MISSION SUBMISSIONS
  -- ==============================================================================
  WITH rows AS (
    UPDATE public.mission_submissions 
    SET user_id = v_user_id 
    WHERE user_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN 
      v_msg := v_msg || v_reclaimed_count || ' submissions reclaimed. ';
      v_total_reclaimed := v_total_reclaimed + v_reclaimed_count;
  END IF;

  -- ==============================================================================
  -- 6. HANDLE CREATED MISSIONS
  -- ==============================================================================
  WITH rows AS (
    UPDATE public.missions 
    SET creator_id = v_user_id 
    WHERE creator_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN 
      v_msg := v_msg || v_reclaimed_count || ' missions reclaimed. ';
      v_total_reclaimed := v_total_reclaimed + v_reclaimed_count;
  END IF;

  -- ==============================================================================
  -- 7. HANDLE TICKET BALANCES (Complex Merge)
  -- ==============================================================================
  -- Loop through orphaned balances
  FOR r IN 
      SELECT id, ticket_type_id, balance 
      FROM public.user_ticket_balances 
      WHERE user_id NOT IN (SELECT id FROM public.profiles)
  LOOP
      -- Check if current user already has this ticket
      IF EXISTS (SELECT 1 FROM public.user_ticket_balances WHERE user_id = v_user_id AND ticket_type_id = r.ticket_type_id) THEN
          -- Merge
          UPDATE public.user_ticket_balances 
          SET balance = balance + r.balance 
          WHERE user_id = v_user_id AND ticket_type_id = r.ticket_type_id;
          
          -- Delete orphan
          DELETE FROM public.user_ticket_balances WHERE id = r.id;
      ELSE
          -- Adopt
          UPDATE public.user_ticket_balances 
          SET user_id = v_user_id 
          WHERE id = r.id;
      END IF;
      v_total_reclaimed := v_total_reclaimed + 1;
  END LOOP;
  
  IF v_total_reclaimed > 0 AND v_msg NOT LIKE '%tickets%' THEN
      v_msg := v_msg || 'Tickets merged. ';
  END IF;

  -- ==============================================================================
  -- 8. HANDLE ONE LAP DUEL
  -- ==============================================================================
  -- Leaderboard
  DELETE FROM public.one_lap_leaderboard WHERE user_id = v_user_id; -- Remove empty new record if exists
  WITH rows AS (
    UPDATE public.one_lap_leaderboard 
    SET user_id = v_user_id 
    WHERE user_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  
  -- Drivers
  DELETE FROM public.one_lap_drivers WHERE user_id = v_user_id; -- Remove empty new record if exists
  WITH rows2 AS (
    UPDATE public.one_lap_drivers 
    SET user_id = v_user_id 
    WHERE user_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows2;

  -- ==============================================================================
  -- 9. FINALIZE
  -- ==============================================================================
  IF v_msg = '' THEN
      v_msg := 'No orphaned data found.';
  END IF;

  RETURN jsonb_build_object('success', true, 'message', v_msg);
END;
$$;

-- EXECUTE IMMEDIATELY (Attempt to reclaim for the user running this script)
-- Note: This works if run in SQL Editor. If run as migration, auth.uid() might be NULL or service_role.
-- If service_role, it won't work. So we rely on the function creation.
SELECT public.reclaim_orphaned_data();
