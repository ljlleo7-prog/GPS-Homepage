-- Re-Link and Fix Schema
-- 1. Reclaim Orphaned Data (Move old data to new User ID)
-- 2. Enforce Correct Foreign Key Constraints (Link to Profiles)

DO $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new_wallet_id UUID;
  v_reclaimed_count INTEGER := 0;
  r RECORD;
BEGIN
  -- ==============================================================================
  -- PART 1: RECLAIM ORPHANED DATA
  -- This ensures data is valid before we enforce "REFERENCES profiles(id)"
  -- ==============================================================================

  -- A. Reclaim/Merge Wallets
  SELECT id, user_id, token_balance, reputation_balance INTO r 
  FROM public.wallets 
  WHERE user_id NOT IN (SELECT id FROM public.profiles)
  ORDER BY token_balance DESC 
  LIMIT 1;

  IF r.id IS NOT NULL THEN
      -- Find new wallet
      SELECT id INTO v_new_wallet_id FROM public.wallets WHERE user_id = v_user_id;

      IF v_new_wallet_id IS NOT NULL THEN
          -- Merge balances
          UPDATE public.wallets
          SET token_balance = token_balance + r.token_balance,
              reputation_balance = reputation_balance + r.reputation_balance
          WHERE id = v_new_wallet_id;
          
          -- Move Ledger Entries
          UPDATE public.ledger_entries SET wallet_id = v_new_wallet_id WHERE wallet_id = r.id;
          
          -- Remove old wallet
          DELETE FROM public.wallets WHERE id = r.id;
      ELSE
          -- Adopt old wallet
          UPDATE public.wallets SET user_id = v_user_id WHERE id = r.id;
      END IF;
  END IF;

  -- B. Reclaim Minigame Scores
  UPDATE public.minigame_scores 
  SET user_id = v_user_id 
  WHERE user_id NOT IN (SELECT id FROM public.profiles);

  -- C. Reclaim Forum Posts & Comments
  UPDATE public.forum_posts SET author_id = v_user_id WHERE author_id NOT IN (SELECT id FROM public.profiles);
  UPDATE public.forum_comments SET user_id = v_user_id WHERE user_id NOT IN (SELECT id FROM public.profiles);

  -- D. Reclaim Missions
  UPDATE public.mission_submissions SET user_id = v_user_id WHERE user_id NOT IN (SELECT id FROM public.profiles);
  UPDATE public.missions SET creator_id = v_user_id WHERE creator_id NOT IN (SELECT id FROM public.profiles);

  -- E. Reclaim One Lap Duel
  -- Remove empty new records to allow adoption of old records (PK conflict avoidance)
  DELETE FROM public.one_lap_leaderboard WHERE user_id = v_user_id AND races_played = 0;
  UPDATE public.one_lap_leaderboard SET user_id = v_user_id WHERE user_id NOT IN (SELECT id FROM public.profiles);
  
  DELETE FROM public.one_lap_drivers WHERE user_id = v_user_id;
  UPDATE public.one_lap_drivers SET user_id = v_user_id WHERE user_id NOT IN (SELECT id FROM public.profiles);

  -- F. Reclaim Tickets (Merge Logic)
  FOR r IN SELECT id, ticket_type_id, balance FROM public.user_ticket_balances WHERE user_id NOT IN (SELECT id FROM public.profiles)
  LOOP
      IF EXISTS (SELECT 1 FROM public.user_ticket_balances WHERE user_id = v_user_id AND ticket_type_id = r.ticket_type_id) THEN
          UPDATE public.user_ticket_balances SET balance = balance + r.balance WHERE user_id = v_user_id AND ticket_type_id = r.ticket_type_id;
          DELETE FROM public.user_ticket_balances WHERE id = r.id;
      ELSE
          UPDATE public.user_ticket_balances SET user_id = v_user_id WHERE id = r.id;
      END IF;
  END LOOP;

  RAISE NOTICE 'Data Reclamation Completed.';

END $$;

-- ==============================================================================
-- PART 2: FIX SCHEMA LINKS (Foreign Keys)
-- Ensure minigame_scores links to profiles(id) instead of auth.users(id)
-- ==============================================================================

-- 1. Fix minigame_scores
DO $$
BEGIN
    -- Drop old constraint if it exists (name might vary, try standard names)
    BEGIN
        ALTER TABLE public.minigame_scores DROP CONSTRAINT IF EXISTS minigame_scores_user_id_fkey;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Add new constraint to public.profiles
    -- This ensures that if a profile is deleted, the scores are also removed (Cascade)
    ALTER TABLE public.minigame_scores 
    ADD CONSTRAINT minigame_scores_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- 2. Verify other tables (Idempotent checks)
-- forum_posts, mission_submissions, wallets, etc. should already link to profiles.
-- We won't touch them to avoid "no change to hierarchy" violation unless they are broken.
