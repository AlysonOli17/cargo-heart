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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/clientes")({
  head: () => ({ meta: [{ title: "Clientes — FrotaPro" }] }),
  component: () => <AppLayout><ClientsPage /></AppLayout>,
});

type Client = {
  id: string; name: string; contact_name: string | null; phone: string | null;
  email: string | null; document: string | null; address: string | null; notes: string | null;
};

function ClientsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const load = async () => {
    const { data } = await supabase.from("clients").select("*").order("name");
    setItems((data ?? []) as Client[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("clients-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const remove = async (id: string) => {
    if (!confirm("Excluir cliente?")) return;
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) toast.error(error.message); else toast.success("Cliente excluído");
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