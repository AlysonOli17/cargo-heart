import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { LayoutDashboard, Truck, Wrench, AlertTriangle, CheckCircle2, Search, Filter, Hourglass } from "lucide-react";
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "CCO Dashboard — Frota Busato" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; status: EquipmentStatus;
  maintenance_problem: string | null; maintenance_expected_return: string | null;
};

function Dashboard() {
  const [items, setItems] = useState<Equipment[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    const { data } = await supabase.from("equipment").select("*").order("identifier");
    setItems(data ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("dashboard").on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    return items.filter(e => {
      const matchSearch = e.identifier.toLowerCase().includes(search.toLowerCase()) || (e.type || "").toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || e.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [items, search, statusFilter]);

  const stats = useMemo(() => ({
    total: items.length,
    operacional: items.filter(e => e.status === 'operacional').length,
    manutencao: items.filter(e => e.status === 'manutencao' || e.status === 'indisponivel').length,
    preventiva: items.filter(e => e.status === 'programado').length,
  }), [items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div><h1 className="text-3xl font-black uppercase tracking-tighter">Central de Comando (CCO)</h1><p className="text-muted-foreground font-medium italic">Status em Tempo Real da Frota</p></div>
        <div className="flex items-center gap-2">
           <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar placa..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-48 rounded-xl h-10 border-none bg-muted/50" /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI card={{ label: "Total Frota", val: stats.total, icon: Truck, color: "bg-slate-50 border-slate-200 text-slate-700" }} />
        <KPI card={{ label: "Em Operação", val: stats.operacional, icon: CheckCircle2, color: "bg-emerald-50 border-emerald-200 text-emerald-700" }} />
        <KPI card={{ label: "Na Oficina", val: stats.manutencao, icon: Wrench, color: "bg-orange-50 border-orange-200 text-orange-700" }} />
        <KPI card={{ label: "Preventivas", val: stats.preventiva, icon: AlertTriangle, color: "bg-amber-50 border-amber-200 text-amber-700" }} />
      </div>

      <Tabs defaultValue="all" onValueChange={setStatusFilter}>
        <TabsList className="bg-muted/50 p-1 h-12 rounded-xl">
          <TabsTrigger value="all" className="font-bold text-[10px] uppercase">Tudo</TabsTrigger>
          <TabsTrigger value="operacional" className="font-bold text-[10px] uppercase">Operacional</TabsTrigger>
          <TabsTrigger value="manutencao" className="font-bold text-[10px] uppercase">Oficina</TabsTrigger>
          <TabsTrigger value="programado" className="font-bold text-[10px] uppercase">Preventiva</TabsTrigger>
        </TabsList>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {filtered.map(e => (
            <Card key={e.id} className="overflow-hidden border-2 shadow-sm hover:border-primary/20 transition-all">
              <div className="h-2" style={{ backgroundColor: `var(--${e.status})` }} />
              <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                   <div><h3 className="font-mono font-black text-xl leading-none uppercase">{e.identifier}</h3><p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase">{e.type}</p></div>
                   <Badge className="text-[9px] font-black uppercase" style={{ backgroundColor: `var(--${e.status})` }}>{STATUS_LABELS[e.status]}</Badge>
                </div>

                {(e.status === 'manutencao' || e.status === 'indisponivel') && (
                  <div className="space-y-2 pt-1">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase leading-tight bg-muted/50 p-1.5 rounded line-clamp-2 min-h-[2.5rem]">Defeito: {e.maintenance_problem || 'Não relatado'}</p>
                    {e.maintenance_expected_return && (
                       <div className="flex items-center gap-1.5 bg-orange-100/50 p-1.5 rounded-lg border border-orange-200">
                          <Hourglass className="h-3.5 w-3.5 text-orange-600 animate-pulse" />
                          <div className="flex flex-col">
                            <span className="text-[8px] font-black text-orange-700 uppercase leading-none">Previsão Retorno</span>
                            <span className="text-[11px] font-black text-orange-800">{new Date(e.maintenance_expected_return).toLocaleDateString('pt-BR')}</span>
                          </div>
                       </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </Tabs>
    </div>
  );
}

function KPI({ card }: { card: any }) {
  const Icon = card.icon;
  return (
    <Card className={cn("border-2 shadow-sm", card.color)}>
      <CardContent className="p-4 flex items-center justify-between">
        <div><p className="text-[10px] font-black uppercase opacity-60">{card.label}</p><h2 className="text-3xl font-black">{card.val}</h2></div>
        <Icon className="h-8 w-8 opacity-20" />
      </CardContent>
    </Card>
  );
}

function cn(...classes: any[]) { return classes.filter(Boolean).join(" "); }
