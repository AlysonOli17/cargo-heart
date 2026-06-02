-- Tabela para gerenciar o cadastro de pessoas
CREATE TABLE IF NOT EXISTS public.people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    name TEXT NOT NULL,
    plate_tag TEXT,
    equipment_types TEXT[] DEFAULT '{}',
    shift TEXT,
    team_letter TEXT,
    vacation_start DATE,
    vacation_end DATE,
    unavailability DATE[] DEFAULT '{}',
    owner_id UUID REFERENCES auth.users(id)
);

-- Ativar RLS
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public People Access" ON public.people FOR ALL USING (true);

-- Realtime
ALTER TABLE public.people REPLICA IDENTITY FULL;

-- Adicionar à publicação de Realtime se existir
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.people;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;
