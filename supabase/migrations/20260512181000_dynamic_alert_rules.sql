-- Tabela para armazenar as regras de alerta customizadas
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'maintenance_duration', -- maintenance_duration, preventive_overdue, etc.
  threshold_days INTEGER NOT NULL DEFAULT 5,
  alert_time TIME NOT NULL DEFAULT '10:00:00',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Permissões de Admin para gerenciar as regras
CREATE POLICY "admins_manage_alert_rules" ON public.alert_rules
FOR ALL USING (public.is_admin());

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

-- Inserir a regra padrão que já tínhamos planejado
INSERT INTO public.alert_rules (name, rule_type, threshold_days, alert_time)
VALUES ('Manutenção Crítica (>5 dias)', 'maintenance_duration', 5, '10:00:00');
