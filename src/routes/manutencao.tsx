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
import { TriagemInbox } from "@/components/TriagemInbox";
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

const tzOffset = () => {
  const tzo = -new Date().getTimezoneOffset();
  const dif = tzo >= 0 ? '+' : '-';
  const pad = (num: number) => String(Math.floor(Math.abs(num))).padStart(2, '0');
  return `${dif}${pad(tzo / 60)}:${pad(tzo % 60)}`;
};

const getLocalDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "CCM MANUTENÇÃO — Frota Busato" }] }),
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

  // Estado para visualização detalhada
  const [selectedDetail, setSelectedDetail] = useState<Equipment | null>(null);

  // Estado para o Dialog de Edição Completa
  const [editingEq, setEditingEq] = useState<Equipment | null>(null);
  const [editForm, setEditForm] = useState({
    status: "manutencao" as EquipmentStatus,
    problem: "",
    priority: "Média",
    responsible: "",
    entryDate: "",
    expectedReturn: "",
    expectedReturnTime: "17:00",
    alertUserId: "",
    maintenanceType: "Manutenção Geral"
  });

  const [form, setForm] = useState({
    status: "manutencao" as EquipmentStatus,
    problem: "",
    priority: "Média",
    responsible: "",
    entryDate: getLocalDateString(), // Local current date
    scheduledDate: getLocalDateString(),
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
        maintenance_expected_return: form.expectedReturn ? `${form.expectedReturn}T${form.expectedReturnTime || '00:00'}:00${tzOffset()}` : null,
        maintenance_started_at: form.entryDate ? `${form.entryDate}T12:00:00${tzOffset()}` : null,
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

  const handleStartEdit = (e: Equipment) => {
    setEditingEq(e);
    const startDate = e.maintenance_started_at ? e.maintenance_started_at.split("T")[0] : "";
    let returnDate = "";
    let returnTime = "17:00";
    if (e.maintenance_expected_return) {
      const parts = e.maintenance_expected_return.split("T");
      returnDate = parts[0];
      if (parts[1]) {
        returnTime = parts[1].slice(0, 5);
      }
    }
    setEditForm({
      status: e.status,
      problem: e.maintenance_problem || "",
      priority: e.maintenance_priority || "Média",
      responsible: e.maintenance_responsible || "",
      entryDate: startDate,
      expectedReturn: returnDate,
      expectedReturnTime: returnTime,
      alertUserId: (e as any).alert_user_id || "",
      maintenanceType: e.maintenance_type || "Manutenção Geral"
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEq) return;
    const { error } = await supabase.from("equipment").update({
      status: editForm.status,
      maintenance_problem: editForm.problem,
      maintenance_priority: editForm.priority,
      maintenance_responsible: editForm.responsible,
      alert_user_id: editForm.alertUserId || null,
      maintenance_expected_return: editForm.expectedReturn ? `${editForm.expectedReturn}T${editForm.expectedReturnTime || '00:00'}:00${tzOffset()}` : null,
      maintenance_started_at: editForm.entryDate ? `${editForm.entryDate}T12:00:00${tzOffset()}` : null,
      maintenance_type: editForm.maintenanceType
    }).eq("id", editingEq.id);

    if (error) {
      toast.error(`Erro ao salvar edição: ${error.message}`);
    } else {
      toast.success("Intervenção editada com sucesso!");
      setEditingEq(null);
      load();
    }
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
          <h1 className="text-3xl font-black flex items-center gap-2 uppercase tracking-tighter text-foreground/90"><Wrench className="h-8 w-8 text-primary" /> CCM MANUTENÇÃO</h1>
          <p className="text-muted-foreground font-medium italic">{items.length} máquinas em intervenção oficial</p>
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
              <DialogHeader><DialogTitle className="font-black uppercase">Controle de Frota — Nova Intervenção</DialogTitle></DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4 py-2">
                <div className="flex flex-col space-y-2">
                  <Label className="text-[10px] font-black uppercase">Equipamento</Label>
                  <Popover open={openCombo} onOpenChange={setOpenCombo}>
                    <PopoverTrigger asChild><Button variant="outline" className="w-full justify-between h-12 font-bold">{selectedEqId ? availableEqs.find(x => x.id === selectedEqId)?.identifier : "PESQUISAR PLACA..."}<ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" /></Button></PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0"><Command><CommandInput placeholder="Digite a placa..." /><CommandList><CommandEmpty>Não encontrado.</CommandEmpty><CommandGroup>{availableEqs.map((eq) => (<CommandItem key={eq.id} onSelect={() => { setSelectedEqId(eq.id); setOpenCombo(false); }}><Check className={cn("mr-2 h-4 w-4", selectedEqId === eq.id ? "opacity-100" : "opacity-0")} />{eq.identifier}</CommandItem>))}</CommandGroup></CommandList></Command></PopoverContent>
                  </Popover>
                </div>
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
                <div className="space-y-2"><Label className="text-[10px] font-black uppercase">Observações Iniciais</Label><Textarea value={form.problem} onChange={(e) => setForm({...form, problem: e.target.value})} placeholder="Defeito relatado..." /></div>
                <Button onClick={handleSubmit} className="w-full h-12 font-black uppercase bg-primary text-white">CONFIRMAR REGISTRO</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Tabs defaultValue="triagem" className="w-full">
        <TabsList className="mb-6 bg-slate-100/80 p-1 rounded-xl">
          <TabsTrigger value="triagem" className="font-black uppercase text-xs data-[state=active]:bg-white data-[state=active]:text-indigo-700 data-[state=active]:shadow-sm px-6 h-9">
            Triagem (Forms)
          </TabsTrigger>
          <TabsTrigger value="os" className="font-black uppercase text-xs data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm px-6 h-9">
            Intervenções (O.S)
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="triagem" className="mt-0 outline-none">
          <TriagemInbox />
        </TabsContent>

        <TabsContent value="os" className="mt-0 outline-none space-y-8">
          {sortedGroups.map(group => (
            <section key={group} className="animate-in fade-in duration-500">
              <h2 className="text-sm font-black uppercase mb-3 flex items-center gap-2 border-b-2 pb-1.5 text-foreground/75">
                <Tag className="h-4 w-4 text-primary" /> 
                {group === 'MEV' ? 'Equipamentos em MEV' : `Frota: ${group}`}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {grouped[group].map(e => {
                  const dias = getDiasParado(e.maintenance_started_at || e.updated_at);
                  const threshold = alertRules.find(r => r.is_active)?.threshold_days || 5;
                  const isOverdue = dias >= threshold;

                  return (
                    <Card key={e.id} onClick={() => setSelectedDetail(e)} className={cn("p-3 flex flex-col justify-between border shadow-sm space-y-2.5 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all duration-200", isOverdue && "border-red-200 bg-red-50/10")}>
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-start gap-1">
                          <div className="flex items-center gap-1.5">
                            <p className="font-mono font-black text-sm text-slate-800">{e.identifier}</p>
                            {isOverdue && <AlertCircle className="h-3.5 w-3.5 text-red-600 animate-pulse" />}
                          </div>
                          <div className="text-[10px] font-black text-slate-900 bg-slate-100/80 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Clock className="h-3 w-3 text-slate-500" />
                            <span>{dias}d</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-1 text-[9px] font-bold uppercase">
                          <span className="text-muted-foreground">{e.type}</span>
                          {e.contract_type && (
                            <span className="text-primary font-black">· {e.contract_type}</span>
                          )}
                        </div>

                        <div className="bg-slate-50/80 border border-slate-100 p-2 rounded text-[11px] text-slate-650 max-h-16 overflow-y-auto whitespace-pre-wrap leading-tight">
                          {e.maintenance_problem || '—'}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                          <div>
                            <span className="block text-[8px] font-black uppercase text-slate-400">Entrada</span>
                            <span>{e.maintenance_started_at ? formatDate(e.maintenance_started_at).split(" ")[0] : '—'}</span>
                          </div>
                          <div className="text-right">
                            <span className="block text-[8px] font-black uppercase text-slate-400">Previsão</span>
                            {e.maintenance_expected_return ? (
                              <span className="text-primary font-black">{formatDate(e.maintenance_expected_return).split(" ")[0]}</span>
                            ) : (
                              <span className="italic text-slate-400 text-[9px]">N/I</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-1 pt-1.5 border-t border-slate-100">
                        <Button variant="outline" size="sm" onClick={(evt) => { evt.stopPropagation(); handleStartEdit(e); }} className="flex-1 font-bold h-7 text-[9px] text-amber-600 border-amber-100 hover:bg-amber-50 px-1.5">
                          EDITAR
                        </Button>
                        <Button variant="outline" size="sm" onClick={(evt) => { evt.stopPropagation(); setUpdatingEq(e); }} className="flex-1 font-bold h-7 text-[9px] text-blue-600 border-blue-100 hover:bg-blue-50 px-1.5">
                          HISTÓRICO
                        </Button>
                        <Button variant="outline" size="sm" onClick={(evt) => { evt.stopPropagation(); release(e); }} className="flex-1 font-bold h-7 text-[9px] text-emerald-600 border-emerald-100 hover:bg-emerald-50 px-1.5">
                          LIBERAR
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </TabsContent>
      </Tabs>

      {/* DIALOG DE ATUALIZAÇÃO DE STATUS / HISTÓRICO */}
      <Dialog open={!!updatingEq} onOpenChange={(o) => !o && setUpdatingEq(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
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
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
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

      {/* DIALOG DE EDIÇÃO COMPLETA */}
      <Dialog open={!!editingEq} onOpenChange={(o) => !o && setEditingEq(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black uppercase flex items-center gap-2 text-amber-650">
              <Edit3 className="h-5 w-5 text-amber-600" /> Editar Intervenção - {editingEq?.identifier}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">Data de Entrada</Label>
                <Input type="date" value={editForm.entryDate} onChange={(e) => setEditForm({...editForm, entryDate: e.target.value})} className="h-10 font-bold" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-primary">Previsão Retorno (Data)</Label>
                <Input type="date" value={editForm.expectedReturn} onChange={(e) => setEditForm({...editForm, expectedReturn: e.target.value})} className="h-10 font-bold border-primary/30" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase text-primary">Hora Prevista</Label>
                <Input type="time" value={editForm.expectedReturnTime} onChange={(e) => setEditForm({...editForm, expectedReturnTime: e.target.value})} className="h-10 font-bold border-primary/30" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">Usuário para Alerta</Label>
                <Select value={editForm.alertUserId} onValueChange={(v) => setEditForm({...editForm, alertUserId: v})}>
                  <SelectTrigger className="h-10 font-bold">
                    <SelectValue placeholder="Selecione..." />
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
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({...editForm, status: v as any})}>
                  <SelectTrigger className="h-10 font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manutencao">Manutenção</SelectItem>
                    <SelectItem value="indisponivel">Indisponível</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">Prioridade</Label>
                <Select value={editForm.priority} onValueChange={(v) => setEditForm({...editForm, priority: v})}>
                  <SelectTrigger className="h-10 font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Média">Média</SelectItem>
                    <SelectItem value="Crítica">Crítica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase">Tipo de Intervenção</Label>
              <Select value={editForm.maintenanceType} onValueChange={(v) => setEditForm({...editForm, maintenanceType: v})}>
                <SelectTrigger className="h-10 font-bold">
                  <SelectValue />
                </SelectTrigger>
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
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase">Observações / Problema</Label>
              <Textarea value={editForm.problem} onChange={(e) => setEditForm({...editForm, problem: e.target.value})} className="h-24" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSaveEdit} className="w-full h-12 font-black uppercase bg-amber-600 hover:bg-amber-700 text-white">
              SALVAR EDIÇÃO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG DE DETALHES COMPLETO */}
      <Dialog open={!!selectedDetail} onOpenChange={(o) => !o && setSelectedDetail(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black text-xl uppercase text-slate-800 flex items-center gap-2">
              <Wrench className="h-5 w-5 text-indigo-600" /> Detalhes da Intervenção
            </DialogTitle>
          </DialogHeader>
          {selectedDetail && (
            <div className="space-y-4 py-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Placa / Equipamento</p>
                  <p className="font-mono font-bold text-slate-800 text-lg uppercase">{selectedDetail.identifier}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Tipo de Equipamento</p>
                  <p className="font-semibold uppercase">{selectedDetail.type || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Contrato</p>
                  <p className="font-bold text-primary uppercase">{selectedDetail.contract_type || "Nenhum"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Status Atual</p>
                  <div>
                    <span className={cn(
                      "text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-widest inline-block border mt-1",
                      selectedDetail.status === 'manutencao' ? "bg-red-50 text-red-700 border-red-200" : "bg-orange-50 text-orange-700 border-orange-200"
                    )}>
                      {STATUS_LABELS[selectedDetail.status] || selectedDetail.status}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Tipo de Intervenção</p>
                  <p className="font-semibold uppercase">{selectedDetail.maintenance_type || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Prioridade</p>
                  <p className={cn(
                    "font-bold uppercase",
                    selectedDetail.maintenance_priority === 'Crítica' ? "text-red-600" : "text-amber-600"
                  )}>{selectedDetail.maintenance_priority || "Média"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Responsável</p>
                  <p className="font-semibold uppercase">{selectedDetail.maintenance_responsible || "Não definido"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Tempo em Manutenção</p>
                  <p className="font-semibold">{getDiasParado(selectedDetail.maintenance_started_at || selectedDetail.updated_at)} dias</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Data de Entrada</p>
                  <p className="font-semibold">{selectedDetail.maintenance_started_at ? formatDate(selectedDetail.maintenance_started_at) : "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Previsão de Retorno</p>
                  <p className="font-semibold text-primary">{selectedDetail.maintenance_expected_return ? formatDate(selectedDetail.maintenance_expected_return) : "Não informada"}</p>
                </div>
              </div>

              {selectedDetail.maintenance_problem && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-[10px] font-black uppercase text-slate-400 mb-3">Histórico de Ocorrências e Atualizações</p>
                  <div className="space-y-3 pl-2 border-l-2 border-slate-200 ml-2">
                    {selectedDetail.maintenance_problem.split('\n').filter(Boolean).map((line, i) => {
                      const isDateTag = line.match(/^\[(.*?)\]/);
                      let dateStr = "";
                      let contentStr = line;
                      let isHighlight = false;
                      
                      if (isDateTag) {
                        dateStr = isDateTag[1];
                        contentStr = line.replace(`[${dateStr}]`, '').trim();
                      }

                      if (contentStr.includes("[RESOLVIDO]") || contentStr.includes("[LIBERAÇÃO") || dateStr.includes("LIBERAÇÃO")) {
                         isHighlight = true;
                      } else if (contentStr.includes("TRIAGEM") || dateStr.includes("TRIAGEM")) {
                         isHighlight = true;
                      }

                      return (
                        <div key={i} className="relative">
                          <div className={cn(
                            "absolute -left-[25px] top-1 h-4 w-4 rounded-full border-2 border-white",
                            isHighlight ? "bg-indigo-500" : "bg-slate-400"
                          )} />
                          <div className={cn(
                            "p-2.5 rounded-lg border text-xs",
                            isHighlight ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-slate-50"
                          )}>
                            {dateStr && <span className="font-black text-[10px] uppercase text-indigo-700 block mb-0.5">{dateStr}</span>}
                            <span className="text-slate-700 font-medium leading-relaxed block mt-1">{contentStr}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t mt-4">
                <Button variant="outline" size="sm" className="flex-1 font-bold h-10 text-xs uppercase text-amber-600 border-amber-200 hover:bg-amber-50" onClick={(evt) => { evt.stopPropagation(); handleStartEdit(selectedDetail); setSelectedDetail(null); }}>
                  Editar
                </Button>
                <Button variant="outline" size="sm" className="flex-1 font-bold h-10 text-xs uppercase text-blue-600 border-blue-200 hover:bg-blue-50" onClick={(evt) => { evt.stopPropagation(); setUpdatingEq(selectedDetail); setSelectedDetail(null); }}>
                  Histórico
                </Button>
                <Button variant="outline" size="sm" className="flex-1 font-bold h-10 text-xs uppercase text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={(evt) => { evt.stopPropagation(); release(selectedDetail); setSelectedDetail(null); }}>
                  Liberar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}