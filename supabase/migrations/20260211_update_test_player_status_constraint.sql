ALTER TABLE public.test_player_requests DROP CONSTRAINT IF EXISTS test_player_requests_status_check;
ALTER TABLE public.test_player_requests ADD CONSTRAINT test_player_requests_status_check 
CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'DECLINED', 'NONE'));
