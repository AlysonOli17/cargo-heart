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
      <div>
        <h1 className="text-3xl font-bold">Dashboard de Equipamentos</h1>
        <p className="text-muted-foreground flex items-center gap-2 mt-1">
          <span className="h-2 w-2 rounded-full bg-[oklch(0.65_0.18_150)] animate-pulse" />
          Visão geral agrupada por tipo
        </p>
      </div>

      <div className="space-y-6">
        {sortedTypes.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">Nenhum equipamento cadastrado ainda.</Card>
        ) : (
          sortedTypes.map((type) => {
            const availableCount = groupedEquipment[type].filter(e => e.status === "disponivel").length;
            const maintenanceCount = groupedEquipment[type].filter(e => e.status === "manutencao").length;
            return (
              <section key={type}>
                <h2 className="text-xl font-semibold mb-3 border-b pb-2 flex items-center justify-between">
                  <span>{type}</span>
                  <span className="flex gap-4 text-sm font-medium">
                    <span className="text-[oklch(0.55_0.18_150)] flex items-center gap-1">
                      <CircleCheck className="h-4 w-4" /> {availableCount} Disponível
                    </span>
                    <span className="text-[oklch(0.6_0.2_50)] flex items-center gap-1">
                      <Wrench className="h-4 w-4" /> {maintenanceCount} em Manutenção
                    </span>
                  </span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {groupedEquipment[type].map((eq) => (
                    <EquipmentCard key={eq.id} eq={eq} />
                  ))}
                </div>
              </section>
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
