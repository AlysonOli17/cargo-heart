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
type Equipment = { id: string; identifier: string; status: EquipmentStatus; current_client_id: string | null };
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
      supabase.from("equipment").select("id,identifier,status,current_client_id"),
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

  const byClient = useMemo(() => {
    return clients
      .map((c) => ({
        client: c,
        items: equipment.filter((e) => e.current_client_id === c.id && e.status !== "manutencao"),
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [clients, equipment]);

  const inMaintenance = useMemo(
    () => equipment.filter((e) => e.status === "manutencao"),
    [equipment]
  );

  const available = useMemo(
    () => equipment.filter((e) => e.status === "disponivel"),
    [equipment]
  );

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

      {today && (
        <Card className="p-4 border-[oklch(0.65_0.18_150)]/40">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[oklch(0.65_0.18_150)]" />
            Equipamentos disponíveis
            <span className="ml-auto text-xs text-muted-foreground">
              {available.length}
            </span>
          </h2>
          {available.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">
              Nenhum equipamento disponível.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {available.map((e) => (
                <div key={e.id} className="px-3 py-2 rounded bg-[oklch(0.65_0.18_150)]/10 border border-[oklch(0.65_0.18_150)]/30 text-sm font-mono text-center">
                  {e.identifier}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {today && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-4 lg:col-span-2">
            <h2 className="font-semibold mb-4">Operação por cliente</h2>
            {byClient.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">
                Nenhum cliente cadastrado.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {byClient.map(({ client, items }) => (
                  <div key={client.id} className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/60 px-3 py-2 text-center font-semibold text-sm uppercase tracking-wide border-b">
                      {client.name}
                    </div>
                    <div className="p-3 min-h-[80px]">
                      {items.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center italic py-2">
                          Sem equipamentos
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {items.map((e) => (
                            <li key={e.id} className="text-sm font-mono flex items-center gap-2">
                              <span className="text-primary">*</span>
                              <span>{e.identifier}</span>
                              {e.status === "em_atendimento" && (
                                <StatusPill s={e.status} />
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
                {available.length > 0 && (
                  <div className="border rounded-lg overflow-hidden border-dashed">
                    <div className="bg-[oklch(0.65_0.18_150)]/15 px-3 py-2 text-center font-semibold text-sm uppercase tracking-wide border-b">
                      Disponíveis
                    </div>
                    <div className="p-3 min-h-[80px]">
                      <ul className="space-y-1">
                        {available.map((e) => (
                          <li key={e.id} className="text-sm font-mono flex items-center gap-2">
                            <span className="text-[oklch(0.55_0.18_150)]">*</span>
                            <span>{e.identifier}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4 border-[oklch(0.65_0.2_50)]/40">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[oklch(0.65_0.2_50)]" />
              Em manutenção
              <span className="ml-auto text-xs text-muted-foreground">
                {inMaintenance.length}
              </span>
            </h2>
            {inMaintenance.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">
                Nenhum equipamento em manutenção.
              </p>
            ) : (
              <ul className="space-y-2">
                {inMaintenance.map((e) => (
                  <li key={e.id} className="text-sm font-mono flex items-center gap-2 px-2 py-1.5 rounded bg-[oklch(0.65_0.2_50)]/10">
                    <span className="text-[oklch(0.6_0.2_50)]">*</span>
                    <span>{e.identifier}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

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

function StatusPill({ s }: { s: EquipmentStatus }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s]}`}>
      {STATUS_LABELS[s]}
    </span>
  );
}