import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Globe, Calendar, HardDrive, Wrench, FileText, CalendarDays, Clock, Shield, LogOut, Menu, ChevronLeft, ChevronRight, Truck, CheckCircle2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { MaintenanceGovernanceAlert } from "./MaintenanceGovernanceAlert";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import logoBusato from "@/assets/logo-busato.png";
import logoGlobo from "@/assets/logo-globo.png";

const baseNav = [
  { to: "/cco", label: "CCO Central", icon: Globe },
  { to: "/usina-operacao", label: "Operação Usina", icon: Calendar },
  { to: "/porto-operacao", label: "Operação Porto", icon: CalendarDays },
  { to: "/operacao", label: "Operação", icon: HardDrive },
  { to: "/equipamentos", label: "Equipamentos", icon: Wrench },
  { to: "/manutencao", label: "Manutenção", icon: FileText },
  { to: "/fidelizacao", label: "Fidelização", icon: CalendarDays },
  { to: "/historico", label: "Histórico", icon: Clock },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isAdmin } = useRole();
  const navigate = useNavigate();
  const loc = useLocation();
  const nav = isAdmin
    ? [...baseNav, { to: "/acesso", label: "Acesso", icon: Shield }]
    : baseNav;

  const [releaseAlert, setReleaseAlert] = useState<{ open: boolean; identifier: string }>({ open: false, identifier: "" });
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("sidebar_collapsed") === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSetCollapsed = (value: boolean) => {
    setCollapsed(value);
    localStorage.setItem("sidebar_collapsed", String(value));
  };

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
    const playBankChime = () => {
      try {
        const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        const ctx = new Ctx();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const master = ctx.createGain();
        master.gain.value = 1.0;
        master.connect(ctx.destination);
        const playTone = (freq: number, start: number, dur: number) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "square";
          o.frequency.value = freq;
          o.connect(g); g.connect(master);
          const t = ctx.currentTime + start;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
          g.gain.setValueAtTime(0.9, t + dur - 0.05);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.start(t);
          o.stop(t + dur + 0.05);
        };
        playTone(1568, 0.0, 0.45);   // Sol5
        playTone(1175, 0.45, 0.6);   // Ré5
        playTone(1568, 1.2, 0.45);
        playTone(1175, 1.65, 0.7);
      } catch { /* ignore */ }
    };

    const channel = supabase
      .channel("equipment_release_notify")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "equipment" }, async (payload) => {
        const oldRow = payload.old as { status?: string } | null;
        const newRow = payload.new as { id: string; status: string; identifier?: string };
        if (oldRow?.status === "manutencao" && (newRow.status === "disponivel" || newRow.status === "operacional")) {
          let identifier = newRow.identifier;
          if (!identifier) {
            const { data } = await supabase.from("equipment").select("identifier").eq("id", newRow.id).maybeSingle();
            identifier = data?.identifier;
          }
          playBankChime();
          setReleaseAlert({ open: true, identifier: identifier ?? "Equipamento" });
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
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50/50">
      <MaintenanceGovernanceAlert />
      
      {/* SIDEBAR FOR DESKTOP */}
      <aside className={`hidden md:flex flex-col bg-[#0f172a] text-slate-300 border-r border-slate-800 transition-all duration-300 ${collapsed ? "w-20" : "w-64"}`}>
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60">
          {!collapsed ? (
            <>
              <Link to="/cco" className="flex items-center gap-2 overflow-hidden mr-2">
                <img src={logoBusato} alt="Busato" className="h-9 object-contain brightness-0 invert" />
              </Link>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => handleSetCollapsed(true)} 
                className="text-slate-500 hover:text-slate-100 hover:bg-slate-800/40 rounded-xl h-9 w-9 shrink-0"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 justify-center w-full">
              <Link to="/cco" className="mb-0.5">
                <img src={logoGlobo} alt="Busato" className="h-8 w-8 object-contain" />
              </Link>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => handleSetCollapsed(false)} 
                className="text-slate-500 hover:text-slate-100 hover:bg-slate-800/40 rounded-xl h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <nav className="flex-1 py-6 px-3 space-y-2.5 overflow-y-auto flex flex-col items-center">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = loc.pathname === n.to;
            return (
              <Link 
                key={n.to} 
                to={n.to}
                className={`flex items-center rounded-xl transition-all duration-200 ${
                  collapsed 
                    ? "justify-center h-12 w-12" 
                    : "w-full gap-3 px-4 py-3 text-xs"
                } font-black uppercase tracking-wider ${
                  active 
                    ? "bg-sky-500/15 text-sky-400 border border-sky-500/25" 
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
                }`}
                title={n.label}
              >
                <Icon className={`h-5 w-5 flex-shrink-0 ${active ? "text-sky-400" : "text-slate-400"}`} />
                {!collapsed && <span>{n.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800/60 w-full flex justify-center">
          <Button 
            variant="ghost" 
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}
            className={`w-full text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 rounded-xl justify-start ${collapsed ? "px-0 justify-center h-12 w-12" : "px-4 py-3"}`}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            {!collapsed && <span className="text-[10px] font-black uppercase tracking-wider ml-2">Sair</span>}
          </Button>
        </div>
      </aside>

      {/* HEADER FOR MOBILE */}
      <header className="md:hidden border-b bg-[#0f172a] text-white h-16 flex items-center justify-between px-4 border-slate-800">
        <Link to="/cco" className="flex items-center gap-2">
          <img src={logoBusato} alt="Busato" className="h-8 object-contain brightness-0 invert" />
        </Link>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setMobileOpen(!mobileOpen)} 
          className="text-white hover:bg-slate-800 h-9 w-9"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </header>

      {/* MOBILE DRAWER */}
      {mobileOpen && (
        <div className="md:hidden bg-[#0f172a] text-white border-b border-slate-800 p-4 space-y-2 animate-in slide-in-from-top duration-200">
          <nav className="space-y-1">
            {nav.map((n) => {
              const Icon = n.icon;
              const active = loc.pathname === n.to;
              return (
                <Link 
                  key={n.to} 
                  to={n.to}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-colors ${
                    active 
                      ? "bg-sky-500/15 text-sky-400 border border-sky-500/25" 
                      : "text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </nav>
          <Button 
            variant="ghost" 
            onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}
            className="w-full text-slate-400 hover:text-white hover:bg-slate-800 justify-start"
          >
            <LogOut className="h-4 w-4 mr-3" />
            <span className="text-xs font-black uppercase">Sair</span>
          </Button>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">{children}</main>
      </div>

      <Toaster />

      {/* Dialog release notify */}
      <AlertDialog open={releaseAlert.open} onOpenChange={(o) => setReleaseAlert((s) => ({ ...s, open: o }))}>
        <AlertDialogContent className="border-2 border-[oklch(0.65_0.18_150)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-2xl">
              <CheckCircle2 className="h-7 w-7 text-[oklch(0.65_0.18_150)]" />
              Equipamento Liberado
            </AlertDialogTitle>
            <AlertDialogDescription className="text-lg">
              <span className="font-bold text-foreground text-2xl block py-3">{releaseAlert.identifier}</span>
              saiu da manutenção e agora está <span className="font-semibold text-[oklch(0.65_0.18_150)]">DISPONÍVEL</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setReleaseAlert({ open: false, identifier: "" })}>
              OK, ciente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}