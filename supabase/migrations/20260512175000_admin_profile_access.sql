-- Habilitar Administradores a visualizarem e editarem todos os perfis na aba de Acesso
CREATE POLICY "admins view all profiles" ON public.profiles FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

CREATE POLICY "admins update all profiles" ON public.profiles FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
);

-- Garantir que a tabela profiles tenha RLS habilitado (já deve estar, mas por segurança)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
