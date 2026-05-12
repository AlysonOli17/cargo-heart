-- Expandir os valores permitidos para o status do equipamento
ALTER TYPE public.equipment_status ADD VALUE IF NOT EXISTS 'operacional';
ALTER TYPE public.equipment_status ADD VALUE IF NOT EXISTS 'indisponivel';
ALTER TYPE public.equipment_status ADD VALUE IF NOT EXISTS 'finalizacao';
ALTER TYPE public.equipment_status ADD VALUE IF NOT EXISTS 'programado';

-- Garantir que a coluna aceite textos caso o ENUM dê conflito em algum ambiente
-- (Alguns ambientes Supabase podem ter restrições ao alterar ENUMs ativos)
ALTER TABLE public.equipment ALTER COLUMN status TYPE TEXT;
ALTER TABLE public.movements ALTER COLUMN from_status TYPE TEXT;
ALTER TABLE public.movements ALTER COLUMN to_status TYPE TEXT;
