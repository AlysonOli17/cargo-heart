
-- Allow shared visibility across users via roles instead of owner_id only

-- EQUIPMENT
DROP POLICY IF EXISTS "owner all equipment" ON public.equipment;
CREATE POLICY "auth read equipment" ON public.equipment FOR SELECT TO authenticated USING (true);
CREATE POLICY "writers insert equipment" ON public.equipment FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operador'::app_role));
CREATE POLICY "writers update equipment" ON public.equipment FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operador'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operador'::app_role));
CREATE POLICY "admins delete equipment" ON public.equipment FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- CLIENTS
DROP POLICY IF EXISTS "owner all clients" ON public.clients;
CREATE POLICY "auth read clients" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "writers insert clients" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operador'::app_role));
CREATE POLICY "writers update clients" ON public.clients FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operador'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operador'::app_role));
CREATE POLICY "admins delete clients" ON public.clients FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- MOVEMENTS
DROP POLICY IF EXISTS "owner all movements" ON public.movements;
CREATE POLICY "auth read movements" ON public.movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "writers insert movements" ON public.movements FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operador'::app_role));

-- EQUIPMENT_REQUESTS: broaden view
DROP POLICY IF EXISTS "view requests" ON public.equipment_requests;
CREATE POLICY "view requests" ON public.equipment_requests FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'operador'::app_role) OR has_role(auth.uid(),'visualizador'::app_role));
