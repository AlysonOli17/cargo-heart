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
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/command"; // Fixed path
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Redefining local command if needed but better use correct imports
import { Command as CommandUI, CommandInput as CommandInputUI, CommandItem as CommandItemUI, CommandList as CommandListUI, CommandEmpty as CommandEmptyUI, CommandGroup as CommandGroupUI } from "@/components/ui/command";

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "CCO Manutenção — Frota Busato" }] }),
  component: () => <AppLayout><MaintenancePage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; status: EquipmentStatus;
  maintenance_problem: string | null; maintenance_started_at: string | null;
};

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
    scheduledDate: new Date().toISOString().split("T")[0],
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
        scheduled_date: form.scheduledDate,
        day_of_week: "Calendário", // Legado
        stop_type: form.stopType,
        notes: form.problem,
        owner_id: user?.id
      });
      if (!error) { toast.success("Agendamento realizado!"); setIsAdding(false); }
      else toast.error(error.message);
    }
  };

  const release = async (id: string) => {
    await supabase.from("equipment").update({ status: "operacional", maintenance_problem: null }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-black flex items-center gap-2 uppercase tracking-tighter"><Wrench className="h-8 w-8 text-primary" /> Oficina CCO</h1>
        <Dialog open={isAdding} onOpenChange={setIsAdding}>
          <DialogTrigger asChild><Button className="font-bold shadow-lg"><PlusCircle className="h-4 w-4 mr-2" />Nova Intervenção</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-black uppercase">Controle de Parada</DialogTitle></DialogHeader>
            
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
              <TabsList className="grid grid-cols-2 w-full mb-4 h-12">
                <TabsTrigger value="now" className="font-bold uppercase text-[10px]">PARAR AGORA</TabsTrigger>
                <TabsTrigger value="schedule" className="font-bold uppercase text-[10px]">AGENDAR DATA</TabsTrigger>
              </TabsList>

              <div className="space-y-4">
                <div className="flex flex-col space-y-2">
                  <Label className="font-bold uppercase text-[10px]">Equipamento / Placa</Label>
                  <Popover open={openCombo} onOpenChange={setOpenCombo}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between h-12 text-sm font-bold">
                        {selectedEqId ? availableEqs.find(x => x.id === selectedEqId)?.identifier : "PESQUISAR PLACA..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                      <CommandUI>
                        <CommandInputUI placeholder="Ex: EH-194..." />
                        <CommandListUI>
                          <CommandEmptyUI>Não encontrado.</CommandEmptyUI>
                          <CommandGroupUI>
                            {availableEqs.map((eq) => (
                              <CommandItemUI key={eq.id} onSelect={() => { setSelectedEqId(eq.id); setOpenCombo(false); }}>
                                <Check className={cn("mr-2 h-4 w-4", selectedEqId === eq.id ? "opacity-100" : "opacity-0")} />
                                {eq.identifier}
                              </CommandItemUI>
                            ))}
                          </CommandGroupUI>
                        </CommandListUI>
                      </CommandUI>
                    </PopoverContent>
                  </Popover>
                </div>

                {mode === "now" ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="font-bold uppercase text-[10px]">Status</Label>
                        <Select value={form.status} onValueChange={(v) => setForm({...form, status: v as any})}>
                          <SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manutencao">Em Manutenção</SelectItem>
                            <SelectItem value="indisponivel">Indisponível</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold uppercase text-[10px]">Prioridade</Label>
                        <Select value={form.priority} onValueChange={(v) => setForm({...form, priority: v})}>
                          <SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Média">Média</SelectItem>
                            <SelectItem value="Crítica">Crítica</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="font-bold uppercase text-[10px]">Data da Parada</Label>
                        <Input type="date" className="h-10 font-bold" value={form.scheduledDate} onChange={(e) => setForm({...form, scheduledDate: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label className="font-bold uppercase text-[10px]">Tipo de Parada</Label>
                        <Select value={form.stopType} onValueChange={(v) => setForm({...form, stopType: v})}>
                          <SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STOP_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}
                
                <div className="space-y-2">
                  <Label className="font-bold uppercase text-[10px]">Observações / Defeito</Label>
                  <Textarea value={form.problem} onChange={(e) => setForm({...form, problem: e.target.value})} placeholder="Descreva o serviço..." className="text-sm" />
                </div>

                <Button onClick={handleSubmit} className="w-full h-12 font-black uppercase bg-primary text-white text-xs">
                  {mode === "now" ? "CONFIRMAR ENTRADA" : "AGENDAR NO CALENDÁRIO"}
                </Button>
              </div>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-black border-b-2 pb-2 uppercase tracking-tighter">Veículos em Manutenção</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(e => (
            <Card key={e.id} className="p-4 border-2 hover:border-primary/20 transition-all">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-mono font-black text-lg">{e.identifier}</p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">{e.maintenance_problem || 'Manutenção Ativa'}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => release(e.id)} className="font-black border-2 h-8 text-[10px]">LIBERAR</Button>
              </div>
            </Card>
          ))}
          {items.length === 0 && <div className="col-span-full p-10 text-center text-muted-foreground italic border-2 border-dashed rounded-3xl uppercase text-xs font-bold">Oficina Vazia</div>}
        </div>
      </div>
    </div>
  );
}