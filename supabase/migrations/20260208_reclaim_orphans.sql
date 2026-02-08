-- Reclaim Orphaned Data RPC
-- This function allows a user to "adopt" data that has lost its link to a profile.
-- It handles Wallets, Forum Posts, Missions, Submissions, etc.

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
  v_msg TEXT := '';
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  -- 1. Handle Wallets
  -- Find the "orphaned" wallet with the highest balance.
  -- Orphaned means user_id points to a non-existent profile.
  SELECT id INTO v_old_wallet_id 
  FROM public.wallets 
  WHERE user_id NOT IN (SELECT id FROM public.profiles)
  ORDER BY token_balance DESC 
  LIMIT 1;

  IF v_old_wallet_id IS NOT NULL THEN
      -- Find the current user's wallet (created automatically)
      SELECT id INTO v_new_wallet_id FROM public.wallets WHERE user_id = v_user_id;

      -- If current wallet exists and is different (and presumably empty/newer), delete it
      IF v_new_wallet_id IS NOT NULL AND v_new_wallet_id != v_old_wallet_id THEN
          -- Delete new wallet to free up the user_id (since user_id is UNIQUE)
          DELETE FROM public.wallets WHERE id = v_new_wallet_id;
      END IF;

      -- Link the old wallet to the current user
      UPDATE public.wallets 
      SET user_id = v_user_id 
      WHERE id = v_old_wallet_id;
      
      v_msg := v_msg || 'Wallet restored. ';
  END IF;

  -- 2. Handle Forum Posts
  -- Link orphaned posts to current user
  WITH rows AS (
    UPDATE public.forum_posts 
    SET author_id = v_user_id 
    WHERE author_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN v_msg := v_msg || v_reclaimed_count || ' posts restored. '; END IF;

  -- 3. Handle Mission Submissions
  WITH rows AS (
    UPDATE public.mission_submissions 
    SET user_id = v_user_id 
    WHERE user_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN v_msg := v_msg || v_reclaimed_count || ' submissions restored. '; END IF;

  -- 4. Handle Support Positions
  WITH rows AS (
    UPDATE public.support_positions 
    SET user_id = v_user_id 
    WHERE user_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN v_msg := v_msg || v_reclaimed_count || ' positions restored. '; END IF;

  -- 5. Handle Created Missions
  WITH rows AS (
    UPDATE public.missions 
    SET creator_id = v_user_id 
    WHERE creator_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN v_msg := v_msg || v_reclaimed_count || ' missions restored. '; END IF;

  -- 6. Handle Test Player Requests
  WITH rows AS (
    UPDATE public.test_player_requests 
    SET user_id = v_user_id 
    WHERE user_id NOT IN (SELECT id FROM public.profiles)
    RETURNING 1
  )
  SELECT count(*) INTO v_reclaimed_count FROM rows;
  IF v_reclaimed_count > 0 THEN v_msg := v_msg || v_reclaimed_count || ' requests restored. '; END IF;

  IF v_msg = '' THEN
      v_msg := 'No orphaned data found.';
  END IF;

  RETURN jsonb_build_object('success', true, 'message', v_msg);
END;
$$;
