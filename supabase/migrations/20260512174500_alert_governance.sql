-- Adicionar campo de última verificação nos equipamentos
ALTER TABLE public.equipment ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

-- Atualizar a tabela de perfis para incluir o setor/cargo
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department TEXT CHECK (department IN ('Manutenção', 'Operação', 'Administrativo'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS receives_alerts BOOLEAN DEFAULT true;

-- Comentários para documentação
COMMENT ON COLUMN equipment.last_verified_at IS 'Data da última vez que o status técnico foi confirmado pelo responsável';
COMMENT ON COLUMN profiles.department IS 'Setor do usuário para direcionamento de alertas e travas';
