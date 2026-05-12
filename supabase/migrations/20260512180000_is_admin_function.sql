-- 1. Criar uma função que checa se o usuário é Admin ignorando o RLS (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Limpar políticas antigas que podem estar causando conflito
DROP POLICY IF EXISTS "admins view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "admins update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "admins view all roles" ON public.user_roles;

-- 3. Nova política para PERFIS usando a função is_admin()
CREATE POLICY "admins_manage_profiles" ON public.profiles
FOR ALL USING (public.is_admin() OR auth.uid() = id);

-- 4. Nova política para CARGOS usando a função is_admin()
CREATE POLICY "admins_manage_roles" ON public.user_roles
FOR ALL USING (public.is_admin() OR auth.uid() = user_id);

-- Garantir que RLS está ativo
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
