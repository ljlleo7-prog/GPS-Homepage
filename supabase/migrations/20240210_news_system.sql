-- Create news_comments table
CREATE TABLE IF NOT EXISTS public.news_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    news_id UUID NOT NULL REFERENCES public.news_articles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.news_comments ENABLE ROW LEVEL SECURITY;

-- Policies for news_comments
CREATE POLICY "Public can read news comments" ON public.news_comments
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can post comments" ON public.news_comments
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own comments" ON public.news_comments
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Developers can delete any comment" ON public.news_comments
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND developer_status = 'APPROVED'
        )
    );

-- Update policies for news_articles to restrict to developers
-- First, drop existing broad policies if they exist (or just ensure specific ones take precedence, but better to be clean)
-- Note: Initial schema granted ALL to authenticated. We should revoke that and use policies.
REVOKE ALL ON public.news_articles FROM authenticated;
GRANT SELECT ON public.news_articles TO authenticated;
-- We need to grant insert/update/delete to authenticated but restrict via policy, 
-- OR just grant to authenticated and let RLS handle it. RLS is enabled.
GRANT INSERT, UPDATE, DELETE ON public.news_articles TO authenticated;

-- Drop existing insert/update/delete policies if any (initial schema didn't define them explicitly for auth users, just granted privileges)
-- But wait, initial schema had: CREATE POLICY "Public can read news articles"...
-- It didn't have specific INSERT policies for news_articles, so it defaulted to the GRANT? 
-- No, if RLS is enabled, you NEED a policy to do anything, even if you have GRANT.
-- The initial schema said: GRANT ALL ... TO authenticated.
-- But it only created one policy: "Public can read news articles".
-- Without an INSERT policy, RLS would block inserts even for authenticated users! 
-- So currently, NO ONE can post news? Or maybe I missed a policy.
-- "Public can read news articles" -> SELECT only.
-- So currently news posting is broken? Or maybe it was seeded and never posted to?
-- Regardless, I will add the correct policies now.

CREATE POLICY "Developers can insert news articles" ON public.news_articles
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND developer_status = 'APPROVED'
        )
    );

CREATE POLICY "Developers can update news articles" ON public.news_articles
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND developer_status = 'APPROVED'
        )
    );

CREATE POLICY "Developers can delete news articles" ON public.news_articles
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND developer_status = 'APPROVED'
        )
    );
