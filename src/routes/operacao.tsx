import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, addDays, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, ChevronLeft, ChevronRight, Activity, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { toast } from "sonner";
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";

export const Route = createFileRoute("/operacao")({
  head: () => ({ meta: [{ title: "Operação ao vivo — Disponibilidade Frota Busato" }] }),
  component: () => <AppLayout><OperationPage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type?: string | null; status: EquipmentStatus; current_client_id: string | null;
  maintenance_problem: string | null; maintenance_expected_return: string | null;
  notes?: string | null;
};
type Client = { id: string; name: string };

function OperationPage() {
  const { user } = useAuth();
  const { isAdmin, canWrite } = useRole();
  const [date, setDate] = useState<Date>(new Date());
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [maintStartedAt, setMaintStartedAt] = useState<Record<string, string>>({});
  const today = isSameDay(date, new Date());
  const [requestEq, setRequestEq] = useState<Equipment | null>(null);
  const [reqClient, setReqClient] = useState("");
  const [reqNotes, setReqNotes] = useState("");
  const [isReplace, setIsReplace] = useState(false);
  const [replacePlate, setReplacePlate] = useState("");
  const [replaceReason, setReplaceReason] = useState("");
  const [clientOpen, setClientOpen] = useState(false);
  const [maintEqDetails, setMaintEqDetails] = useState<Equipment | null>(null);

  const [dayMovements, setDayMovements] = useState<any[]>([]);

  const load = async () => {
    const [{ data: e }, { data: c }] = await Promise.all([
      supabase.from("equipment").select("id,identifier,type,status,current_client_id,maintenance_problem,maintenance_expected_return,notes"),
      supabase.from("clients").select("id,name"),
    ]);
    setEquipment((e ?? []) as Equipment[]);
    setClients((c ?? []) as Client[]);
    const maintIds = ((e ?? []) as Equipment[]).filter(x => x.status === "manutencao").map(x => x.id);
    if (maintIds.length) {
      const { data: mv } = await supabase
        .from("movements")
        .select("equipment_id,created_at,to_status")
        .in("equipment_id", maintIds)
        .eq("to_status", "manutencao")
        .order("created_at", { ascending: false });
      const map: Record<string, string> = {};
      (mv ?? []).forEach((m: any) => { if (!map[m.equipment_id]) map[m.equipment_id] = m.created_at; });
      setMaintStartedAt(map);
    } else {
      setMaintStartedAt({});
    }
  };

  const loadDayMovements = async (selectedDate: Date) => {
    const start = new Date(selectedDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(selectedDate);
    end.setHours(23, 59, 59, 999);

    const { data } = await supabase
      .from("movements")
      .select(`
        id, created_at, from_status, to_status, notes,
        equipment:equipment_id(identifier, type),
        from_client:from_client_id(name),
        to_client:to_client_id(name)
      `)
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .order("created_at", { ascending: false });
    
    setDayMovements(data || []);
  };

  useEffect(() => {
    if (!user) return;
    load();
    loadDayMovements(date);
    
    if (!today) return;
    const ch = supabase.channel(`ops-${date.toDateString()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, date]);

  const byClient = useMemo(() => {
    return clients
      .map((c) => ({
        client: c,
        items: equipment.filter((e) => e.current_client_id === c.id && e.status !== "manutencao"),
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [clients, equipment]);

  const inMaintenance = useMemo(
    () => equipment
      .filter((e) => e.status === "manutencao")
      .sort((a, b) => (maintStartedAt[b.id] ?? "").localeCompare(maintStartedAt[a.id] ?? "")),
    [equipment, maintStartedAt]
  );

  const available = useMemo(
    () => equipment.filter((e) => e.status === "disponivel"),
    [equipment]
  );

  const submitRequest = async () => {
    if (!requestEq || !reqClient || !user) return;
    if (isReplace && (!replacePlate.trim() || !replaceReason.trim())) {
      toast.error("Informe a placa substituída e o motivo");
      return;
    }
    const { error } = await supabase.from("equipment_requests").insert({
      equipment_id: requestEq.id, client_id: reqClient,
      requested_by: user.id, owner_id: user.id, notes: reqNotes || null,
      is_replacement: isReplace,
      replacement_plate: isReplace ? replacePlate.trim() : null,
      replacement_reason: isReplace ? replaceReason.trim() : null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Solicitação enviada — aguardando aprovação");
      setRequestEq(null); setReqClient(""); setReqNotes("");
      setIsReplace(false); setReplacePlate(""); setReplaceReason("");
    }
  };

  return (
    !user ? null :
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
          {isAdmin && (
            <Button variant="outline" onClick={() => setClientOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />Cadastrar cliente
            </Button>
          )}
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

      {!today && (
        <Card className="p-6 border-[oklch(0.65_0.2_50)]/20 shadow-sm">
          <h2 className="font-semibold mb-6 text-xl flex items-center gap-2">
            <History className="h-5 w-5" /> Atividades do dia {format(date, "dd/MM/yyyy", { locale: ptBR })}
          </h2>
          {dayMovements.length === 0 ? (
            <p className="text-center text-muted-foreground py-10 bg-muted/30 rounded-lg border border-dashed">
              Nenhuma movimentação registrada neste dia.
            </p>
          ) : (
            <div className="space-y-4">
              {dayMovements.map(m => (
                <div key={m.id} className="border-l-4 border-primary pl-4 py-3 bg-muted/20 rounded-r-lg hover:bg-muted/40 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-base">{m.equipment?.identifier || "Equipamento deletado"}</span>
                    <span className="text-sm font-medium text-muted-foreground">{format(new Date(m.created_at), "HH:mm", { locale: ptBR })}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {m.from_status && <span className="line-through opacity-60">{STATUS_LABELS[m.from_status as EquipmentStatus]}</span>}
                    {m.from_status && <span className="text-muted-foreground">→</span>}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_COLORS[m.to_status as EquipmentStatus]}`}>
                      {STATUS_LABELS[m.to_status as EquipmentStatus]}
                    </span>
                  </div>
                  {(m.from_client?.name || m.to_client?.name) && (
                    <div className="text-sm mt-3 flex items-center gap-2 bg-background p-2 rounded border">
                      {m.from_client?.name && <span className="font-medium text-muted-foreground">De: <span className="text-foreground">{m.from_client.name}</span></span>}
                      {m.from_client?.name && m.to_client?.name && <span className="text-muted-foreground mx-1">→</span>}
                      {m.to_client?.name && <span className="font-medium text-muted-foreground">Para: <span className="text-foreground">{m.to_client.name}</span></span>}
                    </div>
                  )}
                  {m.notes && (
                    <p className="text-sm mt-3 text-foreground/80 italic border-l-2 pl-3 border-[oklch(0.65_0.18_150)]/50">
                      "{m.notes}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

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
                <button key={e.id} type="button" disabled={!canWrite}
                  onClick={() => setRequestEq(e)}
                  className="px-3 py-2 rounded bg-[oklch(0.65_0.18_150)]/10 border border-[oklch(0.65_0.18_150)]/30 text-sm font-mono text-center hover:bg-[oklch(0.65_0.18_150)]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {e.identifier}
                </button>
              ))}
            </div>
          )}
          {!canWrite && (
            <p className="text-xs text-muted-foreground mt-2 italic">
              Você não tem permissão para solicitar equipamentos.
            </p>
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
                  <li key={e.id} 
                    onClick={() => setMaintEqDetails(e)}
                    className="text-sm px-2 py-2 rounded bg-[oklch(0.65_0.2_50)]/10 space-y-1 cursor-pointer hover:bg-[oklch(0.65_0.2_50)]/20 transition-colors border border-transparent hover:border-[oklch(0.65_0.2_50)]/30">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-[oklch(0.6_0.2_50)]">*</span>
                      <span className="font-semibold">{e.identifier}</span>
                      {maintStartedAt[e.id] && (
                        <span className="ml-auto text-[10px] text-muted-foreground font-sans">
                          desde {format(new Date(maintStartedAt[e.id]), "dd/MM/yyyy", { locale: ptBR })}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-foreground/80 pl-4">
                      <span className="font-medium">Problema:</span>{" "}
                      {e.maintenance_problem || <span className="italic text-muted-foreground">não informado</span>}
                    </div>
                    <div className="text-xs text-muted-foreground pl-4 mt-1 flex items-center">
                       Clique para ver os detalhes
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <Dialog open={!!requestEq} onOpenChange={(o) => !o && setRequestEq(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar — {requestEq?.identifier}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Cliente *</Label>
              <Select value={reqClient} onValueChange={setReqClient}>
                <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Checkbox id="rep" checked={isReplace} onCheckedChange={(v) => setIsReplace(!!v)} />
              <Label htmlFor="rep" className="cursor-pointer">É substituição de outro equipamento?</Label>
            </div>
            {isReplace && (
              <>
                <div>
                  <Label>Placa / identificação substituída *</Label>
                  <Input value={replacePlate} onChange={(e) => setReplacePlate(e.target.value)} placeholder="Ex: ABC-1234" />
                </div>
                <div>
                  <Label>Motivo da substituição *</Label>
                  <Textarea value={replaceReason} onChange={(e) => setReplaceReason(e.target.value)} placeholder="Justifique a substituição..." />
                </div>
              </>
            )}
            <div>
              <Label>Observação</Label>
              <Textarea value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} placeholder="Opcional" />
            </div>
            <p className="text-xs text-muted-foreground">A solicitação será enviada para aprovação do administrador.</p>
            <Button onClick={submitRequest} disabled={!reqClient} className="w-full">Enviar solicitação</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo cliente</DialogTitle></DialogHeader>
          <ClientForm userId={user!.id} onDone={() => setClientOpen(false)} />
        </DialogContent>
      </Dialog>

      <MaintDetailsDialog 
        eq={maintEqDetails} 
        open={!!maintEqDetails} 
        onOpenChange={(o) => !o && setMaintEqDetails(null)} 
      />
    </div>
  );
}

import { differenceInDays } from "date-fns";

function MaintDetailsDialog({ eq, open, onOpenChange }: { eq: Equipment | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!eq) return null;
  
  let extraNotes: any = {};
  try { if (eq.notes) extraNotes = JSON.parse(eq.notes); } catch (e) {}

  const startDate = extraNotes.maintenance_start_date ? new Date(extraNotes.maintenance_start_date + "T00:00:00") : null;
  const daysStopped = startDate ? differenceInDays(new Date(), startDate) : 0;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <span className="h-2 w-2 rounded-full bg-[oklch(0.6_0.2_50)]" />
            Detalhes da Manutenção
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4 pb-4 border-b">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Equipamento</p>
              <p className="font-mono font-bold text-lg">{eq.identifier}</p>
              <p className="text-sm text-muted-foreground">{eq.type || "Sem tipo"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Status Atual</p>
              <StatusPill s={eq.status} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-muted/30 p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground font-medium mb-1">Tipo de Manutenção</p>
              <p className="font-semibold text-sm">{extraNotes.maintenance_type || "Não informado"}</p>
            </div>
            <div className="bg-muted/30 p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground font-medium mb-1">Local / Oficina</p>
              <p className="font-semibold text-sm">{extraNotes.maintenance_location || "Não informado"}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-muted/30 p-3 rounded-lg border">
              <p className="text-xs text-muted-foreground font-medium mb-1">Data de Início</p>
              <p className="font-semibold text-sm">
                {startDate ? format(startDate, "dd/MM/yyyy", { locale: ptBR }) : "Não informada"}
              </p>
            </div>
            <div className={`p-3 rounded-lg border ${daysStopped > 5 ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400" : "bg-muted/30"}`}>
              <p className="text-xs opacity-70 font-medium mb-1">Tempo Parado</p>
              <p className="font-semibold text-sm">
                {startDate ? `${daysStopped} dia${daysStopped !== 1 ? 's' : ''}` : "—"}
              </p>
            </div>
          </div>

          <div className="bg-muted/30 p-3 rounded-lg border mt-2">
             <p className="text-xs text-muted-foreground font-medium mb-1">Previsão de Retorno</p>
             <p className="font-semibold text-sm">
               {eq.maintenance_expected_return 
                  ? format(new Date(eq.maintenance_expected_return + "T00:00:00"), "dd/MM/yyyy", { locale: ptBR }) 
                  : "Não informada"}
             </p>
          </div>

          <div className="pt-2">
            <p className="text-xs text-muted-foreground font-medium mb-2">Problema Relatado</p>
            <div className="bg-background border p-3 rounded-md text-sm whitespace-pre-wrap">
              {eq.maintenance_problem || <span className="italic text-muted-foreground">Nenhum problema relatado.</span>}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusPill({ s }: { s: EquipmentStatus }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s]}`}>
      {STATUS_LABELS[s]}
    </span>
  );
}

function ClientForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [form, setForm] = useState({
    name: "", contact_name: "", phone: "", email: "", document: "", address: "", notes: "",
  });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.from("clients").insert({ ...form, owner_id: userId });
    setLoading(false);
    if (error) toast.error(error.message);
    else { toast.success("Cliente cadastrado"); onDone(); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div><Label>Nome *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Contato</Label><Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
        <div><Label>Telefone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><Label>Documento</Label><Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} /></div>
      </div>
      <div><Label>Endereço</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
      <div><Label>Observações</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? "Salvando..." : "Salvar"}</Button>
    </form>
  );
}