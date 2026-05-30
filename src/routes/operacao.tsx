import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Clock, Truck, Wrench, Trash2, CheckCircle2, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Info, CheckCircle, XCircle, Hourglass, MessageSquare } from "lucide-react";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { format, addDays, startOfWeek, endOfWeek, subWeeks, addWeeks, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/operacao")({
  head: () => ({ meta: [{ title: "Monitoramento de Agendamentos — Frota Busato" }] }),
  component: () => <AppLayout><OperationPlanningPage /></AppLayout>,
});

type Programming = {
  id: string; scheduled_date: string | null; stop_type: string; notes: string | null;
  equipment_id: string;
  equipment: { identifier: string; type: string } | null;
};

type Equipment = {
  id: string; identifier: string; type: string | null; status: string;
  maintenance_expected_return: string | null; maintenance_problem: string | null;
};

function OperationPlanningPage() {
  const { user } = useAuth();
  const [programming, setProgramming] = useState<Programming[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const d = dateStr.includes("T") ? new Date(dateStr) : new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString('pt-BR');
  };

  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 0 }));
  
  const [rescheduleData, setRescheduleData] = useState<{ id: string, eqId: string, type: string, mode: "success" | "fail" } | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(format(addDays(new Date(), 1), "yyyy-MM-dd"));
  const [rescheduleReason, setRescheduleReason] = useState("");

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const d = addDays(currentWeekStart, i);
      return {
        dateStr: format(d, "yyyy-MM-dd"),
        label: format(d, "EEE", { locale: ptBR }),
        fullLabel: format(d, "dd/MM (EEEE)", { locale: ptBR })
      };
    });
  }, [currentWeekStart]);

  const load = async () => {
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from("programming").select("*, equipment:equipment_id(identifier, type)").eq("is_completed", false),
      supabase.from("equipment").select("*").order("identifier")
    ]);
    setProgramming((p ?? []) as any[]);
    setEquipment((e ?? []) as any[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("op-schedule-v12")
      .on("postgres_changes", { event: "*", schema: "public", table: "programming" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const confirmRealized = async (p: Programming) => {
    const { error } = await supabase.from("programming").update({ is_completed: true }).eq("id", p.id);
    if (!error) {
      toast.success("Serviço concluído!");
      
      // Grava no histórico geral que foi realizado com data e hora exata
      await supabase.from("history").insert({
        equipment_id: p.equipment_id,
        status_to: "Realizado",
        notes: `CONCLUÍDO: O serviço de ${p.stop_type} foi realizado com sucesso em ${format(new Date(), 'dd/MM/yyyy HH:mm')}.`
      });

      if (p.stop_type === "Lavador") {
        setRescheduleData({ id: p.id, eqId: p.equipment_id, type: "Lavador", mode: "success" });
        setRescheduleReason("Lavagem recorrente");
      } else { load(); }
    }
  };

  const markNotRealized = (p: Programming) => {
    setRescheduleData({ id: p.id, eqId: p.equipment_id, type: p.stop_type, mode: "fail" });
    setRescheduleReason(""); 
  };

  const handleReschedule = async () => {
    if (!rescheduleData) return;
    if (rescheduleData.mode === "fail" && !rescheduleReason) {
      toast.error("Por favor, informe o motivo");
      return;
    }

    const finalNote = rescheduleData.mode === "fail" ? `NÃO REALIZADO: ${rescheduleReason}` : rescheduleReason;

    // Se for falha, deleta o atual e grava no histórico geral da máquina
    if (rescheduleData.mode === "fail") {
      await supabase.from("programming").delete().eq("id", rescheduleData.id);
      
      // REGISTRO NO HISTÓRICO GERAL (Aba Histórico)
      await supabase.from("history").insert({
        equipment_id: rescheduleData.eqId,
        status_to: "Reagendado",
        notes: `Agendamento de ${rescheduleData.type} não realizado. Motivo: ${rescheduleReason}. Reagendado para ${formatDate(rescheduleDate)}`
      });
    }

    // Insere o novo agendamento
    const { error } = await supabase.from("programming").insert({
      equipment_id: rescheduleData.eqId,
      scheduled_date: rescheduleDate,
      day_of_week: "Calendário",
      stop_type: rescheduleData.type,
      notes: finalNote,
      owner_id: user?.id
    });

    if (!error) {
      toast.success("Operação registrada com sucesso!");
      setRescheduleData(null);
      setRescheduleReason("");
      load();
    }
  };

  const deleteSchedule = async (id: string) => {
    const { error } = await supabase.from("programming").delete().eq("id", id);
    if (!error) { toast.success("Agendamento removido"); load(); }
  };

  const stats = useMemo(() => {
    const activeMaint = equipment.filter(e => e.status === 'manutencao' || e.status === 'indisponivel').length;
    const ready = equipment.filter(e => e.status === 'disponivel' || e.status === 'operacional').length;
    return { activeMaint, ready, totalScheduled: programming.length };
  }, [equipment, programming]);

  const inMaintenance = useMemo(() => {
    return equipment.filter(e => e.status === 'manutencao' || e.status === 'indisponivel');
  }, [equipment]);

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-4">
        <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-xl border">
           <Button variant="ghost" size="icon" onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))} className="h-9 w-9 rounded-lg"><ChevronLeft className="h-4 w-4" /></Button>
           <div className="px-4 font-black text-[10px] uppercase flex items-center gap-2">
             <CalendarIcon className="h-3 w-3 opacity-40" />
             Semana de {format(currentWeekStart, "dd/MM")} a {format(endOfWeek(currentWeekStart, { weekStartsOn: 0 }), "dd/MM")}
           </div>
           <Button variant="ghost" size="icon" onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))} className="h-9 w-9 rounded-lg"><ChevronRight className="h-4 w-4" /></Button>
           <Button variant="secondary" onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }))} className="h-9 px-3 text-[9px] font-black uppercase">Hoje</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card className="bg-emerald-50 border-emerald-250 shadow-sm">
          <CardContent className="p-2 px-3 flex items-center justify-between">
            <div>
              <p className="text-[8px] font-black uppercase text-emerald-600 tracking-wider">Frota Operacional</p>
              <h3 className="text-base font-black mt-0.5 text-emerald-700">{stats.ready}</h3>
            </div>
            <Truck className="h-5 w-5 text-emerald-500 opacity-40" />
          </CardContent>
        </Card>
        <Card className="bg-orange-50 border-orange-250 shadow-sm">
          <CardContent className="p-2 px-3 flex items-center justify-between">
            <div>
              <p className="text-[8px] font-black uppercase text-orange-600 tracking-wider">Em Oficina</p>
              <h3 className="text-base font-black mt-0.5 text-orange-700">{stats.activeMaint}</h3>
            </div>
            <Wrench className="h-5 w-5 text-orange-500 opacity-40" />
          </CardContent>
        </Card>
        <Card className="bg-blue-50 border-blue-250 shadow-sm">
          <CardContent className="p-2 px-3 flex items-center justify-between">
            <div>
              <p className="text-[8px] font-black uppercase text-blue-600 tracking-wider">Agendamentos</p>
              <h3 className="text-base font-black mt-0.5 text-blue-700">{stats.totalScheduled}</h3>
            </div>
            <Clock className="h-5 w-5 text-blue-500 opacity-40" />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={format(new Date(), "yyyy-MM-dd")} className="w-full">
        <TabsList className="w-full h-14 bg-muted/50 p-1 rounded-xl overflow-x-auto no-scrollbar">
          {weekDays.map(day => (
            <TabsTrigger key={day.dateStr} value={day.dateStr} className="flex-1 min-w-[60px] rounded-lg font-black uppercase text-[10px] flex flex-col gap-0.5 relative">
              <span className={day.dateStr === format(new Date(), "yyyy-MM-dd") ? "text-primary" : ""}>{day.label}</span>
              <span className="opacity-60">{day.dateStr.split('-').reverse().slice(0,2).join('/')}</span>
              {programming.filter(p => p.scheduled_date === day.dateStr).length > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full border border-white" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {weekDays.map(day => (
          <TabsContent key={day.dateStr} value={day.dateStr} className="mt-6">
            <div className="space-y-4">
              <h3 className="font-black uppercase text-sm flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-primary" /> Planejamento de {day.fullLabel}
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {programming.filter(p => p.scheduled_date === day.dateStr).map(p => (
                    <Card key={p.id} className="overflow-hidden border-2 hover:border-primary/30 transition-all">
                       <CardContent className="p-4 space-y-3">
                          <div className="flex justify-between items-start">
                            <div><h4 className="font-mono font-black text-lg uppercase leading-none">{p.equipment?.identifier}</h4><p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase">{p.equipment?.type}</p></div>
                            <Badge className="bg-blue-600 text-[9px] font-black uppercase">{p.stop_type}</Badge>
                          </div>
                          {p.notes && <div className="bg-muted/50 p-2 rounded text-[11px] font-medium italic text-muted-foreground border-l-2 border-primary">"{p.notes}"</div>}
                          <div className="pt-2 grid grid-cols-2 gap-2 border-t border-dashed">
                             <Button onClick={() => confirmRealized(p)} className="h-9 bg-emerald-600 text-white font-black uppercase text-[9px] flex items-center justify-center gap-1"><CheckCircle className="h-3 w-3" /> Realizado</Button>
                             <Button onClick={() => markNotRealized(p)} variant="outline" className="h-9 text-red-600 border-red-200 hover:bg-red-50 font-black uppercase text-[9px] flex items-center justify-center gap-1"><XCircle className="h-3 w-3" /> Não Realizado</Button>
                          </div>
                       </CardContent>
                    </Card>
                ))}
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* SEÇÃO DE QUEM JÁ ESTÁ NA OFICINA */}
      <div className="pt-8 space-y-4 border-t-2 border-dashed">
         <h2 className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
           <Wrench className="h-5 w-5 text-orange-500" /> Em Intervenção Técnica
         </h2>
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {inMaintenance.map(e => (
              <Card key={e.id} className="border-2 hover:border-orange-200 transition-all">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <span className="font-mono font-black text-lg">{e.identifier}</span>
                    <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-[9px] font-black uppercase">NA OFICINA</Badge>
                  </div>
                  {e.maintenance_expected_return ? (
                    <div className="bg-blue-50 border border-blue-200 p-2 rounded-lg flex items-center gap-2">
                      <Hourglass className="h-4 w-4 text-blue-600 animate-pulse" />
                      <div>
                        <p className="text-[8px] font-black text-blue-700 uppercase leading-none">Previsão Retorno</p>
                        <p className="text-xs font-black text-blue-800">{formatDate(e.maintenance_expected_return)}</p>
                      </div>
                    </div>
                  ) : (<div className="bg-muted/50 p-2 rounded-lg text-muted-foreground italic text-[10px] font-bold uppercase">Sem previsão definida</div>)}
                </CardContent>
              </Card>
            ))}
         </div>
      </div>

      <Dialog open={!!rescheduleData} onOpenChange={(o) => !o && setRescheduleData(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className={cn("font-black uppercase flex items-center gap-2", rescheduleData?.mode === "fail" ? "text-red-600" : "text-primary")}>
              {rescheduleData?.mode === "fail" ? <AlertCircle className="h-5 w-5" /> : <CalendarIcon className="h-5 w-5" />}
              {rescheduleData?.mode === "fail" ? "Justificar Não Realizado" : "Próximo Agendamento"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
             <div className="space-y-2">
               <Label className="text-[10px] font-black uppercase">Nova Data para Realização</Label>
               <Input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} className="h-12 font-bold" />
             </div>
             <div className="space-y-2">
               <Label className="text-[10px] font-black uppercase flex items-center gap-1">
                 {rescheduleData?.mode === "fail" ? <MessageSquare className="h-3 w-3" /> : null}
                 {rescheduleData?.mode === "fail" ? "Motivo do Não Realizado" : "Observações"}
               </Label>
               <Textarea placeholder={rescheduleData?.mode === "fail" ? "Descreva por que o serviço não foi feito hoje..." : "Observações para o próximo agendamento..."} value={rescheduleReason} onChange={(e) => setRescheduleReason(e.target.value)} className="h-24 text-xs font-medium" />
               {rescheduleData?.mode === "fail" && !rescheduleReason && (<p className="text-[9px] text-red-500 font-bold uppercase">* O motivo é obrigatório.</p>)}
          </div>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => { setRescheduleData(null); load(); }} className="font-black uppercase text-xs">Cancelar</Button>
            <Button onClick={handleReschedule} disabled={rescheduleData?.mode === "fail" && !rescheduleReason} className={cn("font-black uppercase text-xs text-white", rescheduleData?.mode === "fail" ? "bg-red-600 hover:bg-red-700" : "bg-primary")}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}