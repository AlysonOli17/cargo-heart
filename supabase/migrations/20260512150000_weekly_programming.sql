-- Tabela para o Planejamento Semanal de Operação
CREATE TABLE IF NOT EXISTS public.programming (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    day_of_week TEXT NOT NULL, -- Segunda, Terça, etc.
    client_name TEXT NOT NULL,
    equipment_type TEXT NOT NULL, -- Tipo necessário (Caminhão, Pipa, etc)
    quantity_needed INTEGER DEFAULT 0,
    quantity_allocated INTEGER DEFAULT 0,
    notes TEXT,
    owner_id UUID REFERENCES auth.users(id)
);

-- Ativar RLS
ALTER TABLE public.programming ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Programming Access" ON public.programming FOR ALL USING (true);
