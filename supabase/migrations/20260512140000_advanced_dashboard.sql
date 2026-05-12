-- Adicionando novos campos para o Dashboard de CCO/CCM
ALTER TABLE equipment 
ADD COLUMN IF NOT EXISTS sub_status TEXT,
ADD COLUMN IF NOT EXISTS maintenance_priority TEXT DEFAULT 'Baixa',
ADD COLUMN IF NOT EXISTS technical_category TEXT,
ADD COLUMN IF NOT EXISTS is_preventive_overdue BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS maintenance_responsible TEXT;

-- Comentários para documentação
COMMENT ON COLUMN equipment.sub_status IS 'Status detalhado (ex: Em reparo, Aguardando peça, Reserva operacional)';
COMMENT ON COLUMN equipment.maintenance_priority IS 'Prioridade da manutenção (Baixa, Média, Alta, Crítica)';
COMMENT ON COLUMN equipment.technical_category IS 'Categoria técnica (Hidráulica, Elétrica, Motor, etc.)';
