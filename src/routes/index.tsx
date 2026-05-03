import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";
import { Wrench, Users, CircleCheck, Activity } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — FrotaPro" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; brand: string | null; model: string | null;
  status: EquipmentStatus; current_client_id: string | null;
};
type Client = { id: string; name: string; contact_name: string | null };

function Dashboard() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);

  const load = async () => {
    const [{ data: c }, { data: e }] = await Promise.all([
      supabase.from("clients").select("id,name,contact_name").order("name"),
      supabase.from("equipment").select("id,identifier,type,brand,model,status,current_client_id").order("identifier"),
    ]);
    setClients(c ?? []);
    setEquipment((e ?? []) as Equipment[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const counts = {
    total: equipment.length,
    disponivel: equipment.filter(e => e.status === "disponivel").length,
    com_cliente: equipment.filter(e => e.status === "com_cliente").length,
    manutencao: equipment.filter(e => e.status === "manutencao").length,
    em_atendimento: equipment.filter(e => e.status === "em_atendimento").length,
  };

  const unassigned = equipment.filter(e => !e.current_client_id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground flex items-center gap-2 mt-1">
          <span className="h-2 w-2 rounded-full bg-[oklch(0.65_0.18_150)] animate-pulse" />
          Atualização em tempo real
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={Wrench} label="Total" value={counts.total} />
        <StatCard icon={CircleCheck} label="Disponível" value={counts.disponivel} color="text-[oklch(0.55_0.18_150)]" />
        <StatCard icon={Users} label="Com Cliente" value={counts.com_cliente} color="text-[oklch(0.55_0.18_250)]" />
        <StatCard icon={Wrench} label="Manutenção" value={counts.manutencao} color="text-[oklch(0.6_0.2_50)]" />
        <StatCard icon={Activity} label="Em Atendimento" value={counts.em_atendimento} color="text-[oklch(0.55_0.2_300)]" />
      </div>

      <section>
        <h2 className="text-xl font-semibold mb-3">Clientes</h2>
        {clients.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">Nenhum cliente cadastrado ainda.</Card>
        ) : (
          <div className="space-y-4">
            {clients.map((client) => {
              const items = equipment.filter(e => e.current_client_id === client.id);
              return (
                <Card key={client.id} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-lg">{client.name}</h3>
                      {client.contact_name && <p className="text-sm text-muted-foreground">{client.contact_name}</p>}
                    </div>
                    <Badge variant="secondary">{items.length} equip.</Badge>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">Sem equipamentos</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {items.map((e) => <EquipmentCard key={e.id} eq={e} />)}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {unassigned.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3">Sem cliente vinculado</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {unassigned.map((e) => <EquipmentCard key={e.id} eq={e} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${color ?? "text-muted-foreground"}`} />
      </div>
      <p className={`text-2xl font-bold mt-2 ${color ?? ""}`}>{value}</p>
    </Card>
  );
}

function EquipmentCard({ eq }: { eq: Equipment }) {
  return (
    <div className="border rounded-lg p-3 bg-background hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold truncate">{eq.identifier}</p>
          <p className="text-xs text-muted-foreground truncate">
            {[eq.brand, eq.model].filter(Boolean).join(" ") || eq.type || "—"}
          </p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_COLORS[eq.status]}`}>
          {STATUS_LABELS[eq.status]}
        </span>
      </div>
    </div>
  );
}
