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
import { Plus, Pencil, Trash2, History, Search, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";
import { STATUS_LABELS, STATUS_COLORS, type EquipmentStatus } from "@/lib/equipment";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/equipamentos")({
  head: () => ({ meta: [{ title: "Frota — Cadastro de Equipamentos Busato" }] }),
  component: () => <AppLayout><EquipmentPage /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; brand: string | null; model: string | null;
  serial_number: string | null; year: number | null; hour_meter: number | null;
  status: EquipmentStatus; current_client_id: string | null;
  contract_type: string | null;
  te_tag?: string;
  implement_type?: string;
  capacity?: string;
  description?: string;
  notes?: string | null;
};
type Client = { id: string; name: string };
type Movement = {
  id: string; created_at: string; from_status: EquipmentStatus | null; to_status: EquipmentStatus;
  from_client_id: string | null; to_client_id: string | null; notes: string | null;
};

function EquipmentPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useRole();
  const [items, setItems] = useState<Equipment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [historyFor, setHistoryFor] = useState<Equipment | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const load = async () => {
    if (!user) return;
    const [{ data: e }, { data: c }] = await Promise.all([
      supabase.from("equipment").select("*").order("identifier"),
      supabase.from("clients").select("id,name").order("name"),
    ]);
    
    const parsed = (e ?? []).map((eq: any) => {
      let te_tag = "";
      let implement_type = "";
      let capacity = "";
      let description = "";
      let realNotes = eq.notes || "";
      
      try {
        if (eq.notes && (eq.notes.startsWith("{") || eq.notes.startsWith("["))) {
          const parsedNotes = JSON.parse(eq.notes);
          te_tag = parsedNotes.te_tag || "";
          implement_type = parsedNotes.implement_type || "";
          capacity = parsedNotes.capacity || "";
          description = parsedNotes.description || "";
          realNotes = parsedNotes.realNotes || "";
        }
      } catch (_) {}
      
      return {
        ...eq,
        te_tag,
        implement_type,
        capacity,
        description,
        notes: realNotes
      };
    });
    
    setItems(parsed as Equipment[]);
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

  if (authLoading) {
    return <div className="p-8 text-center text-muted-foreground font-bold">Carregando dados de autenticação...</div>;
  }

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
        <div className="flex items-center gap-2">
          <ExcelImportDialog userId={user!.id} onDone={load} />
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo equipamento</Button></DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} Equipamento</DialogTitle></DialogHeader>
              <EquipmentForm equipment={editing} clients={clients} userId={user!.id} onDone={() => { setOpen(false); setEditing(null); }} />
            </DialogContent>
          </Dialog>
        </div>
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
                {eq.te_tag && (
                  <p className="text-[9.5px] font-bold text-indigo-600 uppercase leading-normal">
                    TE+TAG: {eq.te_tag}
                  </p>
                )}
                {eq.implement_type && (
                  <p className="text-[9.5px] font-bold text-amber-600 uppercase leading-normal">
                    IMPLEMENTO: {eq.implement_type}
                  </p>
                )}
                {eq.capacity && (
                  <p className="text-[9.5px] font-bold text-emerald-600 uppercase leading-normal">
                    CAPACIDADE: {eq.capacity}
                  </p>
                )}
                {eq.description && (
                  <p className="text-[9.5px] font-medium text-slate-500 italic truncate max-w-[200px]" title={eq.description}>
                    "{eq.description}"
                  </p>
                )}
                {eq.contract_type && (
                  <p className="text-[10px] font-black text-primary/80 uppercase tracking-tighter leading-normal pt-0.5">
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

function ExcelImportDialog({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        const normalized = data.map((row: any) => {
          const keys = Object.keys(row);
          const newRow: any = {};
          keys.forEach(k => {
            const normKey = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
            newRow[normKey] = row[k];
          });
          return newRow;
        });

        setPreviewData(normalized);
      } catch (err) {
        toast.error("Erro ao ler arquivo Excel. Verifique o formato.");
      }
    };
    reader.readAsBinaryString(selectedFile);
  };

  const handleImport = async () => {
    if (previewData.length === 0) return;
    setLoading(true);

    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const row of previewData) {
      console.log("Processando linha do Excel:", row);
      const te_tag = (row.tetag || row.te_tag || row["te+tag"] || row["te + tag"] || "").toString().trim().toUpperCase();
      let rawPlaca = (row.placa || row.identifier || row.id || row.codigo || "").toString().trim().toUpperCase();
      
      // Fallback to TE + TAG if Placa is empty or N/A
      if (!rawPlaca || rawPlaca === "N/A" || rawPlaca === "NA") {
        rawPlaca = te_tag;
      }

      const identifier = rawPlaca;
      console.log("Identificador computado:", identifier, "TE+TAG:", te_tag, "RawPlaca:", rawPlaca);
      if (!identifier || identifier === "N/A" || identifier === "NA") {
        console.warn("Linha pulada por falta de identificador:", row);
        failed++;
        continue;
      }

      // Columns: CONTRATO | Placa | TE + TAG | Situação | Tipo de Implemento | Modelo | Descrição | Capacidade | Fabricante | Chassi ou Série
      const type = row.tipodeimplemento || row.tipo_de_implemento || row.tipo || row.type || null;
      const brand = row.fabricante || row.marca || row.brand || row.manufacturer || null;
      const model = row.modelo || row.model || null;
      
      const capacity = row.capacidade || row.capacity || "";
      const description = row.descricao || row.description || "";
      const serial_number = row.chassi_ou_serie || row.chassis_ou_serie || row.chassi_serie || row.serie || row.serial_number || null;

      let rawContract = (row.contrato || row.contract_type || "none").toString().trim().toLowerCase();
      let contract_type = "Eventual";
      let status: any = "disponivel";

      if (rawContract.includes("usina")) {
        contract_type = "Usina";
        status = "com_cliente";
      } else if (rawContract.includes("porto")) {
        contract_type = "Porto";
        status = "com_cliente";
      } else if (rawContract.includes("eventual")) {
        contract_type = "Eventual";
        status = "com_cliente";
      } else {
        contract_type = "Eventual";
        status = "disponivel";
      }

      const rawStatus = (row.situacao || row.status || "").toString().trim().toLowerCase();
      if (rawStatus.includes("manutencao") || rawStatus.includes("oficina")) {
        status = "manutencao";
      } else if (rawStatus.includes("disponivel") || rawStatus.includes("livre")) {
        status = "disponivel";
      } else if (rawStatus.includes("operacional") || rawStatus.includes("em operacao") || rawStatus.includes("operando")) {
        status = "com_cliente";
      }

      const hour_meter = row.horimetro || row.hour_meter || null;
      const year = row.ano || row.year || null;

      const serializedNotes = JSON.stringify({
        realNotes: description,
        te_tag,
        implement_type: type,
        capacity,
        description,
        is_reserve: false
      });

      const payload = {
        identifier,
        type,
        brand,
        model,
        contract_type,
        status,
        hour_meter: hour_meter ? Number(hour_meter) : null,
        serial_number: serial_number ? serial_number.toString() : null,
        year: year ? Number(year) : null,
        notes: serializedNotes,
        owner_id: userId,
      };

      try {
        const { data: existing } = await supabase.from("equipment").select("id").eq("identifier", identifier).maybeSingle();
        if (existing) {
          const { error } = await supabase.from("equipment").update(payload).eq("id", existing.id);
          if (error) throw error;
          updated++;
        } else {
          const { error } = await supabase.from("equipment").insert(payload);
          if (error) throw error;
          inserted++;
        }
      } catch (err) {
        console.error("Erro ao importar item:", identifier, err, payload);
        failed++;
      }
    }

    setLoading(false);
    toast.success(`Importação concluída: ${inserted} inseridos, ${updated} atualizados. Erros: ${failed}`);
    setFile(null);
    setPreviewData([]);
    setOpen(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-indigo-100 text-indigo-600 hover:bg-indigo-50 font-bold">
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Importar Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-bold flex items-center gap-2">
            <Upload className="h-5 w-5 text-indigo-600" />
            Importar via Excel
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="border-2 border-dashed border-slate-200 hover:border-slate-300 rounded-xl p-6 text-center cursor-pointer relative bg-slate-50/50">
            <input 
              type="file" 
              accept=".xlsx, .xls" 
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <FileSpreadsheet className="h-10 w-10 mx-auto text-slate-400 mb-2" />
            <p className="text-xs font-bold text-slate-700">
              {file ? file.name : "Clique para selecionar arquivo Excel (.xlsx, .xls)"}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              Colunas sugeridas: Placa (Placa/Identificação), Tipo, Marca, Modelo, Contrato, Status, Horimetro, Serie.
            </p>
          </div>

          {previewData.length > 0 && (
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 max-h-48 overflow-y-auto">
              <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Pré-visualização (Total: {previewData.length} registros)</p>
              <div className="space-y-1">
                {previewData.slice(0, 5).map((row, idx) => {
                  const te_tag = (row.tetag || row.te_tag || row["te+tag"] || row["te + tag"] || "").toString().trim().toUpperCase();
                  let plateVal = (row.placa || row.identificacao || row.identifier || row.id || row.codigo || "").toString().trim().toUpperCase();
                  if (!plateVal || plateVal === "N/A" || plateVal === "NA") {
                    plateVal = te_tag;
                  }
                  const plate = plateVal || "SEM PLACA";
                  return (
                    <div key={idx} className="flex justify-between items-center text-[10px] bg-white p-1.5 rounded border border-slate-100 font-medium">
                      <span className="font-mono font-bold text-slate-900">{String(plate)}</span>
                      <span className="text-slate-500 uppercase">{String(row.tipo || row.type || "—")}</span>
                    </div>
                  );
                })}
                {previewData.length > 5 && (
                  <p className="text-[9px] text-slate-400 text-center pt-1 font-semibold">e mais {previewData.length - 5} linhas...</p>
                )}
              </div>
            </div>
          )}

          <Button 
            onClick={handleImport} 
            className="w-full h-12 font-bold bg-indigo-600 hover:bg-indigo-700 text-white" 
            disabled={loading || previewData.length === 0}
          >
            {loading ? "Processando importação..." : `Confirmar Importação de ${previewData.length} itens`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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

function EquipmentForm({ equipment, userId, onDone }: { equipment: Equipment | null; clients: any[]; userId: string; onDone: () => void }) {
  const [form, setForm] = useState({
    identifier: equipment?.identifier ?? "",
    type: equipment?.type ?? "",
    model: equipment?.model ?? "",
    brand: equipment?.brand ?? "",
    status: (equipment?.status ?? "operacional") as EquipmentStatus,
    contract_type: equipment?.contract_type ?? "Eventual",
    te_tag: equipment?.te_tag ?? "",
    implement_type: equipment?.implement_type ?? "",
    capacity: equipment?.capacity ?? "",
    description: equipment?.description ?? "",
  });
  const [loading, setLoading] = useState(false);

  // Initialize unified value
  const [selectedContract, setSelectedContract] = useState<string>(() => {
    if (equipment?.status === "disponivel" || equipment?.status === "operacional" && equipment?.contract_type !== "Usina" && equipment?.contract_type !== "Porto") {
      return "none";
    }
    return equipment?.contract_type ?? "Eventual";
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    let status = form.status;
    let contract_type = selectedContract;

    if (selectedContract === "none") {
      status = "disponivel";
      contract_type = "Eventual";
    } else if (selectedContract === "Usina") {
      status = "operacional";
    } else if (selectedContract === "Porto") {
      status = "operacional";
    } else if (selectedContract === "Eventual") {
      status = "com_cliente";
    }

    const serializedNotes = JSON.stringify({
      realNotes: form.description,
      te_tag: form.te_tag,
      implement_type: form.implement_type || form.type,
      capacity: form.capacity,
      description: form.description,
      is_reserve: false
    });

    const payload: any = {
      owner_id: userId,
      identifier: form.identifier.toUpperCase(),
      type: form.type || form.implement_type || null,
      model: form.model || null,
      brand: form.brand || null,
      status: status,
      contract_type: contract_type,
      current_client_id: null, // Clear client id to keep it simple and clean
      notes: serializedNotes,
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
    <form onSubmit={submit} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
      <div className="space-y-2">
        <Label>Identificação (Placa) *</Label>
        <Input required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="Ex: QRI2F96" />
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>TE + TAG</Label>
          <Input value={form.te_tag} onChange={(e) => setForm({ ...form, te_tag: e.target.value })} placeholder="Ex: TE-102" />
        </div>
        <div className="space-y-2">
          <Label>Capacidade</Label>
          <Input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="Ex: 20m³ / 15t" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Tipo de Implemento</Label>
          <Input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, implement_type: e.target.value })} placeholder="Ex: BASCULANTE" />
        </div>
        <div className="space-y-2">
          <Label>Fabricante</Label>
          <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="FORD" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Modelo</Label>
        <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="CARGO 1723" />
      </div>

      <div className="space-y-2">
        <Label>Descrição</Label>
        <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descrição detalhada" />
      </div>
      
      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase">Contrato Vinculado</Label>
        <Select value={selectedContract} onValueChange={setSelectedContract}>
          <SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nenhum (Reserva / Disponível)</SelectItem>
            <SelectItem value="Usina">Usina</SelectItem>
            <SelectItem value="Porto">Porto</SelectItem>
            <SelectItem value="Eventual">Eventual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Status Adicional</Label>
        <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as EquipmentStatus })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="operacional">Operacional</SelectItem>
            <SelectItem value="disponivel">Disponível</SelectItem>
            <SelectItem value="manutencao">Em Manutenção</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground italic">
          * Para enviar para Oficina, selecione 'Em Manutenção'.
        </p>
      </div>

      <Button type="submit" className="w-full h-12 font-bold bg-indigo-600 hover:bg-indigo-700 text-white" disabled={loading}>
        {loading ? "Salvando..." : "Salvar Equipamento"}
      </Button>
    </form>
  );
}