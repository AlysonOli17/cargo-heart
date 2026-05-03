-- 1) Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'operador', 'visualizador');

-- 2) user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3) Security definer to check role (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 4) RLS on user_roles
CREATE POLICY "users view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5) Promote ALL existing users to admin (current owner becomes admin)
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- 6) equipment_requests table
CREATE TYPE public.request_status AS ENUM ('pendente', 'aprovado', 'rejeitado');

CREATE TABLE public.equipment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL,
  client_id UUID NOT NULL,
  requested_by UUID NOT NULL,
  owner_id UUID NOT NULL,
  status public.request_status NOT NULL DEFAULT 'pendente',
  notes TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.equipment_requests ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER equipment_requests_updated_at
BEFORE UPDATE ON public.equipment_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: any authenticated user in the same owner workspace can view; only operadores/admins create; only admins decide
CREATE POLICY "view requests" ON public.equipment_requests
  FOR SELECT USING (auth.uid() = owner_id OR auth.uid() = requested_by OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "create requests" ON public.equipment_requests
  FOR INSERT WITH CHECK (
    auth.uid() = requested_by
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador'))
  );

CREATE POLICY "admins update requests" ON public.equipment_requests
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete requests" ON public.equipment_requests
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- 7) Trigger: when request is approved, associate equipment to client
CREATE OR REPLACE FUNCTION public.apply_equipment_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aprovado' AND (OLD.status IS DISTINCT FROM 'aprovado') THEN
    UPDATE public.equipment
      SET status = 'com_cliente'::equipment_status,
          current_client_id = NEW.client_id
      WHERE id = NEW.equipment_id;
    NEW.decided_at := now();
  ELSIF NEW.status = 'rejeitado' AND (OLD.status IS DISTINCT FROM 'rejeitado') THEN
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER equipment_requests_apply
BEFORE UPDATE ON public.equipment_requests
FOR EACH ROW EXECUTE FUNCTION public.apply_equipment_request();
