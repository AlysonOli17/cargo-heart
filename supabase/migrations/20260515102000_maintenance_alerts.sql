-- Adicionando campos para alerta de previsão de manutenção
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS alert_user_id UUID REFERENCES auth.users(id);

-- Comentário para o desenvolvedor
COMMENT ON COLUMN public.equipment.alert_user_id IS 'ID do usuário que deve ser alertado em caso de atraso na liberação';
