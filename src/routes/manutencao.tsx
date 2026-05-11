import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { STATUS_LABELS, STATUS_COLORS } from "@/lib/equipment";

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "Controle de Oficina — Frota Busato" }] }),
  component: () => <AppLayout><MaintenancePage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; model: string | null;
  maintenance_problem: string | null; maintenance_expected_return: string | null;
  updated_at: string; status: "manutencao"; current_client_id: string | null; notes: string | null;
};

type EnrichedEquipment = Equipment & { parsedNotes?: any, maintenance_type?: string };

function MaintenancePage() {
  const { user } = useAuth();
  const { canWrite } = useRole();
  const [items, setItems] = useState<Equipment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("equipment")
      .select("id,identifier,type,model,maintenance_problem,maintenance_expected_return,updated_at,status,current_client_id,notes")
      .eq("status", "manutencao")
      .order("updated_at", { ascending: false });
    setItems((data ?? []) as Equipment[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("manut-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

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
        maintenance_expected_return: null,
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

  const getDiasParado = (dateString: string) => {
    const diff = new Date().getTime() - new Date(dateString).getTime();
    const days = Math.floor(diff / (1000 * 3600 * 24));
    return days < 0 ? 0 : days;
  };

  const enrichedItems: EnrichedEquipment[] = items.map(e => {
    let parsedNotes: any = {};
    try { if (e.notes) parsedNotes = JSON.parse(e.notes); } catch (err) {}
    return { ...e, parsedNotes, maintenance_type: parsedNotes.maintenance_type || "Outros / Não Especificado" };
  });

  const grouped = enrichedItems.reduce((acc, e) => {
    const t = e.maintenance_type!;
    if (!acc[t]) acc[t] = [];
    acc[t].push(e);
    return acc;
  }, {} as Record<string, EnrichedEquipment[]>);

  const sortedTypes = Object.keys(grouped).sort();

  if (!user) return null;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wrench className="h-7 w-7 text-[oklch(0.65_0.2_50)]" />
            SITUAÇÃO OFICINA
          </h1>
          <p className="text-muted-foreground mt-1">{items.length} equipamento(s) parado(s) em manutenção</p>
        </div>
        <div className="text-sm font-medium text-muted-foreground bg-muted/50 px-4 py-2 rounded-md border">
          Data Base: {new Date().toLocaleDateString('pt-BR')}
        </div>
      </div>

      {sortedTypes.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground border border-border">
          Nenhum equipamento na oficina no momento.
        </Card>
      ) : (
        <div className="space-y-8">
          {sortedTypes.map(mType => (
            <section key={mType}>
              <h2 className="text-xl font-semibold mb-3 border-b pb-2 text-[oklch(0.65_0.2_50)] flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                Manutenção {mType}
                <span className="text-sm font-normal text-muted-foreground ml-2">({grouped[mType].length})</span>
              </h2>
              
              <Card className="overflow-hidden border border-border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead className="bg-muted text-muted-foreground text-xs uppercase font-semibold">
                      <tr>
                        <th className="px-4 py-3 border-b">Placa / ID</th>
                        <th className="px-4 py-3 border-b">Tipo</th>
                        <th className="px-4 py-3 border-b">Descrição do Problema</th>
                        <th className="px-4 py-3 border-b">Status Atual</th>
                        <th className="px-4 py-3 border-b">Local / Status</th>
                        <th className="px-4 py-3 border-b">Data Início</th>
                        <th className="px-4 py-3 border-b">Previsão</th>
                        <th className="px-4 py-3 border-b text-center">Dias Parado</th>
                        <th className="px-4 py-3 border-b text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {grouped[mType]
                        .sort((a, b) => (a.type || "").localeCompare(b.type || ""))
                        .map((e) => {
                          let loc = e.parsedNotes?.maintenance_location || "Oficina Base";
                          let start = e.parsedNotes?.maintenance_start_date || e.updated_at;
                          const diasParado = getDiasParado(start);
                          
                          return (
                            <tr key={e.id} className="hover:bg-muted/30 transition-colors bg-background">
                              <td className="px-4 py-3 font-mono font-semibold whitespace-nowrap">{e.identifier}</td>
                              <td className="px-4 py-3 whitespace-nowrap">{e.type || "—"}</td>
                              <td className="px-4 py-3 max-w-xs truncate" title={e.maintenance_problem || ""}>
                                {e.maintenance_problem || <span className="text-muted-foreground italic">Não informado</span>}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[e.status]}`}>
                                  {STATUS_LABELS[e.status]}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap font-medium text-amber-600 dark:text-amber-500">
                                {loc}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {new Date(start).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {e.maintenance_expected_return
                                  ? new Date(e.maintenance_expected_return + "T00:00:00").toLocaleDateString("pt-BR")
                                  : <span className="text-muted-foreground italic">—</span>}
                              </td>
                              <td className="px-4 py-3 text-center font-bold">
                                <span className={diasParado > 5 ? "text-destructive" : ""}>
                                  {diasParado}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => release(e)}
                                  disabled={!canWrite || busy === e.id}
                                  className="hover:bg-[oklch(0.65_0.18_150)] hover:text-white"
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