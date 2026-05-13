import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { LayoutDashboard, Truck, Wrench, AlertTriangle, CheckCircle2, Search, Filter, Hourglass, Calendar } from "lucide-react";
import { STATUS_LABELS, type EquipmentStatus } from "@/lib/equipment";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "CCO Dashboard — Frota Busato" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; status: EquipmentStatus;
  maintenance_problem: string | null; maintenance_expected_return: string | null; contract_type: string | null;
  maintenance_started_at: string | null;
};

type Programming = {
  equipment_id: string;
  stop_type: string;
};

type LiveMovement = {
  id: string;
  created_at: string;
  to_status: EquipmentStatus;
  notes: string | null;
  equipment: { identifier: string; type: string | null };
};

function Dashboard() {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const d = dateStr.includes("T") ? new Date(dateStr) : new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString('pt-BR');
  };

  const [items, setItems] = useState<Equipment[]>([]);
  const [todayProgramming, setTodayProgramming] = useState<Record<string, string>>({});
  const [movements, setMovements] = useState<LiveMovement[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    const today = format(new Date(), "yyyy-MM-dd");
    const [{ data: eqs }, { data: prog }, { data: movs }] = await Promise.all([
      supabase.from("equipment").select("*").order("identifier"),
      supabase.from("programming")
        .select("equipment_id, stop_type")
        .eq("scheduled_date", today)
        .eq("is_completed", false),
      supabase.from("movements")
        .select(`
          id, created_at, to_status, notes,
          equipment ( identifier, type )
        `)
        .order("created_at", { ascending: false })
        .limit(10)
    ]);

    setItems(eqs ?? []);
    setMovements((movs as any) ?? []);
    
    // Mapeia agendamentos de hoje para consulta rápida
    const progMap: Record<string, string> = {};
    (prog ?? []).forEach(p => { progMap[p.equipment_id] = p.stop_type; });
    setTodayProgramming(progMap);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("dashboard-v14")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "programming" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "movements" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const getStatusColor = (status: string, hasProgToday: boolean) => {
    if (hasProgToday) return '#ef4444'; // Sempre vermelho se tiver agendamento hoje
    if (status === 'operacional' || status === 'disponivel') return '#10b981'; // Verde
    if (status === 'programado') return '#f59e0b'; // Amarelo
    return '#ef4444'; // Vermelho
  };

  const filtered = useMemo(() => {
    return items.filter(e => {
      const matchSearch = e.identifier.toLowerCase().includes(search.toLowerCase()) || (e.type || "").toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || 
                        (statusFilter === "operacional" && (e.status === "operacional" || e.status === "disponivel")) ||
                        (statusFilter === "manutencao" && (e.status === "manutencao" || e.status === "indisponivel")) ||
                        e.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [items, search, statusFilter]);

  const stats = useMemo(() => {
    const getStats = (contract: string) => {
      const filtered = items.filter(e => e.contract_type === contract);
      return {
        total: filtered.length,
        op: filtered.filter(e => (e.status === 'operacional' || e.status === 'disponivel') && !todayProgramming[e.id]).length,
        of: filtered.filter(e => e.status === 'manutencao' || e.status === 'indisponivel' || !!todayProgramming[e.id]).length
      };
    };

    return {
      usina: getStats("Usina"),
      porto: getStats("Porto"),
      eventual: getStats("Eventual"),
      total: items.length
    };
  }, [items, todayProgramming]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div><h1 className="text-3xl font-black uppercase tracking-tighter text-foreground/90">Central de Comando (CCO)</h1><p className="text-muted-foreground font-medium italic">Status em Tempo Real da Frota</p></div>
        <div className="flex items-center gap-2">
           <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar placa..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-48 rounded-xl h-10 border-none bg-muted/50" /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ContractKPI label="USINA" stats={stats.usina} color="blue" />
        <ContractKPI label="PORTO" stats={stats.porto} color="grey" />
        <ContractKPI label="EVENTUAL" stats={stats.eventual} color="dark" />
      </div>

      <div className="bg-slate-950 rounded-xl border-2 border-slate-900 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-1000">
        <div className="bg-slate-900 px-4 py-2 flex items-center justify-between border-b border-slate-800">
           <div className="flex items-center gap-2">
             <div className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
             <h2 className="text-slate-100 font-black tracking-widest text-[10px] uppercase italic">Painel de Operações em Tempo Real</h2>
           </div>
           <span className="text-slate-500 font-mono text-[9px] uppercase">Terminal Logístico Busato</span>
        </div>
        <div className="p-0 overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
             <thead>
               <tr className="bg-slate-900/50 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                 <th className="px-4 py-2">Horário</th>
                 <th className="px-4 py-2">Placa / Equipamento</th>
                 <th className="px-4 py-2">Movimentação / Status</th>
                 <th className="px-4 py-2">Detalhes / Observação</th>
                 <th className="px-4 py-2 text-right">Status do Vôo</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-900">
               {movements.length === 0 && (
                 <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-700 font-bold italic uppercase tracking-tighter">Nenhuma movimentação registrada nas últimas horas</td></tr>
               )}
               {movements.map(m => (
                 <tr key={m.id} className="hover:bg-slate-900/40 transition-colors group border-b border-slate-900/50">
                    <td className="px-4 py-3 font-mono text-amber-500 font-black text-xs">{format(new Date(m.created_at), "HH:mm")}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-slate-100 font-black text-sm leading-none tracking-tighter uppercase">{m.equipment?.identifier}</span>
                        <span className="text-slate-500 font-bold text-[8px] uppercase mt-0.5">{m.equipment?.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                       <div className="flex items-center gap-1.5">
                         {m.to_status === 'operacional' || m.to_status === 'disponivel' ? (
                           <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                         ) : (
                           <Wrench className="h-3 w-3 text-red-500" />
                         )}
                         <span className={cn(
                           "font-black text-[10px] uppercase italic tracking-tight",
                           m.to_status === 'operacional' || m.to_status === 'disponivel' ? "text-emerald-400" : "text-red-400"
                         )}>
                           {m.to_status === 'operacional' || m.to_status === 'disponivel' ? "Liberado p/ Operação" : "Entrada em Oficina"}
                         </span>
                       </div>
                    </td>
                    <td className="px-4 py-3">
                       <p className="text-slate-400 text-[9px] font-medium italic max-w-[200px] truncate">{m.notes || "Movimentação padrão"}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                       <span className={cn(
                         "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest",
                         m.to_status === 'operacional' || m.to_status === 'disponivel' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"
                       )}>
                         {m.to_status === 'operacional' || m.to_status === 'disponivel' ? "EM OPERAÇÃO" : "EM OFICINA"}
                       </span>
                    </td>
                 </tr>
               ))}
             </tbody>
          </table>
        </div>
      </div>

      <Tabs defaultValue="all" onValueChange={setStatusFilter}>
        <TabsList className="bg-muted/50 p-1 h-12 rounded-xl">
          <TabsTrigger value="all" className="font-bold text-[10px] uppercase px-6">Tudo</TabsTrigger>
          <TabsTrigger value="operacional" className="font-bold text-[10px] uppercase px-6">Operacional</TabsTrigger>
          <TabsTrigger value="manutencao" className="font-bold text-[10px] uppercase px-6">Oficina / Indisponível</TabsTrigger>
          <TabsTrigger value="programado" className="font-bold text-[10px] uppercase px-6">Preventiva</TabsTrigger>
        </TabsList>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {filtered.map(e => {
            const hasProgToday = !!todayProgramming[e.id];
            const progType = todayProgramming[e.id];
            
            return (
              <Card key={e.id} className="overflow-hidden border-2 shadow-sm hover:border-primary/40 transition-all group relative">
                <div className="h-2" style={{ backgroundColor: getStatusColor(e.status, hasProgToday) }} />
                <CardContent className="p-4 space-y-3">
                  <div className="flex justify-between items-start">
                     <div>
                        <h3 className="font-mono font-black text-xl leading-none uppercase group-hover:text-primary transition-colors">{e.identifier}</h3>
                        <p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase">{e.type}</p>
                        {e.contract_type && (
                          <p className="text-[10px] font-black text-primary/80 uppercase mt-0.5 tracking-tighter">CONTRATO: {e.contract_type}</p>
                        )}
                      </div>
                     <Badge className="text-[9px] font-black uppercase text-white border-none" style={{ backgroundColor: getStatusColor(e.status, hasProgToday) }}>
                       {hasProgToday ? `AGENDADO: ${progType}` : STATUS_LABELS[e.status]}
                     </Badge>
                  </div>

                  {hasProgToday && (
                    <div className="bg-red-50 border border-red-200 p-2 rounded-lg flex items-center gap-2">
                       <Calendar className="h-4 w-4 text-red-600 animate-bounce" />
                       <div>
                         <p className="text-[8px] font-black text-red-700 uppercase leading-none">Indisponível Hoje</p>
                         <p className="text-xs font-black text-red-800">Parada para: {progType}</p>
                       </div>
                    </div>
                  )}

                  {(e.status === 'manutencao' || e.status === 'indisponivel') && !hasProgToday && (
                    <div className="space-y-2 pt-1">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase leading-tight bg-muted/50 p-1.5 rounded line-clamp-2 min-h-[2.5rem]">Defeito: {e.maintenance_problem || 'Não relatado'}</p>
                      {e.maintenance_expected_return && (
                         <div className="flex items-center gap-1.5 bg-blue-50 p-1.5 rounded-lg border border-blue-200">
                            <Hourglass className="h-3.5 w-3.5 text-blue-600 animate-pulse" />
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black text-blue-700 uppercase leading-none">Previsão Retorno</span>
                              <span className="text-[11px] font-black text-blue-800">{formatDate(e.maintenance_expected_return)}</span>
                            </div>
                         </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </Tabs>
    </div>
  );
}

function ContractKPI({ label, stats, color }: { label: string; stats: any; color: "blue" | "grey" | "dark" }) {
  const colors = {
    blue: "from-[#2980B9] to-[#1F618D] shadow-blue-500/10 border-[#2980B9]/20",
    grey: "from-[#7F8C8D] to-[#616A6B] shadow-slate-500/10 border-[#7F8C8D]/20",
    dark: "from-slate-700 to-slate-800 shadow-slate-900/10 border-slate-600/20"
  };

  return (
    <Card className={cn("relative overflow-hidden border-2 bg-gradient-to-br shadow-md transition-all hover:scale-[1.01]", colors[color])}>
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-white/80 font-black tracking-widest text-[9px] uppercase">{label}</h3>
          <Truck className="h-4 w-4 text-white/30" />
        </div>
        <div className="flex items-baseline gap-1.5 mb-3">
          <span className="text-3xl font-black text-white tracking-tighter leading-none">{stats.total}</span>
          <span className="text-white/70 font-bold text-[9px] uppercase tracking-widest">Máquinas</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-white/10 rounded p-1.5 border border-white/10">
             <p className="text-white/50 text-[7px] font-black uppercase leading-none mb-0.5">Operacional</p>
             <p className="text-emerald-300 font-black text-sm leading-none">{stats.op}</p>
          </div>
          <div className="bg-white/10 rounded p-1.5 border border-white/10">
             <p className="text-white/50 text-[7px] font-black uppercase leading-none mb-0.5">Em Oficina</p>
             <p className="text-red-300 font-black text-sm leading-none">{stats.of}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KPI({ card }: { card: { label: string; val: number; icon: any; color: string } }) {
  return (
    <Card className={cn("overflow-hidden border-2 shadow-sm transition-all hover:shadow-md", card.color)}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className="p-3 bg-white/10 rounded-xl">
           <card.icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-80">{card.label}</p>
          <p className="text-3xl font-black">{card.val}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function cn(...classes: any[]) { return classes.filter(Boolean).join(" "); }
