import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Wrench } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";

export const Route = createFileRoute("/clientes")({
  head: () => ({ meta: [{ title: "Clientes — FrotaPro" }] }),
  component: () => <AppLayout><ClientsPage /></AppLayout>,
});

type Client = {
  id: string; name: string; contact_name: string | null; phone: string | null;
  email: string | null; document: string | null; address: string | null; notes: string | null;
};

type AvailableEq = { id: string; identifier: string };

function ClientsPage() {
  const { user } = useAuth();
  const { canWrite } = useRole();
  const [items, setItems] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [available, setAvailable] = useState<AvailableEq[]>([]);
  const [requestEq, setRequestEq] = useState<AvailableEq | null>(null);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [reqNotes, setReqNotes] = useState("");

  const load = async () => {
    const [{ data }, { data: eq }] = await Promise.all([
      supabase.from("clients").select("*").order("name"),
      supabase.from("equipment").select("id,identifier").eq("status", "disponivel").order("identifier"),
    ]);
    setItems((data ?? []) as Client[]);
    setAvailable((eq ?? []) as AvailableEq[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("clients-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment_requests" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  if (!user) return null;

  const remove = async (id: string) => {
    if (!confirm("Excluir cliente?")) return;
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) toast.error(error.message); else toast.success("Cliente excluído");
  };

  const submitRequest = async () => {
    if (!requestEq || !selectedClient) return;
    const { error } = await supabase.from("equipment_requests").insert({
      equipment_id: requestEq.id, client_id: selectedClient,
      requested_by: user!.id, owner_id: user!.id, notes: reqNotes || null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Solicitação enviada — aguardando aprovação do administrador");
      setRequestEq(null); setSelectedClient(""); setReqNotes("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Clientes</h1>
          <p className="text-muted-foreground">{items.length} cadastrados</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Novo cliente</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} cliente</DialogTitle></DialogHeader>
            <ClientForm client={editing} userId={user!.id} onDone={() => { setOpen(false); setEditing(null); }} />
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-4 border-[oklch(0.65_0.18_150)]/40">
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="h-4 w-4 text-[oklch(0.55_0.18_150)]" />
          <h2 className="font-semibold">Equipamentos disponíveis</h2>
          <span className="text-xs text-muted-foreground ml-auto">
            Clique para solicitar associação a um cliente
          </span>
        </div>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum equipamento disponível no momento.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {available.map((e) => (
              <button key={e.id} type="button"
                disabled={!canWrite}
                onClick={() => { setRequestEq(e); setSelectedClient(""); setReqNotes(""); }}
                className="px-3 py-2 rounded bg-[oklch(0.65_0.18_150)]/10 border border-[oklch(0.65_0.18_150)]/30 text-sm font-mono text-center hover:bg-[oklch(0.65_0.18_150)]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {e.identifier}
              </button>
            ))}
          </div>
        )}
        {!canWrite && (
          <p className="text-xs text-muted-foreground mt-2 italic">
            Você não tem permissão para solicitar associações.
          </p>
        )}
      </Card>

      <Dialog open={!!requestEq} onOpenChange={(o) => !o && setRequestEq(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar associação — {requestEq?.identifier}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Cliente *</Label>
              <Select value={selectedClient} onValueChange={setSelectedClient}>
                <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                <SelectContent>
                  {items.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Observação (opcional)</Label>
              <Textarea value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} placeholder="Motivo da solicitação..." />
            </div>
            <p className="text-xs text-muted-foreground">
              A solicitação será enviada para aprovação do administrador.
            </p>
            <Button onClick={submitRequest} disabled={!selectedClient} className="w-full">
              Enviar solicitação
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {items.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">Nenhum cliente. Clique em "Novo cliente".</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{c.name}</h3>
                  {c.contact_name && <p className="text-sm text-muted-foreground truncate">{c.contact_name}</p>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground mt-2 space-y-0.5">
                {c.phone && <p>📞 {c.phone}</p>}
                {c.email && <p className="truncate">✉ {c.email}</p>}
                {c.document && <p>📄 {c.document}</p>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientForm({ client, userId, onDone }: { client: Client | null; userId: string; onDone: () => void }) {
  const [form, setForm] = useState({
    name: client?.name ?? "", contact_name: client?.contact_name ?? "",
    phone: client?.phone ?? "", email: client?.email ?? "",
    document: client?.document ?? "", address: client?.address ?? "", notes: client?.notes ?? "",
  });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const payload = { ...form, owner_id: userId };
    const { error } = client
      ? await supabase.from("clients").update(payload).eq("id", client.id)
      : await supabase.from("clients").insert(payload);
    setLoading(false);
    if (error) toast.error(error.message);
    else { toast.success(client ? "Atualizado" : "Cliente cadastrado"); onDone(); }
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