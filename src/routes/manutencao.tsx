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
import { STATUS_LABELS } from "@/lib/equipment";

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "Controle de Oficina — Frota Busato" }] }),
  component: () => <AppLayout><MaintenancePage /></AppLayout>,
});

function MaintenancePage() {
  const { user } = useAuth();
  const { canWrite } = useRole();
  const [items, setItems] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("equipment")
      .select("*")
      .eq("status", "manutencao")
      .order("updated_at", { ascending: false });
    setItems(data ?? []);
  };

  useEffect(() => {
    if (!user) return;
    load();
  }, [user]);

  if (!user) return null;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Oficina</h1>
      <div className="grid gap-4">
        {items.map((e) => (
          <Card key={e.id} className="p-4 flex items-center justify-between">
            <div>
              <p className="font-bold text-lg">{e.identifier}</p>
              <p className="text-sm text-muted-foreground">{e.maintenance_problem || "Sem descrição"}</p>
            </div>
            <Button variant="outline" size="sm" disabled={!canWrite}>
              Liberar
            </Button>
          </Card>
        ))}
        {items.length === 0 && <p className="text-muted-foreground">Vazio.</p>}
      </div>
    </div>
  );
}