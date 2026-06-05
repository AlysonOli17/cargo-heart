-- Criação da tabela de solicitações de serviço vindas do Google Forms

CREATE TABLE IF NOT EXISTS public.service_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Campos extraídos do Google Forms
    contrato TEXT,
    nome_completo TEXT,
    matricula TEXT,
    consegue_atuar TEXT, -- Sim / Não
    local_operacao TEXT,
    detalhes_local TEXT,
    placa_tag TEXT,
    tipo_equipamento TEXT,
    onde_problema TEXT,
    descricao_problema TEXT,

    -- Campos de Gestão (Operação)
    status TEXT DEFAULT 'pendente', -- pendente, em_atendimento, finalizado, rejeitado
    equipe_atendimento TEXT, -- base, area, lubrificacao, comboio
    prioridade TEXT, -- alta, media, baixa (calculado no insert ou via trigger)
    observacoes_cco TEXT
);

-- RLS
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura para usuários autenticados" 
    ON public.service_requests FOR SELECT TO authenticated USING (true);
    
CREATE POLICY "Permitir update para usuários autenticados" 
    ON public.service_requests FOR UPDATE TO authenticated USING (true);
    
CREATE POLICY "Permitir insert para usuários autenticados" 
    ON public.service_requests FOR INSERT TO authenticated WITH CHECK (true);

-- Permite inserção anônima para que o webhook do Google Forms funcione sem precisar de token de usuário logado (usará anon key)
CREATE POLICY "Permitir insert anônimo via webhook" 
    ON public.service_requests FOR INSERT TO anon WITH CHECK (true);

-- Trigger para calcular prioridade inicial com base na resposta "consegue_atuar"
CREATE OR REPLACE FUNCTION public.calculate_service_request_priority()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.consegue_atuar ILIKE 'Não%' THEN
        NEW.prioridade = 'alta';
    ELSIF NEW.prioridade IS NULL THEN
        NEW.prioridade = 'media';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_service_request_priority_trigger
    BEFORE INSERT ON public.service_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.calculate_service_request_priority();
