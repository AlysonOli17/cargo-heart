ALTER PUBLICATION supabase_realtime ADD TABLE public.equipment_requests;
ALTER TABLE public.equipment_requests REPLICA IDENTITY FULL;