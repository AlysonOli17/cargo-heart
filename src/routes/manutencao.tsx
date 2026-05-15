import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wrench, CheckCircle2, PlusCircle, Clock, Calendar as CalendarIcon, Tag, Check, ChevronsUpDown, Search, FileDown, Hourglass, Edit3 } from "lucide-react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
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
import { format } from "date-fns";

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "CCO Manutenção — Frota Busato" }] }),
  component: () => <AppLayout><MaintenancePage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; status: EquipmentStatus;
  maintenance_problem: string | null; maintenance_started_at: string | null; maintenance_expected_return: string | null;
  maintenance_priority: string | null; maintenance_responsible: string | null; maintenance_type: string | null;
  updated_at: string; sub_status?: string; contract_type: string | null;
};

type AlertRule = { id: string; name: string; threshold_days: number; is_active: boolean; };

const STOP_TYPES = ["Manutenção Geral", "MEV", "Lavador", "Mola", "Borracharia", "Preventiva", "Elétrica", "Motor", "Solda"];

function MaintenancePage() {
  const { user } = useAuth();
  const { canWrite } = useRole();
  const [items, setItems] = useState<Equipment[]>([]);
  const [availableEqs, setAvailableEqs] = useState<{id: string, identifier: string}[]>([]);
  const [users, setUsers] = useState<{id: string, full_name: string | null}[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [openCombo, setOpenCombo] = useState(false);
  const [selectedEqId, setSelectedEqId] = useState("");
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);

  // Estado para o Dialog de Atualização
  const [updatingEq, setUpdatingEq] = useState<Equipment | null>(null);
  const [newUpdateInfo, setNewUpdateInfo] = useState("");
  const [isSolved, setIsSolved] = useState<"yes" | "no">("no");
  
  // Estado para o Dialog de Liberação Final
  const [releasingEq, setReleasingEq] = useState<Equipment | null>(null);
  const [releaseInfo, setReleaseInfo] = useState("");

  const [form, setForm] = useState({
    status: "manutencao" as EquipmentStatus,
    problem: "",
    priority: "Média",
    responsible: "",
    entryDate: new Date().toISOString().split("T")[0], // Data de entrada manual
    scheduledDate: new Date().toISOString().split("T")[0],
    expectedReturn: "",
    expectedReturnTime: "17:00", // Default time
    alertUserId: "", // User to be alerted
    stopType: "Manutenção Geral",
    maintenanceType: "Manutenção Geral"
  });

  // Triggering new build to ensure async fix is applied
  const load = async () => {
    const [{ data: e }, { data: rls }, { data: profs }] = await Promise.all([
      supabase.from("equipment").select("*").order("identifier"),
      supabase.from("alert_rules").select("*").eq("is_active", true),
      supabase.from("profiles").select("id, full_name")
    ]);
    
    setAvailableEqs((e ?? []).map(x => ({ id: x.id, identifier: x.identifier })));
    setItems((e ?? []).filter(x => ['manutencao', 'indisponivel', 'finalizacao', 'programado'].includes(x.status)) as Equipment[]);
    setAlertRules((rls ?? []) as AlertRule[]);
    setUsers((profs ?? []) as any[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("maint-realtime-v1")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_rules" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const handleSubmit = async () => {
    if (!selectedEqId) { toast.error("Selecione o equipamento"); return; }
    
    // Verificação de duplicidade de equipamento em manutenção ativa
    const activeMaintenance = items.find(i => i.id === selectedEqId && ['manutencao', 'indisponivel', 'finalizacao'].includes(i.status));
    if (activeMaintenance && mode === "now") {
        toast.error("Este equipamento já está em manutenção!");
        return;
    }

    if (mode === "now") {
      const { error } = await supabase.from("equipment").update({
        status: form.status,
        maintenance_problem: form.problem,
        maintenance_priority: form.priority,
        maintenance_responsible: form.responsible,
        alert_user_id: form.alertUserId || null,
        maintenance_expected_return: form.expectedReturn ? `${form.expectedReturn}T${form.expectedReturnTime || '00:00'}:00` : null,
        maintenance_started_at: new Date(form.entryDate).toISOString(),
        maintenance_type: form.maintenanceType
      }).eq("id", selectedEqId);
      
      if (error) {
        toast.error(`Erro ao atualizar manutenção: ${error.message}`);
      } else { 
        toast.success("Entrada realizada"); 
        setIsAdding(false); 
        load(); 
      }
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

  const handleUpdateStatus = async () => {
    if (!updatingEq) return;
    
    let finalProblem = "";
    const dateTag = `[${new Date().toLocaleDateString('pt-BR')}]`;

    if (isSolved === "yes") {
      finalProblem = dateTag + " [RESOLVIDO] " + newUpdateInfo;
    } else {
      finalProblem = dateTag + " " + newUpdateInfo + "\n" + (updatingEq.maintenance_problem || "");
    }

    const { error } = await supabase.from("equipment").update({
      maintenance_problem: finalProblem
    }).eq("id", updatingEq.id);

    if (error) {
      toast.error(`Erro ao atualizar: ${error.message}`);
    } else {
      // Registrar no histórico de movimentos
      await supabase.from("movements").insert({
        equipment_id: updatingEq.id,
        from_status: updatingEq.status,
        to_status: updatingEq.status,
        notes: `ATUALIZAÇÃO: ${newUpdateInfo}`,
        owner_id: user?.id
      });

      toast.success("Histórico atualizado!");
      setUpdatingEq(null);
      setNewUpdateInfo("");
      load();
    }
  };

  const handleQuickVerify = async (e: Equipment) => {
    const dateTag = `[${new Date().toLocaleDateString('pt-BR')}]`;
    const checkNote = "Verificação diária realizada: Sem alterações.";
    
    // Evita duplicar se já foi verificado hoje
    if (e.maintenance_problem?.includes(dateTag + " " + checkNote)) {
      toast.info("Já verificado hoje!");
      return;
    }

    const finalProblem = dateTag + " " + checkNote + "\n" + (e.maintenance_problem || "");
    const { error } = await supabase.from("equipment").update({ 
      maintenance_problem: finalProblem,
      last_verified_at: new Date().toISOString()
    }).eq("id", e.id);
    
    if (error) {
      console.error("Erro ao verificar:", error);
      toast.error(`Erro ao verificar: ${error.message}`);
    } else {
      // Registrar no histórico de movimentos
      await supabase.from("movements").insert({
        equipment_id: e.id,
        from_status: e.status,
        to_status: e.status,
        notes: `AUDITORIA: ${checkNote}`,
        owner_id: user?.id
      });

      toast.success("Verificação registrada!");
      load();
    }
  };

  const handleFinalRelease = async () => {
    if (!releasingEq || !releaseInfo) {
      toast.error("Descreva o que foi realizado para liberar.");
      return;
    }

    const dateTag = `[LIBERAÇÃO ${new Date().toLocaleDateString('pt-BR')}]`;
    const finalProblem = (releasingEq.maintenance_problem || "") + "\n" + dateTag + " " + releaseInfo;

    const { error } = await supabase.from("equipment").update({ 
      status: "operacional", 
      maintenance_problem: finalProblem, 
      maintenance_expected_return: null, 
      maintenance_priority: null, 
      maintenance_responsible: null, 
      maintenance_started_at: null 
    }).eq("id", releasingEq.id);
    
    if (error) {
      console.error("Erro ao liberar:", error);
      toast.error(`Falha ao liberar: ${error.message}`);
    } else { 
      toast.success(`${releasingEq.identifier} liberado com sucesso!`); 
      setReleasingEq(null);
      setReleaseInfo("");
      load(); 
    }
  };

  const release = (e: Equipment) => {
    setReleasingEq(e);
    setReleaseInfo("");
  };

  const getDiasParado = (dateStr: string | null) => {
    if (!dateStr) return 0;
    const d = dateStr.includes("T") ? new Date(dateStr) : new Date(dateStr + "T12:00:00");
    const diff = new Date().getTime() - d.getTime();
    return Math.max(0, Math.floor(diff / (1000 * 3600 * 24)));
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const d = dateStr.includes("T") ? new Date(dateStr) : new Date(dateStr + "T12:00:00");
    const formattedDate = d.toLocaleDateString('pt-BR');
    if (dateStr.includes("T")) {
      const hours = d.getHours().toString().padStart(2, '0');
      const minutes = d.getMinutes().toString().padStart(2, '0');
      return `${formattedDate} ${hours}:${minutes}`;
    }
    return formattedDate;
  };

  const filtered = items.filter(e => e.identifier.toLowerCase().includes(searchQuery.toLowerCase()) || (e.type || "").toLowerCase().includes(searchQuery.toLowerCase()));
  
  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const today = format(new Date(), "dd/MM/yyyy HH:mm");
    const busatoBlue = [41, 128, 185]; // #2980B9
    
    // Header Corporativo
    doc.setFillColor(busatoBlue[0], busatoBlue[1], busatoBlue[2]);
    doc.rect(0, 0, 297, 25, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text("RELATÓRIO GERENCIAL - CCO MANUTENÇÃO", 14, 15);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`FROTA BUSATO | GERADO EM: ${today}`, 14, 21);

    // Resumo Gerencial (KPIs no PDF)
    const stats = {
      total: filtered.length,
      mev: filtered.filter(e => e.maintenance_type === "MEV").length,
      criticos: filtered.filter(e => e.maintenance_priority === "Crítica").length,
      mediaDias: filtered.length > 0 ? (filtered.reduce((acc, e) => acc + getDiasParado(e.maintenance_started_at), 0) / filtered.length).toFixed(1) : 0
    };

    doc.setTextColor(40, 40, 40);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("SUMÁRIO EXECUTIVO", 14, 35);
    
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 37, 283, 37);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Total em Intervenção: ${stats.total}`, 14, 45);
    doc.text(`Equipamentos MEV: ${stats.mev}`, 70, 45);
    doc.text(`Prioridades Críticas: ${stats.criticos}`, 130, 45);
    doc.text(`Permanência Média: ${stats.mediaDias} dias`, 190, 45);

    // Tabela Agrupada
    const tableData = filtered.sort((a, b) => (a.contract_type || "").localeCompare(b.contract_type || "")).map(e => [
      e.identifier,
      e.contract_type || "Eventual",
      e.maintenance_type || "Geral",
      e.maintenance_problem || "-",
      { content: e.maintenance_priority || "Média", styles: { textColor: e.maintenance_priority === "Crítica" ? [200, 0, 0] : [40, 40, 40], fontStyle: e.maintenance_priority === "Crítica" ? "bold" : "normal" } },
      e.maintenance_started_at ? formatDate(e.maintenance_started_at) : "-",
      e.maintenance_expected_return ? formatDate(e.maintenance_expected_return) : "-",
      getDiasParado(e.maintenance_started_at || e.updated_at).toString()
    ]);

    autoTable(doc, {
      startY: 55,
      head: [["Placa", "Contrato", "Tipo", "Status / Histórico do Problema", "Prioridade", "Entrada", "Previsão", "Dias"]],
      body: tableData as any,
      theme: "grid",
      headStyles: { fillColor: busatoBlue, textColor: 255, fontStyle: "bold", halign: 'center' },
      styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
      columnStyles: { 
        3: { cellWidth: 70 },
        4: { halign: 'center' },
        7: { halign: 'center', fontStyle: 'bold' }
      },
      didDrawPage: (data) => {
        // Footer
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Página ${data.pageNumber}`, 280, 200);
      }
    });

    doc.save(`relatorio_gerencial_busato_${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast.success("PDF Gerencial gerado com sucesso!");
  };

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
          <h1 className="text-3xl font-black flex items-center gap-2 uppercase tracking-tighter text-foreground/90"><Wrench className="h-8 w-8 text-primary" /> CCO Manutenção</h1>
          <p className="text-muted-foreground font-medium italic">{items.length} máquinas em intervenção</p>
        </div>
        <div className="md:hidden w-full">
           <div className="relative">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
             <Input 
               placeholder="Buscar placa ou tipo..." 
               value={searchQuery} 
               onChange={(e) => setSearchQuery(e.target.value)} 
               className="pl-9 w-full rounded-xl h-10 border-2 bg-muted/30 focus:bg-background transition-all" 
             />
           </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar placa ou tipo..." 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              className="pl-9 w-64 rounded-xl h-10 border-2 bg-muted/30 focus:bg-background transition-all" 
            />
            {searchQuery && (
              <span className="absolute -bottom-5 right-0 text-[9px] font-bold text-muted-foreground uppercase">
                {filtered.length} encontrados
              </span>
            )}
          </div>
          <Button variant="outline" onClick={handleExportPDF} className="font-bold border-2 h-10 uppercase text-xs"><FileDown className="h-4 w-4 mr-2" /> Exportar Paisagem</Button>
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
                      <PopoverTrigger asChild><Button variant="outline" className="w-full justify-between h-12 font-bold">{selectedEqId ? availableEqs.find(x => x.id === selectedEqId)?.identifier : "PESQUISAR PLACA..."}<ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" /></Button></PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0"><Command><CommandInput placeholder="Digite a placa..." /><CommandList><CommandEmpty>Não encontrado.</CommandEmpty><CommandGroup>{availableEqs.map((eq) => (<CommandItem key={eq.id} onSelect={() => { setSelectedEqId(eq.id); setOpenCombo(false); }}><Check className={cn("mr-2 h-4 w-4", selectedEqId === eq.id ? "opacity-100" : "opacity-0")} />{eq.identifier}</CommandItem>))}</CommandGroup></CommandList></Command></PopoverContent>
                    </Popover>
                  </div>
                  {mode === "now" ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Data de Entrada</Label><Input type="date" value={form.entryDate} onChange={(e) => setForm({...form, entryDate: e.target.value})} className="h-10 font-bold" /></div>
                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase text-primary">Previsão Retorno (Data)</Label><Input type="date" value={form.expectedReturn} onChange={(e) => setForm({...form, expectedReturn: e.target.value})} className="h-10 font-bold border-primary/30" /></div>
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase text-primary">Hora Prevista para Liberação</Label>
                          <Input 
                            type="time" 
                            value={form.expectedReturnTime} 
                            onChange={(e) => setForm({...form, expectedReturnTime: e.target.value})} 
                            className="h-10 font-bold border-primary/30" 
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase">Usuário para Alerta de Atraso</Label>
                          <Select value={form.alertUserId} onValueChange={(v) => setForm({...form, alertUserId: v})}>
                            <SelectTrigger className="h-10 font-bold">
                              <SelectValue placeholder="Selecione um usuário..." />
                            </SelectTrigger>
                            <SelectContent>
                              {users.map(u => (
                                <SelectItem key={u.id} value={u.id}>{u.full_name || "Sem Nome"}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Status</Label><Select value={form.status} onValueChange={(v) => setForm({...form, status: v as any})}><SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manutencao">Manutenção</SelectItem><SelectItem value="indisponivel">Indisponível</SelectItem></SelectContent></Select></div>
                        <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Prioridade</Label><Select value={form.priority} onValueChange={(v) => setForm({...form, priority: v})}><SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Média">Média</SelectItem><SelectItem value="Crítica">Crítica</SelectItem></SelectContent></Select></div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase">Tipo de Intervenção</Label>
                        <Select value={form.maintenanceType} onValueChange={(v) => setForm({...form, maintenanceType: v})}>
                          <SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Manutenção Geral">Manutenção Geral</SelectItem>
                            <SelectItem value="MEV">MEV</SelectItem>
                            <SelectItem value="Lavador">Lavador</SelectItem>
                            <SelectItem value="Mola">Mola</SelectItem>
                            <SelectItem value="Preventiva">Preventiva</SelectItem>
                            <SelectItem value="Elétrica">Elétrica</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Data</Label><Input type="date" value={form.scheduledDate} onChange={(e) => setForm({...form, scheduledDate: e.target.value})} className="h-10 font-bold" /></div>
                      <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Tipo</Label><Select value={form.stopType} onValueChange={(v) => setForm({...form, stopType: v})}><SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger><SelectContent>{STOP_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
                    </div>
                  )}
                  <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Observações Iniciais</Label><Textarea value={form.problem} onChange={(e) => setForm({...form, problem: e.target.value})} placeholder="Defeito relatado..." /></div>
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
            <h2 className="text-lg font-black uppercase mb-3 flex items-center gap-2 border-b-2 pb-2 text-foreground/70"><Tag className="h-4 w-4 text-primary" /> {group === 'MEV' ? 'Equipamentos em MEV' : `Frota: ${group}`}</h2>
            <Card className="overflow-hidden border shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-muted/50 text-[10px] uppercase font-black tracking-widest text-muted-foreground">
                    <tr><th className="px-4 py-4">Equipamento</th><th className="px-4 py-4 min-w-[200px]">Status / Histórico</th><th className="px-4 py-4 text-center">Entrada</th><th className="px-4 py-4 text-center">Previsão</th><th className="px-4 py-4 text-center">Dias</th><th className="px-4 py-4 text-right">Ações</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {grouped[group].map(e => {
                      const dias = getDiasParado(e.maintenance_started_at || e.updated_at);
                      const threshold = alertRules.find(r => r.is_active)?.threshold_days || 5;
                      const isOverdue = dias >= threshold;

                      return (
                        <tr key={e.id} className={cn("hover:bg-muted/20 transition-colors", isOverdue && "bg-red-50/50")}>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2">
                              <p className="font-mono font-black text-base">{e.identifier}</p>
                              {isOverdue && <AlertCircle className="h-4 w-4 text-red-600 animate-pulse" />}
                            </div>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase">{e.type}</p>
                            {e.contract_type && (
                              <p className="text-[9px] font-black text-primary uppercase mt-0.5">{e.contract_type}</p>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <div className="bg-muted/30 p-2 rounded-lg text-xs font-medium border mb-1 whitespace-pre-wrap">{e.maintenance_problem || '—'}</div>
                            <Badge variant={e.maintenance_priority === 'Crítica' ? 'destructive' : 'secondary'} className="text-[9px] font-bold">{e.maintenance_priority || 'Média'}</Badge>
                          </td>
                          <td className="px-4 py-4 text-center font-medium text-muted-foreground">{e.maintenance_started_at ? formatDate(e.maintenance_started_at) : '—'}</td>
                          <td className="px-4 py-4 text-center">{e.maintenance_expected_return ? (<Badge variant="outline" className="border-primary text-primary font-black text-[10px]">{formatDate(e.maintenance_expected_return)}</Badge>) : <span className="text-muted-foreground/30 text-[10px] font-bold italic">NÃO INF.</span>}</td>
                          <td className="px-4 py-4 text-center">
                            <span className={cn("text-lg font-black", isOverdue && "text-red-600")}>{dias}</span>
                          </td>
                          <td className="px-4 py-4 text-right flex items-center justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleQuickVerify(e)} className="font-black border-2 h-8 text-[10px] text-emerald-600 border-emerald-100 hover:bg-emerald-50"><CheckCircle2 className="h-3 w-3 mr-1" /> VERIFICAR</Button>
                            <Button variant="outline" size="sm" onClick={() => setUpdatingEq(e)} className="font-black border-2 h-8 text-[10px] text-blue-600 border-blue-100 hover:bg-blue-50"><Edit3 className="h-3 w-3 mr-1" /> ATUALIZAR</Button>
                            <Button variant="outline" size="sm" onClick={() => release(e)} className="font-black border-2 h-8 text-[10px] text-emerald-600 border-emerald-100 hover:bg-emerald-50">LIBERAR</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        ))}
      </div>

      {/* DIALOG DE ATUALIZAÇÃO DE STATUS / HISTÓRICO */}
      <Dialog open={!!updatingEq} onOpenChange={(o) => !o && setUpdatingEq(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-black uppercase flex items-center gap-2"><Edit3 className="h-5 w-5 text-blue-600" /> Atualizar {updatingEq?.identifier}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
             <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">O problema anterior foi resolvido?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant={isSolved === "yes" ? "default" : "outline"} onClick={() => setIsSolved("yes")} className="font-bold text-xs uppercase">SIM (Substituir)</Button>
                  <Button variant={isSolved === "no" ? "default" : "outline"} onClick={() => setIsSolved("no")} className="font-bold text-xs uppercase">NÃO (Adicionar)</Button>
                </div>
             </div>
             <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">Nova Informação / Status Atual</Label>
                <Textarea value={newUpdateInfo} onChange={(e) => setNewUpdateInfo(e.target.value)} placeholder="O que está sendo feito agora?" className="h-32" />
                <p className="text-[9px] text-muted-foreground italic">
                  {isSolved === "no" ? "* Isso manterá o texto anterior e adicionará este no final." : "* Isso apagará o texto anterior e deixará apenas este."}
                </p>
             </div>
          </div>
          <DialogFooter>
            <Button onClick={handleUpdateStatus} className="w-full h-12 font-black uppercase bg-blue-600 text-white">SALVAR ATUALIZAÇÃO</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG DE LIBERAÇÃO FINAL (FECHAMENTO) */}
      <Dialog open={!!releasingEq} onOpenChange={(o) => !o && setReleasingEq(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-black uppercase flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" /> Liberar {releasingEq?.identifier}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
             <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                <p className="text-[10px] font-black text-emerald-800 uppercase mb-1">Resumo da Manutenção</p>
                <p className="text-xs text-emerald-900 italic">Ao liberar, este equipamento voltará para o status "Operacional".</p>
             </div>
             <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">O que foi resolvido? (Relatório de Saída)</Label>
                <Textarea 
                  value={releaseInfo} 
                  onChange={(e) => setReleaseInfo(e.target.value)} 
                  placeholder="Descreva as peças trocadas ou serviços realizados..." 
                  className="h-32 border-2 focus:border-emerald-500" 
                />
             </div>
          </div>
          <DialogFooter>
            <Button onClick={handleFinalRelease} className="w-full h-12 font-black uppercase bg-emerald-600 text-white hover:bg-emerald-700">
              CONFIRMAR E LIBERAR EQUIPAMENTO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}