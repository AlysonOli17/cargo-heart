-- 1. Liberar a tabela de CARGOS (user_roles) para o Admin ver todo mundo
DROP POLICY IF EXISTS "admins view all roles" ON public.user_roles;
CREATE POLICY "admins view all roles" ON public.user_roles FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles AS ur 
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  ) OR auth.uid() = user_id
);

-- 2. Liberar a tabela de PERFIS (profiles) com uma regra mais direta
DROP POLICY IF EXISTS "admins view all profiles" ON public.profiles;
CREATE POLICY "admins view all profiles" ON public.profiles FOR SELECT 
USING (
  (SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1) = 'admin'
  OR auth.uid() = id
);

-- 3. Liberar edição para Admin
DROP POLICY IF EXISTS "admins update all profiles" ON public.profiles;
CREATE POLICY "admins update all profiles" ON public.profiles FOR UPDATE
USING (
  (SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1) = 'admin'
  OR auth.uid() = id
);

-- Garantir que as tabelas estão com RLS ativo
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
