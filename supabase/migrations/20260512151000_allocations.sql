-- Tabela para vincular equipamentos específicos às programações
CREATE TABLE IF NOT EXISTS public.programming_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    programming_id UUID REFERENCES public.programming(id) ON DELETE CASCADE,
    equipment_id UUID REFERENCES public.equipment(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES auth.users(id),
    UNIQUE(programming_id, equipment_id) -- Evita duplicar o mesmo caminhão na mesma programação
);

-- Ativar RLS
ALTER TABLE public.programming_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Allocations Access" ON public.programming_allocations FOR ALL USING (true);
