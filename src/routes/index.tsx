import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { STATUS_LABELS, type EquipmentStatus } from "@/lib/equipment";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Frota Busato" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; brand: string | null; model: string | null;
  status: EquipmentStatus; current_client_id: string | null;
};

function Dashboard() {
  const { user } = useAuth();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { data } = await supabase.from("equipment")
        .select("id,identifier,type,brand,model,status,current_client_id")
        .order("identifier");
      setEquipment((data ?? []) as Equipment[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("dashboard-simple").on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const grouped = equipment.reduce((acc, eq) => {
    const type = eq.type || "Outros";
    if (!acc[type]) acc[type] = [];
    acc[type].push(eq);
    return acc;
  }, {} as Record<string, Equipment[]>);

  if (loading) return <div className="p-10 text-center">Carregando dados...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight uppercase">Monitoramento de Frota</h1>
        <div className="bg-muted px-4 py-2 rounded-lg font-bold">Total: {equipment.length}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.keys(grouped).sort().map(type => (
          <Card key={type} className="p-4 shadow-md">
            <h2 className="text-xl font-bold mb-4 border-b pb-2 text-primary">{type}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {grouped[type].map(eq => (
                <div key={eq.id} className="p-2 border rounded text-center bg-background hover:bg-muted transition-colors">
                  <p className="font-mono font-bold text-sm">{eq.identifier}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">{STATUS_LABELS[eq.status]}</p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
