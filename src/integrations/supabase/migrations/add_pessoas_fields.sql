-- =========================================================
-- MIGRAÇÃO UNIFICADA: Cadastro de Pessoas & Indisponibilidades
-- Execute este script no SQL Editor do Supabase
-- =========================================================

-- 1. Cria a tabela `people` se ela não existir
CREATE TABLE IF NOT EXISTS public.people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    name TEXT NOT NULL,
    plate_tag TEXT,
    equipment_types TEXT[] DEFAULT '{}',
    shift TEXT,
    letra TEXT DEFAULT 'A',
    vacation_start DATE,
    vacation_end DATE,
    unavailability DATE[] DEFAULT '{}',
    matricula TEXT,
    ativo BOOLEAN DEFAULT true,
    owner_id UUID REFERENCES auth.users(id)
);

-- Habilitar RLS na tabela `people` se ainda não estiver habilitada
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

-- Adiciona a política de acesso público para a tabela `people`
-- (Nota: CREATE POLICY IF NOT EXISTS não é padrão no postgres, então usamos um bloco DO ou removemos se já existir)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'people' AND policyname = 'Public People Access'
    ) THEN
        CREATE POLICY "Public People Access" ON public.people FOR ALL USING (true);
    END IF;
END $$;

-- 2. Cria a tabela de indisponibilidades para as pessoas do Porto
CREATE TABLE IF NOT EXISTS public.porto_pessoas_indisponibilidades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pessoa_id   text NOT NULL,
  owner_id    uuid,
  tipo        text NOT NULL DEFAULT 'Atestado',
  data_inicio date NOT NULL,
  data_fim    date NOT NULL,
  motivo      text,
  created_at  timestamptz DEFAULT now()
);

-- Habilita RLS na nova tabela de indisponibilidades
ALTER TABLE public.porto_pessoas_indisponibilidades ENABLE ROW LEVEL SECURITY;

-- Adiciona a política de acesso para a tabela de indisponibilidades
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'porto_pessoas_indisponibilidades' AND policyname = 'owner_access_indisponibilidades'
    ) THEN
        CREATE POLICY "owner_access_indisponibilidades"
          ON public.porto_pessoas_indisponibilidades
          FOR ALL
          USING (true)
          WITH CHECK (true);
    END IF;
END $$;

-- 3. Ativa o Realtime para as tabelas se a publicação existir
ALTER TABLE public.people REPLICA IDENTITY FULL;
ALTER TABLE public.porto_pessoas_indisponibilidades REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        -- Tenta adicionar a tabela `people`
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'people'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.people;
        END IF;
        
        -- Tenta adicionar a tabela `porto_pessoas_indisponibilidades`
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'porto_pessoas_indisponibilidades'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.porto_pessoas_indisponibilidades;
        END IF;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;
