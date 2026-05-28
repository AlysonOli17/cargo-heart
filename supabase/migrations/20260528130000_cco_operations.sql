-- Tabela para gerenciar alocações diárias do CCO (veículos, motoristas e frentes)
CREATE TABLE IF NOT EXISTS public.cco_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    scheduled_date DATE NOT NULL,
    equipment_id UUID REFERENCES public.equipment(id) ON DELETE CASCADE,
    operator_name TEXT,
    service_front TEXT,
    shift TEXT,
    notes TEXT,
    owner_id UUID REFERENCES auth.users(id)
);

-- Ativar RLS
ALTER TABLE public.cco_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public CCO Allocations Access" ON public.cco_allocations FOR ALL USING (true);

-- Realtime
ALTER TABLE public.cco_allocations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cco_allocations;
