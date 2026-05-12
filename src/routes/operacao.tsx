import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button"; // Corrigido: Importação do Button adicionada
import { LayoutDashboard, Clock, Truck, Wrench, Trash2, CheckCircle2, AlertCircle, Calendar as CalendarIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { format, addDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/operacao")({
  head: () => ({ meta: [{ title: "Monitoramento de Agendamentos — Frota Busato" }] }),
  component: () => <AppLayout><OperationPlanningPage /></AppLayout>,
});

type Programming = {
  id: string; scheduled_date: string; stop_type: string; notes: string | null;
  equipment: { identifier: string; type: string };
};

function OperationPlanningPage() {
  const { user } = useAuth();
  const [programming, setProgramming] = useState<Programming[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);

  // Gera os próximos 7 dias para as abas
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const d = addDays(new Date(), i);
      return {
        dateStr: format(d, "yyyy-MM-dd"),
        label: format(d, "EEE", { locale: ptBR }), // Seg, Ter...
        fullLabel: format(d, "dd/MM (EEEE)", { locale: ptBR })
      };
    });
  }, []);

  const load = async () => {
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from("programming").select("*, equipment:equipment_id(identifier, type)").eq("is_completed", false),
      supabase.from("equipment").select("id, identifier, type, status")
    ]);
    setProgramming((p ?? []) as any[]);
    setEquipment((e ?? []) as any[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("op-schedule-v3")
      .on("postgres_changes", { event: "*", schema: "public", table: "programming" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const deleteSchedule = async (id: string) => {
    const { error } = await supabase.from("programming").delete().eq("id", id);
    if (!error) { toast.success("Agendamento removido"); load(); }
  };

  const stats = useMemo(() => {
    const activeMaint = equipment.filter(e => e.status === 'manutencao' || e.status === 'indisponivel').length;
    const ready = equipment.filter(e => e.status === 'disponivel' || e.status === 'operacional').length;
    return { activeMaint, ready, totalScheduled: programming.length };
  }, [equipment, programming]);

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-2 uppercase tracking-tighter text-foreground/90">
            <LayoutDashboard className="h-8 w-8 text-primary" />
            Central de Monitoramento
          </h1>
          <p className="text-muted-foreground font-medium">Controle de Paradas por Calendário</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-emerald-50 border-emerald-200 p-5 flex items-center justify-between">
          <div><p className="text-[10px] font-black text-emerald-600 uppercase">Frota Operacional</p><h2 className="text-4xl font-black text-emerald-700">{stats.ready}</h2></div>
          <Truck className="h-10 w-10 text-emerald-500 opacity-30" />
        </Card>
        <Card className="bg-orange-50 border-orange-200 p-5 flex items-center justify-between">
          <div><p className="text-[10px] font-black text-orange-600 uppercase">Na Oficina</p><h2 className="text-4xl font-black text-orange-700">{stats.activeMaint}</h2></div>
          <Wrench className="h-10 w-10 text-orange-500 opacity-30" />
        </Card>
        <Card className="bg-blue-50 border-blue-200 p-5 flex items-center justify-between">
          <div><p className="text-[10px] font-black text-blue-600 uppercase">Agendamentos Totais</p><h2 className="text-4xl font-black text-blue-700">{stats.totalScheduled}</h2></div>
          <Clock className="h-10 w-10 text-blue-500 opacity-30" />
        </Card>
      </div>

      <Tabs defaultValue={weekDays[0].dateStr} className="w-full">
        <TabsList className="w-full h-14 bg-muted/50 p-1 rounded-xl">
          {weekDays.map(day => (
            <TabsTrigger key={day.dateStr} value={day.dateStr} className="flex-1 rounded-lg font-black uppercase text-[10px] flex flex-col gap-0.5">
              <span>{day.label}</span>
              <span className="opacity-60">{day.dateStr.split('-').reverse().slice(0,2).join('/')}</span>
              {programming.filter(p => p.scheduled_date === day.dateStr).length > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {weekDays.map(day => (
          <TabsContent key={day.dateStr} value={day.dateStr} className="mt-6">
            <div className="space-y-4">
              <h3 className="font-black uppercase text-sm flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-primary" /> Programação de {day.fullLabel}
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {programming.filter(p => p.scheduled_date === day.dateStr).map(p => (
                  <Card key={p.id} className="overflow-hidden border-2 hover:border-primary/30 transition-all">
                     <div className="h-1 bg-primary/20" />
                     <CardContent className="p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-mono font-black text-lg leading-none uppercase">{p.equipment?.identifier}</h4>
                            <p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase">{p.equipment?.type}</p>
                          </div>
                          <Badge className="bg-blue-600 text-[9px] font-black uppercase">{p.stop_type}</Badge>
                        </div>
                        {p.notes && <div className="bg-muted/50 p-2 rounded text-[11px] italic text-muted-foreground">"{p.notes}"</div>}
                        <div className="pt-2 flex justify-between items-center border-t border-dashed">
                           <span className="text-[9px] font-black text-muted-foreground flex items-center gap-1 uppercase">
                              <AlertCircle className="h-3 w-3" /> Programado
                           </span>
                           <Button variant="ghost" size="icon" onClick={() => deleteSchedule(p.id)} className="h-7 w-7 text-red-500"><Trash2 className="h-4 w-4" /></Button>
                        </div>
                     </CardContent>
                  </Card>
                ))}
                
                {programming.filter(p => p.scheduled_date === day.dateStr).length === 0 && (
                  <div className="col-span-full p-12 border-2 border-dashed rounded-3xl text-center text-muted-foreground/50 italic">
                    Nenhuma parada agendada para este dia.
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}