-- Fix handle_new_user function to include search_path
-- This ensures uuid_generate_v4() is found when the trigger runs

CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  -- 1. Create Profile
  INSERT INTO public.profiles (id, username, full_name, avatar_url)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'username', 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url'
  );
  
  -- 2. Create Wallet (Sign-up bonus: 100 tokens)
  INSERT INTO public.wallets (user_id, token_balance, reputation_balance)
  VALUES (new.id, 100, 0); 
  
  RETURN new;
END;
$$;
