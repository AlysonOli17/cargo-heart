
ALTER TABLE public.equipment REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.equipment;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
