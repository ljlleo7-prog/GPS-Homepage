-- Ensure RLS is enabled on news_articles
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;

-- Reset Grants
REVOKE ALL ON public.news_articles FROM authenticated;
REVOKE ALL ON public.news_articles FROM anon;

GRANT SELECT ON public.news_articles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.news_articles TO authenticated;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Public can read news articles" ON public.news_articles;
DROP POLICY IF EXISTS "Developers can insert news articles" ON public.news_articles;
DROP POLICY IF EXISTS "Developers can update news articles" ON public.news_articles;
DROP POLICY IF EXISTS "Developers can delete news articles" ON public.news_articles;

-- 1. Read Policy: Everyone can read
CREATE POLICY "Public can read news articles" ON public.news_articles
    FOR SELECT USING (true);

-- 2. Insert Policy: Only Approved Developers
CREATE POLICY "Developers can insert news articles" ON public.news_articles
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND developer_status = 'APPROVED'
        )
    );

-- 3. Update Policy: Only Approved Developers
CREATE POLICY "Developers can update news articles" ON public.news_articles
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND developer_status = 'APPROVED'
        )
    );

-- 4. Delete Policy: Only Approved Developers
CREATE POLICY "Developers can delete news articles" ON public.news_articles
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND developer_status = 'APPROVED'
        )
    );
