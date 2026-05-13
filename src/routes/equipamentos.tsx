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
import { Plus, Pencil, Trash2, History, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";

export const Route = createFileRoute("/equipamentos")({
  head: () => ({ meta: [{ title: "Frota — Cadastro de Equipamentos Busato" }] }),
  component: () => <AppLayout><EquipmentPage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; brand: string | null; model: string | null;
  serial_number: string | null; year: number | null; hour_meter: number | null;
  status: EquipmentStatus; current_client_id: string | null;
  contract_type: string | null;
};
type Client = { id: string; name: string };
type Movement = {
  id: string; created_at: string; from_status: EquipmentStatus | null; to_status: EquipmentStatus;
  from_client_id: string | null; to_client_id: string | null; notes: string | null;
};

function EquipmentPage() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const [items, setItems] = useState<Equipment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [historyFor, setHistoryFor] = useState<Equipment | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  if (!user) return null;

  const remove = async (id: string) => {
    if (!confirm("Excluir equipamento permanentemente?")) return;
    const { error } = await supabase.from("equipment").delete().eq("id", id);
    if (error) toast.error(error.message); else toast.success("Excluído");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Frota <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded">V2.0-TEST</span></h1>
          <p className="text-muted-foreground">{items.length} equipamentos cadastrados</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo equipamento</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} Equipamento</DialogTitle></DialogHeader>
            <EquipmentForm equipment={editing} clients={clients} userId={user!.id} onDone={() => { setOpen(false); setEditing(null); }} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Buscar por placa, tipo, marca ou modelo..." 
            className="pl-10 h-11 border-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground font-medium italic">
          {items.filter(eq => 
            eq.identifier.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (eq.type || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (eq.brand || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (eq.model || "").toLowerCase().includes(searchQuery.toLowerCase())
          ).length} máquinas encontradas
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items
          .filter(eq => 
            eq.identifier.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (eq.type || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (eq.brand || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            (eq.model || "").toLowerCase().includes(searchQuery.toLowerCase())
          )
          .map((eq) => (
          <Card key={eq.id} className="p-4 space-y-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <h3 className="font-black text-lg uppercase truncate">{eq.identifier}</h3>
                <p className="text-xs font-bold text-muted-foreground truncate uppercase">
                  {[eq.brand, eq.model].filter(Boolean).join(" ") || eq.type || "—"}
                </p>
                {eq.contract_type && (
                  <p className="text-[10px] font-black text-primary/80 uppercase tracking-tighter">
                    CONTRATO: {eq.contract_type}
                  </p>
                )}
              </div>
              <Badge status={eq.status} />
            </div>
            
            <div className="flex gap-1 pt-2">
              <Button variant="outline" size="sm" className="flex-1 font-bold" onClick={() => setHistoryFor(eq)}>Histórico</Button>
              <Button variant="ghost" size="icon" onClick={() => { setEditing(eq); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => remove(eq.id)} className="text-red-500"><Trash2 className="h-4 w-4" /></Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Histórico — {historyFor?.identifier}</DialogTitle></DialogHeader>
          {historyFor && <HistoryView equipmentId={historyFor.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Badge({ status }: { status: EquipmentStatus }) {
  const color = STATUS_COLORS[status] || "bg-muted";
  return (
    <span className={`text-[9px] px-2 py-1 rounded-full font-black uppercase tracking-widest ${color}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function HistoryView({ equipmentId }: { equipmentId: string }) {
  const [movs, setMovs] = useState<Movement[]>([]);
  useEffect(() => {
    supabase.from("movements").select("*").eq("equipment_id", equipmentId).order("created_at", { ascending: false })
      .then(({ data }) => setMovs((data ?? []) as Movement[]));
  }, [equipmentId]);
  
  return (
    <div className="space-y-2 max-h-96 overflow-y-auto pt-4">
      {movs.map((m) => (
        <div key={m.id} className="border-l-2 border-primary pl-3 py-1">
          <p className="text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleString("pt-BR")}</p>
          <p className="text-sm font-bold">
            {STATUS_LABELS[m.to_status]}
          </p>
          {m.notes && <p className="text-xs text-foreground/70 italic">{m.notes}</p>}
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
    brand: equipment?.brand ?? "",
    status: (equipment?.status ?? "operacional") as EquipmentStatus,
    contract_type: equipment?.contract_type ?? "Eventual",
  });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const payload: any = {
      owner_id: userId,
      identifier: form.identifier.toUpperCase(),
      type: form.type || null,
      model: form.model || null,
      brand: form.brand || null,
      status: form.status,
      contract_type: form.contract_type,
    };

    // Validação de duplicidade (Placa)
    const { data: existing } = await supabase.from("equipment").select("id").eq("identifier", form.identifier.toUpperCase()).maybeSingle();
    if (existing && (!equipment || existing.id !== equipment.id)) {
      toast.error("Já existe um equipamento com esta placa/identificação!");
      setLoading(false);
      return;
    }

    const { error } = equipment
      ? await supabase.from("equipment").update(payload).eq("id", equipment.id)
      : await supabase.from("equipment").insert(payload);
    
    setLoading(false);
    if (error) toast.error(error.message);
    else { toast.success("Salvo com sucesso"); onDone(); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label>Identificação *</Label>
        <Input required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="Ex: QRI2F96" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="BASCULANTE" />
        </div>
        <div className="space-y-2">
          <Label>Marca / Fabricante</Label>
          <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="FORD" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Modelo</Label>
        <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="CARGO 1723" />
      </div>
      
      <div className="space-y-2">
        <Label>Status Base</Label>
        <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as EquipmentStatus })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="operacional">Operacional</SelectItem>
            <SelectItem value="disponivel">Disponível</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground italic">
          * Aponte manutenções exclusivamente pela aba de Oficina.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase">Fidelização / Contrato</Label>
        <Select value={form.contract_type} onValueChange={(v) => setForm({ ...form, contract_type: v })}>
          <SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Usina">Usina</SelectItem>
            <SelectItem value="Porto">Porto</SelectItem>
            <SelectItem value="Eventual">Eventual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" className="w-full h-12 font-bold" disabled={loading}>
        {loading ? "Salvando..." : "Salvar Equipamento"}
      </Button>
    </form>
  );
}