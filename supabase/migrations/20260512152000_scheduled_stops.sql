-- Ajustando a tabela de programação para focar em agendamento de paradas por placa
DROP TABLE IF EXISTS public.programming_allocations;
DROP TABLE IF EXISTS public.programming;

CREATE TABLE public.programming (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    day_of_week TEXT NOT NULL, -- Segunda, Terça...
    equipment_id UUID REFERENCES public.equipment(id) ON DELETE CASCADE,
    stop_type TEXT NOT NULL, -- Lavador, Mola, Borracharia, Preventiva, Programada
    notes TEXT,
    is_completed BOOLEAN DEFAULT false,
    owner_id UUID REFERENCES auth.users(id)
);

-- Ativar RLS
ALTER TABLE public.programming ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Programming Access" ON public.programming FOR ALL USING (true);
