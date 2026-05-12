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
import { format } from "date-fns";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "CCO Dashboard — Frota Busato" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; status: EquipmentStatus;
  maintenance_problem: string | null; maintenance_expected_return: string | null;
};

type Programming = {
  equipment_id: string;
  stop_type: string;
};

function Dashboard() {
  const [items, setItems] = useState<Equipment[]>([]);
  const [todayProgramming, setTodayProgramming] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    const today = format(new Date(), "yyyy-MM-dd");
    const [{ data: eqs }, { data: prog }] = await Promise.all([
      supabase.from("equipment").select("*").order("identifier"),
      supabase.from("programming")
        .select("equipment_id, stop_type")
        .eq("scheduled_date", today)
        .eq("is_completed", false)
    ]);

    setItems(eqs ?? []);
    
    // Mapeia agendamentos de hoje para consulta rápida
    const progMap: Record<string, string> = {};
    (prog ?? []).forEach(p => { progMap[p.equipment_id] = p.stop_type; });
    setTodayProgramming(progMap);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("dashboard-v13")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "programming" }, load)
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

  const stats = useMemo(() => ({
    total: items.length,
    operacional: items.filter(e => !todayProgramming[e.id] && (e.status === 'operacional' || e.status === 'disponivel')).length,
    manutencao: items.filter(e => !!todayProgramming[e.id] || e.status === 'manutencao' || e.status === 'indisponivel').length,
    preventiva: items.filter(e => e.status === 'programado').length,
  }), [items, todayProgramming]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div><h1 className="text-3xl font-black uppercase tracking-tighter text-foreground/90">Central de Comando (CCO)</h1><p className="text-muted-foreground font-medium italic">Status em Tempo Real da Frota</p></div>
        <div className="flex items-center gap-2">
           <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar placa..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-48 rounded-xl h-10 border-none bg-muted/50" /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI card={{ label: "Total Frota", val: stats.total, icon: Truck, color: "bg-slate-900 text-white border-slate-800" }} />
        <KPI card={{ label: "Operacional Hoje", val: stats.operacional, icon: CheckCircle2, color: "bg-[#10b981] text-white border-[#059669]" }} />
        <KPI card={{ label: "Indisponível Hoje", val: stats.manutencao, icon: Wrench, color: "bg-[#ef4444] text-white border-[#dc2626]" }} />
        <KPI card={{ label: "Preventivas", val: stats.preventiva, icon: AlertTriangle, color: "bg-[#f59e0b] text-white border-[#d97706]" }} />
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
                     <div><h3 className="font-mono font-black text-xl leading-none uppercase group-hover:text-primary transition-colors">{e.identifier}</h3><p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase">{e.type}</p></div>
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
                              <span className="text-[11px] font-black text-blue-800">{new Date(e.maintenance_expected_return).toLocaleDateString('pt-BR')}</span>
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

function KPI({ card }: { card: any }) {
  const Icon = card.icon;
  return (
    <Card className={cn("border-b-4 shadow-md transition-transform hover:scale-[1.02]", card.color)}>
      <CardContent className="p-5 flex items-center justify-between">
        <div><p className="text-[10px] font-black uppercase opacity-80 mb-1">{card.label}</p><h2 className="text-4xl font-black tracking-tighter">{card.val}</h2></div>
        <Icon className="h-10 w-10 opacity-30" />
      </CardContent>
    </Card>
  );
}

function cn(...classes: any[]) { return classes.filter(Boolean).join(" "); }
