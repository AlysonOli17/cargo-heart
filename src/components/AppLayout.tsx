import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Wrench, LogOut, Truck, Activity, Shield, History } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

const baseNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/operacao", label: "Operação", icon: Activity },
  { to: "/equipamentos", label: "Equipamentos", icon: Wrench },
  { to: "/historico", label: "Histórico", icon: History },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isAdmin } = useRole();
  const navigate = useNavigate();
  const loc = useLocation();
  const nav = isAdmin
    ? [...baseNav, { to: "/acesso", label: "Acesso", icon: Shield }]
    : baseNav;

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    const shown = new Set<string>();

    const notify = async (reqId: string) => {
      if (shown.has(reqId)) return;
      shown.add(reqId);
      const { data: req } = await supabase
        .from("equipment_requests")
        .select("id,status,equipment_id,client_id,is_replacement,replacement_plate")
        .eq("id", reqId)
        .maybeSingle();
      if (!req || req.status !== "pendente") return;
      const [{ data: eq }, { data: cli }] = await Promise.all([
        supabase.from("equipment").select("identifier").eq("id", req.equipment_id).maybeSingle(),
        supabase.from("clients").select("name").eq("id", req.client_id).maybeSingle(),
      ]);
      const desc = `${eq?.identifier ?? "Equip."} → ${cli?.name ?? "Cliente"}${req.is_replacement ? ` (substitui ${req.replacement_plate ?? "?"})` : ""}`;
      toast("Nova solicitação de equipamento", {
        id: reqId,
        description: desc,
        duration: Infinity,
        action: {
          label: "Aprovar",
          onClick: async () => {
            const { error } = await supabase
              .from("equipment_requests")
              .update({ status: "aprovado", decided_by: user.id })
              .eq("id", reqId);
            if (error) toast.error(error.message);
            else toast.success("Solicitação aprovada");
          },
        },
        cancel: {
          label: "Rejeitar",
          onClick: async () => {
            const { error } = await supabase
              .from("equipment_requests")
              .update({ status: "rejeitado", decided_by: user.id })
              .eq("id", reqId);
            if (error) toast.error(error.message);
            else toast.message("Solicitação rejeitada");
          },
        },
      });
    };

    supabase
      .from("equipment_requests")
      .select("id")
      .eq("status", "pendente")
      .then(({ data }) => data?.forEach((r: { id: string }) => notify(r.id)));

    const channel = supabase
      .channel("equipment_requests_admin")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "equipment_requests" }, (payload) => {
        const row = payload.new as { id: string; status: string };
        if (row.status === "pendente") notify(row.id);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "equipment_requests" }, (payload) => {
        const row = payload.new as { id: string; status: string };
        if (row.status !== "pendente") {
          toast.dismiss(row.id);
          shown.delete(row.id);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, isAdmin]);

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Truck className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg">FrotaPro</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {nav.map((n) => {
              const Icon = n.icon;
              const active = loc.pathname === n.to;
              return (
                <Link key={n.to} to={n.to}
                  className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>
                  <Icon className="h-4 w-4" />{n.label}
                </Link>
              );
            })}
          </nav>
          <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}>
            <LogOut className="h-4 w-4 mr-2" />Sair
          </Button>
        </div>
        <nav className="md:hidden border-t flex">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = loc.pathname === n.to;
            return (
              <Link key={n.to} to={n.to}
                className={`flex-1 py-3 text-xs font-medium flex flex-col items-center gap-1 ${active ? "text-primary" : "text-muted-foreground"}`}>
                <Icon className="h-4 w-4" />{n.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 container mx-auto px-4 py-6">{children}</main>
      <Toaster />
    </div>
  );
}