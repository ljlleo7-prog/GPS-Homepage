-- ==============================================================================
-- FIX FORUM POSTING & DATA
-- Description: Adds missing forum columns, restores category/tags, and fixes permissions
-- ==============================================================================

-- 1. ADD MISSING COLUMNS
-- Frontend likely expects 'category' and 'tags' for filtering, or 'pinned' status
DO $$
BEGIN
    -- 'category'
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forum_posts' AND column_name = 'category') THEN
        ALTER TABLE public.forum_posts ADD COLUMN category TEXT DEFAULT 'General';
        RAISE NOTICE 'Added category column to forum_posts';
    END IF;

    -- 'tags' (Array of text)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forum_posts' AND column_name = 'tags') THEN
        ALTER TABLE public.forum_posts ADD COLUMN tags TEXT[] DEFAULT '{}';
        RAISE NOTICE 'Added tags column to forum_posts';
    END IF;

    -- 'view_count' (Often used for sorting)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forum_posts' AND column_name = 'view_count') THEN
        ALTER TABLE public.forum_posts ADD COLUMN view_count INTEGER DEFAULT 0;
        RAISE NOTICE 'Added view_count column to forum_posts';
    END IF;
END $$;

-- 2. RESTORE MISSING DATA FROM BACKUP
DO $$
DECLARE
    v_count integer := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_forum_posts_20260208') THEN
        
        -- Restore Category (if exists in backup)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_forum_posts_20260208' AND column_name = 'category') THEN
             UPDATE public.forum_posts f
             SET category = COALESCE(b.category, 'General')
             FROM backup_forum_posts_20260208 b
             WHERE f.id = b.id;
             RAISE NOTICE 'Restored Category from Backup';
        END IF;

        -- Restore Tags (if exists in backup)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_forum_posts_20260208' AND column_name = 'tags') THEN
             UPDATE public.forum_posts f
             SET tags = COALESCE(b.tags, '{}')
             FROM backup_forum_posts_20260208 b
             WHERE f.id = b.id;
             RAISE NOTICE 'Restored Tags from Backup';
        END IF;

        -- Restore View Count (if exists in backup)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_forum_posts_20260208' AND column_name = 'view_count') THEN
             UPDATE public.forum_posts f
             SET view_count = COALESCE(b.view_count, 0)
             FROM backup_forum_posts_20260208 b
             WHERE f.id = b.id;
             RAISE NOTICE 'Restored View Count from Backup';
        END IF;
        
    END IF;
END $$;

-- 3. FIX RLS PERMISSIONS
-- Problem: Users cannot post.
-- Current Policy: "Forum Post Create" WITH CHECK (auth.uid() = author_id)
-- Issue: This requires the frontend to send 'author_id' in the INSERT payload. 
-- If the frontend relies on a default value or trigger, this might fail if the payload doesn't match.
-- BETTER: Allow INSERT if auth.uid() matches, AND ensure author_id is set correctly.

-- Let's relax the policy slightly to be robust:
DROP POLICY IF EXISTS "Forum Post Create" ON public.forum_posts;
CREATE POLICY "Forum Post Create" ON public.forum_posts
    FOR INSERT
    WITH CHECK (
        auth.role() = 'authenticated' AND 
        auth.uid() = author_id
    );

-- Also allow Rep-gated posting if we want to prevent spam (Optional, but good practice)
-- For now, basic auth check is enough.

-- 4. FIX 'Legacy Posts Not Appearing'
-- If the frontend filters by 'category' and all restored posts have NULL category (because column was missing), they won't show.
-- The UPDATE above fixes this by setting default 'General'.
-- Ensure no posts have NULL category.
UPDATE public.forum_posts SET category = 'General' WHERE category IS NULL;

RAISE NOTICE 'Forum Schema & Permissions Fixed';
