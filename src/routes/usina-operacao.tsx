import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { 
  FileSpreadsheet, 
  Upload, 
  Search, 
  Wrench, 
  Activity, 
  Clock, 
  Play, 
  Square, 
  ChevronRight, 
  Trash2, 
  AlertCircle,
  CheckCircle2,
  Pencil
} from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "@/hooks/use-auth";
import { STATUS_LABELS } from "@/lib/equipment";

export const Route = createFileRoute("/usina-operacao")({
  head: () => ({ meta: [{ title: "Operação Usina — Frota Busato" }] }),
  component: () => <AppLayout><UsinaOperacaoPage /></AppLayout>,
});

type UsinaSchedule = {
  id: string;
  scheduled_date: string;
  equipment: string | null;
  plate: string;
  model: string | null;
  client: string | null;
  shift: string | null;
  valley_time: string | null;
  valley_start: string | null;
  valley_end: string | null;
  cost_center: string | null;
  subet: string | null;
  local: string | null;
  activity: string | null;
  operator: string | null;
  os_number: string | null;
  is_completed: boolean;
};

type CorrectiveLog = {
  id: string;
  schedule_id: string;
  stop_start: string;
  stop_end: string | null;
  reason: string;
  notes: string | null;
};

function UsinaOperacaoPage() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [schedules, setSchedules] = useState<UsinaSchedule[]>([]);
  const [correctiveLogs, setCorrectiveLogs] = useState<CorrectiveLog[]>([]);
  const [equipments, setEquipments] = useState<{ id: string; identifier: string; plate?: string | null; model?: string | null; status?: string | null }[]>([]);
  const [search, setSearch] = useState("");
  
  // Excel File State
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  // Corrective Stop Dialog State
  const [stopOpen, setStopOpen] = useState(false);
  const [activeSchedule, setActiveSchedule] = useState<UsinaSchedule | null>(null);
  const [stopReason, setStopReason] = useState("");
  const [stopNotes, setStopNotes] = useState("");
  const [stopStartStr, setStopStartStr] = useState(format(new Date(), "HH:mm"));
  const [stopEndStr, setStopEndStr] = useState("");

  // Edit Row Dialog State
  const [editOpen, setEditOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<UsinaSchedule | null>(null);
  const [editEquipmentId, setEditEquipmentId] = useState("");
  const [editEquipmentName, setEditEquipmentName] = useState("");
  const [editPlate, setEditPlate] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editOperator, setEditOperator] = useState("");
  const [editValleyStart, setEditValleyStart] = useState("");
  const [editValleyEnd, setEditValleyEnd] = useState("");
  const [editCostCenter, setEditCostCenter] = useState("");
  const [editSubet, setEditSubet] = useState("");
  const [editLocal, setEditLocal] = useState("");
  const [editActivity, setEditActivity] = useState("");
  const [editOS, setEditOS] = useState("");

  const getEquipmentWarning = (equipmentName: string | null, plate: string | null) => {
    if (!equipmentName && !plate) return null;
    
    const eqNameClean = equipmentName?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const plateClean = plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

    // Match equipment in registered system by normalized alphanumeric comparison
    const match = equipments.find(e => {
      const eIdClean = e.identifier?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const ePlateClean = e.plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      
      return (
        (eqNameClean && eIdClean === eqNameClean) ||
        (plateClean && ePlateClean === plateClean) ||
        (eqNameClean && ePlateClean === eqNameClean) ||
        (plateClean && eIdClean === plateClean)
      );
    });

    if (!match) {
      return {
        type: "not_registered",
        message: "Não Cadastrado",
        color: "bg-amber-100 text-amber-850 border-amber-300 text-amber-900"
      };
    }

    const unavailableStatuses = ["manutencao", "indisponivel", "programado", "finalizacao"];
    if (unavailableStatuses.includes(match.status || "")) {
      const statusLabel = STATUS_LABELS[match.status as keyof typeof STATUS_LABELS] || match.status;
      return {
        type: "unavailable",
        message: `Substituição Necessária (${statusLabel})`,
        color: "bg-rose-100 text-rose-800 border-rose-300"
      };
    }

    return null;
  };

  const loadData = async () => {
    // 1. Carrega equipamentos de forma independente (para não falhar caso as tabelas da usina não existam)
    try {
      const { data: eqs, error: eEq } = await supabase.from("equipment").select("id, identifier, model, status, notes");
      if (eEq) throw eEq;

      const formattedEqs = (eqs ?? []).map(eq => {
        let plate = null;
        if (eq.notes) {
          try {
            const parsed = typeof eq.notes === "string" ? JSON.parse(eq.notes) : eq.notes;
            plate = parsed.te_tag || parsed.plate || null;
          } catch (e) {
            // Ignorar erro de parse
          }
        }
        return {
          id: eq.id,
          identifier: eq.identifier,
          model: eq.model,
          status: eq.status,
          plate: plate || eq.identifier
        };
      });

      setEquipments(formattedEqs);
      // Salva no localStorage para uso offline/fallback
      localStorage.setItem("local_equipment", JSON.stringify(formattedEqs));
    } catch (err) {
      console.warn("Falha ao buscar equipamentos do Supabase, usando fallback local:", err);
      const localEqs = JSON.parse(localStorage.getItem("local_equipment") || "[]");
      setEquipments(localEqs);
    }

    // 2. Carrega as escalas e corretivas da Usina
    try {
      const { data: scheds, error: e1 } = await supabase.from("usina_daily_schedules").select("*").eq("scheduled_date", selectedDate);
      if (e1) throw e1;
      const { data: logs, error: e2 } = await supabase.from("usina_corrective_logs").select("*");
      if (e2) throw e2;

      setSchedules((scheds ?? []) as UsinaSchedule[]);
      setCorrectiveLogs((logs ?? []) as CorrectiveLog[]);
    } catch (err) {
      // Fallback localStorage para escalas e corretivas
      const localScheds = JSON.parse(localStorage.getItem("local_usina_schedules") || "[]");
      const localLogs = JSON.parse(localStorage.getItem("local_usina_corrective_logs") || "[]");
      setSchedules(localScheds.filter((s: any) => s.scheduled_date === selectedDate));
      setCorrectiveLogs(localLogs);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadData();
    const chSched = supabase.channel("usina-sched-rt").on("postgres_changes", { event: "*", schema: "public", table: "usina_daily_schedules" }, loadData).subscribe();
    const chLogs = supabase.channel("usina-logs-rt").on("postgres_changes", { event: "*", schema: "public", table: "usina_corrective_logs" }, loadData).subscribe();
    return () => {
      supabase.removeChannel(chSched);
      supabase.removeChannel(chLogs);
    };
  }, [user, selectedDate]);

  const handlePdfChange = async (selectedFile: File) => {
    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const parsedRows: { text: string; x: number }[][] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const items = content.items as any[];

        const linesMap: Record<number, any[]> = {};
        items.forEach(item => {
          if (!item.str || item.str.trim() === "") return;
          const y = Math.round(item.transform[5]);
          const foundY = Object.keys(linesMap).find(k => Math.abs(Number(k) - y) < 4);
          if (foundY) {
            linesMap[Number(foundY)].push(item);
          } else {
            linesMap[y] = [item];
          }
        });

        const sortedY = Object.keys(linesMap).map(Number).sort((a, b) => b - a);
        sortedY.forEach(y => {
          const lineItems = linesMap[y].sort((a, b) => a.transform[4] - b.transform[4]);
          const rowData = lineItems.map(item => ({
            text: item.str.trim(),
            x: Math.round(item.transform[4])
          }));
          if (rowData.length > 0) {
            parsedRows.push(rowData);
          }
        });
      }

      // Detect header row
      let headerRowIndex = -1;
      let headerCells: { text: string; x: number }[] = [];
      
      for (let i = 0; i < parsedRows.length; i++) {
        const row = parsedRows[i];
        const hasPlaca = row.some(cell => /placa|plate/i.test(cell.text));
        const hasEquip = row.some(cell => /equipamento|equip/i.test(cell.text));
        const hasTurno = row.some(cell => /turno|shift/i.test(cell.text));
        if (hasPlaca || (hasEquip && hasTurno)) {
          headerRowIndex = i;
          headerCells = row;
          break;
        }
      }

      if (headerRowIndex === -1) {
        const firstRow = parsedRows.find(r => r.length > 3);
        if (firstRow) {
          headerCells = firstRow;
          headerRowIndex = parsedRows.indexOf(firstRow);
        }
      }

      const dataRows = parsedRows.slice(headerRowIndex + 1);
      const normalizedData = dataRows.map(row => {
        const rowObj: any = {};
        
        row.forEach(cell => {
          let closestHeader: any = null;
          let minDistance = Infinity;
          
          headerCells.forEach(hCell => {
            const dist = Math.abs(hCell.x - cell.x);
            if (dist < minDistance) {
              minDistance = dist;
              closestHeader = hCell;
            }
          });
          
          if (closestHeader) {
            const key = closestHeader.text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
            rowObj[key] = rowObj[key] ? (rowObj[key] + " " + cell.text) : cell.text;
          }
        });
        
        return rowObj;
      });

      setPreviewData(normalizedData.filter(row => row.placa || row.equipment || row.equipamento || row.tetag));
    } catch (err) {
      console.error("PDF parse error", err);
      toast.error("Erro ao ler arquivo PDF.");
    }
  };

  // Excel/PDF parser for Usina
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);

    if (selectedFile.name.endsWith(".pdf")) {
      handlePdfChange(selectedFile);
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        const normalized = data.map((row: any) => {
          const newRow: any = {};
          Object.keys(row).forEach(k => {
            const normKey = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
            newRow[normKey] = row[k];
          });
          return newRow;
        });

        setPreviewData(normalized);
      } catch (err) {
        toast.error("Erro ao processar planilha.");
      }
    };
    reader.readAsBinaryString(selectedFile);
  };

  const handleImportSchedules = async () => {
    if (previewData.length === 0) return;
    setImportLoading(true);
    let count = 0;
    const timeRegex = /(\d{2}:\d{2})\s*(?:-|as|to|às|a|x)\s*(\d{2}:\d{2})/i;
    const finalPayloads: any[] = [];

    for (const row of previewData) {
      const te_tag = (row.tetag || row.te_tag || row["te+tag"] || "").toString().trim().toUpperCase();
      let rawPlaca = (row.placa || row.plate || "").toString().trim().toUpperCase();
      if (!rawPlaca || rawPlaca === "N/A" || rawPlaca === "NA") {
        rawPlaca = te_tag;
      }

      if (!rawPlaca) continue;

      const rawValley = (row.horariovale || row.valley_time || row.horario || "").toString().trim();
      const match = rawValley.match(timeRegex);
      let valley_start = null;
      let valley_end = null;
      if (match) {
        valley_start = match[1];
        valley_end = match[2];
      } else if (rawValley) {
        valley_start = rawValley;
      }

      const rawOS = (row.os || row.ordemdeservico || row.osnumber || "").toString().trim();
      
      // Determine if it is a night shift (start time after 18:00)
      let isNightShift = false;
      if (valley_start) {
        const parts = valley_start.split(":");
        const startHour = parseInt(parts[0], 10);
        if (!isNaN(startHour) && startHour >= 18) {
          isNightShift = true;
        }
      }

      // Check if we need to split the night shift (contains / in OS and is night shift)
      if (isNightShift && rawOS.includes("/")) {
        const osParts = rawOS.split("/").map(o => o.trim());
        const os1 = osParts[0];
        const os2 = osParts[1] || osParts[0];

        const basePayload = {
          scheduled_date: selectedDate,
          equipment: row.equipamento || row.equipment || null,
          plate: rawPlaca,
          model: row.modelo || row.model || null,
          client: row.cliente || row.client || null,
          cost_center: row.centrodecusto || row.costcenter || null,
          subet: row.subet || row.subetapa || null,
          local: row.local || row.localidade || null,
          activity: row.atividade || row.tagprogramacaovale || null,
          operator: row.operador || row.motorista || null,
          is_completed: false,
          owner_id: user?.id
        };

        // Record 1: from start time to 23:59
        finalPayloads.push({
          ...basePayload,
          shift: "NOITE (P1)",
          valley_time: `${valley_start} - 23:59`,
          valley_start,
          valley_end: "23:59",
          os_number: os1
        });

        // Record 2: from 00:00 to end time
        finalPayloads.push({
          ...basePayload,
          shift: "NOITE (P2)",
          valley_time: `00:00 - ${valley_end || "07:00"}`,
          valley_start: "00:00",
          valley_end: valley_end || "07:00",
          os_number: os2
        });
      } else {
        // Standard single record
        finalPayloads.push({
          scheduled_date: selectedDate,
          equipment: row.equipamento || row.equipment || null,
          plate: rawPlaca,
          model: row.modelo || row.model || null,
          client: row.cliente || row.client || null,
          shift: isNightShift ? "NOITE" : (row.turno || row.shift || "DIA"),
          valley_time: rawValley || null,
          valley_start,
          valley_end,
          cost_center: row.centrodecusto || row.costcenter || null,
          subet: row.subet || row.subetapa || null,
          local: row.local || row.localidade || null,
          activity: row.atividade || row.tagprogramacaovale || null,
          operator: row.operador || row.motorista || null,
          os_number: rawOS,
          is_completed: false,
          owner_id: user?.id
        });
      }
    }

    for (const payload of finalPayloads) {
      try {
        const { error } = await supabase.from("usina_daily_schedules").insert(payload);
        if (error) throw error;
        count++;
      } catch (err) {
        // Localstorage fallback
        const localScheds = JSON.parse(localStorage.getItem("local_usina_schedules") || "[]");
        localScheds.push({ ...payload, id: Math.random().toString(36).substring(2) });
        localStorage.setItem("local_usina_schedules", JSON.stringify(localScheds));
        count++;
      }
    }

    toast.success(`Importados ${count} registros com sucesso.`);
    setImportLoading(false);
    setImportOpen(false);
    setFile(null);
    setPreviewData([]);
    loadData();
  };

  // Launch corrective stop
  const handleAddCorrective = async () => {
    if (!activeSchedule || !stopReason) {
      toast.error("Motivo obrigatório");
      return;
    }

    // Parse stop times into full ISO string
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const stop_start = `${todayStr}T${stopStartStr || "00:00"}:00`;
    const stop_end = stopEndStr ? `${todayStr}T${stopEndStr}:00` : null;

    const payload = {
      schedule_id: activeSchedule.id,
      stop_start,
      stop_end,
      reason: stopReason,
      notes: stopNotes,
      owner_id: user?.id
    };

    try {
      const { error } = await supabase.from("usina_corrective_logs").insert(payload);
      if (error) throw error;
      toast.success("Parada corretiva registrada!");
    } catch (err) {
      const localLogs = JSON.parse(localStorage.getItem("local_usina_corrective_logs") || "[]");
      localLogs.push({ ...payload, id: Math.random().toString(36).substring(2) });
      localStorage.setItem("local_usina_corrective_logs", JSON.stringify(localLogs));
      toast.success("Parada corretiva salva localmente");
    }

    setStopOpen(false);
    setStopReason("");
    setStopNotes("");
    loadData();
  };

  const handleFinishStop = async (logId: string, endTime: string) => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const stop_end = `${todayStr}T${endTime}:00`;

    try {
      const { error } = await supabase.from("usina_corrective_logs").update({ stop_end }).eq("id", logId);
      if (error) throw error;
      toast.success("Parada finalizada.");
      loadData();
    } catch (err) {
      const localLogs = JSON.parse(localStorage.getItem("local_usina_corrective_logs") || "[]");
      const mapped = localLogs.map((l: any) => l.id === logId ? { ...l, stop_end } : l);
      localStorage.setItem("local_usina_corrective_logs", JSON.stringify(mapped));
      toast.success("Atualizado localmente");
      loadData();
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    try {
      const { error } = await supabase.from("usina_daily_schedules").delete().eq("id", id);
      if (error) throw error;
      toast.success("Escala deletada");
      loadData();
    } catch (err) {
      const localScheds = JSON.parse(localStorage.getItem("local_usina_schedules") || "[]");
      const filtered = localScheds.filter((s: any) => s.id !== id);
      localStorage.setItem("local_usina_schedules", JSON.stringify(filtered));
      toast.success("Deletado localmente");
      loadData();
    }
  };

  const handleUpdateSchedule = async () => {
    if (!editingSchedule) return;

    const payload = {
      equipment: editEquipmentName || null,
      plate: editPlate,
      model: editModel || null,
      operator: editOperator || null,
      valley_start: editValleyStart || null,
      valley_end: editValleyEnd || null,
      valley_time: (editValleyStart && editValleyEnd) ? `${editValleyStart} - ${editValleyEnd}` : null,
      cost_center: editCostCenter || null,
      subet: editSubet || null,
      local: editLocal || null,
      activity: editActivity || null,
      os_number: editOS || null,
    };

    try {
      const { error } = await supabase.from("usina_daily_schedules").update(payload).eq("id", editingSchedule.id);
      if (error) throw error;
      toast.success("Programação atualizada com sucesso!");
    } catch (err) {
      const localScheds = JSON.parse(localStorage.getItem("local_usina_schedules") || "[]");
      const updated = localScheds.map((s: any) => s.id === editingSchedule.id ? { ...s, ...payload } : s);
      localStorage.setItem("local_usina_schedules", JSON.stringify(updated));
      toast.success("Atualizado localmente");
    }

    setEditOpen(false);
    setEditingSchedule(null);
    loadData();
  };

  // Filter schedules
  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      const matchSearch = (s.plate || "").toLowerCase().includes(search.toLowerCase()) || 
                          (s.operator || "").toLowerCase().includes(search.toLowerCase()) ||
                          (s.local || "").toLowerCase().includes(search.toLowerCase());
      return matchSearch;
    });
  }, [schedules, search]);

  // Analytics: Adherence & Downtime math
  const analytics = useMemo(() => {
    // 12h = 720m shift as a baseline for each scheduled equipment
    const baselineShiftMinutes = 720;
    
    // Grouped by Local / Frente de Atendimento
    const adherenceByLocal: Record<string, { totalScheduled: number, totalBreakdowns: number, breakdownMinutes: number }> = {};
    let totalScheduledCount = schedules.length;
    let totalBreakdownMinutes = 0;

    schedules.forEach(s => {
      const localKey = s.local || "OUTROS";
      if (!adherenceByLocal[localKey]) {
        adherenceByLocal[localKey] = { totalScheduled: 0, totalBreakdowns: 0, breakdownMinutes: 0 };
      }
      
      adherenceByLocal[localKey].totalScheduled++;

      // Sum breakdown time for this schedule
      const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
      stops.forEach(st => {
        adherenceByLocal[localKey].totalBreakdowns++;
        if (st.stop_start) {
          const start = new Date(st.stop_start).getTime();
          const end = st.stop_end ? new Date(st.stop_end).getTime() : Date.now();
          const diffMin = Math.floor((end - start) / 60000);
          if (diffMin > 0) {
            adherenceByLocal[localKey].breakdownMinutes += diffMin;
            totalBreakdownMinutes += diffMin;
          }
        }
      });
    });

    const localList = Object.keys(adherenceByLocal).map(k => {
      const group = adherenceByLocal[k];
      const scheduledMinutes = group.totalScheduled * baselineShiftMinutes;
      const uptime = Math.max(0, scheduledMinutes - group.breakdownMinutes);
      const adherenceScore = scheduledMinutes > 0 ? Math.round((uptime / scheduledMinutes) * 100) : 100;
      return {
        local: k,
        totalScheduled: group.totalScheduled,
        totalBreakdowns: group.totalBreakdowns,
        breakdownHours: (group.breakdownMinutes / 60).toFixed(1),
        adherence: adherenceScore
      };
    });

    const totalScheduledMinutes = totalScheduledCount * baselineShiftMinutes;
    const overallUptime = Math.max(0, totalScheduledMinutes - totalBreakdownMinutes);
    const overallAdherence = totalScheduledMinutes > 0 ? Math.round((overallUptime / totalScheduledMinutes) * 100) : 100;

    return {
      localList,
      overallAdherence,
      totalBreakdownHours: (totalBreakdownMinutes / 60).toFixed(1)
    };
  }, [schedules, correctiveLogs]);

  return (
    <div className="space-y-4">
      
      {/* Title & Import section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tighter text-slate-900 flex items-center gap-1.5">
            <Activity className="h-5 w-5 text-indigo-600 animate-pulse" />
            Operação Diária Usina
          </h1>
          <p className="text-muted-foreground font-medium text-[9px] uppercase tracking-widest mt-0.5">Acompanhamento e Registro de Escalas diárias</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Date Picker */}
          <Input 
            type="date" 
            value={selectedDate} 
            onChange={(e) => setSelectedDate(e.target.value)} 
            className="w-36 h-8 text-xs font-bold bg-white" 
          />

          {/* Import Excel Trigger */}
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button className="font-bold bg-indigo-600 hover:bg-indigo-700 text-white uppercase text-[9px] h-8 px-3">
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Importar Programação
              </Button>
            </DialogTrigger>
            <DialogContent className={previewData.length > 0 ? "max-w-4xl max-h-[90vh] overflow-y-auto" : "max-w-md"}>
              <DialogHeader>
                <DialogTitle className="font-black uppercase text-slate-800">Importar Escala Diária</DialogTitle>
                <DialogDescription className="sr-only">Selecione uma planilha excel (.xlsx, .xls) ou PDF para importar a programação diária da usina.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="border-2 border-dashed border-slate-200 hover:border-slate-300 rounded-xl p-6 text-center cursor-pointer relative bg-slate-50/50">
                  <input 
                    type="file" 
                    accept=".xlsx, .xls, .pdf" 
                    onChange={handleFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <FileSpreadsheet className="h-10 w-10 mx-auto text-slate-400 mb-2" />
                  <p className="text-xs font-bold text-slate-700">
                    {file ? file.name : "Selecione a planilha ou arquivo PDF..."}
                  </p>
                  <p className="text-[9px] text-slate-400 mt-1 uppercase font-black">Mapeia: Equipamento, Placa, Turno, CC, Local, OS, Operador</p>
                </div>

                {previewData.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-indigo-600 text-center uppercase">Contém {previewData.length} registros no arquivo.</p>
                    
                    <div className="border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-slate-50 sticky top-0">
                          <TableRow className="text-[9px] uppercase font-black">
                            <TableHead className="py-1">Equipamento</TableHead>
                            <TableHead className="py-1">Placa</TableHead>
                            <TableHead className="py-1">Turno/Horário</TableHead>
                            <TableHead className="py-1">Operador</TableHead>
                            <TableHead className="py-1">Validação</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody className="text-[11px] font-bold text-slate-800">
                          {previewData.map((row, idx) => {
                            const equipName = row.equipamento || row.equipment || null;
                            const te_tag = (row.tetag || row.te_tag || row["te+tag"] || "").toString().trim().toUpperCase();
                            let rawPlaca = (row.placa || row.plate || "").toString().trim().toUpperCase();
                            if (!rawPlaca || rawPlaca === "N/A" || rawPlaca === "NA") {
                              rawPlaca = te_tag;
                            }
                            const warn = getEquipmentWarning(equipName, rawPlaca);

                            return (
                              <TableRow key={idx} className={warn?.type === "unavailable" ? "bg-rose-50/50" : ""}>
                                <TableCell className="py-1 font-mono">{equipName || "—"}</TableCell>
                                <TableCell className="py-1 font-mono">{rawPlaca || "—"}</TableCell>
                                <TableCell className="py-1">{row.turno || row.shift || "DIA"} ({row.horariovale || row.valley_time || "—"})</TableCell>
                                <TableCell className="py-1 uppercase text-[10px]">{row.operador || row.motorista || "—"}</TableCell>
                                <TableCell className="py-1">
                                  {warn ? (
                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase border ${warn.color}`}>
                                      {warn.message}
                                    </span>
                                  ) : (
                                    <span className="text-emerald-600 text-[8px] font-black uppercase">✓ OK</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportOpen(false)} className="font-bold">Cancelar</Button>
                <Button onClick={handleImportSchedules} disabled={importLoading || previewData.length === 0} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold">
                  {importLoading ? "Processando..." : "Confirmar Importação"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
 
      {/* KPI Cards (Compact Row) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="bg-slate-950 text-white border-none shadow-sm">
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Aderência Geral Usina</p>
              <h3 className="text-xl font-black mt-0.5 text-indigo-400">{analytics.overallAdherence}%</h3>
            </div>
            <Activity className="h-7 w-7 text-indigo-500 opacity-30" />
          </CardContent>
        </Card>
 
        <Card className="bg-white border border-slate-200 shadow-sm">
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Equipamentos Escalados</p>
              <h3 className="text-xl font-black mt-0.5 text-slate-900">{schedules.length}</h3>
            </div>
            <Clock className="h-7 w-7 text-slate-400 opacity-20" />
          </CardContent>
        </Card>
 
        <Card className="bg-red-50 border border-red-200 shadow-sm">
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase text-red-600 tracking-wider">Tempo de Corretiva Total</p>
              <h3 className="text-xl font-black mt-0.5 text-red-700">{analytics.totalBreakdownHours} hrs</h3>
            </div>
            <Wrench className="h-7 w-7 text-red-400 opacity-35" />
          </CardContent>
        </Card>
      </div>
 
      {/* Sub-tabs for Operação and Aderência */}
      <Tabs defaultValue="operacao" className="w-full space-y-3">
        <TabsList className="bg-slate-100 p-1 rounded-xl">
          <TabsTrigger value="operacao" className="font-bold text-xs uppercase px-4 py-2">
            <Activity className="h-4 w-4 mr-2 text-indigo-600" />
            Operação Diária
          </TabsTrigger>
          <TabsTrigger value="aderencia" className="font-bold text-xs uppercase px-4 py-2">
            <Activity className="h-4 w-4 mr-2 text-indigo-600" />
            Aderência & Indicadores
          </TabsTrigger>
          <TabsTrigger value="corretivas" className="font-bold text-xs uppercase px-4 py-2">
            <Wrench className="h-4 w-4 mr-2 text-indigo-600" />
            Corretivas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="operacao" className="space-y-6 mt-0">
          {/* Active Grid Table view */}
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b p-3 flex justify-between items-center flex-wrap gap-2">
              <h2 className="font-black text-slate-800 text-xs uppercase tracking-wider">Programação Operacional Usina</h2>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input 
                  placeholder="Buscar por placa, operador, local..." 
                  value={search} 
                  onChange={e => setSearch(e.target.value)} 
                  className="pl-8 h-8 text-xs font-medium"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table className="min-w-[1200px]">
                <TableHeader className="bg-slate-100/50">
                  <TableRow className="text-[10px] uppercase font-black tracking-wider text-slate-600">
                    <TableHead className="py-2.5">Equipamento</TableHead>
                    <TableHead className="py-2.5">Placa</TableHead>
                    <TableHead className="py-2.5">Modelo</TableHead>
                    <TableHead className="py-2.5">Horário Início</TableHead>
                    <TableHead className="py-2.5">Horário Fim</TableHead>
                    <TableHead className="py-2.5">Centro Custo</TableHead>
                    <TableHead className="py-2.5">Local</TableHead>
                    <TableHead className="py-2.5">Atividade</TableHead>
                    <TableHead className="py-2.5">Operador</TableHead>
                    <TableHead className="py-2.5">OS</TableHead>
                    <TableHead className="py-2.5">Corretivas</TableHead>
                    <TableHead className="py-2.5 text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100 text-xs font-bold text-slate-900">
                  {filteredSchedules.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-8 text-slate-400 italic font-black">Nenhum equipamento escalado hoje.</TableCell>
                    </TableRow>
                  ) : (
                    filteredSchedules.map(s => {
                      const activeStops = correctiveLogs.filter(l => l.schedule_id === s.id);
                      const isCurrentlyBroken = activeStops.some(l => !l.stop_end);
                      return (
                        <TableRow key={s.id} className={`hover:bg-slate-50/50 ${isCurrentlyBroken ? "bg-red-50/20" : ""}`}>
                          <TableCell className="font-mono text-slate-700">{s.equipment || "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5 items-start">
                              <span className={`px-2 py-0.5 rounded font-mono ${isCurrentlyBroken ? "bg-red-100 text-red-700 border border-red-200" : "bg-indigo-50 text-indigo-700 border border-indigo-200"}`}>
                                {s.plate}
                              </span>
                              {(() => {
                                const warn = getEquipmentWarning(s.equipment, s.plate);
                                if (warn) {
                                  return (
                                    <span className={`px-1 py-0.5 rounded text-[8px] font-black border uppercase tracking-tight mt-0.5 ${warn.color}`}>
                                      {warn.message}
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </TableCell>
                          <TableCell className="text-slate-500 font-semibold">{s.model || "—"}</TableCell>
                          <TableCell className="font-mono text-slate-700">{s.valley_start || "—"}</TableCell>
                          <TableCell className="font-mono text-slate-700">{s.valley_end || "—"}</TableCell>
                          <TableCell className="font-mono text-slate-500">{s.cost_center || "—"}</TableCell>
                          <TableCell className="text-indigo-800 uppercase">{s.local || "—"}</TableCell>
                          <TableCell className="max-w-[150px] truncate text-slate-500 font-medium" title={s.activity || ""}>{s.activity || "—"}</TableCell>
                          <TableCell className="text-slate-800 uppercase">{s.operator || "—"}</TableCell>
                          <TableCell className="font-mono text-slate-600">{s.os_number || "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {activeStops.map(l => (
                                <div key={l.id} className="flex items-center gap-1 text-[9px] font-black uppercase">
                                  <span className={l.stop_end ? "text-slate-500" : "text-red-600 animate-pulse"}>
                                    ⚠️ {format(new Date(l.stop_start), "HH:mm")} → {l.stop_end ? format(new Date(l.stop_end), "HH:mm") : "Parado"}
                                  </span>
                                  {!l.stop_end && (
                                    <Button 
                                      size="icon" 
                                      variant="outline" 
                                      className="h-4 w-4 text-emerald-600 border-emerald-300 hover:bg-emerald-50 rounded"
                                      onClick={() => {
                                        const time = prompt("Hora do retorno (HH:MM) ex: 14:30");
                                        if (time) handleFinishStop(l.id, time);
                                      }}
                                      title="Registrar Retorno da corretiva"
                                    >
                                      <CheckCircle2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                              {activeStops.length === 0 && (
                                <span className="text-[9px] text-emerald-600 uppercase font-black">Operacional</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button 
                                variant="outline" 
                                size="icon" 
                                className="h-8 w-8 text-indigo-600 border-indigo-100 hover:bg-indigo-50"
                                onClick={() => {
                                  setEditingSchedule(s);
                                  setEditEquipmentName(s.equipment || "");
                                  setEditPlate(s.plate || "");
                                  setEditModel(s.model || "");
                                  setEditOperator(s.operator || "");
                                  setEditValleyStart(s.valley_start || "");
                                  setEditValleyEnd(s.valley_end || "");
                                  setEditCostCenter(s.cost_center || "");
                                  setEditSubet(s.subet || "");
                                  setEditLocal(s.local || "");
                                  setEditActivity(s.activity || "");
                                  setEditOS(s.os_number || "");
                                  // Find equipment if matches using normalized alphanumeric values
                                  const sEqClean = s.equipment?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
                                  const sPlateClean = s.plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
                                  const matchingEq = equipments.find(e => {
                                    const eIdClean = e.identifier?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
                                    const ePlateClean = e.plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
                                    return (sEqClean && eIdClean === sEqClean) || (sPlateClean && ePlateClean === sPlateClean);
                                  });
                                  setEditEquipmentId(matchingEq?.id || "custom");
                                  setEditOpen(true);
                                }}
                                title="Editar escala"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="outline" 
                                size="icon" 
                                className="h-8 w-8 text-red-600 border-red-100 hover:bg-red-50"
                                onClick={() => {
                                  setActiveSchedule(s);
                                  setStopStartStr(format(new Date(), "HH:mm"));
                                  setStopOpen(true);
                                }}
                                title="Registrar parada corretiva"
                              >
                                <Wrench className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50"
                                onClick={() => handleDeleteSchedule(s.id)}
                                title="Deletar escala"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="aderencia" className="space-y-6 mt-0">
          {/* Adherence Scores grouped by Service local lines */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left 2 Columns: Adherence table */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                <div className="bg-slate-50 border-b p-3">
                  <h3 className="font-black text-slate-800 text-xs uppercase tracking-wider">Aderência por Localidade de Atendimento</h3>
                </div>
                <Table>
                  <TableHeader className="bg-slate-100/50">
                    <TableRow className="text-[10px] font-black uppercase text-slate-600">
                      <TableHead>Local / Frente</TableHead>
                      <TableHead>Máquinas Escaladas</TableHead>
                      <TableHead>Intercorrências Corretivas</TableHead>
                      <TableHead>Horas Corretiva</TableHead>
                      <TableHead className="text-right">Aderência</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="text-xs font-bold text-slate-800">
                    {analytics.localList.map(g => (
                      <TableRow key={g.local}>
                        <TableCell className="uppercase">{g.local}</TableCell>
                        <TableCell>{g.totalScheduled}</TableCell>
                        <TableCell>{g.totalBreakdowns} paradas</TableCell>
                        <TableCell className="font-mono text-red-600">{g.breakdownHours} hrs</TableCell>
                        <TableCell className="text-right">
                          <span className={`px-2 py-0.5 rounded font-black ${g.adherence >= 90 ? "bg-emerald-100 text-emerald-700" : g.adherence >= 75 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                            {g.adherence}%
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {analytics.localList.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-6 text-slate-400 italic font-bold">Sem dados de aderência para hoje.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Right Column: Corrective stop info */}
            <div className="bg-white border-2 border-slate-200 rounded-xl p-5 space-y-3">
              <h3 className="text-xs font-black uppercase text-slate-800 flex items-center gap-1">
                <AlertCircle className="h-4 w-4 text-indigo-500" /> Informativo de Aderência
              </h3>
              <p className="text-[11px] leading-relaxed text-slate-600 font-medium">
                O cálculo de aderência é computado a partir do baseline do turno de 12 horas (720 minutos) por equipamento programado, deduzindo os minutos em que o equipamento ficou inoperante em corretivas.
              </p>
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-[10px] text-indigo-800 font-black uppercase">
                Aderência mínima de contrato Vale: 90%
              </div>
            </div>

          </div>
        </TabsContent>

        <TabsContent value="corretivas" className="space-y-6 mt-0">
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b p-3">
              <h2 className="font-black text-slate-800 text-xs uppercase tracking-wider">Equipamentos em Corretiva (Filtrados)</h2>
            </div>
            
            <div className="overflow-x-auto">
              <Table className="min-w-[1000px]">
                <TableHeader className="bg-slate-100/50">
                  <TableRow className="text-[10px] uppercase font-black tracking-wider text-slate-600">
                    <TableHead className="py-2.5">Equipamento</TableHead>
                    <TableHead className="py-2.5">Placa</TableHead>
                    <TableHead className="py-2.5">Local</TableHead>
                    <TableHead className="py-2.5">OS</TableHead>
                    <TableHead className="py-2.5">Tempo Total Parado</TableHead>
                    <TableHead className="py-2.5">Histórico de Paradas</TableHead>
                    <TableHead className="py-2.5 text-right">Aderência Individual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100 text-xs font-bold text-slate-900">
                  {schedules.filter(s => correctiveLogs.some(l => l.schedule_id === s.id)).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-slate-400 italic font-black">Nenhum equipamento com corretiva registrada hoje.</TableCell>
                    </TableRow>
                  ) : (
                    schedules.filter(s => correctiveLogs.some(l => l.schedule_id === s.id)).map(s => {
                      const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
                      let breakdownMinutes = 0;
                      stops.forEach(st => {
                        if (st.stop_start) {
                          const start = new Date(st.stop_start).getTime();
                          const end = st.stop_end ? new Date(st.stop_end).getTime() : Date.now();
                          const diff = Math.floor((end - start) / 60000);
                          if (diff > 0) breakdownMinutes += diff;
                        }
                      });

                      const totalMinutes = 720;
                      const uptime = Math.max(0, totalMinutes - breakdownMinutes);
                      const adherenceScore = Math.round((uptime / totalMinutes) * 100);

                      return (
                        <TableRow key={s.id} className="hover:bg-slate-50/50 bg-red-50/10">
                          <TableCell className="font-mono text-slate-700">{s.equipment || "—"}</TableCell>
                          <TableCell>
                            <span className="px-2 py-0.5 rounded font-mono bg-red-100 text-red-700 border border-red-200">
                              {s.plate}
                            </span>
                          </TableCell>
                          <TableCell className="text-indigo-800 uppercase">{s.local || "—"}</TableCell>
                          <TableCell className="font-mono text-slate-600">{s.os_number || "—"}</TableCell>
                          <TableCell className="font-mono text-red-600">{(breakdownMinutes / 60).toFixed(1)} hrs</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {stops.map(l => (
                                <div key={l.id} className="text-[10px] text-slate-600 flex items-center gap-1.5">
                                  ⚠️ <span className="font-mono font-bold">{format(new Date(l.stop_start), "HH:mm")} → {l.stop_end ? format(new Date(l.stop_end), "HH:mm") : "Parado"}</span>
                                  {l.reason && <span className="text-slate-400 font-medium">({l.reason})</span>}
                                  {!l.stop_end && (
                                    <Button 
                                      size="icon" 
                                      variant="outline" 
                                      className="h-4 w-4 text-emerald-600 border-emerald-300 hover:bg-emerald-50 rounded"
                                      onClick={() => {
                                        const time = prompt("Hora do retorno (HH:MM) ex: 14:30");
                                        if (time) handleFinishStop(l.id, time);
                                      }}
                                      title="Registrar Retorno da corretiva (Liberar)"
                                    >
                                      <CheckCircle2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`px-2 py-0.5 rounded font-black ${adherenceScore >= 90 ? "bg-emerald-100 text-emerald-700" : adherenceScore >= 75 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                              {adherenceScore}%
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Corrective Stop Insertion Dialog */}
      <Dialog open={stopOpen} onOpenChange={setStopOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black uppercase text-slate-800 flex items-center gap-2">
              <Wrench className="h-5 w-5 text-red-600" />
              Lançar Parada Corretiva
            </DialogTitle>
            <DialogDescription className="sr-only">Registre o início, término (opcional) e motivo de uma nova parada corretiva.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Hora da Quebra / Parada (HH:MM)</Label>
              <Input 
                type="time" 
                value={stopStartStr} 
                onChange={e => setStopStartStr(e.target.value)} 
                className="font-mono font-bold"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Hora do Retorno / Liberação (Opcional)</Label>
              <Input 
                type="time" 
                value={stopEndStr} 
                onChange={e => setStopEndStr(e.target.value)} 
                className="font-mono font-bold"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Motivo Principal da Quebra</Label>
              <Input 
                placeholder="Ex: Mangueira estourada, Elétrica..." 
                value={stopReason} 
                onChange={e => setStopReason(e.target.value)} 
                className="font-bold"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Observações Extras</Label>
              <Input 
                placeholder="Detalhes adicionais..." 
                value={stopNotes} 
                onChange={e => setStopNotes(e.target.value)} 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopOpen(false)} className="font-bold">Cancelar</Button>
            <Button onClick={handleAddCorrective} className="bg-red-600 hover:bg-red-700 text-white font-bold">Lançar Parada</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
 
      {/* Edit Schedule Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black uppercase text-slate-800 flex items-center gap-2">
              <Pencil className="h-5 w-5 text-indigo-600" />
              Editar Programação
            </DialogTitle>
            <DialogDescription className="sr-only">Edite as informações da escala diária selecionada.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Equipamento Cadastrado</Label>
              <select 
                value={editEquipmentId} 
                onChange={e => {
                  const val = e.target.value;
                  setEditEquipmentId(val);
                  if (val !== "custom") {
                    const eq = equipments.find(item => item.id === val);
                    if (eq) {
                      setEditEquipmentName(eq.identifier);
                      setEditPlate(eq.plate || eq.identifier);
                      setEditModel(eq.model || "");
                    }
                  }
                }}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="custom">-- Digitar Equipamento Avulso --</option>
                {equipments.map(eq => (
                  <option key={eq.id} value={eq.id}>
                    {eq.identifier} {eq.plate ? `(${eq.plate})` : ""}
                  </option>
                ))}
              </select>
              {(() => {
                const warn = getEquipmentWarning(editEquipmentName, editPlate);
                if (warn) {
                  return (
                    <div className={`mt-1.5 p-2 rounded border text-[10px] font-black uppercase flex items-center gap-1.5 ${warn.color}`}>
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{warn.message}</span>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase">Nome Equipamento</Label>
                <Input 
                  value={editEquipmentName} 
                  onChange={e => setEditEquipmentName(e.target.value)} 
                  className="font-bold text-xs"
                  placeholder="Ex: CAT 938K"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase">Placa / Tag</Label>
                <Input 
                  value={editPlate} 
                  onChange={e => setEditPlate(e.target.value)} 
                  className="font-mono font-bold text-xs"
                  placeholder="Ex: ABC-1234"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase">Modelo</Label>
                <Input 
                  value={editModel} 
                  onChange={e => setEditModel(e.target.value)} 
                  className="font-bold text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase">OS</Label>
                <Input 
                  value={editOS} 
                  onChange={e => setEditOS(e.target.value)} 
                  className="font-mono font-bold text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase">Horário Início (HH:MM)</Label>
                <Input 
                  type="time" 
                  value={editValleyStart} 
                  onChange={e => setEditValleyStart(e.target.value)} 
                  className="font-mono font-bold text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase">Horário Fim (HH:MM)</Label>
                <Input 
                  type="time" 
                  value={editValleyEnd} 
                  onChange={e => setEditValleyEnd(e.target.value)} 
                  className="font-mono font-bold text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Centro de Custo</Label>
              <Input 
                value={editCostCenter} 
                onChange={e => setEditCostCenter(e.target.value)} 
                className="font-bold text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Local</Label>
              <Input 
                value={editLocal} 
                onChange={e => setEditLocal(e.target.value)} 
                className="font-bold text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Atividade</Label>
              <Input 
                value={editActivity} 
                onChange={e => setEditActivity(e.target.value)} 
                className="font-bold text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Operador / Motorista</Label>
              <Input 
                value={editOperator} 
                onChange={e => setEditOperator(e.target.value)} 
                className="font-bold text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} className="font-bold">Cancelar</Button>
            <Button onClick={handleUpdateSchedule} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold">Salvar Alterações</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
 
    </div>
  );
}
