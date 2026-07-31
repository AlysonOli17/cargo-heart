import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/AppLayout";
import { parseExcelFile, type ParsedDay, type ParsedScheduleRow } from "@/lib/excel-parser";
import {
  getSchedulesByDate, upsertSchedules, deleteSchedulesByDate, getContracts
} from "@/lib/cco-service";
import type { Contract } from "@/lib/cco-service";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Calendar,
  Trash2, Eye, ChevronDown, ChevronUp, RefreshCw, Info
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/programacao")({
  component: ProgramacaoPage,
});

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type ImportStatus = "idle" | "parsing" | "preview" | "importing" | "done" | "error";

export default function ProgramacaoPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [existingSchedules, setExistingSchedules] = useState<any[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);

  // Import state
  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [parsedData, setParsedData] = useState<ParsedDay[]>([]);
  const [selectedDay, setSelectedDay] = useState<ParsedDay | null>(null);
  const [importError, setImportError] = useState("");
  const [importProgress, setImportProgress] = useState(0);
  const [filename, setFilename] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading]);

  useEffect(() => {
    getContracts().then(setContracts).catch(console.error);
  }, []);

  useEffect(() => {
    loadExistingSchedules();
  }, [selectedDate]);

  async function loadExistingSchedules() {
    setLoadingSchedules(true);
    try {
      const data = await getSchedulesByDate(selectedDate);
      setExistingSchedules(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSchedules(false);
    }
  }

  async function handleFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setImportError("Apenas arquivos .xlsx e .xls são aceitos");
      setImportStatus("error");
      return;
    }

    setFilename(file.name);
    setImportStatus("parsing");
    setImportError("");

    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseExcelFile(buffer, file.name);

      if (parsed.length === 0) {
        setImportError("Nenhuma programação encontrada no arquivo. Verifique se o arquivo é válido.");
        setImportStatus("error");
        return;
      }

      setParsedData(parsed);

      // Try to auto-select the day matching the selected date
      const matchingDay = parsed.find(d => d.date === selectedDate);
      setSelectedDay(matchingDay || parsed[parsed.length - 1]);
      setImportStatus("preview");
    } catch (e: any) {
      setImportError(e.message || "Erro ao processar o arquivo");
      setImportStatus("error");
    }
  }

  async function handleImport() {
    if (!selectedDay || !user) return;
    setImportStatus("importing");
    setImportProgress(0);

    try {
      const contractMap = new Map<string, string>();
      contracts.forEach(c => {
        contractMap.set(`${c.type}-${c.client}`, c.id);
        contractMap.set(c.name, c.id);
      });

      // Flatten all rows from all groups
      const allRows: any[] = [];
      for (const group of selectedDay.groups) {
        const contractKey = `${group.contract_type}-Usina`;
        const contractId = contractMap.get(contractKey) || contractMap.get(`${group.contract_type} Usina`) || contracts[0]?.id;

        for (const row of group.rows) {
          allRows.push({
            date: selectedDay.date,
            shift: group.shift,
            contract_id: contractId,
            team: group.team,
            equipment_identifier: row.equipment_identifier,
            plate: row.plate !== "DISPONIVEL" ? row.plate : null,
            model: row.model,
            operator_name: row.operator_name,
            cost_center: row.cost_center,
            location: row.location,
            activity: row.activity,
            work_order: row.work_order,
            turno: row.turno,
            schedule_start: row.schedule_start,
            schedule_end: row.schedule_end,
            status: "operando" as const,
            imported_from: filename,
            created_by: user.id,
          });
        }
      }

      // Delete existing schedules for this date if any
      if (existingSchedules.length > 0) {
        await deleteSchedulesByDate(selectedDay.date);
      }

      setImportProgress(30);

      // Import in batches
      const batchSize = 50;
      for (let i = 0; i < allRows.length; i += batchSize) {
        const batch = allRows.slice(i, i + batchSize);
        await upsertSchedules(batch);
        setImportProgress(30 + Math.round(((i + batchSize) / allRows.length) * 70));
      }

      setImportProgress(100);
      setImportStatus("done");
      await loadExistingSchedules();
    } catch (e: any) {
      setImportError(e.message || "Erro ao importar");
      setImportStatus("error");
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [contracts, selectedDate]);

  const totalRows = selectedDay?.groups.reduce((a, g) => a + g.rows.length, 0) || 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-foreground">Programação Diária</h1>
            <p className="text-muted-foreground text-sm font-medium">
              Importe o Excel do dia ou gerencie a programação manualmente
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Existing schedules info */}
        {existingSchedules.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700">
            <Info className="w-4 h-4 shrink-0" />
            <p className="text-sm font-medium">
              <strong>{existingSchedules.length} equipamentos</strong> já programados para{" "}
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}.
              Uma nova importação substituirá os dados existentes.
            </p>
            <button
              onClick={loadExistingSchedules}
              className="ml-auto p-1.5 hover:bg-blue-100 rounded-md transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Upload zone */}
        {(importStatus === "idle" || importStatus === "error") && (
          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            className={cn(
              "border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer",
              dragging
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-border hover:border-primary/40 hover:bg-accent/30"
            )}
            onClick={() => document.getElementById("excel-file-input")?.click()}
          >
            <input
              id="excel-file-input"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <div className="flex flex-col items-center gap-4">
              <div className={cn(
                "w-16 h-16 rounded-2xl flex items-center justify-center transition-all",
                dragging ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                <FileSpreadsheet className="w-8 h-8" />
              </div>
              <div>
                <p className="font-black text-foreground text-lg">
                  {dragging ? "Solte o arquivo aqui" : "Arraste o Excel ou clique para selecionar"}
                </p>
                <p className="text-muted-foreground text-sm font-medium mt-1">
                  Suporta arquivos .xlsx e .xls · Detecta automaticamente os contratos
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground font-medium">
                <span>✓ Habitual Dia/Noite</span>
                <span>✓ Eventual Dia/Noite</span>
                <span>✓ Múltiplas equipes</span>
              </div>
            </div>
          </div>
        )}

        {importStatus === "error" && (
          <div className="flex items-center gap-3 px-4 py-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p className="text-sm font-medium">{importError}</p>
            <button onClick={() => { setImportStatus("idle"); setImportError(""); }} className="ml-auto text-xs font-bold underline">
              Tentar novamente
            </button>
          </div>
        )}

        {importStatus === "parsing" && (
          <div className="flex items-center gap-4 px-6 py-8 bg-card border border-border rounded-2xl">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <div>
              <p className="font-bold text-foreground">Processando arquivo...</p>
              <p className="text-sm text-muted-foreground">{filename}</p>
            </div>
          </div>
        )}

        {/* Preview */}
        {(importStatus === "preview" || importStatus === "importing" || importStatus === "done") && selectedDay && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
              {/* Preview header */}
              <div className="px-6 py-4 border-b border-border bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-primary" />
                  <div>
                    <p className="font-black text-foreground text-sm">{filename}</p>
                    <p className="text-xs text-muted-foreground font-medium">
                      {parsedData.length} dia{parsedData.length > 1 ? "s" : ""} encontrado{parsedData.length > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                {importStatus !== "done" && (
                  <button
                    onClick={() => { setImportStatus("idle"); setParsedData([]); setSelectedDay(null); }}
                    className="text-xs text-muted-foreground hover:text-foreground font-medium"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              {/* Day selector (if multiple sheets) */}
              {parsedData.length > 1 && (
                <div className="px-6 py-3 border-b border-border overflow-x-auto">
                  <div className="flex gap-2 min-w-max">
                    {parsedData.map(d => (
                      <button
                        key={d.sheetName}
                        onClick={() => setSelectedDay(d)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                          selectedDay.sheetName === d.sheetName
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-accent"
                        )}
                      >
                        {d.sheetName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Groups preview */}
              <div className="p-4 space-y-3">
                {selectedDay.groups.map((group, gi) => (
                  <GroupPreview key={gi} group={group} />
                ))}
              </div>

              {/* Import action */}
              <div className="px-6 py-4 border-t border-border bg-muted/10 flex items-center justify-between">
                <div>
                  <p className="font-bold text-foreground text-sm">
                    {totalRows} equipamentos em {selectedDay.groups.length} blocos
                  </p>
                  <p className="text-xs text-muted-foreground font-medium">
                    Data: {new Date(selectedDay.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                  </p>
                </div>
                {importStatus === "preview" && (
                  <button
                    id="btn-import"
                    onClick={handleImport}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    Importar Programação
                  </button>
                )}
                {importStatus === "importing" && (
                  <div className="flex items-center gap-3">
                    <div className="w-32 bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${importProgress}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-muted-foreground">{importProgress}%</span>
                  </div>
                )}
                {importStatus === "done" && (
                  <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span className="font-bold text-sm">Importado com sucesso!</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Current schedule table */}
        {existingSchedules.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-black text-foreground text-sm uppercase tracking-wide">
                  Programação do Dia
                </h3>
                <p className="text-xs text-muted-foreground font-medium mt-0.5">
                  {existingSchedules.length} equipamentos programados
                </p>
              </div>
              <button
                onClick={async () => {
                  if (confirm("Apagar toda a programação deste dia?")) {
                    await deleteSchedulesByDate(selectedDate);
                    await loadExistingSchedules();
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Apagar tudo
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[700px]">
                <thead>
                  <tr className="border-b border-border text-[9px] font-black text-muted-foreground uppercase tracking-widest bg-muted/10">
                    <th className="px-4 py-2">Equipamento</th>
                    <th className="px-4 py-2">Placa</th>
                    <th className="px-4 py-2">Contrato / Turno</th>
                    <th className="px-4 py-2">Operador</th>
                    <th className="px-4 py-2">Horário</th>
                    <th className="px-4 py-2">Local</th>
                    <th className="px-4 py-2">OS</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {existingSchedules.map(s => (
                    <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="font-bold text-sm text-foreground">{s.equipment_identifier}</p>
                        {s.model && <p className="text-[10px] text-muted-foreground">{s.model}</p>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-foreground">{s.plate || "—"}</td>
                      <td className="px-4 py-2.5">
                        <p className="text-xs font-bold text-foreground">{s.contracts?.name}</p>
                        <p className="text-[10px] text-muted-foreground">{s.shift} · {s.team || ""}</p>
                      </td>
                      <td className="px-4 py-2.5 text-sm font-medium text-foreground">{s.operator_name || "—"}</td>
                      <td className="px-4 py-2.5">
                        {s.schedule_start ? (
                          <span className="font-mono text-xs text-foreground">
                            {s.schedule_start?.slice(0, 5)} — {s.schedule_end?.slice(0, 5)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={s.location || ""}>
                        {s.location || "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.work_order || "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          "inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase border",
                          s.status === "operando" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                          s.status === "agendado" && "bg-slate-100 text-slate-600 border-slate-200",
                          s.status === "corretiva" && "bg-red-50 text-red-700 border-red-200",
                          s.status === "finalizado" && "bg-blue-50 text-blue-700 border-blue-200",
                        )}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function GroupPreview({ group }: { group: ParsedDay["groups"][number] }) {
  const [expanded, setExpanded] = useState(true);
  const typeColor = group.contract_type === "Eventual" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700";
  const shiftColor = group.shift === "Noite" ? "bg-slate-100 text-slate-600" : "bg-orange-100 text-orange-700";

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black uppercase", typeColor)}>
            {group.contract_type}
          </span>
          <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black uppercase", shiftColor)}>
            {group.shift}
          </span>
          {group.team && (
            <span className="text-xs font-bold text-foreground">{group.team}</span>
          )}
          <span className="text-[10px] text-muted-foreground font-medium">{group.rows.length} equip.</span>
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[600px]">
            <thead>
              <tr className="border-b border-border text-[9px] font-black text-muted-foreground uppercase tracking-widest bg-muted/5">
                <th className="px-3 py-1.5">Equipamento</th>
                <th className="px-3 py-1.5">Placa</th>
                <th className="px-3 py-1.5">Turno / Horário</th>
                <th className="px-3 py-1.5">Operador</th>
                <th className="px-3 py-1.5">Local</th>
                <th className="px-3 py-1.5">OS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {group.rows.map((row, i) => (
                <tr key={i} className="hover:bg-muted/10 transition-colors">
                  <td className="px-3 py-1.5 text-xs font-bold text-foreground">{row.equipment_identifier}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-foreground">{row.plate || "—"}</td>
                  <td className="px-3 py-1.5">
                    <p className="text-[10px] font-bold text-foreground">{row.turno}</p>
                    {row.schedule_start && (
                      <p className="text-[9px] text-muted-foreground font-mono">{row.schedule_start} — {row.schedule_end}</p>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-[10px] text-muted-foreground font-medium">{row.operator_name || "—"}</td>
                  <td className="px-3 py-1.5 text-[10px] text-muted-foreground max-w-[180px] truncate">{row.location || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground">{row.work_order || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
