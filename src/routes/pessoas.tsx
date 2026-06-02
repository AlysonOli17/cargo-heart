import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { 
  Users, 
  UserCheck, 
  UserX, 
  CalendarDays, 
  Settings2, 
  Plus, 
  Trash2, 
  Pencil, 
  Download, 
  Upload
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/pessoas")({
  head: () => ({ meta: [{ title: "Cadastro de Pessoas — CCO Busato" }] }),
  component: () => <AppLayout><PessoasPage /></AppLayout>,
});

function PessoasPage() {
  const { user } = useAuth();
  const [people, setPeople] = useState<any[]>([]);
  const [equipments, setEquipments] = useState<any[]>([]);
  const [pessoaIndisps, setPessoaIndisps] = useState<any[]>([]);
  
  // Date filter for viewing status (default to today)
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split("T")[0]);

  // Pessoas Tab State
  const [pessoaDialogOpen, setPessoaDialogOpen] = useState(false);
  const [editingPessoa, setEditingPessoa] = useState<any>(null);
  const [pessoaSearch, setPessoaSearch] = useState("");
  const [indispDialogOpen, setIndispDialogOpen] = useState(false);
  const [selectedPessoaForIndisp, setSelectedPessoaForIndisp] = useState<any>(null);
  
  const [pessoaForm, setPessoaForm] = useState({
    name: "", matricula: "", shift: "Dia", letra: "A",
    plate_tag: "", vacation_start: "", vacation_end: "", ativo: true,
    contrato: "CCO PORTO"
  });
  const [indispForm, setIndispForm] = useState({
    tipo: "Atestado", data_inicio: "", data_fim: "", motivo: ""
  });

  // 2x2 rotation config (stored in localStorage)
  // Escala A = 02/06/2026, de acordo com o padrão solicitado.
  const [rotacaoRef, setRotacaoRef] = useState<string>(() =>
    localStorage.getItem("porto_rotacao_ref") || "2026-06-02"
  );
  const [rotacaoLetraRef, setRotacaoLetraRef] = useState<"A" | "B">(() =>
    (localStorage.getItem("porto_rotacao_letra_ref") as "A" | "B") || "A"
  );

  // ---- 2x2 Rotation Logic ----
  const getLetraAtiva = (dateStr: string): "A" | "B" => {
    const ref = new Date(rotacaoRef + "T12:00:00");
    const target = new Date(dateStr + "T12:00:00");
    const diffDays = Math.floor((target.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
    const cycle = (((Math.floor(diffDays / 2)) % 2) + 2) % 2;
    return cycle === 0 ? rotacaoLetraRef : (rotacaoLetraRef === "A" ? "B" : "A");
  };

  const isPessoaDisponivel = (pessoa: any, dateStr: string): { ok: boolean; motivo: string } => {
    if (pessoa.ativo === false) return { ok: false, motivo: "Inativo" };
    if (pessoa.vacation_start &&
        pessoa.vacation_end &&
        dateStr >= pessoa.vacation_start &&
        dateStr <= pessoa.vacation_end) {
      return { ok: false, motivo: `Férias até ${new Date(pessoa.vacation_end + "T12:00:00").toLocaleDateString("pt-BR")}` };
    }
    const unavArr = pessoa.unavailability || [];
    if (unavArr.includes(dateStr)) return { ok: false, motivo: "Indisponível" };
    // Check pessoaIndisps
    const indisp = pessoaIndisps.find((i: any) =>
      i.pessoa_id === pessoa.id &&
      dateStr >= i.data_inicio && dateStr <= i.data_fim
    );
    if (indisp) return { ok: false, motivo: `${indisp.tipo}${indisp.motivo ? ": " + indisp.motivo : ""}` };
    return { ok: true, motivo: "" };
  };

  // CRUD Loading
  const loadPessoas = async () => {
    try {
      const { data, error } = await supabase.from("people" as any).select("*").order("name");
      if (!error && data) {
        setPeople(data as any[]);
        localStorage.setItem("local_people", JSON.stringify(data));
      }
    } catch {}
  };

  const loadPessoaIndisps = async () => {
    try {
      const { data, error } = await supabase.from("porto_pessoas_indisponibilidades" as any).select("*");
      if (!error && data) setPessoaIndisps(data as any[]);
    } catch {}
  };

  const loadEquipments = async () => {
    try {
      const { data, error } = await supabase.from("equipment" as any).select("*").order("identifier");
      if (!error && data) setEquipments(data as any[]);
    } catch {}
  };

  useEffect(() => {
    if (!user) return;
    loadPessoas();
    loadPessoaIndisps();
    loadEquipments();
  }, [user]);

  // Actions
  const savePessoa = async () => {
    try {
      const payload: any = {
        name: pessoaForm.name.trim(),
        matricula: pessoaForm.matricula.trim() || null,
        shift: pessoaForm.shift,
        letra: pessoaForm.letra,
        plate_tag: pessoaForm.plate_tag.trim() || null,
        vacation_start: pessoaForm.vacation_start || null,
        vacation_end: pessoaForm.vacation_end || null,
        ativo: pessoaForm.ativo,
        contrato: pessoaForm.contrato
      };
      if (!payload.name) { toast.error("Nome é obrigatório."); return; }
      if (editingPessoa) {
        const { error } = await supabase.from("people" as any).update(payload).eq("id", editingPessoa.id);
        if (error) throw error;
        toast.success("Pessoa atualizada!");
      } else {
        const { error } = await supabase.from("people" as any).insert({ ...payload, owner_id: user?.id });
        if (error) throw error;
        toast.success("Pessoa cadastrada!");
      }
      setPessoaDialogOpen(false);
      setEditingPessoa(null);
      await loadPessoas();
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err?.message || "Tente novamente."));
    }
  };

  const deletePessoa = async (id: string) => {
    if (!confirm("Remover esta pessoa?")) return;
    try {
      await supabase.from("people" as any).delete().eq("id", id);
      toast.success("Pessoa removida.");
      await loadPessoas();
    } catch { toast.error("Erro ao remover."); }
  };

  const saveIndisp = async () => {
    if (!selectedPessoaForIndisp) return;
    if (!indispForm.data_inicio || !indispForm.data_fim) { toast.error("Informe as datas."); return; }
    try {
      await supabase.from("porto_pessoas_indisponibilidades" as any).insert({
        pessoa_id: selectedPessoaForIndisp.id,
        owner_id: user?.id,
        tipo: indispForm.tipo,
        data_inicio: indispForm.data_inicio,
        data_fim: indispForm.data_fim,
        motivo: indispForm.motivo || null,
      });
      toast.success("Indisponibilidade registrada.");
      setIndispForm({ tipo: "Atestado", data_inicio: "", data_fim: "", motivo: "" });
      await loadPessoaIndisps();
    } catch { toast.error("Erro ao registrar indisponibilidade."); }
  };

  const deleteIndisp = async (id: string) => {
    await supabase.from("porto_pessoas_indisponibilidades" as any).delete().eq("id", id);
    await loadPessoaIndisps();
    toast.success("Indisponibilidade removida.");
  };

  const downloadPessoasTemplate = () => {
    const data = [
      {
        "Nome": "João da Silva",
        "Matricula": "M12345",
        "Turno": "Dia",
        "Letra": "A",
        "Caminhao Fidelizado": "PLACA123",
        "Contrato": "CCO PORTO",
        "Inicio Ferias": "2026-06-15",
        "Fim Ferias": "2026-06-30"
      },
      {
        "Nome": "Maria Oliveira",
        "Matricula": "M67890",
        "Turno": "Noite",
        "Letra": "B",
        "Caminhao Fidelizado": "PLACA456",
        "Contrato": "CCO USINA",
        "Inicio Ferias": "",
        "Fim Ferias": ""
      }
    ];

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo Importacao Pessoas");
    XLSX.writeFile(wb, "modelo_importacao_pessoas.xlsx");
    toast.success("Modelo baixado! Preencha e utilize o botão Importar.");
  };

  const handlePessoasImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        const rawRows = XLSX.utils.sheet_to_json(ws) as any[];
        if (rawRows.length === 0) {
          toast.error("Planilha vazia.");
          return;
        }

        let importCount = 0;
        for (const row of rawRows) {
          const name = row["Nome"] || row["nome"] || row["Nome Completo"];
          if (!name) continue;

          const matricula = row["Matricula"] || row["matricula"] || row["Matrícula"];
          let shift = row["Turno"] || row["turno"] || "Dia";
          shift = shift.toString().trim().toLowerCase();
          if (shift.includes("noite")) {
            shift = "Noite";
          } else {
            shift = "Dia";
          }

          let letra = row["Letra"] || row["letra"] || "A";
          letra = letra.toString().trim().toUpperCase() === "B" ? "B" : "A";

          const plate_tag = row["Caminhao Fidelizado"] || row["caminhao"] || row["caminhão"] || row["Placa"] || row["placa"] || null;
          
          let contrato = row["Contrato"] || row["contrato"] || "CCO PORTO";
          contrato = contrato.toString().trim().toUpperCase().includes("USINA") ? "CCO USINA" : "CCO PORTO";

          const vacation_start = row["Inicio Ferias"] || row["Início Férias"] || row["vacation_start"] || null;
          const vacation_end = row["Fim Ferias"] || row["Fim Férias"] || row["vacation_end"] || null;

          const payload = {
            name: name.toString().trim(),
            matricula: matricula ? matricula.toString().trim() : null,
            shift,
            letra,
            plate_tag: plate_tag ? plate_tag.toString().trim() : null,
            vacation_start: vacation_start ? vacation_start.toString().trim() : null,
            vacation_end: vacation_end ? vacation_end.toString().trim() : null,
            ativo: true,
            contrato,
            owner_id: user?.id
          };

          // Check if person exists by name or matricula
          let query = supabase.from("people" as any).select("id");
          if (payload.matricula) {
            query = query.or(`name.eq."${payload.name}",matricula.eq."${payload.matricula}"`);
          } else {
            query = query.eq("name", payload.name);
          }

          const { data: existing } = await query;

          if (existing && existing.length > 0) {
            await supabase.from("people" as any).update(payload).eq("id", existing[0].id);
          } else {
            await supabase.from("people" as any).insert(payload);
          }
          importCount++;
        }

        toast.success(`${importCount} pessoas importadas/atualizadas com sucesso!`);
        await loadPessoas();
      } catch (err: any) {
        toast.error("Erro ao importar planilha: " + err.message);
      }
    };
    reader.readAsBinaryString(selectedFile);
    e.target.value = "";
  };

  // Stats derived state
  const stats = useMemo(() => {
    const hoje = selectedDate || new Date().toISOString().split("T")[0];
    const letraHoje = getLetraAtiva(hoje);
    const totalPessoas = people.length;
    
    const disponiveisHoje = people.filter(p => {
      const disp = isPessoaDisponivel(p, hoje);
      return disp.ok && p.letra === letraHoje;
    }).length;
    
    const emFerias = people.filter(p =>
      p.vacation_start && p.vacation_end &&
      hoje >= p.vacation_start && hoje <= p.vacation_end
    ).length;

    const indisponiveisPeriodo = people.filter(p => {
      const indisp = pessoaIndisps.find((i: any) =>
        i.pessoa_id === p.id && hoje >= i.data_inicio && hoje <= i.data_fim
      );
      return !!indisp;
    }).length;

    return { totalPessoas, disponiveisHoje, emFerias, indisponiveisPeriodo, letraHoje };
  }, [people, pessoaIndisps, selectedDate, rotacaoRef, rotacaoLetraRef]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
            <Users className="h-8 w-8 text-emerald-600" />
            <span>Pessoas e Operadores</span>
          </h1>
          <p className="text-muted-foreground mt-1">
            Gerenciamento geral de motoristas e operadores: turnos, férias, indisponibilidades, contratos e escala 2x2.
          </p>
        </div>
        
        {/* Date Selector for Viewing Status */}
        <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-1.5 border border-slate-200">
          <span className="text-[10px] font-black uppercase text-slate-500">Visualizar Status Em:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="text-xs bg-transparent border-none text-slate-800 font-bold focus:outline-none focus:ring-0 cursor-pointer"
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Users className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Total Cadastrado</p>
            <p className="text-2xl font-black text-white">{stats.totalPessoas}</p>
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <UserCheck className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Disp. Hoje ({stats.letraHoje})</p>
            <p className="text-2xl font-black text-emerald-400">{stats.disponiveisHoje}</p>
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <CalendarDays className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Em Férias</p>
            <p className="text-2xl font-black text-amber-400">{stats.emFerias}</p>
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-500/20 flex items-center justify-center">
            <UserX className="h-5 w-5 text-rose-400" />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Indisponíveis</p>
            <p className="text-2xl font-black text-rose-400">{stats.indisponiveisPeriodo}</p>
          </div>
        </div>
      </div>

      {/* Rotation config + search + action buttons */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        {/* Rotation 2x2 panel */}
        <div className="flex flex-wrap items-center gap-3 bg-emerald-950/40 border border-emerald-900/50 rounded-xl px-4 py-2.5">
          <Settings2 className="h-4 w-4 text-emerald-400" />
          <span className="text-[10px] font-black uppercase text-emerald-400 tracking-wider">Escala 2x2 — Referência:</span>
          <input
            type="date"
            value={rotacaoRef}
            onChange={e => {
              setRotacaoRef(e.target.value);
              localStorage.setItem("porto_rotacao_ref", e.target.value);
            }}
            className="h-7 text-xs bg-emerald-950/80 border border-emerald-900/60 text-emerald-200 rounded px-2 font-mono focus:outline-none"
          />
          <span className="text-[10px] font-black uppercase text-emerald-400">Letra:</span>
          <select
            value={rotacaoLetraRef}
            onChange={e => {
              const val = e.target.value as "A" | "B";
              setRotacaoLetraRef(val);
              localStorage.setItem("porto_rotacao_letra_ref", val);
            }}
            className="h-7 text-xs bg-emerald-950/80 border border-emerald-900/60 text-emerald-200 rounded px-2 font-bold focus:outline-none"
          >
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
          <span className="text-[10px] text-emerald-300 font-bold ml-1 bg-emerald-900/40 px-2 py-0.5 rounded">
            Letra no dia selecionado: {stats.letraHoje}
          </span>
        </div>

        {/* Search, Download Template, Import & Add Button */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por nome ou matrícula..."
            value={pessoaSearch}
            onChange={e => setPessoaSearch(e.target.value)}
            className="h-9 text-xs w-60 bg-card border-slate-300"
          />
          
          <Button
            variant="outline"
            onClick={downloadPessoasTemplate}
            className="h-9 border-emerald-200 text-emerald-700 hover:bg-emerald-50 font-bold text-xs uppercase px-3"
            title="Baixar Modelo de Excel para Preenchimento"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Modelo
          </Button>

          <div className="relative">
            <input
              type="file"
              id="global-pessoas-import-input"
              className="hidden"
              accept=".xlsx, .xls"
              onChange={handlePessoasImport}
            />
            <Button
              variant="outline"
              onClick={() => document.getElementById("global-pessoas-import-input")?.click()}
              className="h-9 border-emerald-200 text-emerald-700 hover:bg-emerald-50 font-bold text-xs uppercase px-3"
              title="Importar planilha de Pessoas (.xlsx)"
            >
              <Upload className="h-4 w-4 mr-1.5" />
              Importar
            </Button>
          </div>

          <Button
            onClick={() => {
              setEditingPessoa(null);
              setPessoaForm({ name: "", matricula: "", shift: "Dia", letra: "A", plate_tag: "", vacation_start: "", vacation_end: "", ativo: true, contrato: "CCO PORTO" });
              setPessoaDialogOpen(true);
            }}
            className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase px-4"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Nova Pessoa
          </Button>
        </div>
      </div>

      {/* People Table */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow className="text-[10px] font-black uppercase text-slate-600">
              <TableHead>Nome</TableHead>
              <TableHead>Matrícula</TableHead>
              <TableHead>Turno</TableHead>
              <TableHead className="text-center">Letra</TableHead>
              <TableHead>Caminhão Fidelizado</TableHead>
              <TableHead>Contrato</TableHead>
              <TableHead className="text-center">Status Hoje</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-xs font-bold text-slate-800">
            {people
              .filter(p => {
                const term = pessoaSearch.toLowerCase();
                return !term ||
                  (p.name || "").toLowerCase().includes(term) ||
                  (p.matricula || "").toLowerCase().includes(term);
              })
              .map(p => {
                const hoje = selectedDate || new Date().toISOString().split("T")[0];
                const disp = isPessoaDisponivel(p, hoje);
                const pessoaIndispList = pessoaIndisps.filter((i: any) => i.pessoa_id === p.id);
                return (
                  <TableRow key={p.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-black uppercase">{p.name}</TableCell>
                    <TableCell className="font-mono text-slate-500">{p.matricula || "—"}</TableCell>
                    <TableCell>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black border ${
                        (p.shift || "Dia") === "Dia"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}>
                        {(p.shift || "Dia") === "Dia" ? "☀️ Dia" : "🌙 Noite"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        p.letra === "A" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      }`}>
                        {p.letra || "A"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-emerald-700">{p.plate_tag || "—"}</TableCell>
                    <TableCell>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black border ${
                        (p.contrato || "CCO PORTO") === "CCO PORTO"
                          ? "bg-sky-50 text-sky-700 border-sky-200"
                          : "bg-teal-50 text-teal-700 border-teal-200"
                      }`}>
                        {p.contrato || "CCO PORTO"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {disp.ok ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] font-black uppercase">✓ Disponível</Badge>
                      ) : (
                        <Badge className="bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-black uppercase" title={disp.motivo}>⚠ {disp.motivo.length > 20 ? disp.motivo.substring(0, 20) + "..." : disp.motivo}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[9px] font-black uppercase text-amber-700 border-amber-200 hover:bg-amber-50"
                          onClick={() => {
                            setSelectedPessoaForIndisp(p);
                            setIndispDialogOpen(true);
                          }}
                          title={`Indisponibilidades (${pessoaIndispList.length})`}
                        >
                          <CalendarDays className="h-3.5 w-3.5" />
                          {pessoaIndispList.length > 0 && <span className="ml-1">{pessoaIndispList.length}</span>}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[9px] font-black uppercase"
                          onClick={() => {
                            setEditingPessoa(p);
                            setPessoaForm({
                              name: p.name || "",
                              matricula: p.matricula || "",
                              shift: p.shift || "Dia",
                              letra: p.letra || "A",
                              plate_tag: p.plate_tag || "",
                              vacation_start: p.vacation_start || "",
                              vacation_end: p.vacation_end || "",
                              ativo: p.ativo !== false,
                              contrato: p.contrato || "CCO PORTO"
                            });
                            setPessoaDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[9px] font-black uppercase text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => deletePessoa(p.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            {people.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-slate-400 italic">
                  Nenhuma pessoa cadastrada. Clique em "Nova Pessoa" para começar.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog: Cadastrar / Editar Pessoa */}
      <Dialog open={pessoaDialogOpen} onOpenChange={open => { if (!open) { setPessoaDialogOpen(false); setEditingPessoa(null); } }}>
        <DialogContent className="max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle className="font-black uppercase text-slate-800">
              {editingPessoa ? "✏️ Editar Pessoa" : "➕ Nova Pessoa"}
            </DialogTitle>
            <DialogDescription className="sr-only">Cadastro de motorista/operador.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-[10px] font-black uppercase text-slate-600">Nome *</Label>
                <Input
                  value={pessoaForm.name}
                  onChange={e => setPessoaForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome completo"
                  className="mt-1 h-8 text-xs font-bold uppercase"
                />
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase text-slate-600">Matrícula</Label>
                <Input
                  value={pessoaForm.matricula}
                  onChange={e => setPessoaForm(f => ({ ...f, matricula: e.target.value }))}
                  placeholder="Ex: 12345"
                  className="mt-1 h-8 text-xs font-mono"
                />
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase text-slate-600">Contrato / Operação</Label>
                <select
                  value={pessoaForm.contrato}
                  onChange={e => setPessoaForm(f => ({ ...f, contrato: e.target.value }))}
                  className="mt-1 w-full h-8 text-xs font-bold border border-slate-300 rounded-md px-2 bg-white"
                >
                  <option value="CCO PORTO">CCO PORTO</option>
                  <option value="CCO USINA">CCO USINA</option>
                </select>
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase text-slate-600">Turno</Label>
                <select
                  value={pessoaForm.shift}
                  onChange={e => setPessoaForm(f => ({ ...f, shift: e.target.value }))}
                  className="mt-1 w-full h-8 text-xs font-bold border border-slate-300 rounded-md px-2 bg-white"
                >
                  <option value="Dia">☀️ Dia</option>
                  <option value="Noite">🌙 Noite</option>
                </select>
              </div>
              <div>
                <Label className="text-[10px] font-black uppercase text-slate-600">Letra de Atuação (2x2)</Label>
                <select
                  value={pessoaForm.letra}
                  onChange={e => setPessoaForm(f => ({ ...f, letra: e.target.value }))}
                  className="mt-1 w-full h-8 text-xs font-bold border border-slate-300 rounded-md px-2 bg-white"
                >
                  <option value="A">Letra A</option>
                  <option value="B">Letra B</option>
                </select>
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] font-black uppercase text-slate-600">Caminhão Fidelizado (Placa/TAG)</Label>
                <select
                  value={pessoaForm.plate_tag}
                  onChange={e => setPessoaForm(f => ({ ...f, plate_tag: e.target.value }))}
                  className="mt-1 w-full h-8 text-xs font-bold border border-slate-300 rounded-md px-2 bg-white"
                >
                  <option value="">— Nenhum —</option>
                  {equipments.map(eq => (
                    <option key={eq.id} value={eq.plate || eq.identifier}>
                      {eq.identifier}{eq.plate && eq.plate !== eq.identifier ? ` (${eq.plate})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] font-black uppercase text-slate-600">Período de Férias</Label>
                <div className="flex gap-2 mt-1">
                  <div className="flex-1">
                    <Label className="text-[9px] text-slate-400">Início</Label>
                    <Input
                      type="date"
                      value={pessoaForm.vacation_start}
                      onChange={e => setPessoaForm(f => ({ ...f, vacation_start: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-[9px] text-slate-400">Fim</Label>
                    <Input
                      type="date"
                      value={pessoaForm.vacation_end}
                      onChange={e => setPessoaForm(f => ({ ...f, vacation_end: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPessoaDialogOpen(false)} className="font-bold text-xs">Cancelar</Button>
            <Button onClick={savePessoa} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Indisponibilidades */}
      <Dialog open={indispDialogOpen} onOpenChange={open => { if (!open) setIndispDialogOpen(false); }}>
        <DialogContent className="max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle className="font-black uppercase text-slate-800">
              📅 Indisponibilidades — {selectedPessoaForIndisp?.name}
            </DialogTitle>
            <DialogDescription className="sr-only">Gerenciar períodos de indisponibilidade.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Existing indisps */}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {pessoaIndisps
                .filter((i: any) => i.pessoa_id === selectedPessoaForIndisp?.id)
                .map((i: any) => (
                  <div key={i.id} className="flex items-center justify-between bg-rose-50 border border-rose-100 rounded-lg px-3 py-1.5">
                    <div className="text-xs">
                      <span className="font-black text-rose-700 uppercase">{i.tipo}</span>
                      <span className="text-slate-500 ml-2">
                        {new Date(i.data_inicio + "T12:00:00").toLocaleDateString("pt-BR")} →{" "}
                        {new Date(i.data_fim + "T12:00:00").toLocaleDateString("pt-BR")}
                      </span>
                      {i.motivo && <span className="text-slate-400 italic ml-2">— {i.motivo}</span>}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-rose-500 hover:bg-rose-100"
                      onClick={() => deleteIndisp(i.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              {pessoaIndisps.filter((i: any) => i.pessoa_id === selectedPessoaForIndisp?.id).length === 0 && (
                <p className="text-xs text-slate-400 italic text-center py-2">Nenhuma indisponibilidade cadastrada.</p>
              )}
            </div>
            
            {/* Add new indisp */}
            <div className="border-t pt-3 space-y-2">
              <p className="text-[10px] font-black uppercase text-slate-500">Registrar Nova</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[9px] font-black uppercase text-slate-500">Tipo</Label>
                  <select
                    value={indispForm.tipo}
                    onChange={e => setIndispForm(f => ({ ...f, tipo: e.target.value }))}
                    className="mt-1 w-full h-8 text-xs font-bold border border-slate-300 rounded-md px-2 bg-white"
                  >
                    <option>Atestado</option>
                    <option>Folga Programada</option>
                    <option>Suspenso</option>
                    <option>Outro</option>
                  </select>
                </div>
                <div>
                  <Label className="text-[9px] font-black uppercase text-slate-500">Motivo (opcional)</Label>
                  <Input
                    value={indispForm.motivo}
                    onChange={e => setIndispForm(f => ({ ...f, motivo: e.target.value }))}
                    placeholder="Descrição..."
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[9px] font-black uppercase text-slate-500">Data Início</Label>
                  <Input type="date" value={indispForm.data_inicio} onChange={e => setIndispForm(f => ({ ...f, data_inicio: e.target.value }))} className="mt-1 h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-[9px] font-black uppercase text-slate-500">Data Fim</Label>
                  <Input type="date" value={indispForm.data_fim} onChange={e => setIndispForm(f => ({ ...f, data_fim: e.target.value }))} className="mt-1 h-8 text-xs" />
                </div>
              </div>
              <Button onClick={saveIndisp} className="w-full h-8 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase">
                <Plus className="h-3.5 w-3.5 mr-1" /> Registrar Indisponibilidade
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIndispDialogOpen(false)} className="font-bold text-xs">Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
