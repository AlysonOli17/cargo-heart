import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, CheckCircle2, PlusCircle, AlertCircle, User, Tag, Clock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { STATUS_LABELS, STATUS_COLORS, SUB_STATUS_OPTIONS, type EquipmentStatus } from "@/lib/equipment";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "CCO Manutenção — Frota Busato" }] }),
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
    preventive_overdue: false
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
      .in("status", ["disponivel", "operacional"])
      .order("identifier");
    setAvailableEqs(av ?? []);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("manut-ccm")
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
        maintenance_expected_return: newMaint.expected_return || null,
        maintenance_started_at: newMaint.started_at ? newMaint.started_at + "T12:00:00Z" : new Date().toISOString(),
        is_preventive_overdue: newMaint.preventive_overdue
      })
      .eq("id", newMaint.equipment_id);

    if (!error) {
      await supabase.from("movements").insert({
        equipment_id: newMaint.equipment_id,
        to_status: newMaint.status,
        from_status: "operacional",
        notes: `CCO: ${newMaint.sub_status} - ${newMaint.problem}`,
        owner_id: user.id
      });
      toast.success("Equipamento registrado no CCO");
      setIsAdding(false);
      load();
    } else {
      toast.error(error.message);
    }
  };

  const release = async (eq: Equipment) => {
    const report = prompt(`Relatório final para liberação do ${eq.identifier}:`);
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
        is_preventive_overdue: false
      })
      .eq("id", eq.id);

    if (!error) {
      await supabase.from("movements").insert({
        equipment_id: eq.id,
        to_status: "operacional",
        from_status: eq.status,
        notes: `Liberação CCO: ${report}`,
        owner_id: user.id
      });
      toast.success(`${eq.identifier} liberado para operação`);
    } else {
      toast.error(error.message);
    }
    setBusy(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2 text-foreground/90">
            <Clock className="h-7 w-7 text-primary" />
            Controle de Oficina (CCM)
          </h1>
          <p className="text-muted-foreground mt-1 font-medium italic">{items.length} intervenções em andamento</p>
        </div>

        <Dialog open={isAdding} onOpenChange={setIsAdding}>
          <DialogTrigger asChild>
            <Button disabled={!canWrite} className="bg-primary hover:bg-primary/90 text-white font-bold shadow-lg">
              <PlusCircle className="h-4 w-4 mr-2" />
              Nova Intervenção
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Registrar Intervenção CCO/CCM</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4 pt-4">
              <div className="col-span-2 space-y-2">
                <Label>Equipamento *</Label>
                <Select value={newMaint.equipment_id} onValueChange={(v) => setNewMaint({...newMaint, equipment_id: v})}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
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
                    <SelectItem value="programado">🟡 Programado</SelectItem>
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
                <Label>Problema / Observação *</Label>
                <Textarea value={newMaint.problem} onChange={(e) => setNewMaint({...newMaint, problem: e.target.value})} placeholder="Descreva a ocorrência..." />
              </div>

              <div className="space-y-2">
                <Label>Responsável</Label>
                <Input value={newMaint.responsible} onChange={(e) => setNewMaint({...newMaint, responsible: e.target.value})} placeholder="Mecânico / Empresa" />
              </div>

              <div className="space-y-2">
                <Label>Localização</Label>
                <Input value={newMaint.location} onChange={(e) => setNewMaint({...newMaint, location: e.target.value})} />
              </div>

              <div className="flex items-center space-x-2 pt-4">
                <Checkbox id="preventive" checked={newMaint.preventive_overdue} onCheckedChange={(c) => setNewMaint({...newMaint, preventive_overdue: !!c})} />
                <Label htmlFor="preventive" className="text-red-600 font-bold">Preventiva Vencida?</Label>
              </div>

              <Button onClick={sendToMaintenance} className="col-span-2 mt-4 font-bold">REGISTRAR NO CCO</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {items.map((e) => (
          <Card key={e.id} className="overflow-hidden border-l-4" style={{ borderLeftColor: `var(--${e.status})` }}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <h4 className="font-black text-xl">{e.identifier}</h4>
                  <p className="text-xs font-bold text-muted-foreground uppercase">{e.type}</p>
                </div>
                
                <div className="space-y-1">
                   <Badge className={STATUS_COLORS[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                   <p className="text-[10px] font-black uppercase text-center">{e.maintenance_priority}</p>
                </div>

                <div className="max-w-md hidden md:block">
                  <p className="text-sm font-medium leading-tight">{e.maintenance_problem}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Início: {safeFormatDateFull(e.maintenance_started_at)} | Responsável: {e.maintenance_responsible || '—'}</p>
                </div>
              </div>

              <Button onClick={() => release(e)} disabled={busy === e.id} variant="outline" className="font-bold border-2">
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
                Liberar
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}