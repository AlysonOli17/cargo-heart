
-- Substitution fields on equipment requests
ALTER TABLE public.equipment_requests
  ADD COLUMN IF NOT EXISTS is_replacement boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS replacement_plate text,
  ADD COLUMN IF NOT EXISTS replacement_reason text;

-- Daily reset: equipment com_cliente -> disponivel (history in movements is preserved by trigger)
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.reset_daily_equipment()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.equipment
    SET status = 'disponivel'::equipment_status,
        current_client_id = NULL
    WHERE status = 'com_cliente'::equipment_status;
END; $$;

-- 03:00 UTC = 00:00 Brasilia
SELECT cron.unschedule('reset-daily-equipment') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reset-daily-equipment');
SELECT cron.schedule('reset-daily-equipment', '0 3 * * *', $$SELECT public.reset_daily_equipment();$$);
