import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { getContracts, getEquipment, getOperators } from "@/lib/cco-service";
import type { Contract, Equipment, Operator } from "@/lib/cco-service";
import { Plus, Pencil, Trash2, CheckCircle2, X, Search, Truck, Users, FileText } from "lucide-react";

export const Route = createFileRoute("/cadastros")({
  component: CadastrosPage,
});

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type Tab = "equipamentos" | "operadores" | "contratos";

export default function CadastrosPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("equipamentos");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading]);

  if (loading) return null;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-foreground">Cadastros</h1>
          <p className="text-muted-foreground text-sm font-medium">Gerencie equipamentos, operadores e contratos</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {[
            { key: "equipamentos" as Tab, label: "Equipamentos", icon: Truck },
            { key: "operadores" as Tab, label: "Operadores", icon: Users },
            { key: "contratos" as Tab, label: "Contratos", icon: FileText },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-all -mb-px",
                activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "equipamentos" && <EquipmentTab user={user} />}
        {activeTab === "operadores" && <OperatorsTab user={user} />}
        {activeTab === "contratos" && <ContractsTab />}
      </div>
    </AppLayout>
  );
}

// ── Equipment Tab ─────────────────────────────────────────────────────────────
function EquipmentTab({ user }: { user: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ open: boolean; item: any | null }>({ open: false, item: null });
  const [form, setForm] = useState({ identifier: "", plate: "", model: "", type_id: "", contract_id: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [eq, ct, tp] = await Promise.all([
      getEquipment(),
      getContracts(),
      supabase.from("equipment_types").select("*").eq("active", true).order("name"),
    ]);
    setItems(eq || []);
    setContracts(ct || []);
    setTypes(tp.data || []);
  };

  useEffect(() => { load(); }, []);

  const filtered = items.filter(i =>
    i.identifier.toLowerCase().includes(search.toLowerCase()) ||
    (i.plate || "").toLowerCase().includes(search.toLowerCase())
  );

  function openModal(item: any = null) {
    setModal({ open: true, item });
    setForm(item ? {
      identifier: item.identifier, plate: item.plate || "", model: item.model || "",
      type_id: item.type_id || "", contract_id: item.contract_id || "",
    } : { identifier: "", plate: "", model: "", type_id: "", contract_id: "" });
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (modal.item) {
        await supabase.from("equipment").update(form).eq("id", modal.item.id);
      } else {
        await supabase.from("equipment").insert({ ...form, active: true });
      }
      setModal({ open: false, item: null });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Inativar este equipamento?")) return;
    await supabase.from("equipment").update({ active: false }).eq("id", id);
    await load();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar equipamento ou placa..."
            className="pl-9 pr-4 py-2 text-sm rounded-xl border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 w-64"
          />
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Equipamento
        </button>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[600px]">
            <thead>
              <tr className="border-b border-border text-[9px] font-black text-muted-foreground uppercase tracking-widest bg-muted/10">
                <th className="px-4 py-3">Identificador</th>
                <th className="px-4 py-3">Placa</th>
                <th className="px-4 py-3">Modelo</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Contrato</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-bold text-sm text-foreground">{item.identifier}</td>
                  <td className="px-4 py-3 font-mono text-sm text-foreground">{item.plate || "—"}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{item.model || "—"}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{item.equipment_types?.name || "—"}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{item.contracts?.name || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openModal(item)} className="p-1.5 hover:bg-accent rounded-md text-muted-foreground hover:text-foreground transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-destructive/10 rounded-md text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">Nenhum equipamento encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal.open && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-black text-foreground">{modal.item ? "Editar Equipamento" : "Novo Equipamento"}</h3>
              <button onClick={() => setModal({ open: false, item: null })} className="p-1.5 hover:bg-accent rounded-md text-muted-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <FormField label="Identificador" value={form.identifier} onChange={v => setForm(f => ({ ...f, identifier: v }))} placeholder="Ex: PIPA_10" />
              <FormField label="Placa" value={form.plate} onChange={v => setForm(f => ({ ...f, plate: v }))} placeholder="Ex: TOO0A19" />
              <FormField label="Modelo" value={form.model} onChange={v => setForm(f => ({ ...f, model: v }))} placeholder="Ex: COMPLETO, 16T" />
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Tipo</label>
                <select value={form.type_id} onChange={e => setForm(f => ({ ...f, type_id: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Selecionar...</option>
                  {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Contrato</label>
                <select value={form.contract_id} onChange={e => setForm(f => ({ ...f, contract_id: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Selecionar...</option>
                  {contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 px-6 pb-6">
              <button onClick={() => setModal({ open: false, item: null })} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-60 transition-colors">
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Operators Tab ─────────────────────────────────────────────────────────────
function OperatorsTab({ user }: { user: any }) {
  const [items, setItems] = useState<Operator[]>([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ open: boolean; item: Operator | null }>({ open: false, item: null });
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => getOperators().then(setItems).catch(console.error);
  useEffect(() => { load(); }, []);

  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  function openModal(item: Operator | null = null) {
    setModal({ open: true, item });
    setName(item?.name || "");
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (modal.item) {
        await supabase.from("operators").update({ name }).eq("id", modal.item.id);
      } else {
        await supabase.from("operators").insert({ name, active: true });
      }
      setModal({ open: false, item: null });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Inativar este operador?")) return;
    await supabase.from("operators").update({ active: false }).eq("id", id);
    await load();
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar operador..."
            className="pl-9 pr-4 py-2 text-sm rounded-xl border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 w-64" />
        </div>
        <button onClick={() => openModal()} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />
          Novo Operador
        </button>
      </div>
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-[9px] font-black text-muted-foreground uppercase tracking-widest bg-muted/10">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-sm text-foreground">{item.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">Ativo</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openModal(item)} className="p-1.5 hover:bg-accent rounded-md text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-destructive/10 rounded-md text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground text-sm">Nenhum operador encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {modal.open && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-black text-foreground">{modal.item ? "Editar Operador" : "Novo Operador"}</h3>
              <button onClick={() => setModal({ open: false, item: null })} className="p-1.5 hover:bg-accent rounded-md transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6">
              <FormField label="Nome completo" value={name} onChange={setName} placeholder="Ex: João da Silva" />
            </div>
            <div className="flex gap-2 px-6 pb-6">
              <button onClick={() => setModal({ open: false, item: null })} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-60 transition-colors">{saving ? "Salvando..." : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Contracts Tab ─────────────────────────────────────────────────────────────
function ContractsTab() {
  const [items, setItems] = useState<Contract[]>([]);

  const load = () => getContracts().then(setItems).catch(console.error);
  useEffect(() => { load(); }, []);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-border">
        <p className="text-xs text-muted-foreground font-medium">Os contratos são configurados pelo administrador do sistema.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-[9px] font-black text-muted-foreground uppercase tracking-widest bg-muted/10">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map(c => (
              <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-bold text-sm text-foreground">{c.name}</td>
                <td className="px-4 py-3">
                  <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black uppercase",
                    c.type === "Habitual" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700")}>
                    {c.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground font-medium">{c.client}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">Ativo</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Shared Components ─────────────────────────────────────────────────────────
function FormField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );
}
