-- Fix for missing 'MS' plan in plan_commission_map
-- Includes contracted_price to satisfy NOT NULL constraint.

INSERT INTO plan_commission_map (
  plan_type, 
  monthly_payment, 
  monthly_commission, 
  outright_commission, 
  contracted_price
)
VALUES ('MS', 0, 0, 150, 0)
ON CONFLICT (plan_type) 
DO UPDATE SET 
  outright_commission = 150,
  contracted_price = 0; -- Ensure it's set if it was previously null/invalid
