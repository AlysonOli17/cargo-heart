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

export const Route = createFileRoute("/manutencao")({
  head: () => ({ meta: [{ title: "Manutenção — FrotaPro" }] }),
  component: () => <AppLayout><MaintenancePage /></AppLayout>,
});

type Equipment = { id: string; identifier: string; type: string | null; model: string | null };

function MaintenancePage() {
  const { user } = useAuth();
  const { canWrite } = useRole();
  const [items, setItems] = useState<Equipment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("equipment")
      .select("id,identifier,type,model")
      .eq("status", "manutencao")
      .order("identifier");
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
    if (!confirm(`Liberar ${eq.identifier} da manutenção?`)) return;
    setBusy(eq.id);
    const { error } = await supabase
      .from("equipment")
      .update({ status: "disponivel", current_client_id: null })
      .eq("id", eq.id);
    setBusy(null);
    if (error) toast.error(error.message);
    else toast.success(`${eq.identifier} liberado para disponível`);
  };

  if (!user) return null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Wrench className="h-7 w-7 text-[oklch(0.65_0.2_50)]" />
          Manutenção
        </h1>
        <p className="text-muted-foreground mt-1">{items.length} equipamento(s) em manutenção</p>
      </div>

      {items.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          Nenhum equipamento em manutenção no momento.
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((e) => (
            <Card key={e.id} className="p-4 flex flex-col gap-3 border-[oklch(0.65_0.2_50)]/40">
              <div>
                <div className="font-mono font-semibold text-lg">{e.identifier}</div>
                <div className="text-sm text-muted-foreground">
                  {[e.type, e.model].filter(Boolean).join(" • ") || "—"}
                </div>
              </div>
              <Button
                onClick={() => release(e)}
                disabled={!canWrite || busy === e.id}
                className="bg-[oklch(0.65_0.18_150)] hover:bg-[oklch(0.6_0.18_150)] text-white"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Liberar para Disponível
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}