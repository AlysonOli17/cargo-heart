import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole, type AppRole } from "@/hooks/use-role";

export const Route = createFileRoute("/acesso")({
  head: () => ({ meta: [{ title: "Controle de acesso — FrotaPro" }] }),
  component: () => <AppLayout><AccessPage /></AppLayout>,
});

type UserRow = { user_id: string; role: AppRole; email: string | null; full_name: string | null };
type RequestRow = {
  id: string; status: "pendente" | "aprovado" | "rejeitado";
  equipment_id: string; client_id: string; requested_by: string;
  notes: string | null; created_at: string;
};

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador", operador: "Operador", visualizador: "Visualizador",
};

const ROLE_ABILITIES: Record<AppRole, string[]> = {
  admin: ["Acesso total", "Aprova solicitações", "Gerencia perfis e usuários"],
  operador: ["Vê todas as abas", "Cadastra clientes/equipamentos", "Solicita associação (precisa de aprovação)"],
  visualizador: ["Apenas visualiza dashboards e listagens", "Não cria, edita ou solicita"],
};

function AccessPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useRole();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [equipMap, setEquipMap] = useState<Record<string, string>>({});
  const [clientMap, setClientMap] = useState<Record<string, string>>({});
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});

  const load = async () => {
    const [{ data: roles }, { data: profiles }, { data: reqs }, { data: equips }, { data: clients }] = await Promise.all([
      supabase.from("user_roles").select("user_id,role"),
      supabase.from("profiles").select("id,email,full_name"),
      supabase.from("equipment_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("equipment").select("id,identifier"),
      supabase.from("clients").select("id,name"),
    ]);
    const pm: Record<string, { email: string | null; full_name: string | null }> = {};
    (profiles ?? []).forEach((p: any) => { pm[p.id] = { email: p.email, full_name: p.full_name }; });
    setUsers((roles ?? []).map((r: any) => ({
      user_id: r.user_id, role: r.role,
      email: pm[r.user_id]?.email ?? null,
      full_name: pm[r.user_id]?.full_name ?? null,
    })));
    setRequests((reqs ?? []) as RequestRow[]);
    const em: Record<string, string> = {}; (equips ?? []).forEach((e: any) => { em[e.id] = e.identifier; });
    const cm: Record<string, string> = {}; (clients ?? []).forEach((c: any) => { cm[c.id] = c.name; });
    const prm: Record<string, string> = {};
    (profiles ?? []).forEach((p: any) => { prm[p.id] = p.full_name || p.email || p.id.slice(0, 8); });
    setEquipMap(em); setClientMap(cm); setProfileMap(prm);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("access-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment_requests" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  if (authLoading || roleLoading) return null;
  if (!user) return null;
  if (!isAdmin) return <Navigate to="/" />;

  const changeRole = async (userId: string, newRole: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
    if (error) toast.error(error.message); else toast.success("Perfil atualizado");
  };

  const decide = async (id: string, status: "aprovado" | "rejeitado") => {
    const { error } = await supabase.from("equipment_requests")
      .update({ status, decided_by: user.id }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success(status === "aprovado" ? "Solicitação aprovada" : "Solicitação rejeitada");
  };

  const pending = requests.filter(r => r.status === "pendente");
  const history = requests.filter(r => r.status !== "pendente").slice(0, 20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" />
          Controle de acesso
        </h1>
        <p className="text-muted-foreground mt-1">Gerencie perfis e aprove solicitações</p>
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Solicitações pendentes
          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-[oklch(0.65_0.2_50)]/15 text-[oklch(0.55_0.2_50)]">{pending.length}</span>
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma solicitação pendente.</p>
        ) : (
          <div className="space-y-2">
            {pending.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 border rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-mono font-semibold">{equipMap[r.equipment_id] ?? "—"}</span>
                    <span className="text-muted-foreground"> → </span>
                    <span className="font-semibold">{clientMap[r.client_id] ?? "—"}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Solicitado por {profileMap[r.requested_by] ?? "—"} · {new Date(r.created_at).toLocaleString("pt-BR")}
                  </p>
                  {r.notes && <p className="text-xs mt-1 italic">"{r.notes}"</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => decide(r.id, "rejeitado")}>
                    <X className="h-4 w-4 mr-1" />Rejeitar
                  </Button>
                  <Button size="sm" onClick={() => decide(r.id, "aprovado")}>
                    <Check className="h-4 w-4 mr-1" />Aprovar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Usuários e perfis</h2>
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.user_id} className="flex items-center gap-3 border rounded-lg p-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{u.full_name ?? u.email ?? u.user_id.slice(0, 8)}</p>
                {u.email && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
              </div>
              <Select value={u.role} onValueChange={(v) => changeRole(u.user_id, v as AppRole)}
                disabled={u.user_id === user.id}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["admin", "operador", "visualizador"] as AppRole[]).map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {users.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Nenhum usuário.</p>}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-3">O que cada perfil pode fazer</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(ROLE_ABILITIES) as AppRole[]).map(r => (
            <div key={r} className="border rounded-lg p-3">
              <p className="font-semibold mb-2">{ROLE_LABELS[r]}</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                {ROLE_ABILITIES[r].map((a, i) => <li key={i}>• {a}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      {history.length > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Histórico de solicitações</h2>
          <div className="space-y-1.5">
            {history.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-sm border-b pb-1.5 last:border-0">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  r.status === "aprovado" ? "bg-[oklch(0.65_0.18_150)]/15 text-[oklch(0.45_0.18_150)]"
                    : "bg-[oklch(0.65_0.2_30)]/15 text-[oklch(0.5_0.2_30)]"
                }`}>{r.status}</span>
                <span className="font-mono">{equipMap[r.equipment_id] ?? "—"}</span>
                <span className="text-muted-foreground">→</span>
                <span>{clientMap[r.client_id] ?? "—"}</span>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(r.created_at).toLocaleString("pt-BR")}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}