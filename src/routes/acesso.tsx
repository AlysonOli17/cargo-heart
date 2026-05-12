import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Shield, Check, X, UserPlus, Users, Bell, Briefcase } from "lucide-react";
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
  
  const load = async () => {
    const [{ data: roles }, { data: profiles }] = await Promise.all([
      supabase.from("user_roles").select("user_id,role"),
      supabase.from("profiles").select("id,email,full_name,department,receives_alerts"),
    ]);
    const roleMap: Record<string, AppRole> = {};
    (roles ?? []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
    
    setUsers((profiles ?? []).map((p: any) => ({
      user_id: p.id,
      role: roleMap[p.id] ?? null,
      email: p.email,
      full_name: p.full_name,
      department: p.department,
      receives_alerts: p.receives_alerts ?? true
    })));
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  if (authLoading || roleLoading) return null;
  if (!user || !isAdmin) return <Navigate to="/" />;

  const updateProfile = async (userId: string, updates: Partial<UserRow>) => {
    const { error } = await supabase.from("profiles").update({
      department: updates.department,
      receives_alerts: updates.receives_alerts
    }).eq("id", userId);
    
    if (error) toast.error(error.message);
    else {
      toast.success("Perfil atualizado");
      load();
    }
  };

  const changeRole = async (userId: string, newRole: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
    if (error) toast.error(error.message); else { toast.success("Cargo alterado"); load(); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-2">
          <Shield className="h-8 w-8 text-primary" /> Governança e Acesso
        </h1>
        <p className="text-muted-foreground font-medium italic">Gerencie permissões, setores e alertas críticos</p>
      </div>

      <div className="grid gap-4">
        {users.map(u => (
          <Card key={u.user_id} className="p-4 overflow-hidden border-2">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <p className="font-black uppercase text-lg leading-none">{u.full_name || "Usuário sem Nome"}</p>
                <p className="text-xs text-muted-foreground font-mono mt-1">{u.email}</p>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {/* SETOR */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase opacity-50">Setor/Departamento</Label>
                  <Select value={u.department || ""} onValueChange={(v) => updateProfile(u.user_id, { department: v })}>
                    <SelectTrigger className="w-40 h-9 font-bold text-xs"><SelectValue placeholder="Definir Setor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Manutenção">Manutenção</SelectItem>
                      <SelectItem value="Operação">Operação</SelectItem>
                      <SelectItem value="Administrativo">Administrativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* CARGO NO SISTEMA */}
                <div className="space-y-1">
                  <Label className="text-[10px] font-black uppercase opacity-50">Nível de Acesso</Label>
                  <Select value={u.role || ""} onValueChange={(v) => changeRole(u.user_id, v as AppRole)} disabled={u.user_id === user.id}>
                    <SelectTrigger className="w-40 h-9 font-bold text-xs"><SelectValue placeholder="Sem perfil" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="operador">Operador</SelectItem>
                      <SelectItem value="visualizador">Visualizador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* ALERTAS */}
                <div className="flex items-center gap-2 pt-4 md:pt-0">
                  <div className="text-right">
                    <p className="text-[10px] font-black uppercase leading-none">Receber Alertas</p>
                    <p className="text-[9px] text-muted-foreground">Alertas críticos às 10h</p>
                  </div>
                  <Switch checked={u.receives_alerts} onCheckedChange={(v) => updateProfile(u.user_id, { receives_alerts: v })} />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}