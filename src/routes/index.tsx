import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, type EquipmentStatus } from "@/lib/equipment";
import { Wrench, CheckCircle2, AlertTriangle, Timer, PieChart, Activity, ShieldAlert, Truck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "CCO Dashboard — Gestão de Frota Busato" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; brand: string | null; model: string | null;
  status: EquipmentStatus; 
  sub_status: string | null;
  maintenance_priority: string | null;
  technical_category: string | null;
  is_preventive_overdue: boolean;
  maintenance_started_at: string | null;
  maintenance_expected_return: string | null;
};

function Dashboard() {
  const { user } = useAuth();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data: e } = await supabase.from("equipment")
      .select("*")
      .order("identifier");
    setEquipment((e ?? []) as Equipment[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("dashboard-ccm")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  // Indicadores (KPIs)
  const stats = useMemo(() => {
    const total = equipment.length;
    if (total === 0) return { availability: 0, maintenance: 0, critical: 0, preventive: 0 };
    
    // Filtro expandido para operacional
    const operational = equipment.filter(e => ['operacional', 'disponivel', 'com_cliente'].includes(e.status)).length;
    const maintenance = equipment.filter(e => ['manutencao', 'indisponivel', 'finalizacao', 'programado'].includes(e.status)).length;
    const critical = equipment.filter(e => e.maintenance_priority === 'Crítica').length;
    const preventive = equipment.filter(e => e.is_preventive_overdue).length;

    return {
      availability: Math.round((operational / total) * 100),
      maintenance,
      critical,
      preventive
    };
  }, [equipment]);

  if (loading) return <div className="p-10 text-center animate-pulse">Carregando CCO...</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      {/* Header com Indicadores Rápidos */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase">Disponibilidade</p>
              <h3 className="text-2xl font-black">{stats.availability}%</h3>
            </div>
            <Activity className="h-8 w-8 text-primary opacity-50" />
          </CardContent>
          <div className="px-4 pb-4">
            <Progress value={stats.availability} className="h-1" />
          </div>
        </Card>

        <Card className="bg-orange-50 border-orange-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-orange-600 uppercase">Em Manutenção</p>
              <h3 className="text-2xl font-black text-orange-700">{stats.maintenance}</h3>
            </div>
            <Wrench className="h-8 w-8 text-orange-500 opacity-50" />
          </CardContent>
        </Card>

        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-red-600 uppercase">Críticos / Parados</p>
              <h3 className="text-2xl font-black text-red-700">{stats.critical}</h3>
            </div>
            <ShieldAlert className="h-8 w-8 text-red-500 opacity-50" />
          </CardContent>
        </Card>

        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-amber-600 uppercase">Preventivas Vencidas</p>
              <h3 className="text-2xl font-black text-amber-700">{stats.preventive}</h3>
            </div>
            <Timer className="h-8 w-8 text-amber-500 opacity-50" />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="operacional" className="w-full">
        <TabsList className="grid grid-cols-4 w-full h-12 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="operacional" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Truck className="h-4 w-4 mr-2" /> Operacional
          </TabsTrigger>
          <TabsTrigger value="oficina" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Wrench className="h-4 w-4 mr-2" /> Oficina
          </TabsTrigger>
          <TabsTrigger value="preventivas" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Timer className="h-4 w-4 mr-2" /> Preventivas
          </TabsTrigger>
          <TabsTrigger value="indicadores" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <PieChart className="h-4 w-4 mr-2" /> Indicadores
          </TabsTrigger>
        </TabsList>

        {/* ABA OPERACIONAL: Incluindo com_cliente e disponivel */}
        <TabsContent value="operacional" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {equipment
              .filter(e => ['operacional', 'disponivel', 'com_cliente'].includes(e.status))
              .map(e => (
                <EquipmentCard key={e.id} e={e} />
              ))}
          </div>
        </TabsContent>

        {/* ABA OFICINA */}
        <TabsContent value="oficina" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {equipment
              .filter(e => ['manutencao', 'indisponivel', 'finalizacao'].includes(e.status))
              .map(e => (
                <EquipmentCard key={e.id} e={e} />
              ))}
          </div>
        </TabsContent>

        {/* ABA PREVENTIVAS */}
        <TabsContent value="preventivas" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {equipment
              .filter(e => e.status === 'programado' || e.is_preventive_overdue)
              .map(e => (
                <EquipmentCard key={e.id} e={e} />
              ))}
          </div>
        </TabsContent>

        {/* ABA INDICADORES */}
        <TabsContent value="indicadores" className="mt-6">
          <Card>
            <CardHeader><CardTitle>Visão Geral de Frota</CardTitle></CardHeader>
            <CardContent className="h-[400px] flex items-center justify-center text-muted-foreground border-2 border-dashed m-6 rounded-xl">
               Gráficos de reincidência e categorias em desenvolvimento...
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EquipmentCard({ e }: { e: Equipment }) {
  const colorClass = STATUS_COLORS[e.status] || "bg-muted";
  const priorityClass = PRIORITY_COLORS[e.maintenance_priority as keyof typeof PRIORITY_COLORS] || "bg-slate-100";

  return (
    <Card className="overflow-hidden border-2 hover:border-primary/30 transition-all group">
      <div className={`h-1.5 ${colorClass.split(' ')[0]}`} />
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <h4 className="font-black text-lg tracking-tighter">{e.identifier}</h4>
            <p className="text-[10px] font-bold text-muted-foreground uppercase">{e.type || 'Sem tipo'}</p>
          </div>
          <Badge className={`${colorClass} border-none text-[9px] font-black uppercase tracking-widest`}>
            {STATUS_LABELS[e.status]}
          </Badge>
        </div>

        {e.sub_status && (
          <div className="bg-muted/50 p-2 rounded-lg border border-dashed text-xs font-medium flex items-center gap-2">
             <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
             {e.sub_status}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t mt-2">
          {e.maintenance_priority && (
            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${priorityClass}`}>
              {e.maintenance_priority}
            </span>
          )}
          {e.technical_category && (
            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase bg-slate-800 text-white">
              {e.technical_category}
            </span>
          )}
          {e.is_preventive_overdue && (
            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase bg-red-600 text-white animate-bounce">
              Preventiva Vencida
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
