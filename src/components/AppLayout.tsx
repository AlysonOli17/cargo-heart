import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Globe, Calendar, HardDrive, Wrench, FileText, CalendarDays, Clock, Shield, LogOut, Menu, ChevronLeft, ChevronRight, Truck, CheckCircle2, User } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { MaintenanceGovernanceAlert } from "./MaintenanceGovernanceAlert";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import logoBusato from "@/assets/logo-busato.png";
import logoGlobo from "@/assets/logo-globo.png";

const menuGroups = [
  {
    title: "AGENDA & KANBAN",
    items: [
      { to: "/usina-operacao", label: "Operação Usina", icon: Calendar },
      { to: "/porto-operacao", label: "Operação Porto", icon: CalendarDays },
      { to: "/operacao", label: "Operação Geral", icon: HardDrive },
    ]
  },
  {
    title: "ACOMPANHAMENTO",
    items: [
      { to: "/cco", label: "CCO Central", icon: Globe },
      { to: "/historico", label: "Histórico", icon: Clock },
    ]
  },
  {
    title: "CADASTROS",
    isAccordion: true,
    id: "cadastros",
    icon: FileText,
    items: [
      { to: "/equipamentos", label: "Equipamentos", icon: Wrench },
      { to: "/pessoas", label: "Pessoas", icon: User },
    ]
  },
  {
    title: "CONTRATOS",
    items: [
      { to: "/fidelizacao", label: "Fidelização", icon: FileText },
    ]
  },
  {
    title: "MANUTENÇÃO",
    items: [
      { to: "/manutencao", label: "CCM Manutenção", icon: Wrench },
    ]
  }
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isAdmin } = useRole();
  const navigate = useNavigate();
  const loc = useLocation();
  const baseNav = menuGroups.flatMap(g => g.items);
  const nav = isAdmin
    ? [...baseNav, { to: "/acesso", label: "Acesso", icon: Shield }]
    : baseNav;

  const [releaseAlert, setReleaseAlert] = useState<{ open: boolean; identifier: string }>({ open: false, identifier: "" });
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("sidebar_collapsed") === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({ cadastros: true });

  const toggleAccordion = (id: string) => {
    setOpenAccordions(prev => ({ ...prev, [id]: !prev[id] }));
  };

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
      <aside className={`hidden md:flex flex-col bg-[#131b2c] text-slate-300 border-r border-[#1e293b] transition-all duration-300 h-screen sticky top-0 ${collapsed ? "w-20" : "w-[260px]"}`}>
        <div className="h-24 flex flex-col items-center justify-center border-b border-[#1e293b] shrink-0 pt-2">
          {!collapsed ? (
            <Link to="/cco" className="flex flex-col items-center gap-1 overflow-hidden w-full justify-center">
              <div className="flex items-center gap-3">
                <img src={logoGlobo} alt="Busato Globo" className="h-8 w-8 object-contain opacity-80" />
                <span className="text-2xl font-black tracking-[0.2em] text-slate-300">BUSATO</span>
              </div>
              <span className="text-[10px] font-black tracking-[0.3em] text-[#e28c33] ml-8 mt-1">LOCAÇÕES</span>
            </Link>
          ) : (
            <Link to="/cco" className="flex items-center justify-center">
              <img src={logoGlobo} alt="Busato" className="h-8 w-8 object-contain opacity-80" />
            </Link>
          )}
        </div>

        <nav className="flex-1 py-6 px-4 space-y-5 overflow-y-auto overflow-x-hidden custom-scrollbar">
          {menuGroups.map((group, idx) => {
            if (group.isAccordion) {
              const isOpen = openAccordions[group.id!] && !collapsed;
              const hasActiveChild = group.items.some(i => loc.pathname === i.to);
              return (
                <div key={idx} className="space-y-2">
                  {!collapsed && (
                    <button 
                      onClick={() => toggleAccordion(group.id!)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-all duration-200 ${
                        isOpen 
                          ? "bg-[#1c2438] border-slate-600/50 text-white shadow-sm" 
                          : hasActiveChild 
                            ? "bg-[#162032] border-indigo-500/30 text-indigo-100" 
                            : "bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#1a2333]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <group.icon className={`h-4 w-4 ${isOpen ? "text-indigo-400" : ""}`} />
                        <span className="text-[11px] font-black uppercase tracking-widest">{group.title}</span>
                      </div>
                      <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                    </button>
                  )}
                  {(isOpen || collapsed) && (
                    <div className={collapsed ? "space-y-2" : "pl-4 space-y-1 mt-1 relative"}>
                      {!collapsed && (
                        <div className="absolute left-[22px] top-2 bottom-2 w-px bg-slate-700/50"></div>
                      )}
                      {group.items.map(item => {
                        const active = loc.pathname === item.to;
                        return (
                          <Link 
                            key={item.to} 
                            to={item.to}
                            className={`flex items-center rounded-lg transition-all duration-200 ${
                              collapsed 
                                ? "justify-center h-12 w-12 mx-auto" 
                                : "w-full gap-3 px-3 py-2 text-[13px] relative"
                            } font-bold ${
                              active 
                                ? "bg-[#1b253b] text-blue-400" 
                                : "text-slate-400 hover:text-slate-200 hover:bg-[#1a2333]"
                            }`}
                            title={collapsed ? item.label : undefined}
                          >
                            {!collapsed && active && (
                              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2/3 bg-blue-500 rounded-r-md shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                            )}
                            <item.icon className={`h-4 w-4 flex-shrink-0 ${active ? "text-blue-400" : "text-slate-400"}`} />
                            {!collapsed && <span>{item.label}</span>}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={idx} className="space-y-2">
                {!collapsed && (
                  <h3 className="px-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500/70 mb-1">
                    {group.title}
                  </h3>
                )}
                {group.items.map(item => {
                  const active = loc.pathname === item.to;
                  return (
                    <Link 
                      key={item.to} 
                      to={item.to}
                      className={`flex items-center rounded-lg transition-all duration-200 ${
                        collapsed 
                          ? "justify-center h-12 w-12 mx-auto" 
                          : "w-full gap-3 px-3 py-2.5 text-[13px] relative"
                      } font-bold uppercase tracking-wider ${
                        active 
                          ? "bg-[#1b253b] text-blue-400" 
                          : "text-slate-400 hover:text-slate-200 hover:bg-[#1a2333]"
                      }`}
                      title={collapsed ? item.label : undefined}
                    >
                      {!collapsed && active && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2/3 bg-blue-500 rounded-r-md shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                      )}
                      <item.icon className={`h-[18px] w-[18px] flex-shrink-0 ${active ? "text-blue-400" : "text-slate-500"}`} />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
          
          {isAdmin && (
            <div className="space-y-2 pt-4 border-t border-[#1e293b]">
              {!collapsed && (
                <h3 className="px-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500/70 mb-1">
                  ADMINISTRAÇÃO
                </h3>
              )}
              <Link 
                to="/acesso"
                className={`flex items-center rounded-lg transition-all duration-200 ${
                  collapsed 
                    ? "justify-center h-12 w-12 mx-auto" 
                    : "w-full gap-3 px-3 py-2.5 text-[13px] relative"
                } font-bold uppercase tracking-wider ${
                  loc.pathname === "/acesso" 
                    ? "bg-[#1b253b] text-blue-400" 
                    : "text-slate-400 hover:text-slate-200 hover:bg-[#1a2333]"
                }`}
                title={collapsed ? "Acesso" : undefined}
              >
                {!collapsed && loc.pathname === "/acesso" && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2/3 bg-blue-500 rounded-r-md shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                )}
                <Shield className={`h-[18px] w-[18px] flex-shrink-0 ${loc.pathname === "/acesso" ? "text-blue-400" : "text-slate-500"}`} />
                {!collapsed && <span>Acesso</span>}
              </Link>
            </div>
          )}
        </nav>

        <div className="border-t border-[#1e293b] w-full shrink-0 flex flex-col">
          {!collapsed && (
            <div className="p-4 flex items-center gap-3 border-b border-[#1e293b]/50">
              <div className="h-9 w-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-inner">
                {user?.email?.[0].toUpperCase() || "U"}
              </div>
              <div className="flex flex-col min-w-0 overflow-hidden">
                <span className="text-sm font-bold text-slate-200 truncate">{user?.email?.split('@')[0]}</span>
                <span className="text-[10px] font-bold text-slate-500">{isAdmin ? "Administrador" : "Usuário"}</span>
              </div>
            </div>
          )}
          <div className="flex w-full">
            <Button 
              variant="ghost" 
              onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}
              className={`flex-1 text-slate-400 hover:text-red-400 hover:bg-red-950/20 rounded-none justify-center h-12 ${collapsed ? "px-0" : "px-4"}`}
              title="Sair do sistema"
            >
              <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
              {!collapsed && <span className="text-[11px] font-black uppercase tracking-wider ml-2">Sair</span>}
            </Button>
            
            <Button 
              variant="ghost" 
              onClick={() => handleSetCollapsed(!collapsed)}
              className={`w-12 border-l border-[#1e293b] text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 rounded-none justify-center h-12`}
              title={collapsed ? "Expandir menu" : "Recolher menu"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>
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
                      ? "bg-primary/20 text-primary border border-primary/30" 
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