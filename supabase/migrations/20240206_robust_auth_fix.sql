-- Robust fix for Auth Trigger
-- 1. Drops existing trigger/function to ensure clean slate
-- 2. Uses gen_random_uuid() which is built-in (no extension needed)
-- 3. Explicitly provides IDs to avoid relying on table defaults that might fail

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 1. Create Profile
  -- Use explicit ID from auth.users
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'username', 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url'
  );
  
  -- 2. Create Wallet
  -- Explicitly generate ID using gen_random_uuid() (Postgres built-in)
  -- This bypasses any potential issues with uuid_generate_v4() extension
  INSERT INTO public.wallets (id, user_id, token_balance, reputation_balance)
  VALUES (gen_random_uuid(), new.id, 100, 0); 
  
  RETURN new;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error (visible in Supabase logs) but raise to fail the transaction
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RAISE EXCEPTION 'Database error during user creation: %', SQLERRM;
END;
$$;

-- Re-create Trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
