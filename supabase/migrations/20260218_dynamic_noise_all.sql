UPDATE public.support_instruments
SET dynamic_noise_pct = 1
WHERE COALESCE(dynamic_noise_pct, 0) <= 0;

UPDATE public.support_instruments
SET dynamic_flex_time_pct = 0
WHERE COALESCE(dynamic_flex_time_pct, 0) <> 0;
