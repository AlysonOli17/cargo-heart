
-- Auto clear current_client_id when equipment is not com_cliente
CREATE OR REPLACE FUNCTION public.clear_client_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status <> 'com_cliente'::equipment_status THEN
    NEW.current_client_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_client_on_status ON public.equipment;
CREATE TRIGGER trg_clear_client_on_status
BEFORE INSERT OR UPDATE ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.clear_client_on_status_change();

-- Fix existing inconsistent rows
UPDATE public.equipment
  SET current_client_id = NULL
  WHERE status <> 'com_cliente'::equipment_status
    AND current_client_id IS NOT NULL;
