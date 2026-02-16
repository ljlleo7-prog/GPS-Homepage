ALTER TABLE public.support_instruments ADD COLUMN IF NOT EXISTS demand_saturation_units INTEGER DEFAULT 500;
UPDATE public.support_instruments SET demand_saturation_units = 500 WHERE demand_saturation_units IS NULL OR demand_saturation_units <= 0;
