import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, History, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/equipamentos")({
  head: () => ({ meta: [{ title: "Equipamentos — Disponibilidade Frota Busato" }] }),
  component: () => <AppLayout><EquipmentPage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; brand: string | null; model: string | null;
  serial_number: string | null; year: number | null; hour_meter: number | null; notes: string | null;
  status: EquipmentStatus; current_client_id: string | null;
  maintenance_problem: string | null; maintenance_expected_return: string | null;
};
type Client = { id: string; name: string };
type Movement = {
  id: string; created_at: string; from_status: EquipmentStatus | null; to_status: EquipmentStatus;
  from_client_id: string | null; to_client_id: string | null; notes: string | null;
};

function EquipmentPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Equipment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [historyFor, setHistoryFor] = useState<Equipment | null>(null);

  const load = async () => {
    const [{ data: e }, { data: c }] = await Promise.all([
      supabase.from("equipment").select("*").order("identifier"),
      supabase.from("clients").select("id,name").order("name"),
    ]);
    setItems((e ?? []) as Equipment[]);
    setClients((c ?? []) as Client[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("eq-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  if (!user) return null;

  const remove = async (id: string) => {
    if (!confirm("Excluir equipamento?")) return;
    const { error } = await supabase.from("equipment").delete().eq("id", id);
    if (error) toast.error(error.message); else toast.success("Excluído");
  };

  const clientName = (id: string | null) => id ? clients.find(c => c.id === id)?.name ?? "—" : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Equipamentos</h1>
          <p className="text-muted-foreground">{items.length} cadastrados</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo equipamento</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} equipamento</DialogTitle></DialogHeader>
            <EquipmentForm equipment={editing} clients={clients} userId={user!.id} onDone={() => { setOpen(false); setEditing(null); }} />
          </DialogContent>
        </Dialog>
      </div>

      {items.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">Nenhum equipamento. Clique em "Novo equipamento".</Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(
            items.reduce<Record<string, Equipment[]>>((acc, eq) => {
              const k = eq.type?.trim() || "Sem tipo";
              (acc[k] ||= []).push(eq);
              return acc;
            }, {})
          )
            .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
            .map(([type, group]) => (
              <section key={type} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{type}</h2>
                  <span className="text-xs text-muted-foreground">({group.length})</span>
                  <div className="flex-1 border-t" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((eq) => (
                    <Card key={eq.id} className="p-4 space-y-2">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{eq.identifier}</h3>
                  <p className="text-sm text-muted-foreground truncate">
                    {[eq.brand, eq.model].filter(Boolean).join(" ") || eq.type || "—"}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-full font-medium whitespace-nowrap ${STATUS_COLORS[eq.status]}`}>
                  {STATUS_LABELS[eq.status]}
                </span>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {eq.serial_number && <p>Série: {eq.serial_number}</p>}
                <p>Cliente: <span className="text-foreground">{clientName(eq.current_client_id)}</span></p>
                {eq.hour_meter != null && <p>Horímetro: {eq.hour_meter}h</p>}
                {eq.status === "manutencao" && (eq.maintenance_problem || eq.maintenance_expected_return) && (
                  <div className="mt-1 p-2 rounded bg-[oklch(0.65_0.2_50)]/10 border border-[oklch(0.65_0.2_50)]/30 text-foreground">
                    <p className="flex items-center gap-1 font-medium"><Wrench className="h-3 w-3" />Manutenção</p>
                    {eq.maintenance_problem && <p>Problema: {eq.maintenance_problem}</p>}
                    {eq.maintenance_expected_return && <p>Previsão: {new Date(eq.maintenance_expected_return + "T00:00:00").toLocaleDateString("pt-BR")}</p>}
                  </div>
                )}
              </div>
              <div className="flex gap-1 pt-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setHistoryFor(eq)}><History className="h-3 w-3 mr-1" />Hist.</Button>
                <Button variant="ghost" size="icon" onClick={() => { setEditing(eq); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => remove(eq.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Histórico — {historyFor?.identifier}</DialogTitle></DialogHeader>
          {historyFor && <HistoryView equipmentId={historyFor.id} clientName={clientName} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryView({ equipmentId, clientName }: { equipmentId: string; clientName: (id: string | null) => string }) {
  const [movs, setMovs] = useState<Movement[]>([]);
  useEffect(() => {
    supabase.from("movements").select("*").eq("equipment_id", equipmentId).order("created_at", { ascending: false })
      .then(({ data }) => setMovs((data ?? []) as Movement[]));
  }, [equipmentId]);
  if (movs.length === 0) return <p className="text-sm text-muted-foreground">Sem movimentações.</p>;
  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {movs.map((m) => (
        <div key={m.id} className="border-l-2 border-primary pl-3 py-1">
          <p className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
          <p className="text-sm">
            {m.from_status ? <>{STATUS_LABELS[m.from_status]} → </> : "Cadastro: "}
            <strong>{STATUS_LABELS[m.to_status]}</strong>
          </p>
          {(m.from_client_id || m.to_client_id) && (
            <p className="text-xs text-muted-foreground">Cliente: {clientName(m.from_client_id)} → {clientName(m.to_client_id)}</p>
          )}
          {m.notes && <p className="text-xs text-foreground/80 italic mt-0.5">{m.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function EquipmentForm({ equipment, clients, userId, onDone }: { equipment: Equipment | null; clients: Client[]; userId: string; onDone: () => void }) {
  const [form, setForm] = useState({
    identifier: equipment?.identifier ?? "",
    type: equipment?.type ?? "",
    model: equipment?.model ?? "",
    status: (equipment?.status ?? "disponivel") as EquipmentStatus,
    current_client_id: equipment?.current_client_id ?? "",
    maintenance_problem: equipment?.maintenance_problem ?? "",
    maintenance_expected_return: equipment?.maintenance_expected_return ?? "",
  });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.status === "manutencao" && !form.maintenance_problem.trim()) {
      toast.error("Informe qual é o problema da manutenção");
      return;
    }
    if (form.status === "com_cliente" && !form.current_client_id) {
      toast.error("Selecione o cliente para o equipamento");
      return;
    }
    setLoading(true);
    const payload: any = {
      owner_id: userId,
      identifier: form.identifier,
      type: form.type || null,
      model: form.model || null,
      status: form.status,
      current_client_id: form.status === "com_cliente" ? form.current_client_id : null,
      maintenance_problem: form.status === "manutencao" ? form.maintenance_problem.trim() : null,
      maintenance_expected_return: form.status === "manutencao" && form.maintenance_expected_return ? form.maintenance_expected_return : null,
    };
    const { error } = equipment
      ? await supabase.from("equipment").update(payload).eq("id", equipment.id)
      : await supabase.from("equipment").insert(payload);
    setLoading(false);
    if (error) toast.error(error.message);
    else { toast.success(equipment ? "Atualizado" : "Cadastrado"); onDone(); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Identificação *</Label><Input required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} /></div>
        <div><Label>Tipo</Label><Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="Escavadeira, Trator..." /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Modelo</Label><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as EquipmentStatus })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABELS) as EquipmentStatus[]).map(s => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {form.status === "com_cliente" && (
        <div>
          <Label>Cliente *</Label>
          <Select value={form.current_client_id} onValueChange={(v) => setForm({ ...form, current_client_id: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
            <SelectContent>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">O equipamento permanecerá com este cliente até alguém alterar manualmente.</p>
        </div>
      )}
      {form.status === "manutencao" && (
        <div className="space-y-3 p-3 rounded-md bg-[oklch(0.65_0.2_50)]/10 border border-[oklch(0.65_0.2_50)]/30">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wrench className="h-4 w-4" />Detalhes da manutenção
          </div>
          <div>
            <Label>Qual é o problema? *</Label>
            <Textarea required value={form.maintenance_problem}
              onChange={(e) => setForm({ ...form, maintenance_problem: e.target.value })}
              placeholder="Descreva o problema do equipamento" />
          </div>
          <div>
            <Label>Previsão de retorno</Label>
            <Input type="date" value={form.maintenance_expected_return}
              onChange={(e) => setForm({ ...form, maintenance_expected_return: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground">O equipamento só sairá da manutenção quando alguém liberar manualmente na tela de Manutenção.</p>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={loading}>{loading ? "Salvando..." : "Salvar"}</Button>
    </form>
  );
}