import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { STATUS_LABELS, type EquipmentStatus } from "@/lib/equipment";
import { Wrench, Users, CircleCheck, Activity } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Disponibilidade Frota Busato" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; brand: string | null; model: string | null;
  status: EquipmentStatus; current_client_id: string | null;
};

const StatusIcon = ({ status }: { status: EquipmentStatus }) => {
  switch (status) {
    case "disponivel":
      return <CircleCheck className="h-5 w-5 text-[oklch(0.55_0.18_150)]" />;
    case "com_cliente":
      return <Users className="h-5 w-5 text-[oklch(0.55_0.18_250)]" />;
    case "manutencao":
      return <Wrench className="h-5 w-5 text-[oklch(0.6_0.2_50)]" />;
    case "em_atendimento":
      return <Activity className="h-5 w-5 text-[oklch(0.55_0.2_300)]" />;
    default:
      return <CircleCheck className="h-5 w-5 text-muted-foreground" />;
  }
};

function Dashboard() {
  const { user } = useAuth();
  const [equipment, setEquipment] = useState<Equipment[]>([]);

  const load = async () => {
    const { data: e } = await supabase.from("equipment").select("id,identifier,type,brand,model,status,current_client_id").order("identifier");
    setEquipment((e ?? []) as Equipment[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  // Agrupando por tipo
  const groupedEquipment = equipment.reduce((acc, eq) => {
    const type = eq.type || "Outros";
    if (!acc[type]) acc[type] = [];
    acc[type].push(eq);
    return acc;
  }, {} as Record<string, Equipment[]>);

  // Ordenando os tipos alfabeticamente
  const sortedTypes = Object.keys(groupedEquipment).sort();

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard de Frota</h1>
          <p className="text-muted-foreground flex items-center gap-2 mt-1 italic">
            <span className="h-2 w-2 rounded-full bg-[oklch(0.65_0.18_150)] animate-pulse" />
            Acompanhamento em tempo real por categoria
          </p>
        </div>
        <div className="flex gap-4">
           <Card className="px-4 py-2 bg-background/50 backdrop-blur border-dashed">
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Total Frota</p>
              <p className="text-xl font-bold">{equipment.length}</p>
           </Card>
           <Card className="px-4 py-2 bg-[oklch(0.65_0.18_150)]/10 border-[oklch(0.65_0.18_150)]/20">
              <p className="text-[10px] uppercase font-bold text-[oklch(0.55_0.18_150)] tracking-widest">Disponíveis</p>
              <p className="text-xl font-bold text-[oklch(0.55_0.18_150)]">{equipment.filter(e => e.status === 'disponivel').length}</p>
           </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
        {sortedTypes.length === 0 ? (
          <div className="col-span-full py-20 text-center border-2 border-dashed rounded-2xl bg-muted/20">
             <p className="text-muted-foreground">Nenhum equipamento cadastrado no sistema.</p>
          </div>
        ) : (
          sortedTypes.map((type) => {
            const items = groupedEquipment[type];
            const available = items.filter(e => e.status === "disponivel").length;
            const inMaint = items.filter(e => e.status === "manutencao").length;
            
            return (
              <Card key={type} className="overflow-hidden border-2 transition-all hover:border-primary/20 group">
                <div className="bg-muted/40 p-4 border-b flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold uppercase tracking-tight">{type}</h2>
                    <p className="text-xs text-muted-foreground">{items.length} unidades no total</p>
                  </div>
                  <div className="flex gap-2">
                    <div className="text-center px-2 py-1 rounded bg-background border shadow-sm">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase leading-none">Disp</p>
                      <p className="text-sm font-bold text-[oklch(0.55_0.18_150)]">{available}</p>
                    </div>
                    <div className="text-center px-2 py-1 rounded bg-background border shadow-sm">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase leading-none">Ofic</p>
                      <p className="text-sm font-bold text-[oklch(0.6_0.2_50)]">{inMaint}</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-background/50">
                   <div className="grid grid-cols-1 gap-2">
                      {items.map((eq) => (
                        <div key={eq.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 border border-transparent hover:border-primary/10 hover:bg-muted/40 transition-all">
                           <StatusIcon status={eq.status} />
                           <div className="flex-1 min-w-0">
                              <p className="font-mono font-bold text-sm">{eq.identifier}</p>
                              <p className="text-[10px] text-muted-foreground truncate uppercase">
                                {eq.brand} {eq.model}
                              </p>
                           </div>
                           <div className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              eq.status === 'disponivel' ? 'bg-[oklch(0.65_0.18_150)]/10 text-[oklch(0.55_0.18_150)]' :
                              eq.status === 'manutencao' ? 'bg-[oklch(0.65_0.2_50)]/10 text-[oklch(0.6_0.2_50)]' :
                              'bg-primary/10 text-primary'
                           }`}>
                              {STATUS_LABELS[eq.status]}
                           </div>
                        </div>
                      ))}
                   </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function EquipmentCard({ eq }: { eq: Equipment }) {
  return (
    <div className="border rounded-lg p-4 bg-background hover:shadow-md transition-shadow flex items-center gap-3">
      <div title={`Status: ${STATUS_LABELS[eq.status]}`}>
        <StatusIcon status={eq.status} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-base truncate">{eq.identifier}</p>
        <p className="text-sm text-muted-foreground truncate">
          {[eq.brand, eq.model].filter(Boolean).join(" ") || "Sem modelo definido"}
        </p>
      </div>
    </div>
  );
}
