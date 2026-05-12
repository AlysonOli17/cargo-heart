import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, CheckCircle2, PlusCircle, Clock, Calendar as CalendarIcon, Tag, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, type EquipmentStatus } from "@/lib/equipment";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "CCO Manutenção — Frota Busato" }] }),
  component: () => <AppLayout><MaintenancePage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; status: EquipmentStatus;
  maintenance_problem: string | null; maintenance_started_at: string | null; maintenance_expected_return: string | null;
  maintenance_priority: string | null; maintenance_responsible: string | null; maintenance_type: string | null;
};

const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const STOP_TYPES = ["Lavador", "Mola", "Borracharia", "Preventiva", "Manutenção Programada", "Elétrica", "Motor", "Solda"];

function MaintenancePage() {
  const { user } = useAuth();
  const { canWrite } = useRole();
  const [items, setItems] = useState<Equipment[]>([]);
  const [availableEqs, setAvailableEqs] = useState<{id: string, identifier: string}[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  
  const [openCombo, setOpenCombo] = useState(false);
  const [selectedEqId, setSelectedEqId] = useState("");

  const [form, setForm] = useState({
    status: "manutencao" as EquipmentStatus,
    problem: "",
    priority: "Média",
    responsible: "",
    location: "Oficina Base",
    day: "Segunda",
    stopType: "Manutenção Programada"
  });

  const load = async () => {
    const { data: e } = await supabase.from("equipment").select("*").order("identifier");
    setAvailableEqs((e ?? []).map(x => ({ id: x.id, identifier: x.identifier })));
    setItems((e ?? []).filter(x => ['manutencao', 'indisponivel', 'finalizacao', 'programado'].includes(x.status)) as Equipment[]);
  };

  useEffect(() => { if (user) load(); }, [user]);

  const handleSubmit = async () => {
    if (!selectedEqId) { toast.error("Selecione o equipamento"); return; }

    if (mode === "now") {
      const { error } = await supabase.from("equipment").update({
        status: form.status,
        maintenance_problem: form.problem,
        maintenance_priority: form.priority,
        maintenance_responsible: form.responsible,
        maintenance_started_at: new Date().toISOString()
      }).eq("id", selectedEqId);
      if (!error) { toast.success("Entrada realizada"); setIsAdding(false); load(); }
    } else {
      const { error } = await supabase.from("programming").insert({
        equipment_id: selectedEqId,
        day_of_week: form.day,
        stop_type: form.stopType,
        notes: form.problem,
        owner_id: user?.id
      });
      if (!error) { toast.success("Parada agendada com sucesso!"); setIsAdding(false); }
    }
  };

  const release = async (id: string) => {
    await supabase.from("equipment").update({ status: "operacional", maintenance_problem: null }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-black flex items-center gap-2"><Wrench className="h-8 w-8 text-primary" /> Oficina CCO</h1>
        <Dialog open={isAdding} onOpenChange={setIsAdding}>
          <DialogTrigger asChild><Button className="font-bold"><PlusCircle className="h-4 w-4 mr-2" />Nova Intervenção</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Controle de Parada</DialogTitle></DialogHeader>
            
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
              <TabsList className="grid grid-cols-2 w-full mb-4">
                <TabsTrigger value="now" className="font-bold">PARAR AGORA</TabsTrigger>
                <TabsTrigger value="schedule" className="font-bold">AGENDAR</TabsTrigger>
              </TabsList>

              <div className="space-y-4">
                <div className="flex flex-col space-y-2">
                  <Label>Equipamento / Placa</Label>
                  <Popover open={openCombo} onOpenChange={setOpenCombo}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between h-12">
                        {selectedEqId ? availableEqs.find(x => x.id === selectedEqId)?.identifier : "Pesquisar placa..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command>
                        <CommandInput placeholder="Ex: EH-194..." />
                        <CommandList>
                          <CommandEmpty>Não encontrado.</CommandEmpty>
                          <CommandGroup>
                            {availableEqs.map((eq) => (
                              <CommandItem key={eq.id} onSelect={() => { setSelectedEqId(eq.id); setOpenCombo(false); }}>
                                <Check className={cn("mr-2 h-4 w-4", selectedEqId === eq.id ? "opacity-100" : "opacity-0")} />
                                {eq.identifier}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {mode === "now" ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select value={form.status} onValueChange={(v) => setForm({...form, status: v as any})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manutencao">Em Manutenção</SelectItem>
                            <SelectItem value="indisponivel">Indisponível</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Prioridade</Label>
                        <Select value={form.priority} onValueChange={(v) => setForm({...form, priority: v})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Média">Média</SelectItem>
                            <SelectItem value="Crítica">Crítica</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Defeito / Observação</Label>
                      <Textarea value={form.problem} onChange={(e) => setForm({...form, problem: e.target.value})} placeholder="O que aconteceu?" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Dia da Parada</Label>
                        <Select value={form.day} onValueChange={(v) => setForm({...form, day: v})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Tipo de Parada</Label>
                        <Select value={form.stopType} onValueChange={(v) => setForm({...form, stopType: v})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STOP_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Notas do Agendamento</Label>
                      <Textarea value={form.problem} onChange={(e) => setForm({...form, problem: e.target.value})} placeholder="Observações..." />
                    </div>
                  </>
                )}

                <Button onClick={handleSubmit} className="w-full h-12 font-black uppercase bg-primary text-white">
                  {mode === "now" ? "CONFIRMAR ENTRADA" : "AGENDAR PARA A SEMANA"}
                </Button>
              </div>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold border-b pb-2">Máquinas na Oficina</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map(e => (
            <Card key={e.id} className="p-4 border-l-4" style={{ borderLeftColor: `var(--${e.status})` }}>
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-mono font-black text-lg">{e.identifier}</p>
                  <p className="text-xs font-bold text-muted-foreground uppercase">{e.maintenance_problem}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => release(e.id)} className="font-bold border-2">LIBERAR</Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}