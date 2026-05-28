-- Tabela para gerenciar a programação diária importada da Usina
CREATE TABLE IF NOT EXISTS public.usina_daily_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    scheduled_date DATE NOT NULL,
    equipment TEXT,
    plate TEXT NOT NULL,
    model TEXT,
    client TEXT,
    shift TEXT,
    valley_time TEXT,
    valley_start TEXT,
    valley_end TEXT,
    cost_center TEXT,
    subet TEXT,
    local TEXT,
    activity TEXT,
    operator TEXT,
    os_number TEXT,
    is_completed BOOLEAN DEFAULT false,
    owner_id UUID REFERENCES auth.users(id)
);

-- Tabela para gerenciar as paradas corretivas ocorridas durante o turno na Usina
CREATE TABLE IF NOT EXISTS public.usina_corrective_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    schedule_id UUID REFERENCES public.usina_daily_schedules(id) ON DELETE CASCADE,
    stop_start TIMESTAMPTZ NOT NULL,
    stop_end TIMESTAMPTZ,
    reason TEXT NOT NULL,
    notes TEXT,
    owner_id UUID REFERENCES auth.users(id)
);

-- Ativar RLS
ALTER TABLE public.usina_daily_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Usina Schedules Access" ON public.usina_daily_schedules FOR ALL USING (true);

ALTER TABLE public.usina_corrective_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Usina Corrective Logs Access" ON public.usina_corrective_logs FOR ALL USING (true);

-- Realtime
ALTER TABLE public.usina_daily_schedules REPLICA IDENTITY FULL;
ALTER TABLE public.usina_corrective_logs REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.usina_daily_schedules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.usina_corrective_logs;
