
ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS maintenance_problem text,
  ADD COLUMN IF NOT EXISTS maintenance_expected_return date;

-- Update movement logging to capture maintenance details in notes
CREATE OR REPLACE FUNCTION public.log_equipment_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  note_text text := NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'manutencao' AND (NEW.maintenance_problem IS NOT NULL OR NEW.maintenance_expected_return IS NOT NULL) THEN
      note_text := 'Manutenção: ' || COALESCE(NEW.maintenance_problem, '—')
        || CASE WHEN NEW.maintenance_expected_return IS NOT NULL
              THEN ' | Previsão de retorno: ' || to_char(NEW.maintenance_expected_return, 'DD/MM/YYYY')
              ELSE '' END;
    END IF;
    INSERT INTO public.movements (owner_id, equipment_id, from_status, to_status, to_client_id, notes)
    VALUES (NEW.owner_id, NEW.id, NULL, NEW.status, NEW.current_client_id, note_text);
  ELSIF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.current_client_id IS DISTINCT FROM NEW.current_client_id) THEN
    IF NEW.status = 'manutencao' AND OLD.status IS DISTINCT FROM 'manutencao' THEN
      note_text := 'Manutenção: ' || COALESCE(NEW.maintenance_problem, '—')
        || CASE WHEN NEW.maintenance_expected_return IS NOT NULL
              THEN ' | Previsão de retorno: ' || to_char(NEW.maintenance_expected_return, 'DD/MM/YYYY')
              ELSE '' END;
    ELSIF OLD.status = 'manutencao' AND NEW.status <> 'manutencao' THEN
      note_text := 'Liberado da manutenção'
        || CASE WHEN OLD.maintenance_problem IS NOT NULL THEN ' (problema anterior: ' || OLD.maintenance_problem || ')' ELSE '' END;
    END IF;
    INSERT INTO public.movements (owner_id, equipment_id, from_status, to_status, from_client_id, to_client_id, notes)
    VALUES (NEW.owner_id, NEW.id, OLD.status, NEW.status, OLD.current_client_id, NEW.current_client_id, note_text);
  END IF;
  RETURN NEW;
END;
$function$;

-- Clear maintenance fields when leaving manutencao status
CREATE OR REPLACE FUNCTION public.clear_maintenance_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status <> 'manutencao'::equipment_status THEN
    NEW.maintenance_problem := NULL;
    NEW.maintenance_expected_return := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Ensure triggers are attached
DROP TRIGGER IF EXISTS trg_set_updated_at_equipment ON public.equipment;
CREATE TRIGGER trg_set_updated_at_equipment
BEFORE UPDATE ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_clear_client_on_status_change ON public.equipment;
CREATE TRIGGER trg_clear_client_on_status_change
BEFORE UPDATE ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.clear_client_on_status_change();

DROP TRIGGER IF EXISTS trg_clear_maintenance_on_status_change ON public.equipment;
CREATE TRIGGER trg_clear_maintenance_on_status_change
BEFORE UPDATE ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.clear_maintenance_on_status_change();

DROP TRIGGER IF EXISTS trg_log_equipment_movement ON public.equipment;
CREATE TRIGGER trg_log_equipment_movement
AFTER INSERT OR UPDATE ON public.equipment
FOR EACH ROW EXECUTE FUNCTION public.log_equipment_movement();

DROP TRIGGER IF EXISTS trg_set_updated_at_clients ON public.clients;
CREATE TRIGGER trg_set_updated_at_clients
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at_equipment_requests ON public.equipment_requests;
CREATE TRIGGER trg_set_updated_at_equipment_requests
BEFORE UPDATE ON public.equipment_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_apply_equipment_request ON public.equipment_requests;
CREATE TRIGGER trg_apply_equipment_request
BEFORE UPDATE ON public.equipment_requests
FOR EACH ROW EXECUTE FUNCTION public.apply_equipment_request();
