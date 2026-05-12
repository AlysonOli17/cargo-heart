-- Adicionando campo de data real para os agendamentos
ALTER TABLE public.programming ADD COLUMN IF NOT EXISTS scheduled_date DATE;

-- Atualizar políticas se necessário
CREATE POLICY "Public Programming Access V2" ON public.programming FOR ALL USING (true);
