import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, CheckCircle2, PlusCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { STATUS_LABELS, STATUS_COLORS } from "@/lib/equipment";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  updated_at: string; status: "manutencao"; current_client_id: string | null; notes: string | null;
};

// Função de formatação ultra segura
const safeFormatDateFull = (dateStr: string | null) => {
  if (!dateStr || dateStr === "" || dateStr === "null") return "—";
  try {
    const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR");
  } catch (e) {
    return "—";
  }
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
    problem: "",
    type: "Corretiva",
    location: "Oficina Base",
    expected_return: ""
  });

  const load = async () => {
    const { data } = await supabase
      .from("equipment")
      .select(`
        id, identifier, type, model, 
        maintenance_problem, maintenance_expected_return, 
        maintenance_type, maintenance_location, maintenance_started_at,
        updated_at, status, current_client_id, notes
      `)
      .eq("status", "manutencao")
      .order("updated_at", { ascending: false });
    setItems((data ?? []) as Equipment[]);

    const { data: av } = await supabase
      .from("equipment")
      .select("id, identifier")
      .eq("status", "disponivel")
      .order("identifier");
    setAvailableEqs(av ?? []);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("manut-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const sendToMaintenance = async () => {
    if (!newMaint.equipment_id || !newMaint.problem) {
      toast.error("Selecione o equipamento e descreva o problema");
      return;
    }

    const { error } = await supabase
      .from("equipment")
      .update({
        status: "manutencao",
        maintenance_problem: newMaint.problem,
        maintenance_type: newMaint.type,
        maintenance_location: newMaint.location,
        maintenance_expected_return: newMaint.expected_return || null,
        maintenance_started_at: new Date().toISOString()
      })
      .eq("id", newMaint.equipment_id);

    if (!error) {
      await supabase.from("movements").insert({
        equipment_id: newMaint.equipment_id,
        to_status: "manutencao",
        from_status: "disponivel",
        notes: `Entrada na oficina: ${newMaint.problem}`,
        owner_id: user.id
      });
      toast.success("Equipamento enviado para manutenção");
      setIsAdding(false);
      setNewMaint({ equipment_id: "", problem: "", type: "Corretiva", location: "Oficina Base", expected_return: "" });
      load();
    } else {
      toast.error(error.message);
    }
  };

  const release = async (eq: Equipment) => {
    const report = prompt(`Relatório do serviço realizado no ${eq.identifier} (opcional):`);
    if (report === null) return;

    setBusy(eq.id);
    const { error } = await supabase
      .from("equipment")
      .update({ 
        status: "disponivel", 
        current_client_id: null,
        maintenance_problem: null,
        maintenance_type: null,
        maintenance_location: null,
        maintenance_expected_return: null,
        maintenance_started_at: null,
        notes: null
      })
      .eq("id", eq.id);

    if (!error && report.trim()) {
      await supabase.from("movements").insert({
        equipment_id: eq.id,
        to_status: "disponivel",
        from_status: "manutencao",
        notes: `Serviço realizado: ${report}`,
        owner_id: user.id
      });
    }

    setBusy(null);
    if (error) toast.error(error.message);
    else toast.success(`${eq.identifier} liberado para disponível`);
  };

  const getDiasParado = (dateString: string | null) => {
    if (!dateString || dateString === "null") return 0;
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return 0;
      const diff = new Date().getTime() - d.getTime();
      const days = Math.floor(diff / (1000 * 3600 * 24));
      return days < 0 ? 0 : days;
    } catch (e) { return 0; }
  };

  const grouped = items.reduce((acc, e) => {
    const t = e.maintenance_type || "Geral";
    if (!acc[t]) acc[t] = [];
    acc[t].push(e);
    return acc;
  }, {} as Record<string, Equipment[]>);

  const sortedTypes = Object.keys(grouped).sort();

  if (!user) return null;
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-2 text-foreground/90 uppercase tracking-tighter">
            <Wrench className="h-7 w-7 text-[oklch(0.65_0.2_50)]" />
            SITUAÇÃO OFICINA
          </h1>
          <p className="text-muted-foreground mt-1 font-medium italic">{items.length} máquinas paradas</p>
        </div>

        <div className="flex items-center gap-3">
          <Dialog open={isAdding} onOpenChange={setIsAdding}>
            <DialogTrigger asChild>
              <Button disabled={!canWrite} className="bg-[oklch(0.65_0.2_50)] hover:bg-[oklch(0.55_0.2_50)] text-white font-bold shadow-lg">
                <PlusCircle className="h-4 w-4 mr-2" />
                Enviar para Oficina
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Entrada de Equipamento</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
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
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select value={newMaint.type} onValueChange={(v) => setNewMaint({...newMaint, type: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Corretiva">Corretiva</SelectItem>
                        <SelectItem value="Preventiva">Preventiva</SelectItem>
                        <SelectItem value="Preditiva">Preditiva</SelectItem>
                        <SelectItem value="Pintura">Pintura/Estética</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Localização</Label>
                    <Input value={newMaint.location} onChange={(e) => setNewMaint({...newMaint, location: e.target.value})} placeholder="Onde?" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Problema *</Label>
                  <Textarea value={newMaint.problem} onChange={(e) => setNewMaint({...newMaint, problem: e.target.value})} placeholder="Descreva o defeito" />
                </div>

                <div className="space-y-2">
                  <Label>Previsão</Label>
                  <Input type="date" value={newMaint.expected_return} onChange={(e) => setNewMaint({...newMaint, expected_return: e.target.value})} />
                </div>

                <Button onClick={sendToMaintenance} className="w-full bg-[oklch(0.65_0.2_50)] text-white font-bold">Salvar Entrada</Button>
              </div>
            </DialogContent>
          </Dialog>

          <div className="text-sm font-bold text-muted-foreground bg-muted/50 px-4 py-2 rounded-xl border">
            {new Date().toLocaleDateString('pt-BR')}
          </div>
        </div>
      </div>

      {sortedTypes.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Nenhum equipamento na oficina no momento.</Card>
      ) : (
        <div className="space-y-10">
          {sortedTypes.map(mType => (
            <section key={mType}>
              <h2 className="text-xl font-bold mb-3 border-b-2 pb-2 text-[oklch(0.65_0.2_50)] flex items-center gap-2 uppercase tracking-tighter">
                <Wrench className="h-5 w-5" />
                Manutenção {mType}
                <span className="text-sm font-normal text-muted-foreground ml-2">({grouped[mType].length})</span>
              </h2>
              
              <Card className="overflow-hidden border-none shadow-xl bg-card/50">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-muted/50 text-muted-foreground text-[10px] uppercase font-black tracking-widest">
                      <tr>
                        <th className="px-4 py-4">Equipamento</th>
                        <th className="px-4 py-4 min-w-[250px]">Descrição Detalhada</th>
                        <th className="px-4 py-4">Localização</th>
                        <th className="px-4 py-4">Início</th>
                        <th className="px-4 py-4">Previsão</th>
                        <th className="px-4 py-4 text-center">Dias Parado</th>
                        <th className="px-4 py-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {grouped[mType]
                        .sort((a, b) => (a.identifier || "").localeCompare(b.identifier || ""))
                        .map((e) => {
                          const start = e.maintenance_started_at || e.updated_at;
                          const diasParado = getDiasParado(start);
                          
                          return (
                            <tr key={e.id} className="hover:bg-muted/20 bg-background transition-colors">
                              <td className="px-4 py-4">
                                <p className="font-mono font-black text-base">{e.identifier}</p>
                                <p className="text-[10px] font-bold text-muted-foreground uppercase">{e.type || '—'}</p>
                              </td>
                              <td className="px-4 py-4">
                                <div className="bg-muted/30 p-3 rounded-2xl border border-foreground/5 text-xs leading-relaxed font-medium">
                                  {e.maintenance_problem || <span className="italic text-muted-foreground">Não informada</span>}
                                </div>
                              </td>
                              <td className="px-4 py-4 font-bold text-amber-600 uppercase text-xs">
                                {e.maintenance_location || "Oficina Base"}
                              </td>
                              <td className="px-4 py-4 font-medium text-muted-foreground whitespace-nowrap">
                                {safeFormatDateFull(start)}
                              </td>
                              <td className="px-4 py-4 font-bold whitespace-nowrap">
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
                                  disabled={!canWrite || busy === e.id}
                                  className="hover:bg-[oklch(0.65_0.18_150)] hover:text-white font-bold border-2 rounded-xl"
                                >
                                  <CheckCircle2 className="h-4 w-4 mr-1" />
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