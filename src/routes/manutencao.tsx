import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wrench, CheckCircle2, PlusCircle, Clock, Calendar as CalendarIcon, Tag, Check, ChevronsUpDown, Search, FileDown, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "CCO Manutenção — Frota Busato" }] }),
  component: () => <AppLayout><MaintenancePage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; status: EquipmentStatus;
  maintenance_problem: string | null; maintenance_started_at: string | null; maintenance_expected_return: string | null;
  maintenance_priority: string | null; maintenance_responsible: string | null; maintenance_type: string | null;
  updated_at: string;
};

const STOP_TYPES = ["Lavador", "Mola", "Borracharia", "Preventiva", "Manutenção Programada", "Elétrica", "Motor", "Solda"];

function MaintenancePage() {
  const { user } = useAuth();
  const { canWrite } = useRole();
  const [items, setItems] = useState<Equipment[]>([]);
  const [availableEqs, setAvailableEqs] = useState<{id: string, identifier: string}[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [openCombo, setOpenCombo] = useState(false);
  const [selectedEqId, setSelectedEqId] = useState("");

  const [form, setForm] = useState({
    status: "manutencao" as EquipmentStatus,
    problem: "",
    priority: "Média",
    responsible: "",
    scheduledDate: new Date().toISOString().split("T")[0],
    expectedReturn: "",
    stopType: "Manutenção Programada"
  });

  const load = async () => {
    const { data: e } = await supabase.from("equipment").select("*").order("identifier");
    setAvailableEqs((e ?? []).map(x => ({ id: x.id, identifier: x.identifier })));
    setItems((e ?? []).filter(x => ['manutencao', 'indisponivel', 'finalizacao', 'programado'].includes(x.status)) as Equipment[]);
  };

  useEffect(() => { if (user) load(); }, [user]);

  const exportToPDF = () => {
    if (items.length === 0) { toast.error("Não há dados"); return; }
    const doc = new jsPDF({ orientation: "l", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const brandBlue = [44, 126, 189]; 
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(80, 80, 80); doc.text("BUSATO", 20, 20);
    doc.setFontSize(16); doc.setTextColor(60, 60, 60); doc.text("RELATÓRIO DE MANUTENÇÃO ATIVA", pageWidth - 20, 20, { align: "right" });
    doc.setDrawColor(brandBlue[0], brandBlue[1], brandBlue[2]); doc.setLineWidth(0.8); doc.line(20, 25, pageWidth - 20, 25);
    autoTable(doc, {
      startY: 42,
      head: [["Equipamento", "Tipo", "Defeito / Observação", "Entrada", "Previsão Retorno", "Tempo Parado"]],
      body: items.map(e => [e.identifier, e.type || "—", e.maintenance_problem || "Técnico", e.maintenance_started_at ? new Date(e.maintenance_started_at).toLocaleDateString("pt-BR") : "—", e.maintenance_expected_return ? new Date(e.maintenance_expected_return).toLocaleDateString("pt-BR") : "—", getDiasParado(e.maintenance_started_at || e.updated_at).toString() + " dias"]),
      theme: "grid", headStyles: { fillColor: brandBlue as any, textColor: [255, 255, 255] }
    });
    doc.save(`relatorio-oficina.pdf`);
  };

  const handleSubmit = async () => {
    if (!selectedEqId) { toast.error("Selecione o equipamento"); return; }
    if (mode === "now") {
      const { error } = await supabase.from("equipment").update({
        status: form.status,
        maintenance_problem: form.problem,
        maintenance_priority: form.priority,
        maintenance_responsible: form.responsible,
        maintenance_expected_return: form.expectedReturn || null,
        maintenance_started_at: new Date().toISOString()
      }).eq("id", selectedEqId);
      if (!error) { toast.success("Entrada realizada"); setIsAdding(false); load(); }
    } else {
      const { error } = await supabase.from("programming").insert({
        equipment_id: selectedEqId,
        scheduled_date: form.scheduledDate,
        day_of_week: "Calendário",
        stop_type: form.stopType,
        notes: form.problem,
        owner_id: user?.id
      });
      if (!error) { toast.success("Agendamento realizado!"); setIsAdding(false); }
    }
  };

  const release = async (id: string, identifier: string) => {
    const confirm = window.confirm(`Confirmar liberação do equipamento ${identifier}?`);
    if (!confirm) return;

    const { error } = await supabase.from("equipment").update({ 
      status: "disponivel", // Mudado para disponivel para garantir que saia da lista de oficina
      maintenance_problem: null,
      maintenance_expected_return: null,
      maintenance_priority: null,
      maintenance_responsible: null,
      maintenance_started_at: null
    }).eq("id", id);

    if (!error) {
      toast.success(`Equipamento ${identifier} liberado com sucesso!`);
      load();
    } else {
      toast.error("Erro ao liberar: " + error.message);
    }
  };

  const getDiasParado = (dateStr: string | null) => {
    if (!dateStr) return 0;
    const diff = new Date().getTime() - new Date(dateStr).getTime();
    return Math.max(0, Math.floor(diff / (1000 * 3600 * 24)));
  };

  const filtered = items.filter(e => 
    e.identifier.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (e.type || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const grouped = filtered.reduce((acc, e) => {
    const group = e.maintenance_type === "MEV" ? "MEV" : (e.type || "Geral");
    if (!acc[group]) acc[group] = [];
    acc[group].push(e);
    return acc;
  }, {} as Record<string, Equipment[]>);

  const sortedGroups = Object.keys(grouped).sort((a, b) => a === "MEV" ? -1 : b === "MEV" ? 1 : a.localeCompare(b));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-2 uppercase tracking-tighter text-foreground/90">
            <Wrench className="h-8 w-8 text-primary" /> CCO Manutenção
          </h1>
          <p className="text-muted-foreground font-medium italic">{items.length} máquinas em intervenção</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportToPDF} className="font-bold border-2 h-10 uppercase text-xs">
            <FileDown className="h-4 w-4 mr-2" /> Exportar Paisagem
          </Button>

          <Dialog open={isAdding} onOpenChange={setIsAdding}>
            <DialogTrigger asChild><Button className="font-bold uppercase shadow-lg h-10 text-xs"><PlusCircle className="h-4 w-4 mr-2" />Nova Intervenção</Button></DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle className="font-black uppercase">Controle de Frota</DialogTitle></DialogHeader>
              <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
                <TabsList className="grid grid-cols-2 w-full mb-4 h-12">
                  <TabsTrigger value="now" className="font-bold text-[10px]">PARAR AGORA</TabsTrigger>
                  <TabsTrigger value="schedule" className="font-bold text-[10px]">AGENDAR PARADA</TabsTrigger>
                </TabsList>
                <div className="space-y-4">
                  <div className="flex flex-col space-y-2">
                    <Label className="text-[10px] font-black uppercase">Equipamento</Label>
                    <Popover open={openCombo} onOpenChange={setOpenCombo}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-between h-12 font-bold">{selectedEqId ? availableEqs.find(x => x.id === selectedEqId)?.identifier : "PESQUISAR PLACA..."}<ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" /></Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                        <Command><CommandInput placeholder="Digite a placa..." /><CommandList><CommandEmpty>Não encontrado.</CommandEmpty><CommandGroup>
                          {availableEqs.map((eq) => (<CommandItem key={eq.id} onSelect={() => { setSelectedEqId(eq.id); setOpenCombo(false); }}><Check className={cn("mr-2 h-4 w-4", selectedEqId === eq.id ? "opacity-100" : "opacity-0")} />{eq.identifier}</CommandItem>))}
                        </CommandGroup></CommandList></Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  {mode === "now" ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Status</Label><Select value={form.status} onValueChange={(v) => setForm({...form, status: v as any})}><SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manutencao">Manutenção</SelectItem><SelectItem value="indisponivel">Indisponível</SelectItem></SelectContent></Select></div>
                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Prioridade</Label><Select value={form.priority} onValueChange={(v) => setForm({...form, priority: v})}><SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Média">Média</SelectItem><SelectItem value="Crítica">Crítica</SelectItem></SelectContent></Select></div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase text-primary flex items-center gap-1"><Hourglass className="h-3 w-3" /> Previsão de Retorno</Label>
                        <Input type="date" value={form.expectedReturn} onChange={(e) => setForm({...form, expectedReturn: e.target.value})} className="h-10 font-bold border-primary/30" />
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Data</Label><Input type="date" value={form.scheduledDate} onChange={(e) => setForm({...form, scheduledDate: e.target.value})} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Tipo</Label><Select value={form.stopType} onValueChange={(v) => setForm({...form, stopType: v})}><SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger><SelectContent>{STOP_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                  )}
                  <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Observações</Label><Textarea value={form.problem} onChange={(e) => setForm({...form, problem: e.target.value})} placeholder="Defeito relatado..." /></div>
                  <Button onClick={handleSubmit} className="w-full h-12 font-black uppercase bg-primary text-white">CONFIRMAR REGISTRO</Button>
                </div>
              </Tabs>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-8">
        {sortedGroups.map(group => (
          <section key={group} className="animate-in fade-in duration-500">
            <h2 className="text-lg font-black uppercase mb-3 flex items-center gap-2 border-b-2 pb-2 text-foreground/70">
              <Tag className="h-4 w-4 text-primary" /> {group === 'MEV' ? 'Equipamentos em MEV' : `Frota: ${group}`}
            </h2>
            <Card className="overflow-hidden border shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-muted/50 text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                    <tr>
                      <th className="px-4 py-4">Equipamento</th>
                      <th className="px-4 py-4 min-w-[200px]">Problema</th>
                      <th className="px-4 py-4 text-center">Início</th>
                      <th className="px-4 py-4 text-center">Previsão</th>
                      <th className="px-4 py-4 text-center">Dias</th>
                      <th className="px-4 py-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {grouped[group].map(e => (
                      <tr key={e.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-4"><p className="font-mono font-black text-base">{e.identifier}</p><p className="text-[9px] font-bold text-muted-foreground uppercase">{e.type}</p></td>
                        <td className="px-4 py-4">
                          <div className="bg-muted/30 p-2 rounded-lg text-xs font-medium border mb-1">{e.maintenance_problem || '—'}</div>
                          <Badge variant={e.maintenance_priority === 'Crítica' ? 'destructive' : 'secondary'} className="text-[9px] font-bold">{e.maintenance_priority || 'Média'}</Badge>
                        </td>
                        <td className="px-4 py-4 text-center font-medium text-muted-foreground">{e.maintenance_started_at ? new Date(e.maintenance_started_at).toLocaleDateString('pt-BR') : '—'}</td>
                        <td className="px-4 py-4 text-center">
                          {e.maintenance_expected_return ? (
                            <Badge variant="outline" className="border-primary text-primary font-black text-[10px]">{new Date(e.maintenance_expected_return).toLocaleDateString('pt-BR')}</Badge>
                          ) : <span className="text-muted-foreground/30 text-[10px] font-bold italic">NÃO INF.</span>}
                        </td>
                        <td className="px-4 py-4 text-center"><span className="text-lg font-black">{getDiasParado(e.maintenance_started_at || e.updated_at)}</span></td>
                        <td className="px-4 py-4 text-right">
                          <Button variant="outline" size="sm" onClick={() => release(e.id, e.identifier)} className="font-black border-2 h-8 text-[10px] text-emerald-600 border-emerald-100 hover:bg-emerald-50">LIBERAR</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}