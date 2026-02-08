-- Check for orphaned data
-- Returns counts of records that reference non-existent profiles

DO $$
DECLARE
    v_orphan_posts INTEGER;
    v_orphan_wallets INTEGER;
    v_orphan_submissions INTEGER;
    v_orphan_positions INTEGER;
    v_orphan_requests INTEGER;
    v_orphan_missions INTEGER;
BEGIN
    -- 1. Forum Posts
    SELECT COUNT(*) INTO v_orphan_posts
    FROM public.forum_posts
    WHERE author_id NOT IN (SELECT id FROM public.profiles);

    -- 2. Wallets
    SELECT COUNT(*) INTO v_orphan_wallets
    FROM public.wallets
    WHERE user_id NOT IN (SELECT id FROM public.profiles);

    -- 3. Mission Submissions
    SELECT COUNT(*) INTO v_orphan_submissions
    FROM public.mission_submissions
    WHERE user_id NOT IN (SELECT id FROM public.profiles);

    -- 4. Support Positions
    SELECT COUNT(*) INTO v_orphan_positions
    FROM public.support_positions
    WHERE user_id NOT IN (SELECT id FROM public.profiles);

    -- 5. Test Player Requests
    SELECT COUNT(*) INTO v_orphan_requests
    FROM public.test_player_requests
    WHERE user_id NOT IN (SELECT id FROM public.profiles);

    -- 6. Missions (Creator)
    SELECT COUNT(*) INTO v_orphan_missions
    FROM public.missions
    WHERE creator_id NOT IN (SELECT id FROM public.profiles);

    RAISE NOTICE 'Orphan Scan Results:';
    RAISE NOTICE 'Forum Posts: %', v_orphan_posts;
    RAISE NOTICE 'Wallets: %', v_orphan_wallets;
    RAISE NOTICE 'Mission Submissions: %', v_orphan_submissions;
    RAISE NOTICE 'Support Positions: %', v_orphan_positions;
    RAISE NOTICE 'Test Player Requests: %', v_orphan_requests;
    RAISE NOTICE 'Missions (Creator): %', v_orphan_missions;
END $$;
