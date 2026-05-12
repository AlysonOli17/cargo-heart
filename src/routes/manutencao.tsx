import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, CheckCircle2, PlusCircle, Clock, ShieldAlert, User, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, type EquipmentStatus } from "@/lib/equipment";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "Controle de Oficina — Frota Busato" }] }),
  component: () => <AppLayout><MaintenancePage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; model: string | null;
  maintenance_problem: string | null; 
  maintenance_expected_return: string | null;
  maintenance_type: string | null;
  maintenance_location: string | null;
  maintenance_started_at: string | null;
  sub_status: string | null;
  maintenance_priority: string | null;
  maintenance_responsible: string | null;
  technical_category: string | null;
  is_preventive_overdue: boolean;
  status: EquipmentStatus;
  updated_at: string;
};

const safeFormatDateFull = (dateStr: string | null) => {
  if (!dateStr || dateStr === "" || dateStr === "null") return "—";
  try {
    const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR");
  } catch (e) { return "—"; }
};

function MaintenancePage() {
  const { user } = useAuth();
  const { canWrite } = useRole();
  const [items, setItems] = useState<Equipment[]>([]);
  const [availableEqs, setAvailableEqs] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  
  const [newMaint, setNewMaint] = useState({
    equipment_id: "",
    status: "manutencao" as EquipmentStatus,
    sub_status: "Em reparo",
    problem: "",
    priority: "Média",
    category: "Geral",
    responsible: "",
    location: "Oficina Base",
    started_at: new Date().toISOString().split("T")[0],
    expected_return: "",
    preventive_overdue: false,
    m_type: "Corretiva"
  });

  const load = async () => {
    const { data } = await supabase
      .from("equipment")
      .select("*")
      .in("status", ["manutencao", "indisponivel", "finalizacao", "programado"])
      .order("updated_at", { ascending: false });
    setItems((data ?? []) as Equipment[]);

    const { data: av } = await supabase
      .from("equipment")
      .select("id, identifier")
      .order("identifier");
    setAvailableEqs(av ?? []);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("manut-integrated")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const sendToMaintenance = async () => {
    if (!newMaint.equipment_id || !newMaint.problem) {
      toast.error("Informe o equipamento e o problema");
      return;
    }

    const { error } = await supabase
      .from("equipment")
      .update({
        status: newMaint.status,
        sub_status: newMaint.sub_status,
        maintenance_problem: newMaint.problem.trim(),
        maintenance_priority: newMaint.priority,
        technical_category: newMaint.category,
        maintenance_responsible: newMaint.responsible,
        maintenance_location: newMaint.location,
        maintenance_type: newMaint.m_type,
        maintenance_expected_return: newMaint.expected_return || null,
        maintenance_started_at: newMaint.started_at ? newMaint.started_at + "T12:00:00Z" : new Date().toISOString(),
        is_preventive_overdue: newMaint.preventive_overdue,
        notes: JSON.stringify({
          maintenance_location: newMaint.location,
          maintenance_start_date: newMaint.started_at,
          maintenance_type: newMaint.m_type
        })
      })
      .eq("id", newMaint.equipment_id);

    if (!error) {
      await supabase.from("movements").insert({
        equipment_id: newMaint.equipment_id,
        to_status: newMaint.status,
        from_status: "operacional",
        notes: `Entrada CCO: ${newMaint.problem}`,
        owner_id: user.id
      });
      toast.success("Registrado com sucesso");
      setIsAdding(false);
      load();
    } else {
      toast.error(error.message);
    }
  };

  const release = async (eq: Equipment) => {
    const report = prompt(`Relatório final de liberação do ${eq.identifier}:`);
    if (report === null) return;

    setBusy(eq.id);
    const { error } = await supabase
      .from("equipment")
      .update({ 
        status: "operacional", 
        sub_status: "Disponível",
        maintenance_problem: null,
        maintenance_priority: "Baixa",
        maintenance_responsible: null,
        technical_category: null,
        maintenance_location: null,
        maintenance_expected_return: null,
        maintenance_started_at: null,
        is_preventive_overdue: false,
        notes: null
      })
      .eq("id", eq.id);

    if (!error) {
      await supabase.from("movements").insert({
        equipment_id: eq.id,
        to_status: "operacional",
        from_status: eq.status,
        notes: `Liberação: ${report}`,
        owner_id: user.id
      });
      toast.success(`${eq.identifier} liberado`);
    }
    setBusy(null);
  };

  const getDiasParado = (dateString: string | null) => {
    if (!dateString || dateString === "null") return 0;
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return 0;
      const diff = new Date().getTime() - d.getTime();
      return Math.max(0, Math.floor(diff / (1000 * 3600 * 24)));
    } catch (e) { return 0; }
  };

  // Agrupamento Híbrido: MEV primeiro, depois por Tipo
  const grouped = items.reduce((acc, e) => {
    const groupName = e.maintenance_type === "MEV" ? "MEV" : (e.type || "Geral");
    if (!acc[groupName]) acc[groupName] = [];
    acc[groupName].push(e);
    return acc;
  }, {} as Record<string, Equipment[]>);

  const sortedGroups = Object.keys(grouped).sort((a, b) => {
    if (a === "MEV") return -1;
    if (b === "MEV") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Clock className="h-7 w-7 text-primary" />
            Controle de Oficina
          </h1>
          <p className="text-muted-foreground mt-1 font-medium italic">{items.length} máquinas em intervenção</p>
        </div>

        <Dialog open={isAdding} onOpenChange={setIsAdding}>
          <DialogTrigger asChild>
            <Button disabled={!canWrite} className="bg-primary hover:bg-primary/90 text-white font-bold shadow-lg uppercase">
              <PlusCircle className="h-4 w-4 mr-2" />
              Nova Intervenção
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Registrar Entrada CCO/CCM</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4 pt-4">
              <div className="col-span-2 space-y-2">
                <Label>Equipamento *</Label>
                <Select value={newMaint.equipment_id} onValueChange={(v) => setNewMaint({...newMaint, equipment_id: v})}>
                  <SelectTrigger><SelectValue placeholder="Selecione o equipamento..." /></SelectTrigger>
                  <SelectContent>
                    {availableEqs.map(eq => (
                      <SelectItem key={eq.id} value={eq.id}>{eq.identifier}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status Principal</Label>
                <Select value={newMaint.status} onValueChange={(v) => setNewMaint({...newMaint, status: v as EquipmentStatus})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="programado">🟡 Manut. Programada</SelectItem>
                    <SelectItem value="manutencao">🟠 Em Manutenção</SelectItem>
                    <SelectItem value="indisponivel">🔴 Indisponível</SelectItem>
                    <SelectItem value="finalizacao">🔵 Finalização</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Prioridade</Label>
                <Select value={newMaint.priority} onValueChange={(v) => setNewMaint({...newMaint, priority: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Baixa">Baixa</SelectItem>
                    <SelectItem value="Média">Média</SelectItem>
                    <SelectItem value="Alta">Alta</SelectItem>
                    <SelectItem value="Crítica">Crítica</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 space-y-2">
                <Label>Problema Detectado *</Label>
                <Textarea value={newMaint.problem} onChange={(e) => setNewMaint({...newMaint, problem: e.target.value})} placeholder="Descreva o defeito..." />
              </div>

              <div className="space-y-2">
                <Label>Tipo de Serviço</Label>
                <Select value={newMaint.m_type} onValueChange={(v) => setNewMaint({...newMaint, m_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Corretiva">Corretiva</SelectItem>
                    <SelectItem value="MEV">MEV</SelectItem>
                    <SelectItem value="Preventiva">Preventiva</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Responsável</Label>
                <Input value={newMaint.responsible} onChange={(e) => setNewMaint({...newMaint, responsible: e.target.value})} placeholder="Mecânico / Empresa" />
              </div>

              <div className="grid grid-cols-2 gap-3 col-span-2">
                <div className="space-y-2">
                  <Label>Início</Label>
                  <Input type="date" value={newMaint.started_at} onChange={(e) => setNewMaint({...newMaint, started_at: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Previsão</Label>
                  <Input type="date" value={newMaint.expected_return} onChange={(e) => setNewMaint({...newMaint, expected_return: e.target.value})} />
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <Checkbox id="overdue" checked={newMaint.preventive_overdue} onCheckedChange={(c) => setNewMaint({...newMaint, preventive_overdue: !!c})} />
                <Label htmlFor="overdue" className="text-red-600 font-bold">Preventiva Vencida?</Label>
              </div>

              <Button onClick={sendToMaintenance} className="col-span-2 mt-4 font-bold bg-primary h-12 text-white">CONFIRMAR REGISTRO</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {sortedGroups.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground italic border-dashed">Nenhuma máquina na oficina no momento.</Card>
      ) : (
        <div className="space-y-8">
          {sortedGroups.map(groupName => (
            <section key={groupName} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
              <h2 className="text-xl font-bold mb-3 border-b-2 pb-2 flex items-center gap-2 uppercase tracking-tight text-foreground/80">
                <Wrench className="h-5 w-5 text-primary" />
                {groupName === 'MEV' ? 'Equipamentos em MEV' : `Frota: ${groupName}`}
                <span className="text-xs font-normal text-muted-foreground ml-2">({grouped[groupName].length} UN)</span>
              </h2>
              
              <Card className="overflow-hidden border-2 shadow-sm bg-card/50">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-muted/50 text-muted-foreground text-[10px] uppercase font-black tracking-widest">
                      <tr>
                        <th className="px-4 py-4">Equipamento</th>
                        <th className="px-4 py-4 min-w-[250px]">Problema / Status CCO</th>
                        <th className="px-4 py-4 text-center">Responsável</th>
                        <th className="px-4 py-4 text-center">Início</th>
                        <th className="px-4 py-4 text-center">Previsão</th>
                        <th className="px-4 py-4 text-center">Dias</th>
                        <th className="px-4 py-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {grouped[groupName]
                        .sort((a, b) => (a.identifier || "").localeCompare(b.identifier || ""))
                        .map((e) => {
                          const start = e.maintenance_started_at || e.updated_at;
                          const diasParado = getDiasParado(start);
                          const priorityClass = PRIORITY_COLORS[e.maintenance_priority as keyof typeof PRIORITY_COLORS] || "bg-slate-100";

                          return (
                            <tr key={e.id} className="hover:bg-muted/20 bg-background transition-colors">
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-3">
                                   <div className={`w-1 h-8 rounded-full ${STATUS_COLORS[e.status].split(' ')[0]}`} />
                                   <div>
                                      <p className="font-mono font-black text-base">{e.identifier}</p>
                                      <p className="text-[10px] font-bold text-muted-foreground uppercase">{e.type || '—'}</p>
                                   </div>
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="space-y-2">
                                   <div className="bg-muted/30 p-3 rounded-xl border border-foreground/5 text-xs font-medium">
                                      {e.maintenance_problem || <span className="italic text-muted-foreground">Não informada</span>}
                                   </div>
                                   <div className="flex gap-2">
                                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${priorityClass}`}>
                                        {e.maintenance_priority || 'Baixa'}
                                      </span>
                                      {e.is_preventive_overdue && (
                                        <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase bg-red-600 text-white animate-pulse">
                                          Vencida
                                        </span>
                                      )}
                                   </div>
                                </div>
                              </td>
                              <td className="px-4 py-4 text-center font-bold text-slate-600 uppercase text-[10px]">
                                {e.maintenance_responsible || "Não def."}
                              </td>
                              <td className="px-4 py-4 text-center font-medium text-muted-foreground whitespace-nowrap">
                                {safeFormatDateFull(start)}
                              </td>
                              <td className="px-4 py-4 text-center font-bold whitespace-nowrap">
                                {safeFormatDateFull(e.maintenance_expected_return)}
                              </td>
                              <td className="px-4 py-4 text-center">
                                <span className={`text-xl font-black ${diasParado > 5 ? "text-red-500" : "text-foreground/70"}`}>
                                  {diasParado}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-right whitespace-nowrap">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => release(e)}
                                  disabled={busy === e.id}
                                  className="hover:bg-primary hover:text-white font-bold border-2 rounded-xl"
                                >
                                  Liberar
                                </Button>
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
      )}
    </div>
  );
}