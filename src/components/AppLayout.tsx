import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Wrench, LogOut, Truck, Activity, Shield, History, CheckCircle2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

const baseNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/operacao", label: "Operação", icon: Activity },
  { to: "/equipamentos", label: "Equipamentos", icon: Wrench },
  { to: "/manutencao", label: "Manutenção", icon: Wrench },
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

  // Notify when equipment leaves manutencao -> disponivel
  useEffect(() => {
    if (!user) return;
    const playBeep = () => {
      try {
        const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        const ctx = new Ctx();
        const playTone = (freq: number, start: number, dur: number) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine"; o.frequency.value = freq;
          o.connect(g); g.connect(ctx.destination);
          g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
          g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
          o.start(ctx.currentTime + start);
          o.stop(ctx.currentTime + start + dur + 0.05);
        };
        playTone(880, 0, 0.18);
        playTone(1320, 0.2, 0.25);
      } catch { /* ignore */ }
    };

    const channel = supabase
      .channel("equipment_release_notify")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "equipment" }, async (payload) => {
        const oldRow = payload.old as { status?: string } | null;
        const newRow = payload.new as { id: string; status: string; identifier?: string };
        if (oldRow?.status === "manutencao" && newRow.status === "disponivel") {
          let identifier = newRow.identifier;
          if (!identifier) {
            const { data } = await supabase.from("equipment").select("identifier").eq("id", newRow.id).maybeSingle();
            identifier = data?.identifier;
          }
          playBeep();
          toast.success("Equipamento liberado da manutenção", {
            description: `${identifier ?? "Equipamento"} agora está DISPONÍVEL`,
            duration: 10000,
            icon: <CheckCircle2 className="h-5 w-5 text-[oklch(0.65_0.18_150)]" />,
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

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