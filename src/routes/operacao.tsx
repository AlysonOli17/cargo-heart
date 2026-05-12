import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Calendar, LayoutDashboard, PlusCircle, Truck, Users, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/operacao")({
  head: () => ({ meta: [{ title: "Central de Programação — Frota Busato" }] }),
  component: () => <AppLayout><OperationPlanningPage /></AppLayout>,
});

type Programming = {
  id: string;
  day_of_week: string;
  client_name: string;
  equipment_type: string;
  quantity_needed: number;
  quantity_allocated: number;
};

type Equipment = {
  id: string; identifier: string; type: string | null; status: string; current_client_id: string | null;
};

const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

function OperationPlanningPage() {
  const { user } = useAuth();
  const [programming, setProgramming] = useState<Programming[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  
  const [newPlan, setNewPlan] = useState({
    day: "Segunda",
    client: "",
    type: "CAMINHÃO BASCULANTE",
    qty: 1
  });

  const load = async () => {
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from("programming").select("*"),
      supabase.from("equipment").select("id, identifier, type, status, current_client_id")
    ]);
    setProgramming((p ?? []) as Programming[]);
    setEquipment((e ?? []) as Equipment[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("op-planning")
      .on("postgres_changes", { event: "*", schema: "public", table: "programming" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const addProgramming = async () => {
    if (!newPlan.client || newPlan.qty <= 0) return;
    const { error } = await supabase.from("programming").insert({
      day_of_week: newPlan.day,
      client_name: newPlan.client,
      equipment_type: newPlan.type,
      quantity_needed: newPlan.qty,
      owner_id: user?.id
    });
    if (!error) {
      toast.success("Programação adicionada");
      setIsAdding(false);
      load();
    }
  };

  // Cálculos de Demanda vs Disponibilidade
  const stats = useMemo(() => {
    const totalAvailable = equipment.filter(e => e.status === 'disponivel' || e.status === 'operacional').length;
    const totalNeeded = programming.reduce((acc, p) => acc + p.quantity_needed, 0);
    const types = Array.from(new Set(equipment.map(e => e.type).filter(Boolean)));
    
    return {
      totalAvailable,
      totalNeeded,
      gap: totalNeeded - totalAvailable,
      byType: types.map(t => ({
        type: t,
        available: equipment.filter(e => e.type === t && (e.status === 'disponivel' || e.status === 'operacional')).length,
        needed: programming.filter(p => p.equipment_type === t).reduce((acc, p) => acc + p.quantity_needed, 0)
      }))
    };
  }, [equipment, programming]);

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-2 uppercase">
            <LayoutDashboard className="h-8 w-8 text-primary" />
            Central de Programação
          </h1>
          <p className="text-muted-foreground font-medium">Monitoramento de Demanda e Alocação Semanal</p>
        </div>

        <Dialog open={isAdding} onOpenChange={setIsAdding}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 font-bold shadow-lg">
              <PlusCircle className="h-4 w-4 mr-2" />
              Nova Programação
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Programar Demanda</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
               <div>
                 <Label>Dia da Semana</Label>
                 <Select value={newPlan.day} onValueChange={(v) => setNewPlan({...newPlan, day: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                 </Select>
               </div>
               <div>
                 <Label>Cliente / Frente de Trabalho</Label>
                 <Input value={newPlan.client} onChange={(e) => setNewPlan({...newPlan, client: e.target.value})} placeholder="Ex: Obra BR-101" />
               </div>
               <div className="grid grid-cols-2 gap-3">
                 <div>
                   <Label>Tipo de Equipamento</Label>
                   <Select value={newPlan.type} onValueChange={(v) => setNewPlan({...newPlan, type: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CAMINHÃO BASCULANTE">Caminhão Basculante</SelectItem>
                        <SelectItem value="CAMINHÃO PIPA">Caminhão Pipa</SelectItem>
                        <SelectItem value="RETROESCAVADEIRA">Retroescavadeira</SelectItem>
                        <SelectItem value="CARREGADEIRA">Carregadeira</SelectItem>
                      </SelectContent>
                   </Select>
                 </div>
                 <div>
                   <Label>Quantidade Necessária</Label>
                   <Input type="number" value={newPlan.qty} onChange={(e) => setNewPlan({...newPlan, qty: Number(e.target.value)})} />
                 </div>
               </div>
               <Button onClick={addProgramming} className="w-full font-bold">SALVAR PROGRAMAÇÃO</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* PAINEL DE MONITORAMENTO (KPIs) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
             <div className="flex justify-between items-start">
               <div>
                 <p className="text-xs font-black text-primary uppercase">Demanda Total</p>
                 <h2 className="text-4xl font-black">{stats.totalNeeded}</h2>
                 <p className="text-[10px] text-muted-foreground mt-1">Máquinas programadas para a semana</p>
               </div>
               <Users className="h-8 w-8 text-primary/40" />
             </div>
          </CardContent>
        </Card>

        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-6">
             <div className="flex justify-between items-start">
               <div>
                 <p className="text-xs font-black text-emerald-600 uppercase">Disponível Agora</p>
                 <h2 className="text-4xl font-black text-emerald-700">{stats.totalAvailable}</h2>
                 <p className="text-[10px] text-emerald-600/70 mt-1">Frota pronta para trabalho (Verde)</p>
               </div>
               <Truck className="h-8 w-8 text-emerald-500/40" />
             </div>
          </CardContent>
        </Card>

        <Card className={stats.gap > 0 ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"}>
          <CardContent className="p-6">
             <div className="flex justify-between items-start">
               <div>
                 <p className="text-xs font-black text-foreground/70 uppercase">Necessidade Crítica</p>
                 <h2 className={`text-4xl font-black ${stats.gap > 0 ? "text-red-700" : "text-blue-700"}`}>
                   {stats.gap > 0 ? stats.gap : 0}
                 </h2>
                 <p className="text-[10px] text-muted-foreground mt-1">Caminhões faltando para fechar a escala</p>
               </div>
               <AlertCircle className="h-8 w-8 opacity-40" />
             </div>
          </CardContent>
        </Card>
      </div>

      {/* QUADRO SEMANAL */}
      <Tabs defaultValue="Segunda" className="w-full">
        <TabsList className="w-full h-14 bg-muted/50 p-1 rounded-xl">
          {DAYS.map(day => (
            <TabsTrigger key={day} value={day} className="flex-1 rounded-lg font-bold uppercase text-[10px]">
              {day}
            </TabsTrigger>
          ))}
        </TabsList>

        {DAYS.map(day => (
          <TabsContent key={day} value={day} className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* COLUNA: PROGRAMAÇÃO DO DIA */}
              <div className="lg:col-span-2 space-y-4">
                <h3 className="font-black uppercase text-sm flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Planejamento para {day}
                </h3>
                {programming.filter(p => p.day_of_week === day).length === 0 ? (
                  <div className="p-10 border-2 border-dashed rounded-2xl text-center text-muted-foreground">
                    Nenhuma programação para este dia. Clique em "Nova Programação".
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {programming.filter(p => p.day_of_week === day).map(p => {
                      const availableForType = stats.byType.find(t => t.type === p.equipment_type)?.available || 0;
                      const isComplete = availableForType >= p.quantity_needed;
                      
                      return (
                        <Card key={p.id} className="overflow-hidden border-2">
                           <div className={`h-1.5 ${isComplete ? "bg-emerald-500" : "bg-orange-500"}`} />
                           <CardContent className="p-4 space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <h4 className="font-black text-base uppercase leading-none">{p.client_name}</h4>
                                  <p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase">{p.equipment_type}</p>
                                </div>
                                <Badge variant={isComplete ? "default" : "outline"} className={isComplete ? "bg-emerald-500" : "text-orange-600 border-orange-200"}>
                                  {isComplete ? "COBERTO" : "FALTA EQUIP."}
                                </Badge>
                              </div>
                              
                              <div className="space-y-1">
                                <div className="flex justify-between text-[10px] font-black uppercase">
                                   <span>Progresso de Alocação</span>
                                   <span>{availableForType} / {p.quantity_needed}</span>
                                </div>
                                <Progress value={(availableForType / p.quantity_needed) * 100} className="h-2" />
                              </div>

                              <div className="flex items-center gap-2 pt-2 text-[10px] font-bold text-muted-foreground">
                                 {isComplete ? (
                                   <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Frota disponível suficiente</>
                                 ) : (
                                   <><AlertCircle className="h-3 w-3 text-orange-500" /> Providenciar mais {p.quantity_needed - availableForType} unidades</>
                                 )}
                              </div>
                           </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* COLUNA: PRONTIDÃO (SIDEBAR) */}
              <div className="space-y-4">
                <h3 className="font-black uppercase text-sm flex items-center gap-2">
                  <Truck className="h-4 w-4" /> Pátio Próximo (Livres)
                </h3>
                <Card className="bg-muted/30 border-none shadow-none">
                  <CardContent className="p-4">
                    <div className="space-y-4">
                      {stats.byType.map(t => (
                        <div key={t.type} className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black uppercase text-muted-foreground">{t.type}</span>
                            <Badge variant="secondary" className="text-[9px] font-black">{t.available} OK</Badge>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {equipment
                              .filter(e => e.type === t.type && (e.status === 'disponivel' || e.status === 'operacional'))
                              .map(e => (
                                <div key={e.id} className="px-2 py-1 bg-white border rounded text-[9px] font-bold shadow-sm">
                                  {e.identifier}
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}