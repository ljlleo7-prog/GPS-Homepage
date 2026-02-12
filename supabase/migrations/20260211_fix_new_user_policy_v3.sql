-- Fix new user entry policy to give 1000 TKN and 60 REP
-- This reverts the accidental change to 100 TKN / 0 REP in previous migrations.

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 1. Create Profile
  INSERT INTO public.profiles (id, username, full_name, avatar_url, last_login)
  VALUES (
    new.id, 
    COALESCE(new.raw_user_meta_data->>'username', 'User_' || substr(new.id::text, 1, 8)),
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url',
    NOW()
  );
  
  -- 2. Create Wallet
  -- Policy: 1000 Tokens, 60 Reputation
  INSERT INTO public.wallets (id, user_id, token_balance, reputation_balance)
  VALUES (gen_random_uuid(), new.id, 1000, 60); 
  
  RETURN new;
END;
$$;

-- Ensure trigger is active
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
