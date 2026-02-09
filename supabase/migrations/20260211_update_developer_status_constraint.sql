ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_developer_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_developer_status_check 
CHECK (developer_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'DECLINED'));
