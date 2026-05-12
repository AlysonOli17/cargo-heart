import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Shield, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole, type AppRole } from "@/hooks/use-role";

export const Route = createFileRoute("/acesso")({
  head: () => ({ meta: [{ title: "Controle de acesso — Disponibilidade Frota Busato" }] }),
  component: () => <AppLayout><AccessPage /></AppLayout>,
});

type UserRow = { 
  user_id: string; 
  role: AppRole | null; 
  email: string | null; 
  full_name: string | null;
  department: string | null;
  receives_alerts: boolean;
};

function AccessPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useRole();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  
  const load = async () => {
    setLoading(true);
    try {
      // 1. Carrega cargos
      const { data: roles } = await supabase.from("user_roles").select("user_id,role");
      const roleMap: Record<string, AppRole> = {};
      (roles ?? []).forEach((r: any) => { roleMap[r.user_id] = r.role; });

      // 2. Carrega perfis (TENTATIVA 1: Completa)
      let { data: profiles, error: pError } = await supabase.from("profiles")
        .select("id,email,full_name,department,receives_alerts");

      // 3. SE FALHAR (colunas faltando), tenta a TENTATIVA 2: Básica
      if (pError) {
        console.warn("Falha ao carregar colunas extras, tentando básico...");
        const { data: basicProfiles, error: bError } = await supabase.from("profiles")
          .select("id,email,full_name");
        
        if (bError) {
          console.error("Falha total no carregamento:", bError);
          toast.error("Erro crítico de permissão no banco de dados.");
        } else {
          profiles = basicProfiles;
        }
      }

      const mappedUsers = (profiles ?? []).map((p: any) => ({
        user_id: p.id,
        role: roleMap[p.id] ?? null,
        email: p.email,
        full_name: p.full_name,
        department: p.department || null,
        receives_alerts: p.receives_alerts ?? true
      }));

      setUsers(mappedUsers);
    } catch (err) {
      console.error("Erro fatal:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && isAdmin) load();
  }, [user, isAdmin]);

  if (authLoading || roleLoading) return null;
  if (!user || !isAdmin) return <Navigate to="/" />;

  const updateProfile = async (userId: string, updates: Partial<UserRow>) => {
    try {
      const { error } = await supabase.from("profiles").update({
        department: updates.department,
        receives_alerts: updates.receives_alerts
      }).eq("id", userId);
      
      if (error) throw error;
      toast.success("Perfil atualizado");
      load();
    } catch (err: any) {
      toast.error("Erro ao atualizar. Colunas de setor ainda não ativas no banco.");
    }
  };

  const changeRole = async (userId: string, newRole: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
    if (error) toast.error(error.message); else { toast.success("Cargo alterado"); load(); }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" /> Governança e Acesso
          </h1>
          <p className="text-muted-foreground font-medium italic">Gerencie permissões e setores</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="font-bold uppercase text-[10px]">
          <RefreshCw className={cn("h-3 w-3 mr-2", loading && "animate-spin")} /> Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted-foreground animate-pulse font-bold uppercase">Sincronizando...</div>
      ) : (
        <div className="grid gap-4">
          {users.map(u => (
            <Card key={u.user_id} className="p-4 border-2 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="font-black uppercase text-lg">{u.full_name || "Sem Nome"}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{u.email || u.user_id}</p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="space-y-1">
                    <Label className="text-[9px] font-black uppercase opacity-60">Setor</Label>
                    <Select value={u.department || ""} onValueChange={(v) => updateProfile(u.user_id, { department: v })}>
                      <SelectTrigger className="w-36 h-9 font-bold text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Manutenção">Manutenção</SelectItem>
                        <SelectItem value="Operação">Operação</SelectItem>
                        <SelectItem value="Administrativo">Administrativo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[9px] font-black uppercase opacity-60">Cargo</Label>
                    <Select value={u.role || ""} onValueChange={(v) => changeRole(u.user_id, v as AppRole)} disabled={u.user_id === user.id}>
                      <SelectTrigger className="w-36 h-9 font-bold text-xs"><SelectValue placeholder="Definir" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="operador">Operador</SelectItem>
                        <SelectItem value="visualizador">Visualizador</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2 pt-2 md:pt-0">
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase leading-none">Alertas</p>
                    </div>
                    <Switch checked={u.receives_alerts} onCheckedChange={(v) => updateProfile(u.user_id, { receives_alerts: v })} />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function cn(...classes: any[]) { return classes.filter(Boolean).join(" "); }