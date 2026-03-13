-- Trigger to automatically mark member as 'membership_paid' when a membership collection is added.

CREATE OR REPLACE FUNCTION public.auto_mark_membership_paid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if this collection is a membership payment
  IF NEW.is_membership_fee = TRUE OR LOWER(NEW.payment_for) = 'membership' THEN
    UPDATE members
    SET membership_paid = TRUE
    WHERE id = NEW.member_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_mark_membership_paid ON collections;

CREATE TRIGGER trigger_auto_mark_membership_paid
AFTER INSERT ON collections
FOR EACH ROW
EXECUTE FUNCTION public.auto_mark_membership_paid();
