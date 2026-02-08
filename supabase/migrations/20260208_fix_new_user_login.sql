-- Fix handle_new_user to populate last_login and ensure new users have a valid state
-- This resolves the issue where new users have NULL last_login, potentially blocking some features.

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 1. Create Profile
  -- Use explicit ID from auth.users
  -- Set last_login to NOW() so it's not NULL
  INSERT INTO public.profiles (id, username, full_name, avatar_url, last_login)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'username', 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url',
    NOW()
  );
  
  -- 2. Create Wallet
  -- Explicitly generate ID using gen_random_uuid() (Postgres built-in)
  INSERT INTO public.wallets (id, user_id, token_balance, reputation_balance)
  VALUES (gen_random_uuid(), new.id, 100, 0); 
  
  RETURN new;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but raise to fail the transaction
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RAISE EXCEPTION 'Database error during user creation: %', SQLERRM;
END;
$$;

-- No need to recreate trigger as it points to the function by name, 
-- but we can ensure it exists just in case.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 3. Backfill existing profiles with NULL last_login
-- This fixes the issue for users who already signed up but are blocked.
UPDATE public.profiles
SET last_login = NOW()
WHERE last_login IS NULL;
