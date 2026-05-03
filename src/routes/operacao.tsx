import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, startOfDay, endOfDay, addDays, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, ChevronLeft, ChevronRight, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";

export const Route = createFileRoute("/operacao")({
  head: () => ({ meta: [{ title: "Operação ao vivo — FrotaPro" }] }),
  component: () => <AppLayout><OperationPage /></AppLayout>,
});

type Movement = {
  id: string;
  created_at: string;
  equipment_id: string;
  from_status: EquipmentStatus | null;
  to_status: EquipmentStatus;
  from_client_id: string | null;
  to_client_id: string | null;
};
type Equipment = { id: string; identifier: string };
type Client = { id: string; name: string };

function OperationPage() {
  const { user } = useAuth();
  const [date, setDate] = useState<Date>(new Date());
  const [movs, setMovs] = useState<Movement[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const today = isSameDay(date, new Date());

  const load = async () => {
    const start = startOfDay(date).toISOString();
    const end = endOfDay(date).toISOString();
    const [{ data: m }, { data: e }, { data: c }] = await Promise.all([
      supabase.from("movements").select("*")
        .gte("created_at", start).lte("created_at", end)
        .order("created_at", { ascending: false }),
      supabase.from("equipment").select("id,identifier"),
      supabase.from("clients").select("id,name"),
    ]);
    setMovs((m ?? []) as Movement[]);
    setEquipment((e ?? []) as Equipment[]);
    setClients((c ?? []) as Client[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    if (!today) return;
    const ch = supabase.channel(`ops-${date.toDateString()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "movements" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, date.toDateString()]);

  const eqName = (id: string) => equipment.find(e => e.id === id)?.identifier ?? "—";
  const clientName = (id: string | null) => id ? clients.find(c => c.id === id)?.name ?? "—" : "Sem cliente";

  const stats = useMemo(() => {
    const moved = new Set(movs.map(m => m.equipment_id)).size;
    const toClient = movs.filter(m => m.to_status === "com_cliente" && m.from_status !== "com_cliente").length;
    const toMaint = movs.filter(m => m.to_status === "manutencao").length;
    const toService = movs.filter(m => m.to_status === "em_atendimento").length;
    return { moved, toClient, toMaint, toService };
  }, [movs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            Operação
          </h1>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            {today ? (
              <><span className="h-2 w-2 rounded-full bg-[oklch(0.65_0.18_150)] animate-pulse" />Ao vivo</>
            ) : (
              <>Visualizando {format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="min-w-[200px] justify-start">
                <CalendarIcon className="h-4 w-4 mr-2" />
                {format(date, "dd 'de' MMM, yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)}
                disabled={(d) => d > new Date()} initialFocus
                locale={ptBR}
                className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" disabled={today}
            onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!today && <Button variant="secondary" onClick={() => setDate(new Date())}>Hoje</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Movimentações" value={movs.length} />
        <StatCard label="Equip. movidos" value={stats.moved} />
        <StatCard label="Saídas p/ cliente" value={stats.toClient} color="text-[oklch(0.55_0.18_250)]" />
        <StatCard label="Para manutenção" value={stats.toMaint} color="text-[oklch(0.6_0.2_50)]" />
      </div>

      <Card className="p-4">
        <h2 className="font-semibold mb-4">
          Linha do tempo {today && <span className="text-xs text-muted-foreground ml-2">(atualiza em tempo real)</span>}
        </h2>
        {movs.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">
            Nenhuma movimentação neste dia.
          </p>
        ) : (
          <div className="space-y-3">
            {movs.map((m) => (
              <div key={m.id} className="flex gap-3 border-l-2 border-primary pl-4 py-2">
                <div className="min-w-[60px] text-xs text-muted-foreground pt-1">
                  {format(new Date(m.created_at), "HH:mm:ss")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{eqName(m.equipment_id)}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-sm">
                    {m.from_status ? (
                      <>
                        <StatusPill s={m.from_status} />
                        <span className="text-muted-foreground">→</span>
                        <StatusPill s={m.to_status} />
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-muted-foreground italic">Cadastro</span>
                        <StatusPill s={m.to_status} />
                      </>
                    )}
                  </div>
                  {(m.from_client_id || m.to_client_id) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Cliente: {clientName(m.from_client_id)} → <span className="text-foreground font-medium">{clientName(m.to_client_id)}</span>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? ""}`}>{value}</p>
    </Card>
  );
}

function StatusPill({ s }: { s: EquipmentStatus }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s]}`}>
      {STATUS_LABELS[s]}
    </span>
  );
}