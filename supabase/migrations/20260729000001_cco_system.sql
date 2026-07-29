-- =============================================
-- CCO SYSTEM - SQL COMPLETO DE SETUP
-- Execute este arquivo inteiro no Supabase SQL Editor
-- =============================================

-- PASSO 1: Limpar triggers e funções problemáticas
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP TRIGGER IF EXISTS corrective_calc_minutes ON public.correctives;
DROP TRIGGER IF EXISTS set_daily_schedules_updated_at ON public.daily_schedules;

-- PASSO 1B: Corrigir FK de profiles para permitir ON DELETE CASCADE
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN 
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.table_schema = 'public' 
      AND tc.table_name = 'profiles'
      AND ccu.table_schema = 'auth' 
      AND ccu.table_name = 'users'
  LOOP
    EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS ' || r.constraint_name;
  END LOOP;
END $$;

-- FK será recriado com CASCADE na criação/alteração da tabela profiles abaixo

-- PASSO 2: Criar ENUMs com segurança
DO $$ BEGIN CREATE TYPE contract_type AS ENUM ('Habitual', 'Eventual'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE contract_client AS ENUM ('Usina', 'Porto'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE shift_type AS ENUM ('Dia', 'Noite'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE schedule_status AS ENUM ('agendado', 'operando', 'corretiva', 'finalizado', 'ausente'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE corrective_problem_type AS ENUM ('mecanico', 'eletrico', 'pneu', 'abastecimento', 'operador', 'acidente', 'outro'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('cco_operador', 'supervisor', 'analista', 'gerente', 'admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PASSO 3: Tabela PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'admin',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "profiles_all" ON public.profiles FOR ALL TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PASSO 4: Trigger para criar profile automaticamente ao criar usuário
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'admin'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- PASSO 5: Criar profiles para usuários já existentes (caso já tenha usuários no Auth)
INSERT INTO public.profiles (id, name, role)
SELECT 
  u.id,
  COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  'admin'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- PASSO 6: Tabela CONTRACTS
CREATE TABLE IF NOT EXISTS public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Habitual',
  client TEXT NOT NULL DEFAULT 'Usina',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'Habitual';
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS client TEXT NOT NULL DEFAULT 'Usina';
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "contracts_all" ON public.contracts FOR ALL TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.contracts (name, type, client) SELECT 'Habitual Usina', 'Habitual', 'Usina' WHERE NOT EXISTS (SELECT 1 FROM public.contracts WHERE name = 'Habitual Usina');
INSERT INTO public.contracts (name, type, client) SELECT 'Eventual Usina', 'Eventual', 'Usina' WHERE NOT EXISTS (SELECT 1 FROM public.contracts WHERE name = 'Eventual Usina');
INSERT INTO public.contracts (name, type, client) SELECT 'Habitual Porto', 'Habitual', 'Porto' WHERE NOT EXISTS (SELECT 1 FROM public.contracts WHERE name = 'Habitual Porto');
INSERT INTO public.contracts (name, type, client) SELECT 'Eventual Porto', 'Eventual', 'Porto' WHERE NOT EXISTS (SELECT 1 FROM public.contracts WHERE name = 'Eventual Porto');

-- PASSO 7: Tabela EQUIPMENT_TYPES
CREATE TABLE IF NOT EXISTS public.equipment_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.equipment_types ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "equipment_types_all" ON public.equipment_types FOR ALL TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.equipment_types (name) VALUES
  ('Pá Carregadeira'), ('Mini Carregadeira'), ('Mini Escavadeira'), ('Escavadeira'),
  ('Retroescavadeira'), ('Caminhão Caçamba'), ('Caminhão Pipa'), ('Caminhão Brook'),
  ('Caminhão Carroceria'), ('Peneira Rotativa'), ('Carreta'), ('Outro')
ON CONFLICT (name) DO NOTHING;

-- PASSO 8: Tabela EQUIPMENT
CREATE TABLE IF NOT EXISTS public.equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL DEFAULT '',
  plate TEXT,
  model TEXT,
  type_id UUID REFERENCES public.equipment_types(id),
  contract_id UUID REFERENCES public.contracts(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS identifier TEXT NOT NULL DEFAULT '';
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS plate TEXT;
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS type_id UUID;
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS contract_id UUID;
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "equipment_all" ON public.equipment FOR ALL TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PASSO 9: Tabela OPERATORS
CREATE TABLE IF NOT EXISTS public.operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "operators_all" ON public.operators FOR ALL TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PASSO 10: Tabela DAILY_SCHEDULES
CREATE TABLE IF NOT EXISTS public.daily_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  shift TEXT NOT NULL DEFAULT 'Dia',
  contract_id UUID REFERENCES public.contracts(id),
  team TEXT,
  equipment_id UUID,
  equipment_identifier TEXT NOT NULL DEFAULT '',
  plate TEXT,
  model TEXT,
  operator_id UUID,
  operator_name TEXT,
  cost_center TEXT,
  location TEXT,
  activity TEXT,
  work_order TEXT,
  turno TEXT,
  schedule_start TIME,
  schedule_end TIME,
  status TEXT NOT NULL DEFAULT 'agendado',
  actual_start TIME,
  actual_end TIME,
  imported_from TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_schedules_date ON public.daily_schedules(date);
CREATE INDEX IF NOT EXISTS idx_daily_schedules_contract ON public.daily_schedules(contract_id);
ALTER TABLE public.daily_schedules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "daily_schedules_all" ON public.daily_schedules FOR ALL TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PASSO 11: Tabela CORRECTIVES
CREATE TABLE IF NOT EXISTS public.correctives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  equipment_identifier TEXT NOT NULL DEFAULT '',
  plate TEXT,
  contract_id UUID REFERENCES public.contracts(id),
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ,
  minutes_lost INTEGER,
  problem_type TEXT NOT NULL DEFAULT 'outro',
  description TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolution_notes TEXT,
  created_by UUID,
  resolved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_correctives_date ON public.correctives(date);
CREATE INDEX IF NOT EXISTS idx_correctives_schedule ON public.correctives(schedule_id);
ALTER TABLE public.correctives ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "correctives_all" ON public.correctives FOR ALL TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PASSO 12: Trigger para calcular minutos perdidos ao fechar corretiva
CREATE OR REPLACE FUNCTION public.calc_minutes_lost()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.end_time IS NOT NULL AND (OLD.end_time IS NULL OR OLD.end_time != NEW.end_time) THEN
    NEW.minutes_lost := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60));
    NEW.resolved := true;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER corrective_calc_minutes
  BEFORE UPDATE ON public.correctives
  FOR EACH ROW EXECUTE FUNCTION public.calc_minutes_lost();

-- PASSO 13: Trigger auto updated_at em daily_schedules
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER set_daily_schedules_updated_at
  BEFORE UPDATE ON public.daily_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PASSO 14: View de resumo diário
CREATE OR REPLACE VIEW public.v_daily_corrective_summary AS
SELECT
  c.date,
  c.contract_id,
  ct.name AS contract_name,
  COUNT(c.id) AS total_correctives,
  COUNT(CASE WHEN c.resolved THEN 1 END) AS resolved_correctives,
  COUNT(CASE WHEN NOT c.resolved THEN 1 END) AS open_correctives,
  COALESCE(SUM(c.minutes_lost), 0) AS total_minutes_lost,
  COALESCE(SUM(c.minutes_lost) / 60.0, 0) AS total_hours_lost
FROM public.correctives c
JOIN public.contracts ct ON ct.id = c.contract_id
GROUP BY c.date, c.contract_id, ct.name;

-- FIM
SELECT 'Setup concluído com sucesso! ✅' AS resultado;
