import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Shield, RefreshCw, Bell, Plus, Trash2, Clock, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole, type AppRole } from "@/hooks/use-role";

export const Route = createFileRoute("/acesso")({
  head: () => ({ meta: [{ title: "Governança e Acesso — Frota Busato" }] }),
  component: () => <AppLayout><AccessPage /></AppLayout>,
});

type UserRow = { user_id: string; role: AppRole | null; email: string | null; full_name: string | null; department: string | null; receives_alerts: boolean; };
type AlertRule = { id: string; name: string; threshold_days: number; alert_time: string; is_active: boolean; };

function AccessPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useRole();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  
  const load = async () => {
    setLoading(true);
    try {
      const [{ data: roles }, { data: profiles }, { data: rls }] = await Promise.all([
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("profiles").select("id,email,full_name,department,receives_alerts"),
        supabase.from("alert_rules").select("*").order("created_at")
      ]);

      const roleMap: Record<string, AppRole> = {};
      (roles ?? []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
      setUsers((profiles ?? []).map((p: any) => ({
        user_id: p.id, role: roleMap[p.id] ?? null, email: p.email, full_name: p.full_name,
        department: p.department, receives_alerts: p.receives_alerts ?? true
      })));
      setRules((rls ?? []) as AlertRule[]);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { if (user && isAdmin) load(); }, [user, isAdmin]);

  if (authLoading || roleLoading) return null;
  if (!user || !isAdmin) return <Navigate to="/" />;

  const addRule = async () => {
    const { error } = await supabase.from("alert_rules").insert({
      name: "Nova Regra de Auditoria",
      threshold_days: 5,
      alert_time: "10:00:00"
    });
    if (error) toast.error("Erro ao criar regra"); else { toast.success("Regra criada!"); load(); }
  };

  const updateRule = async (id: string, updates: Partial<AlertRule>) => {
    const { error } = await supabase.from("alert_rules").update(updates).eq("id", id);
    if (error) toast.error("Erro ao salvar"); else load();
  };

  const deleteRule = async (id: string) => {
    if (!confirm("Excluir esta regra permanentemente?")) return;
    const { error } = await supabase.from("alert_rules").delete().eq("id", id);
    if (error) toast.error("Erro ao deletar"); else { toast.success("Regra removida"); load(); }
  };

  return (
    <div className="space-y-10">
      {/* SEÇÃO DE USUÁRIOS */}
      <section className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-2">
              <Shield className="h-8 w-8 text-primary" /> Equipe e Acessos
            </h1>
            <p className="text-muted-foreground font-medium italic">Aprovação de novos usuários e setores</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="font-bold uppercase text-[10px]">
            <RefreshCw className={cn("h-3 w-3 mr-2", loading && "animate-spin")} /> Sincronizar
          </Button>
        </div>

        <div className="grid gap-3">
          {users.map(u => (
            <Card key={u.user_id} className="p-4 border-2 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="font-black uppercase text-lg leading-tight">{u.full_name || "Sem Nome"}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{u.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="space-y-1"><Label className="text-[9px] font-black uppercase opacity-60">Setor</Label>
                    <Select value={u.department || ""} onValueChange={(v) => updateProfile(u.user_id, { department: v }, load)}>
                      <SelectTrigger className="w-36 h-9 font-bold text-xs"><SelectValue placeholder="Definir" /></SelectTrigger>
                      <SelectContent><SelectItem value="Manutenção">Manutenção</SelectItem><SelectItem value="Operação">Operação</SelectItem><SelectItem value="Administrativo">Administrativo</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-[9px] font-black uppercase opacity-60">Cargo</Label>
                    <Select value={u.role || ""} onValueChange={(v) => changeRole(u.user_id, v as AppRole, load)} disabled={u.user_id === user.id}>
                      <SelectTrigger className="w-36 h-9 font-bold text-xs"><SelectValue placeholder="Bloqueado" /></SelectTrigger>
                      <SelectContent><SelectItem value="admin">Administrador</SelectItem><SelectItem value="operador">Operador</SelectItem><SelectItem value="visualizador">Visualizador</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pt-2 md:pt-0"><p className="text-[9px] font-black uppercase leading-none">Alertas</p>
                    <Switch checked={u.receives_alerts} onCheckedChange={(v) => updateProfile(u.user_id, { receives_alerts: v }, load)} />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* SEÇÃO DE REGRAS DE ALERTA */}
      <section className="space-y-4 pt-6 border-t-4 border-dashed">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-2">
              <Bell className="h-7 w-7 text-red-600" /> Regras de Governança
            </h2>
            <p className="text-muted-foreground font-medium italic">Configure gatilhos de auditoria e travas de tela</p>
          </div>
          <Button onClick={addRule} className="font-black uppercase text-xs h-10 bg-red-600 text-white hover:bg-red-700">
            <Plus className="h-4 w-4 mr-2" /> Criar Novo Alerta
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {rules.map(rule => (
            <Card key={rule.id} className="p-5 border-2 relative overflow-hidden group">
               {!rule.is_active && <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center font-black uppercase text-xs text-muted-foreground">Regra Desativada</div>}
               <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <Input value={rule.name} onChange={(e) => updateRule(rule.id, { name: e.target.value })} className="h-8 font-black uppercase text-sm border-none bg-muted/50 focus:bg-white transition-all w-full mr-2" />
                    <Button variant="ghost" size="icon" onClick={() => deleteRule(rule.id)} className="text-red-500 hover:bg-red-50 h-8 w-8"><Trash2 className="h-4 w-4" /></Button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase opacity-60 flex items-center gap-1"><Calendar className="h-3 w-3" /> Máximo de Dias Parado</Label>
                      <Input type="number" value={rule.threshold_days} onChange={(e) => updateRule(rule.id, { threshold_days: parseInt(e.target.value) })} className="font-bold h-10" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase opacity-60 flex items-center gap-1"><Clock className="h-3 w-3" /> Horário do Alerta</Label>
                      <Input type="time" value={rule.alert_time} onChange={(e) => updateRule(rule.id, { alert_time: e.target.value })} className="font-bold h-10" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-dashed">
                    <span className="text-[10px] font-black uppercase text-muted-foreground italic">Ativar trava de tela?</span>
                    <Switch checked={rule.is_active} onCheckedChange={(v) => updateRule(rule.id, { is_active: v })} />
                  </div>
               </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

// Funções auxiliares movidas para fora para limpar o código
async function updateProfile(userId: string, updates: any, reload: () => void) {
  const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
  if (error) toast.error("Atenção: Rode o SQL que enviei antes para habilitar esta função!"); else { toast.success("Atualizado"); reload(); }
}
async function changeRole(userId: string, newRole: AppRole, reload: () => void) {
  await supabase.from("user_roles").delete().eq("user_id", userId);
  const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
  if (error) toast.error(error.message); else { toast.success("Cargo alterado"); reload(); }
}
function cn(...classes: any[]) { return classes.filter(Boolean).join(" "); }