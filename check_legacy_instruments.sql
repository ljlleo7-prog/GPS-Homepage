SELECT id, title, type, deliverable_frequency, deliverable_day, deliverable_cost_per_ticket 
FROM support_instruments 
WHERE (is_driver_bet IS FALSE OR is_driver_bet IS NULL) 
  AND deliverable_frequency IS NULL;
