DROP TRIGGER IF EXISTS equipment_movement_log ON public.equipment;
CREATE TRIGGER equipment_movement_log
  AFTER INSERT OR UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.log_equipment_movement();

DROP TRIGGER IF EXISTS equipment_updated_at ON public.equipment;
CREATE TRIGGER equipment_updated_at
  BEFORE UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS clients_updated_at ON public.clients;
CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();