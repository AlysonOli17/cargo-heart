import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, Fragment } from "react";
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
import { format, addDays, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
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
  Pencil,
  ArrowUpDown
} from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "@/hooks/use-auth";
import { STATUS_LABELS } from "@/lib/equipment";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  LabelList
} from "recharts";

const CORRECTIVE_TYPES = [
  "Mecanica",
  "Atraso Operador",
  "Atestado",
  "Falta",
  "Aguardando Mobilização Equipamento",
  "Local errado"
];

const parseCorrectiveReason = (rawReason: string) => {
  const match = rawReason?.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match) {
    const matchedType = match[1];
    if (CORRECTIVE_TYPES.includes(matchedType)) {
      return {
        type: matchedType,
        reason: match[2]
      };
    }
  }
  return {
    type: "Mecanica",
    reason: rawReason || ""
  };
};

const formatMinutesToHHMMSS = (totalMinutes: number) => {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  const s = 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** Returns the planned duration in minutes between valley_start and valley_end.
 *  Falls back to 720 (12h) if either time is missing or unparseable. */
const calcPlannedMinutes = (valleyStart: string | null | undefined, valleyEnd: string | null | undefined): number => {
  if (!valleyStart || !valleyEnd) return 720;
  const parse = (t: string) => {
    const parts = t.split(':').map(Number);
    return parts.length >= 2 ? parts[0] * 60 + parts[1] : null;
  };
  const s = parse(valleyStart);
  const e = parse(valleyEnd);
  if (s === null || e === null) return 720;
  const diff = e >= s ? e - s : (1440 - s) + e; // handle overnight
  return diff > 0 ? diff : 720;
};

const tzOffset = () => {
  const tzo = -new Date().getTimezoneOffset();
  const dif = tzo >= 0 ? '+' : '-';
  const pad = (num: number) => String(Math.floor(Math.abs(num))).padStart(2, '0');
  return `${dif}${pad(tzo / 60)}:${pad(tzo % 60)}`;
};

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

const getRowTargetDate = (row: any, baseSelectedDate: string) => {
  // Only read from dedicated day/date columns — NEVER from equipment name
  const rawVal = (
    row.diadasemana || row.diasemana || row.dia || row.data || row.date ||
    row.diaDaSemana || row.diaSemana || ""
  ).toString().trim();

  // Normalize: remove accents, lowercase
  const searchStr = rawVal.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const templateBaseDate = new Date("2000-01-02T12:00:00");

  // Weekdays mapped to their template offset (0 = Sunday 2000-01-02)
  const weekdays = [
    { keys: ["domingo", "dom"], offset: 0 },
    { keys: ["segunda", "seg"], offset: 1 },
    { keys: ["terca", "terca-feira", "ter"], offset: 2 },
    { keys: ["quarta", "quarta-feira", "qua"], offset: 3 },
    { keys: ["quinta", "quinta-feira", "qui"], offset: 4 },
    { keys: ["sexta", "sexta-feira", "sex"], offset: 5 },
    { keys: ["sabado", "sabado-feira", "sab"], offset: 6 }
  ];

  // Only match if the day column has content
  if (searchStr) {
    for (const day of weekdays) {
      // Use whole-word boundary check to avoid partial matches (e.g. "TER" in "TERRAPLENAGEM")
      if (day.keys.some(k => {
        const re = new RegExp(`(^|[^a-z])${k}([^a-z]|$)`);
        return re.test(searchStr);
      })) {
        return format(addDays(templateBaseDate, day.offset), "yyyy-MM-dd");
      }
    }

    // Check if it's a numeric day-of-month matching the selected week
    const sundayDate = startOfWeek(new Date(baseSelectedDate + "T12:00:00"), { weekStartsOn: 0 });
    const digits = searchStr.match(/\d+/g);
    if (digits && digits.length >= 1) {
      const dayVal = parseInt(digits[0], 10);
      for (let offset = 0; offset <= 6; offset++) {
        const targetDate = addDays(sundayDate, offset);
        if (targetDate.getDate() === dayVal) {
          return format(addDays(templateBaseDate, offset), "yyyy-MM-dd");
        }
      }
    }
  }

  // No day column found — use the selectedDate's day of week as the template date
  const selectedDayOfWeek = new Date(baseSelectedDate + "T12:00:00").getDay();
  return format(addDays(templateBaseDate, selectedDayOfWeek), "yyyy-MM-dd");
};

function UsinaOperacaoPage() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dateFilterMode, setDateFilterMode] = useState<"single" | "range" | "month">("single");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), "MM"));
  const [selectedYear, setSelectedYear] = useState(format(new Date(), "yyyy"));
  const [expandedChart, setExpandedChart] = useState<"equipment" | "date" | "adherence" | "operator" | "location" | "maintenance" | "plates" | null>(null);
  const [expandedSearch, setExpandedSearch] = useState("");

  // ── Report-only date filter (independent from the operational date filter) ──
  const [reportDateMode, setReportDateMode] = useState<"single" | "range" | "month">("single");
  const [reportSingleDate, setReportSingleDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reportStartDate, setReportStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reportEndDate, setReportEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reportMonth, setReportMonth] = useState(format(new Date(), "MM"));
  const [reportYear, setReportYear] = useState(format(new Date(), "yyyy"));

  const matchesReportDateFilter = (schedDate: string) => {
    if (reportDateMode === "single") return schedDate === reportSingleDate;
    if (reportDateMode === "range") {
      const s = reportStartDate || "2000-01-01";
      const e = reportEndDate   || "2999-12-31";
      return schedDate >= s && schedDate <= e;
    }
    if (reportDateMode === "month") {
      const [y, m] = schedDate.split("-");
      return y === reportYear && m === reportMonth;
    }
    return true;
  };

  const matchesDateFilter = (schedDate: string) => {
    if (dateFilterMode === "single") {
      return schedDate === selectedDate;
    } else if (dateFilterMode === "range") {
      const start = startDate || "2000-01-01";
      const end = endDate || "2999-12-31";
      return schedDate >= start && schedDate <= end;
    } else if (dateFilterMode === "month") {
      if (!selectedMonth || !selectedYear) return true;
      const [y, m] = schedDate.split("-");
      return y === selectedYear && m === selectedMonth;
    }
    return true;
  };

  const [schedules, setSchedules] = useState<UsinaSchedule[]>([]);
  const [correctiveLogs, setCorrectiveLogs] = useState<CorrectiveLog[]>([]);
  const [programming, setProgramming] = useState<any[]>([]);
  const [equipments, setEquipments] = useState<{ id: string; identifier: string; plate?: string | null; model?: string | null; status?: string | null }[]>([]);
  const [search, setSearch] = useState("");
  const [shiftFilter, setShiftFilter] = useState<"todos" | "dia" | "noite">("todos");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };
  
  const [selectedOperacaoIds, setSelectedOperacaoIds] = useState<Set<string>>(new Set());
  const [selectedHabituaisIds, setSelectedHabituaisIds] = useState<Set<string>>(new Set());

  // Real-time ticking state for minute-by-minute calculations
  const [timeTick, setTimeTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeTick(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const [expandedLocal, setExpandedLocal] = useState<string | null>(null);
  const [stopType, setStopType] = useState("Mecanica");
  const [editStopType, setEditStopType] = useState("Mecanica");
  const [adherenceViewMode, setAdherenceViewMode] = useState<"charts" | "table">("charts");

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

  // Edit Stop Dialog State
  const [editStopOpen, setEditStopOpen] = useState(false);
  const [editingStopLog, setEditingStopLog] = useState<CorrectiveLog | null>(null);
  const [editStopStartStr, setEditStopStartStr] = useState("");
  const [editStopEndStr, setEditStopEndStr] = useState("");
  const [editStopReason, setEditStopReason] = useState("");
  const [editStopNotes, setEditStopNotes] = useState("");

  // Schedule Details Dialog State
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsSchedule, setDetailsSchedule] = useState<UsinaSchedule | null>(null);

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
  const [editScheduledDate, setEditScheduledDate] = useState("");

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

    // 1. Check if the equipment is registered as unavailable or in maintenance status in general
    const unavailableStatuses = ["manutencao", "indisponivel", "programado", "finalizacao"];
    if (unavailableStatuses.includes(match.status || "")) {
      const statusLabel = STATUS_LABELS[match.status as keyof typeof STATUS_LABELS] || match.status;
      return {
        type: "unavailable",
        message: `Substituição Necessária (${statusLabel})`,
        color: "bg-rose-100 text-rose-800 border-rose-300"
      };
    }

    // 2. Check for scheduling conflicts (planned stops/maintenance scheduled for today)
    const weekdayName = format(new Date(selectedDate + "T12:00:00"), "EEEE", { locale: ptBR });
    const weekdayClean = weekdayName.split("-")[0].trim().toLowerCase();

    const stopRecord = programming.find(p => {
      const isSameEquip = p.equipment_id === match.id;
      if (!isSameEquip) return false;
      
      const isCompleted = p.is_completed;
      if (isCompleted) return false;

      // Match either exact date or day of week
      if (p.scheduled_date === selectedDate) return true;
      if (p.day_of_week) {
        const pDayClean = p.day_of_week.split("-")[0].trim().toLowerCase();
        if (pDayClean === weekdayClean) return true;
      }
      return false;
    });

    if (stopRecord) {
      const stopType = stopRecord.stop_type || "Manutenção";
      return {
        type: "programming_conflict",
        message: `Substituição Necessária (Parada: ${stopType})`,
        color: "bg-rose-100 text-rose-800 border-rose-300 font-bold"
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
      let schedsQuery = supabase.from("usina_daily_schedules").select("*");
      if (dateFilterMode === "single") {
        schedsQuery = schedsQuery.or(`scheduled_date.eq.${selectedDate},and(scheduled_date.gte.2000-01-02,scheduled_date.lte.2000-01-08)`);
      } else if (dateFilterMode === "range") {
        const start = startDate || "2000-01-01";
        const end = endDate || "2999-12-31";
        schedsQuery = schedsQuery.or(`and(scheduled_date.gte.${start},scheduled_date.lte.${end}),and(scheduled_date.gte.2000-01-02,scheduled_date.lte.2000-01-08)`);
      } else if (dateFilterMode === "month") {
        const start = `${selectedYear}-${selectedMonth}-01`;
        const end = `${selectedYear}-${selectedMonth}-31`;
        schedsQuery = schedsQuery.or(`and(scheduled_date.gte.${start},scheduled_date.lte.${end}),and(scheduled_date.gte.2000-01-02,scheduled_date.lte.2000-01-08)`);
      }
      let { data: scheds, error: e1 } = await schedsQuery;
      if (e1) throw e1;
      
      const { data: logs, error: e2 } = await supabase.from("usina_corrective_logs").select("*");
      if (e2) throw e2;

      const { data: progs, error: eProg } = await supabase.from("programming").select("*").eq("is_completed", false);
      if (eProg) throw eProg;
      setProgramming(progs ?? []);
      localStorage.setItem("local_programming", JSON.stringify(progs ?? []));

      // Check if we have daily schedules for selectedDate
      const dayScheds = (scheds ?? []).filter(s => s.scheduled_date === selectedDate);
      if (dayScheds.length === 0 && dateFilterMode === "single") {
        // Find templates for this weekday
        const selectedDayOfWeek = new Date(selectedDate + "T12:00:00").getDay();
        const templateDateStr = format(addDays(new Date("2000-01-02T12:00:00"), selectedDayOfWeek), "yyyy-MM-dd");
        const templatesForDay = (scheds ?? []).filter(s => s.scheduled_date === templateDateStr);

        if (templatesForDay.length > 0) {
          // Clone templates to selectedDate
          const clones = templatesForDay.map(t => ({
            scheduled_date: selectedDate,
            equipment: t.equipment,
            plate: t.plate,
            model: t.model,
            client: t.client,
            shift: t.shift,
            valley_time: t.valley_time,
            valley_start: t.valley_start,
            valley_end: t.valley_end,
            cost_center: t.cost_center,
            subet: t.subet,
            local: t.local,
            activity: t.activity,
            operator: t.operator,
            os_number: t.os_number,
            is_completed: false,
            owner_id: user?.id
          }));

          const { data: inserted, error: eInsert } = await supabase
            .from("usina_daily_schedules")
            .insert(clones)
            .select();
          
          if (!eInsert && inserted) {
            scheds = [...(scheds ?? []), ...inserted];
          }
        }
      }

      setSchedules((scheds ?? []) as UsinaSchedule[]);
      setCorrectiveLogs((logs ?? []) as CorrectiveLog[]);

      // Update local storage cache for the selected date, keeping other dates intact
      const localScheds = JSON.parse(localStorage.getItem("local_usina_schedules") || "[]");
      const otherDatesScheds = localScheds.filter((s: any) => s.scheduled_date !== selectedDate);
      const merged = [...otherDatesScheds, ...(scheds ?? []).filter((s: any) => s.scheduled_date === selectedDate)];
      localStorage.setItem("local_usina_schedules", JSON.stringify(merged));
    } catch (err) {
      // Fallback localStorage para escalas e corretivas
      const localScheds = JSON.parse(localStorage.getItem("local_usina_schedules") || "[]");
      const localLogs = JSON.parse(localStorage.getItem("local_usina_corrective_logs") || "[]");
      const localProgs = JSON.parse(localStorage.getItem("local_programming") || "[]");

      setProgramming(localProgs);

      const dayScheds = localScheds.filter((s: any) => s.scheduled_date === selectedDate);
      let mergedScheds = [...localScheds];

      if (dayScheds.length === 0 && dateFilterMode === "single") {
        const selectedDayOfWeek = new Date(selectedDate + "T12:00:00").getDay();
        const templateDateStr = format(addDays(new Date("2000-01-02T12:00:00"), selectedDayOfWeek), "yyyy-MM-dd");
        const templatesForDay = localScheds.filter((s: any) => s.scheduled_date === templateDateStr);

        if (templatesForDay.length > 0) {
          const clones = templatesForDay.map((t: any) => ({
            ...t,
            id: Math.random().toString(36).substring(2),
            scheduled_date: selectedDate,
            is_completed: false,
            owner_id: user?.id
          }));
          mergedScheds = [...localScheds, ...clones];
          localStorage.setItem("local_usina_schedules", JSON.stringify(mergedScheds));
        }
      }

      setSchedules(mergedScheds.filter((s: any) => 
        matchesDateFilter(s.scheduled_date) || 
        (s.scheduled_date >= "2000-01-02" && s.scheduled_date <= "2000-01-08")
      ));
      setCorrectiveLogs(localLogs);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadData();
    const chSched = supabase.channel("usina-sched-rt").on("postgres_changes", { event: "*", schema: "public", table: "usina_daily_schedules" }, loadData).subscribe();
    const chLogs = supabase.channel("usina-logs-rt").on("postgres_changes", { event: "*", schema: "public", table: "usina_corrective_logs" }, loadData).subscribe();
    const chProg = supabase.channel("usina-prog-rt").on("postgres_changes", { event: "*", schema: "public", table: "programming" }, loadData).subscribe();
    return () => {
      supabase.removeChannel(chSched);
      supabase.removeChannel(chLogs);
      supabase.removeChannel(chProg);
    };
  }, [user, selectedDate, dateFilterMode, startDate, endDate, selectedMonth, selectedYear]);

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
        
        // Parse as raw 2D array of rows to handle header offset dynamically
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        
        // Find the index of the header row (typically row 1 or 2, looking for 'DIA DA SEMANA', 'Equipamento', or 'Placa')
        let headerRowIdx = 0;
        for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
          const row = rawRows[i] || [];
          const hasDay = row.some(cell => /dia|semana/i.test(String(cell)));
          const hasPlaca = row.some(cell => /placa|plate|tag/i.test(String(cell)));
          const hasEquip = row.some(cell => /equipamento|equip/i.test(String(cell)));
          if (hasDay || (hasPlaca && hasEquip)) {
            headerRowIdx = i;
            break;
          }
        }

        const headers = rawRows[headerRowIdx] || [];
        const dataRows = rawRows.slice(headerRowIdx + 1);

        const normalized = dataRows.map((row: any[]) => {
          const newRow: any = {};
          headers.forEach((k: any, index: number) => {
            if (!k) return;
            const cleanKey = k.toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            // Normalize header combinations to exact known keys
            let normKey = cleanKey.replace(/[^a-z0-9]/g, "");
            if (cleanKey.includes("dia") && cleanKey.includes("semana")) {
              normKey = "diadasemana";
            } else if (cleanKey.includes("equipamento") || cleanKey.includes("equip")) {
              normKey = "equipamento";
            } else if (cleanKey.includes("placa") || cleanKey.includes("tag")) {
              normKey = "placa";
            } else if (cleanKey.includes("modelo") || cleanKey.includes("model")) {
              normKey = "modelo";
            } else if (cleanKey.includes("turno")) {
              normKey = "turno";
            } else if (cleanKey.includes("horario") || cleanKey.includes("vale")) {
              normKey = "horariovale";
            } else if (cleanKey.includes("operador") || cleanKey.includes("motorista")) {
              normKey = "operador";
            } else if (cleanKey.includes("os") || cleanKey.includes("ordem")) {
              normKey = "os";
            } else if (cleanKey.includes("local") || cleanKey.includes("frente")) {
              normKey = "local";
            } else if (cleanKey.includes("centro") || cleanKey.includes("custo") || cleanKey === "cc") {
              normKey = "centrodecusto";
            }
            
            newRow[normKey] = row[index];
          });

          // Split merged equipment & plate values if present
          let plateVal = newRow.placa ? newRow.placa.toString().trim() : "";
          let equipVal = newRow.equipamento ? newRow.equipamento.toString().trim() : "";

          if (plateVal && plateVal.includes("-") && plateVal.length > 10) {
            const lastIndex = plateVal.lastIndexOf("-");
            const left = plateVal.substring(0, lastIndex).trim();
            const right = plateVal.substring(lastIndex + 1).trim();
            if (left && right) {
              if (!equipVal) {
                newRow.equipamento = left;
              }
              newRow.placa = right;
            }
          } else if (equipVal && equipVal.includes("-") && equipVal.length > 10 && !plateVal) {
            const lastIndex = equipVal.lastIndexOf("-");
            const left = equipVal.substring(0, lastIndex).trim();
            const right = equipVal.substring(lastIndex + 1).trim();
            if (left && right) {
              newRow.equipamento = left;
              newRow.placa = right;
            }
          }

          return newRow;
        });

        // Debug: log normalized keys of first row to help diagnose missing columns
        if (normalized.length > 0) {
          console.log("[Import Debug] Colunas normalizadas:", Object.keys(normalized[0]));
          console.log("[Import Debug] Valores linha 1:", normalized[0]);
        }

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
    // Matches: "19 X 05:30", "19:00 - 05:30", "19 a 05:30", "07:00 às 19:00", etc.
    // Accepts HH or HH:MM on both sides
    const timeRegex = /(\d{1,2}(?::\d{2})?)\s*(?:-|as|to|às|a|x)\s*(\d{1,2}(?::\d{2})?)/i;
    const normalizeTime = (t: string): string => {
      if (!t) return t;
      t = t.trim();
      // If it's just a number (e.g. "19"), pad to "19:00"
      if (/^\d{1,2}$/.test(t)) return t.padStart(2, "0") + ":00";
      // If HH:MM format, ensure two-digit hour
      const parts = t.split(":");
      return parts[0].padStart(2, "0") + ":" + (parts[1] || "00").padStart(2, "0");
    };
    const finalPayloads: any[] = [];
    const plateLocalMap: Record<string, string | null> = {};

    for (const row of previewData) {
      const te_tag = (row.tetag || row.te_tag || row["te+tag"] || "").toString().trim().toUpperCase();
      let rawPlaca = (row.placa || row.plate || "").toString().trim().toUpperCase();
      if (!rawPlaca || rawPlaca === "N/A" || rawPlaca === "NA") {
        rawPlaca = te_tag;
      }

      // If there's still no plate/tag, fall back to equipment identifier or a generated tag so the record is not lost
      const rawEquip = (row.equipamento || row.equipment || "").toString().trim().toUpperCase();
      if (!rawPlaca && rawEquip) {
        rawPlaca = rawEquip;
      }

      if (!rawPlaca && !rawEquip) continue;

      const rawValley = (row.horariovale || row.valley_time || row.horario || "").toString().trim();
      const match = rawValley.match(timeRegex);
      let valley_start: string | null = null;
      let valley_end: string | null = null;
      if (match) {
        valley_start = normalizeTime(match[1]);
        valley_end = normalizeTime(match[2]);
      } else if (rawValley) {
        valley_start = normalizeTime(rawValley);
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

      const rowDateStr = getRowTargetDate(row, selectedDate);
      const rowDateObj = new Date(rowDateStr + "T12:00:00");

      // Dynamically find the local column: any key containing "local" or "frente" or "area" or "posto"
      const localKey = Object.keys(row).find(k =>
        k === "local" || k.startsWith("local") || k.includes("local") ||
        k.startsWith("frente") || k === "area" || k === "posto" || k === "setor"
      );
      const rawLocal = (localKey ? row[localKey] : null) ||
        row.localidade || row.localatendimento || row.frenteatendimento ||
        row.frenteservico || row.area || null;
      if (rawLocal) {
        plateLocalMap[rawPlaca] = rawLocal;
      }
      const resolvedLocal = rawLocal || plateLocalMap[rawPlaca] || null;

      // Check if we need to split the night shift (contains / in OS and is night shift)
      if (isNightShift && rawOS.includes("/")) {
        const osParts = rawOS.split("/").map(o => o.trim());
        const os1 = osParts[0];
        const os2 = osParts[1] || osParts[0];
        const nextDayDate = format(addDays(rowDateObj, 1), "yyyy-MM-dd");

        const basePayload = {
          equipment: row.equipamento || row.equipment || null,
          plate: rawPlaca,
          model: row.modelo || row.model || null,
          client: row.cliente || row.client || null,
          cost_center: row.centrodecusto || row.costcenter || null,
          subet: row.subet || row.subetapa || null,
          local: resolvedLocal,
          activity: row.atividade || row.tagprogramacaovale || null,
          operator: row.operador || row.motorista || null,
          is_completed: false,
          owner_id: user?.id
        };

        // Record 1: from start time to 23:59
        finalPayloads.push({
          ...basePayload,
          scheduled_date: rowDateStr,
          shift: "NOITE (P1)",
          valley_time: `${valley_start} - 23:59`,
          valley_start,
          valley_end: "23:59",
          os_number: os1
        });

        // Record 2: from 00:00 to end time
        finalPayloads.push({
          ...basePayload,
          scheduled_date: nextDayDate,
          shift: "NOITE (P2)",
          valley_time: `00:00 - ${valley_end || ""}`,
          valley_start: "00:00",
          valley_end: valley_end || null,
          os_number: os2
        });
      } else {
        // Standard single record
        // If it starts after midnight (e.g. 00:00 to 07:00), schedule it to the next day
        let finalScheduledDate = rowDateStr;
        if (valley_start) {
          const parts = valley_start.split(":");
          const startHour = parseInt(parts[0], 10);
          if (!isNaN(startHour) && startHour >= 0 && startHour < 7) {
            finalScheduledDate = format(addDays(rowDateObj, 1), "yyyy-MM-dd");
          }
        }

        finalPayloads.push({
          scheduled_date: finalScheduledDate,
          equipment: row.equipamento || row.equipment || null,
          plate: rawPlaca,
          model: row.modelo || row.model || null,
          client: row.cliente || row.client || null,
          shift: isNightShift ? "NOITE" : (row.turno || row.shift || "DIA"),
          valley_time: rawValley || null,
          valley_start,
          valley_end: valley_end || null,
          cost_center: row.centrodecusto || row.costcenter || null,
          subet: row.subet || row.subetapa || null,
          local: resolvedLocal,
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
    const stop_start = `${todayStr}T${stopStartStr || "00:00"}:00${tzOffset()}`;
    const stop_end = stopEndStr ? `${todayStr}T${stopEndStr}:00${tzOffset()}` : null;

    const payload = {
      schedule_id: activeSchedule.id,
      stop_start,
      stop_end,
      reason: `[${stopType}] ${stopReason}`,
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
    setStopType("Mecanica");
    loadData();
  };

  const handleFinishStop = async (logId: string, endTime: string) => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const stop_end = `${todayStr}T${endTime}:00${tzOffset()}`;

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

  const openEditStop = (log: CorrectiveLog) => {
    setEditingStopLog(log);
    const startStr = log.stop_start ? format(new Date(log.stop_start), "HH:mm") : "";
    const endStr = log.stop_end ? format(new Date(log.stop_end), "HH:mm") : "";
    setEditStopStartStr(startStr);
    setEditStopEndStr(endStr);
    const parsed = parseCorrectiveReason(log.reason);
    setEditStopReason(parsed.reason);
    setEditStopType(parsed.type);
    setEditStopNotes(log.notes || "");
    setEditStopOpen(true);
  };

  const handleSaveEditStop = async () => {
    if (!editingStopLog || !editStopReason) {
      toast.error("Motivo é obrigatório");
      return;
    }
    
    const baseDateStr = format(new Date(editingStopLog.stop_start), "yyyy-MM-dd");
    const stop_start = `${baseDateStr}T${editStopStartStr || "00:00"}:00${tzOffset()}`;
    const stop_end = editStopEndStr ? `${baseDateStr}T${editStopEndStr}:00${tzOffset()}` : null;

    const payload = {
      stop_start,
      stop_end,
      reason: `[${editStopType}] ${editStopReason}`,
      notes: editStopNotes
    };

    try {
      const { error } = await supabase.from("usina_corrective_logs").update(payload).eq("id", editingStopLog.id);
      if (error) throw error;
      toast.success("Parada corretiva atualizada!");
      loadData();
    } catch (err) {
      const localLogs = JSON.parse(localStorage.getItem("local_usina_corrective_logs") || "[]");
      const updated = localLogs.map((l: any) => l.id === editingStopLog.id ? { ...l, ...payload } : l);
      localStorage.setItem("local_usina_corrective_logs", JSON.stringify(updated));
      toast.success("Parada corretiva atualizada localmente");
      loadData();
    }

    setEditStopOpen(false);
    setEditingStopLog(null);
  };

  const handleDeleteStop = async (logId: string) => {
    try {
      const { error } = await supabase.from("usina_corrective_logs").delete().eq("id", logId);
      if (error) throw error;
      toast.success("Parada corretiva excluída!");
      loadData();
    } catch (err) {
      const localLogs = JSON.parse(localStorage.getItem("local_usina_corrective_logs") || "[]");
      const filtered = localLogs.filter((l: any) => l.id !== logId);
      localStorage.setItem("local_usina_corrective_logs", JSON.stringify(filtered));
      toast.success("Parada corretiva excluída localmente");
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

  const handleBulkDelete = async (ids: Set<string>, clearFn: () => void) => {
    if (ids.size === 0) return;
    const confirmed = window.confirm(`Apagar ${ids.size} registro(s) selecionado(s)?`);
    if (!confirmed) return;

    const idsArr = Array.from(ids);
    let deletedCount = 0;
    try {
      const { error } = await supabase.from("usina_daily_schedules").delete().in("id", idsArr);
      if (error) throw error;
      deletedCount = idsArr.length;
    } catch (err) {
      const localScheds = JSON.parse(localStorage.getItem("local_usina_schedules") || "[]");
      const filtered = localScheds.filter((s: any) => !ids.has(s.id));
      localStorage.setItem("local_usina_schedules", JSON.stringify(filtered));
      deletedCount = idsArr.length;
    }
    toast.success(`${deletedCount} registro(s) apagado(s).`);
    clearFn();
    loadData();
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
      scheduled_date: editScheduledDate || editingSchedule.scheduled_date,
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

  // Helper: given HH:MM string, return total minutes from midnight
  const timeToMinutes = (t: string | null): number => {
    if (!t) return -1;
    const parts = t.split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || "0", 10);
  };

  // Filter schedules
  const filteredSchedules = useMemo(() => {
    const result = schedules.filter(s => {
      if (!matchesDateFilter(s.scheduled_date)) return false;
      
      const term = search.toLowerCase();
      const cleanTerm = term.replace(/[^a-zA-Z0-9]/g, "");
      const schedDateParsed = new Date(s.scheduled_date + "T12:00:00");
      const weekdayStr = format(schedDateParsed, "EEEE", { locale: ptBR }).toLowerCase();

      const matchSearch = 
        (s.equipment || "").toLowerCase().includes(term) ||
        (cleanTerm && (s.equipment || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().includes(cleanTerm)) ||
        (s.plate || "").toLowerCase().includes(term) ||
        (cleanTerm && (s.plate || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().includes(cleanTerm)) ||
        (s.model || "").toLowerCase().includes(term) ||
        (s.valley_start || "").toLowerCase().includes(term) ||
        (s.valley_end || "").toLowerCase().includes(term) ||
        (s.cost_center || "").toLowerCase().includes(term) ||
        (s.local || "").toLowerCase().includes(term) ||
        (s.activity || "").toLowerCase().includes(term) ||
        (s.operator || "").toLowerCase().includes(term) ||
        (s.os_number || "").toLowerCase().includes(term) ||
        weekdayStr.includes(term);

      if (!matchSearch) return false;

      // Shift filter: Dia = 06:00–18:00, Noite = 18:01–05:59
      if (shiftFilter !== "todos") {
        const startMin = timeToMinutes(s.valley_start);
        if (startMin < 0) return shiftFilter === "dia"; // no start time → treat as day
        const isDia = startMin >= 6 * 60 && startMin < 18 * 60;   // 06:00 ≤ t < 18:00
        const isNoite = startMin >= 18 * 60 || startMin < 6 * 60;  // 18:00+ or 00:00-05:59
        if (shiftFilter === "dia" && !isDia) return false;
        if (shiftFilter === "noite" && !isNoite) return false;
      }

      return true;
    });

    if (sortColumn) {
      result.sort((a, b) => {
        let valA = a[sortColumn as keyof typeof a];
        let valB = b[sortColumn as keyof typeof b];

        if (valA === null || valA === undefined) valA = "";
        if (valB === null || valB === undefined) valB = "";
        
        const strA = valA.toString().trim().toLowerCase();
        const strB = valB.toString().trim().toLowerCase();

        // Compare times numerically if sorting by valley_start or valley_end
        if (sortColumn === "valley_start" || sortColumn === "valley_end") {
          const minA = timeToMinutes(valA.toString());
          const minB = timeToMinutes(valB.toString());
          return sortDirection === "asc" ? minA - minB : minB - minA;
        }

        if (strA < strB) return sortDirection === "asc" ? -1 : 1;
        if (strA > strB) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [schedules, selectedDate, dateFilterMode, startDate, endDate, selectedMonth, selectedYear, search, shiftFilter, sortColumn, sortDirection]);

  // Find all schedules with active conflicts for the warning banner
  const conflictedSchedules = useMemo(() => {
    return filteredSchedules.map(s => {
      const warn = getEquipmentWarning(s.equipment, s.plate);
      return { schedule: s, warning: warn };
    }).filter(item => item.warning !== null && (item.warning.type === "unavailable" || item.warning.type === "programming_conflict"));
  }, [filteredSchedules, programming, equipments]);

  // Filter habitual schedules (the template week 2000-01-02 to 2000-01-08)
  const habitualSchedules = useMemo(() => {
    return schedules.filter(s => {
      const isTemplate = s.scheduled_date >= "2000-01-02" && s.scheduled_date <= "2000-01-08";
      if (!isTemplate) return false;
      
      const term = search.toLowerCase();
      const cleanTerm = term.replace(/[^a-zA-Z0-9]/g, "");
      const schedDateParsed = new Date(s.scheduled_date + "T12:00:00");
      const weekdayStr = format(schedDateParsed, "EEEE", { locale: ptBR }).toLowerCase();

      const matchSearch = 
        (s.equipment || "").toLowerCase().includes(term) ||
        (cleanTerm && (s.equipment || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().includes(cleanTerm)) ||
        (s.plate || "").toLowerCase().includes(term) ||
        (cleanTerm && (s.plate || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().includes(cleanTerm)) ||
        (s.model || "").toLowerCase().includes(term) ||
        (s.valley_start || "").toLowerCase().includes(term) ||
        (s.valley_end || "").toLowerCase().includes(term) ||
        (s.cost_center || "").toLowerCase().includes(term) ||
        (s.local || "").toLowerCase().includes(term) ||
        (s.activity || "").toLowerCase().includes(term) ||
        (s.operator || "").toLowerCase().includes(term) ||
        (s.os_number || "").toLowerCase().includes(term) ||
        weekdayStr.includes(term);

      return matchSearch;
    }).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  }, [schedules, search]);

  // Analytics: Adherence & Downtime math
  const analytics = useMemo(() => {
    // Grouped by Local / Frente de Atendimento
    // plannedMinutes = Σ valley_start→valley_end for each schedule in the group
    const adherenceByLocal: Record<string, {
      totalScheduled: number;
      totalBreakdowns: number;
      breakdownMinutes: number;
      plannedMinutes: number;   // ← real sum of scheduled hours
    }> = {};
    const daySchedules = schedules.filter(s => matchesDateFilter(s.scheduled_date));
    let totalScheduledCount = daySchedules.length;
    let totalBreakdownMinutes = 0;
    let totalPlannedMinutes = 0; // Σ planned hours of all lines
    let unattendedCount = 0;

    daySchedules.forEach(s => {
      const localKey = s.local || "OUTROS";
      if (!adherenceByLocal[localKey]) {
        adherenceByLocal[localKey] = { totalScheduled: 0, totalBreakdowns: 0, breakdownMinutes: 0, plannedMinutes: 0 };
      }

      const linePlanned = calcPlannedMinutes(s.valley_start, s.valley_end);
      adherenceByLocal[localKey].totalScheduled++;
      adherenceByLocal[localKey].plannedMinutes += linePlanned;
      totalPlannedMinutes += linePlanned;

      // Sum breakdown time for this schedule
      const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
      
      // Determine if currently unattended (has active stop with no end date)
      const hasActiveStop = stops.some(st => st.stop_start && !st.stop_end);
      if (hasActiveStop) {
        unattendedCount++;
      }

      stops.forEach(st => {
        adherenceByLocal[localKey].totalBreakdowns++;
        if (st.stop_start) {
          const start = new Date(st.stop_start).getTime();
          const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
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
      const uptime = Math.max(0, group.plannedMinutes - group.breakdownMinutes);
      const adherenceScore = group.plannedMinutes > 0 ? Math.round((uptime / group.plannedMinutes) * 100) : 100;
      return {
        local: k,
        totalScheduled: group.totalScheduled,
        totalBreakdowns: group.totalBreakdowns,
        breakdownHours: (group.breakdownMinutes / 60).toFixed(1),
        adherence: adherenceScore
      };
    });

    const overallUptime = Math.max(0, totalPlannedMinutes - totalBreakdownMinutes);
    const overallAdherence = totalPlannedMinutes > 0 ? Math.round((overallUptime / totalPlannedMinutes) * 100) : 100;

    const activeCount = Math.max(0, totalScheduledCount - unattendedCount);
    const equipmentAdherence = totalScheduledCount > 0 ? Math.round((activeCount / totalScheduledCount) * 100) : 100;
    const totalPlannedHours = (totalPlannedMinutes / 60);

    const totalBreakdowns = localList.reduce((acc, l) => acc + l.totalBreakdowns, 0);

    // --- Recharts Datasets ---
    // 1. EQUIPAMENTO
    const equipmentMap: Record<string, number> = {};
    daySchedules.forEach(s => {
      const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
      let mins = 0;
      stops.forEach(st => {
        if (st.stop_start) {
          const start = new Date(st.stop_start).getTime();
          const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
          const diff = Math.floor((end - start) / 60000);
          if (diff > 0) mins += diff;
        }
      });
      if (mins > 0 && s.equipment) {
        equipmentMap[s.equipment] = (equipmentMap[s.equipment] || 0) + mins;
      }
    });
    const chartDataEquipment = Object.entries(equipmentMap)
      .map(([name, val]) => ({ name, minutes: val }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5);

    // 2. DATA (Trend of last 7 dates or only selectedDate if chosen)
    const datesWithData = selectedDate
      ? [selectedDate]
      : Array.from(new Set(schedules.map(s => s.scheduled_date)))
          .sort()
          .slice(-7);
    const chartDataDates = datesWithData.map(dateStr => {
      const dayScheds = schedules.filter(s => s.scheduled_date === dateStr);
      let totalMins = 0;
      dayScheds.forEach(s => {
        const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
        stops.forEach(st => {
          if (st.stop_start) {
            const start = new Date(st.stop_start).getTime();
            const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
            const diff = Math.floor((end - start) / 60000);
            if (diff > 0) totalMins += diff;
          }
        });
      });
      const parts = dateStr.split("-");
      const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dateStr;
      return { name: label, minutes: totalMins };
    });

    // 4. MANUTENÇÃO (Paradas por tipo)
    const typesMap: Record<string, number> = {};
    daySchedules.forEach(s => {
      const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
      stops.forEach(st => {
        if (st.stop_start) {
          const start = new Date(st.stop_start).getTime();
          const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
          const diff = Math.floor((end - start) / 60000);
          if (diff > 0) {
            const parsed = parseCorrectiveReason(st.reason);
            typesMap[parsed.type] = (typesMap[parsed.type] || 0) + diff;
          }
        }
      });
    });
    const chartDataTypes = Object.entries(typesMap).map(([name, val]) => ({ name, minutes: val }));

    // 5. MOTORISTA/OPERADOR
    const operatorMap: Record<string, number> = {};
    daySchedules.forEach(s => {
      const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
      let mins = 0;
      stops.forEach(st => {
        if (st.stop_start) {
          const start = new Date(st.stop_start).getTime();
          const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
          const diff = Math.floor((end - start) / 60000);
          if (diff > 0) mins += diff;
        }
      });
      if (mins > 0 && s.operator) {
        operatorMap[s.operator] = (operatorMap[s.operator] || 0) + mins;
      }
    });
    const chartDataOperator = Object.entries(operatorMap)
      .map(([name, val]) => ({ name, minutes: val }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5);

    // 6. PLACA
    const plateMap: Record<string, number> = {};
    daySchedules.forEach(s => {
      const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
      let mins = 0;
      stops.forEach(st => {
        if (st.stop_start) {
          const start = new Date(st.stop_start).getTime();
          const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
          const diff = Math.floor((end - start) / 60000);
          if (diff > 0) mins += diff;
        }
      });
      if (mins > 0 && s.plate) {
        plateMap[s.plate] = (plateMap[s.plate] || 0) + mins;
      }
    });
    const chartDataPlates = Object.entries(plateMap)
      .map(([name, val]) => ({ name, minutes: val }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5);

    const fullChartDataEquipment = Object.entries(equipmentMap)
      .map(([name, val]) => ({ name, minutes: val }))
      .sort((a, b) => b.minutes - a.minutes);
    const fullChartDataPlates = Object.entries(plateMap)
      .map(([name, val]) => ({ name, minutes: val }))
      .sort((a, b) => b.minutes - a.minutes);
    const fullChartDataOperator = Object.entries(operatorMap)
      .map(([name, val]) => ({ name, minutes: val }))
      .sort((a, b) => b.minutes - a.minutes);

    return {
      localList,
      overallAdherence,
      totalScheduledCount,
      totalBreakdownHours: (totalBreakdownMinutes / 60).toFixed(1),
      unattendedCount,
      activeCount,
      equipmentAdherence,
      totalPlannedHours,
      chartDataEquipment,
      chartDataDates,
      chartDataTypes,
      chartDataOperator,
      chartDataPlates,
      fullChartDataEquipment,
      fullChartDataPlates,
      fullChartDataOperator
    };
  }, [schedules, correctiveLogs, selectedDate, dateFilterMode, startDate, endDate, selectedMonth, selectedYear, timeTick]);

  // ── Analytics exclusively for the Relatório Gerencial charts (uses its own date filter) ──
  const analyticsReport = useMemo(() => {
    const adherenceByLocal: Record<string, {
      totalScheduled: number;
      totalBreakdowns: number;
      breakdownMinutes: number;
      plannedMinutes: number;
    }> = {};
    const reportSchedules = schedules.filter(s => matchesReportDateFilter(s.scheduled_date));
    let totalScheduledCount = reportSchedules.length;
    let totalBreakdownMinutes = 0;
    let totalPlannedMinutes = 0;
    let unattendedCount = 0;

    reportSchedules.forEach(s => {
      const localKey = s.local || "OUTROS";
      if (!adherenceByLocal[localKey]) {
        adherenceByLocal[localKey] = { totalScheduled: 0, totalBreakdowns: 0, breakdownMinutes: 0, plannedMinutes: 0 };
      }
      const linePlanned = calcPlannedMinutes(s.valley_start, s.valley_end);
      adherenceByLocal[localKey].totalScheduled++;
      adherenceByLocal[localKey].plannedMinutes += linePlanned;
      totalPlannedMinutes += linePlanned;
      const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
      const hasActiveStop = stops.some(st => st.stop_start && !st.stop_end);
      if (hasActiveStop) unattendedCount++;
      stops.forEach(st => {
        adherenceByLocal[localKey].totalBreakdowns++;
        if (st.stop_start) {
          const start = new Date(st.stop_start).getTime();
          const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
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
      const uptime = Math.max(0, group.plannedMinutes - group.breakdownMinutes);
      const adherenceScore = group.plannedMinutes > 0 ? Math.round((uptime / group.plannedMinutes) * 100) : 100;
      return { local: k, totalScheduled: group.totalScheduled, totalBreakdowns: group.totalBreakdowns, breakdownHours: (group.breakdownMinutes / 60).toFixed(1), adherence: adherenceScore };
    });

    const totalUptimeMinutes = Math.max(0, totalPlannedMinutes - totalBreakdownMinutes);
    const overallAdherence = totalPlannedMinutes > 0
      ? parseFloat(((totalUptimeMinutes / totalPlannedMinutes) * 100).toFixed(2))
      : 100;
    const activeCount = Math.max(0, totalScheduledCount - unattendedCount);
    const equipmentAdherence = totalScheduledCount > 0 ? Math.round((activeCount / totalScheduledCount) * 100) : 100;
    const totalPlannedHours = totalPlannedMinutes / 60;

    // --- Chart Datasets ---
    const equipmentMap: Record<string, number> = {};
    const operatorMap: Record<string, number> = {};
    const plateMap: Record<string, number> = {};
    const typesMap: Record<string, number> = {};

    reportSchedules.forEach(s => {
      const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
      let mins = 0;
      stops.forEach(st => {
        if (st.stop_start) {
          const start = new Date(st.stop_start).getTime();
          const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
          const diff = Math.floor((end - start) / 60000);
          if (diff > 0) {
            mins += diff;
            const parsed = parseCorrectiveReason(st.reason);
            typesMap[parsed.type] = (typesMap[parsed.type] || 0) + diff;
          }
        }
      });
      if (mins > 0 && s.equipment) equipmentMap[s.equipment] = (equipmentMap[s.equipment] || 0) + mins;
      if (mins > 0 && s.operator)  operatorMap[s.operator]   = (operatorMap[s.operator]   || 0) + mins;
      if (mins > 0 && s.plate)     plateMap[s.plate]         = (plateMap[s.plate]         || 0) + mins;
    });

    const chartDataEquipment = Object.entries(equipmentMap).map(([name, val]) => ({ name, minutes: val })).sort((a, b) => b.minutes - a.minutes).slice(0, 5);
    const chartDataOperator  = Object.entries(operatorMap).map(([name, val]) => ({ name, minutes: val })).sort((a, b) => b.minutes - a.minutes).slice(0, 5);
    const chartDataPlates    = Object.entries(plateMap).map(([name, val]) => ({ name, minutes: val })).sort((a, b) => b.minutes - a.minutes).slice(0, 5);
    const chartDataTypes     = Object.entries(typesMap).map(([name, val]) => ({ name, minutes: val }));

    const fullChartDataEquipment = Object.entries(equipmentMap).map(([name, val]) => ({ name, minutes: val })).sort((a, b) => b.minutes - a.minutes);
    const fullChartDataPlates    = Object.entries(plateMap).map(([name, val]) => ({ name, minutes: val })).sort((a, b) => b.minutes - a.minutes);
    const fullChartDataOperator  = Object.entries(operatorMap).map(([name, val]) => ({ name, minutes: val })).sort((a, b) => b.minutes - a.minutes);

    // DATE chart: if single-day mode → show just that day; otherwise → last 7 dates with data
    const datesWithData = reportDateMode === "single"
      ? [reportSingleDate]
      : Array.from(new Set(schedules.map(s => s.scheduled_date))).sort().slice(-30);
    const datesInRange = datesWithData.filter(d => matchesReportDateFilter(d));
    const chartDataDates = datesInRange.map(dateStr => {
      const dayScheds = schedules.filter(s => s.scheduled_date === dateStr);
      let totalMins = 0;
      dayScheds.forEach(s => {
        correctiveLogs.filter(l => l.schedule_id === s.id).forEach(st => {
          if (st.stop_start) {
            const start = new Date(st.stop_start).getTime();
            const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
            const diff = Math.floor((end - start) / 60000);
            if (diff > 0) totalMins += diff;
          }
        });
      });
      const parts = dateStr.split("-");
      const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dateStr;
      return { name: label, minutes: totalMins };
    });

    return {
      localList, overallAdherence, totalScheduledCount,
      totalBreakdownMinutes, totalPlannedMinutes, totalUptimeMinutes,
      totalBreakdownHours: (totalBreakdownMinutes / 60),
      unattendedCount, activeCount, equipmentAdherence, totalPlannedHours,
      chartDataEquipment, chartDataDates, chartDataTypes, chartDataOperator, chartDataPlates,
      fullChartDataEquipment, fullChartDataPlates, fullChartDataOperator
    };
  }, [schedules, correctiveLogs, reportDateMode, reportSingleDate, reportStartDate, reportEndDate, reportMonth, reportYear, timeTick]);

  return (
    <Tabs defaultValue="operacao" className="w-full space-y-4">
      {/* Tabs and Date picker row at the very top of the page */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-2">
        <div className="flex justify-start">
          <TabsList className="bg-slate-100 p-1 rounded-xl">
            <TabsTrigger value="operacao" className="font-bold text-xs uppercase px-4 py-2">
              <Activity className="h-4 w-4 mr-2 text-indigo-600" />
              Operação Diária
            </TabsTrigger>
            <TabsTrigger value="habituais" className="font-bold text-xs uppercase px-4 py-2">
              <Clock className="h-4 w-4 mr-2 text-indigo-600" />
              Demandas Habituais
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
        </div>

        <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Filtrar Data:</span>
          
          <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200 shadow-sm">
            <button
              onClick={() => setDateFilterMode("single")}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-md transition-all ${
                dateFilterMode === "single" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Dia
            </button>
            <button
              onClick={() => setDateFilterMode("range")}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-md transition-all ${
                dateFilterMode === "range" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Período
            </button>
            <button
              onClick={() => setDateFilterMode("month")}
              className={`px-2 py-1 text-[9px] font-black uppercase rounded-md transition-all ${
                dateFilterMode === "month" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Mês/Ano
            </button>
          </div>

          {dateFilterMode === "single" && (
            <Input 
              type="date" 
              value={selectedDate} 
              onChange={(e) => setSelectedDate(e.target.value)} 
              className="w-36 h-8 text-xs font-bold bg-white" 
            />
          )}

          {dateFilterMode === "range" && (
            <div className="flex items-center gap-1">
              <Input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)} 
                className="w-32 h-8 text-xs font-bold bg-white" 
              />
              <span className="text-[9px] font-bold text-slate-400">a</span>
              <Input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)} 
                className="w-32 h-8 text-xs font-bold bg-white" 
              />
            </div>
          )}

          {dateFilterMode === "month" && (
            <div className="flex items-center gap-1">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white text-xs font-bold px-2 py-1 text-slate-800"
              >
                <option value="01">Janeiro</option>
                <option value="02">Fevereiro</option>
                <option value="03">Março</option>
                <option value="04">Abril</option>
                <option value="05">Maio</option>
                <option value="06">Junho</option>
                <option value="07">Julho</option>
                <option value="08">Agosto</option>
                <option value="09">Setembro</option>
                <option value="10">Outubro</option>
                <option value="11">Novembro</option>
                <option value="12">Dezembro</option>
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white text-xs font-bold px-2 py-1 text-slate-800"
              >
                <option value="2024">2024</option>
                <option value="2025">2025</option>
                <option value="2026">2026</option>
                <option value="2027">2027</option>
                <option value="2028">2028</option>
              </select>
            </div>
          )}
        </div>
      </div>
 

      <TabsContent value="operacao" className="space-y-3 mt-0">
          {/* Shift Filter Bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Filtrar Turno:</span>
            <div className="flex rounded-lg overflow-hidden border border-slate-200 shadow-sm">
              <button
                id="shift-filter-todos"
                onClick={() => setShiftFilter("todos")}
                className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                  shiftFilter === "todos"
                    ? "bg-slate-800 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Todos
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] ${
                  shiftFilter === "todos" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                }`}>
                  {schedules.filter(s => matchesDateFilter(s.scheduled_date)).length}
                </span>
              </button>
              <button
                id="shift-filter-dia"
                onClick={() => setShiftFilter("dia")}
                className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-wider border-l border-slate-200 transition-all ${
                  shiftFilter === "dia"
                    ? "bg-amber-500 text-white"
                    : "bg-white text-amber-700 hover:bg-amber-50"
                }`}
              >
                ☀️ Dia
                <span className="ml-1 text-[9px] opacity-80">06:00 – 18:00</span>
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] ${
                  shiftFilter === "dia" ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"
                }`}>
                  {schedules.filter(s => {
                    if (!matchesDateFilter(s.scheduled_date)) return false;
                    if (!s.valley_start) return true;
                    const [h] = s.valley_start.split(":").map(Number);
                    return h >= 6 && h < 18;
                  }).length}
                </span>
              </button>
              <button
                id="shift-filter-noite"
                onClick={() => setShiftFilter("noite")}
                className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-wider border-l border-slate-200 transition-all ${
                  shiftFilter === "noite"
                    ? "bg-indigo-700 text-white"
                    : "bg-white text-indigo-700 hover:bg-indigo-50"
                }`}
              >
                🌙 Noite
                <span className="ml-1 text-[9px] opacity-80">18:01 – 05:59</span>
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] ${
                  shiftFilter === "noite" ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700"
                }`}>
                  {schedules.filter(s => {
                    if (!matchesDateFilter(s.scheduled_date)) return false;
                    if (!s.valley_start) return false;
                    const [h] = s.valley_start.split(":").map(Number);
                    return h >= 18 || h < 6;
                  }).length}
                </span>
              </button>
            </div>
          </div>

          {/* Active Grid Table view */}
          {conflictedSchedules.length > 0 && (
            <div className="mb-4 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 shadow-sm animate-in fade-in slide-in-from-top duration-300">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="w-full">
                  <h4 className="font-black text-xs uppercase tracking-wider text-rose-800 flex items-center gap-1.5">
                    ⚠️ Substituição Necessária - Conflito de Agenda Detectado
                  </h4>
                  <p className="text-[11px] text-rose-700 mt-1 font-medium">
                    Os seguintes equipamentos foram escalados para hoje, mas possuem conflito com manutenção ou parada programada. Favor designar outro equipamento:
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {conflictedSchedules.map(({ schedule, warning }) => (
                      <div key={schedule.id} className="p-2.5 bg-white border border-rose-100 rounded-lg shadow-sm flex flex-col gap-1 text-[11px]">
                        <div className="flex justify-between items-start gap-1">
                          <span className="font-black text-slate-800 uppercase truncate">
                            {schedule.equipment || schedule.plate}
                          </span>
                          <span className="text-[9px] font-black uppercase text-indigo-700 bg-indigo-50 border border-indigo-150 px-1.5 py-0.5 rounded shrink-0">
                            {schedule.shift}
                          </span>
                        </div>
                        <div className="text-slate-500 font-semibold truncate">
                          {schedule.model || "Modelo —"}
                        </div>
                        <div className="mt-1 px-2 py-1 rounded bg-rose-50 border border-rose-150 text-rose-700 font-bold text-[9px] uppercase tracking-tight text-center">
                          {warning?.message}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b p-3 flex justify-between items-center flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h2 className="font-black text-slate-800 text-xs uppercase tracking-wider">Programação Operacional Usina</h2>
                {selectedOperacaoIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 px-3 text-[10px] font-black uppercase"
                    onClick={() => handleBulkDelete(selectedOperacaoIds, () => setSelectedOperacaoIds(new Set()))}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Apagar {selectedOperacaoIds.size} selecionado(s)
                  </Button>
                )}
              </div>
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
              <Table className="min-w-[1000px] w-full text-[10.5px] [&_td]:py-1 [&_td]:px-1.5 [&_th]:py-1 [&_th]:px-1.5">
                <TableHeader className="bg-slate-100/50">
                  <TableRow className="text-[10px] uppercase font-black tracking-wider text-slate-600">
                    <TableHead className="py-2.5 w-8">
                      <input
                        type="checkbox"
                        className="accent-indigo-600 w-3.5 h-3.5 cursor-pointer"
                        checked={filteredSchedules.length > 0 && filteredSchedules.every(s => selectedOperacaoIds.has(s.id))}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedOperacaoIds(new Set(filteredSchedules.map(s => s.id)));
                          } else {
                            setSelectedOperacaoIds(new Set());
                          }
                        }}
                        title="Selecionar todos"
                      />
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("equipment")}>
                      <div className="flex items-center gap-1">
                        Equipamento
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "equipment" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("plate")}>
                      <div className="flex items-center gap-1">
                        Placa
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "plate" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("model")}>
                      <div className="flex items-center gap-1">
                        Modelo
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "model" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("valley_start")}>
                      <div className="flex items-center gap-1">
                        Horário Início
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "valley_start" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("valley_end")}>
                      <div className="flex items-center gap-1">
                        Horário Fim
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "valley_end" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("cost_center")}>
                      <div className="flex items-center gap-1">
                        Centro Custo
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "cost_center" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("local")}>
                      <div className="flex items-center gap-1">
                        Local
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "local" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("activity")}>
                      <div className="flex items-center gap-1">
                        Atividade
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "activity" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("operator")}>
                      <div className="flex items-center gap-1">
                        Operador
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "operator" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5 cursor-pointer select-none hover:bg-slate-200/50 transition-colors" onClick={() => handleSort("os_number")}>
                      <div className="flex items-center gap-1">
                        OS
                        <ArrowUpDown className={`h-3.5 w-3.5 transition-colors ${sortColumn === "os_number" ? "text-indigo-600 font-bold" : "text-slate-400"}`} />
                      </div>
                    </TableHead>
                    <TableHead className="py-2.5">Corretivas</TableHead>
                    <TableHead className="py-2.5 text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-100 text-[10.5px] font-bold text-slate-900">
                  {filteredSchedules.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={13} className="text-center py-8 text-slate-400 italic font-black">Nenhum equipamento escalado hoje.</TableCell>
                    </TableRow>
                  ) : (
                    filteredSchedules.map(s => {
                      const activeStops = correctiveLogs.filter(l => l.schedule_id === s.id);
                      const isCurrentlyBroken = activeStops.some(l => !l.stop_end);
                      const isChecked = selectedOperacaoIds.has(s.id);
                      return (
                        <TableRow 
                          key={s.id} 
                          className={`hover:bg-slate-50/50 cursor-pointer ${isCurrentlyBroken ? "bg-red-50/20" : ""} ${isChecked ? "bg-indigo-50/50" : ""}`}
                          onClick={() => {
                            setDetailsSchedule(s);
                            setDetailsOpen(true);
                          }}
                        >
                          <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="accent-indigo-600 w-3.5 h-3.5 cursor-pointer"
                              checked={isChecked}
                              onChange={e => {
                                const next = new Set(selectedOperacaoIds);
                                if (e.target.checked) next.add(s.id); else next.delete(s.id);
                                setSelectedOperacaoIds(next);
                              }}
                            />
                          </TableCell>
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
                          <TableCell onClick={(e) => e.stopPropagation()}>
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
                                      onClick={(e) => {
                                        e.stopPropagation();
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
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1.5">
                              <Button 
                                variant="outline" 
                                size="icon" 
                                className="h-8 w-8 text-indigo-600 border-indigo-100 hover:bg-indigo-50"
                                onClick={(e) => {
                                  e.stopPropagation();
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
                                  setEditScheduledDate(s.scheduled_date || "");
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
                                onClick={(e) => {
                                  e.stopPropagation();
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSchedule(s.id);
                                }}
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

        <TabsContent value="habituais" className="space-y-6 mt-0">
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b p-3 flex justify-between items-center flex-wrap gap-2">
              <div>
                <h2 className="font-black text-slate-800 text-xs uppercase tracking-wider">Demandas Habituais</h2>
                <p className="text-[9px] text-muted-foreground uppercase font-bold mt-0.5">Programação semanal recorrente — define o padrão para todos os dias da semana</p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {selectedHabituaisIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 px-3 text-[10px] font-black uppercase"
                    onClick={() => handleBulkDelete(selectedHabituaisIds, () => setSelectedHabituaisIds(new Set()))}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Apagar {selectedHabituaisIds.size} selecionado(s)
                  </Button>
                )}
                <div className="relative w-full max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input 
                    placeholder="Buscar por placa, operador, local..." 
                    value={search} 
                    onChange={e => setSearch(e.target.value)} 
                    className="pl-8 h-8 text-xs font-medium w-48"
                  />
                </div>

                {/* Import Excel Trigger inside this tab */}
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
                                  <TableHead className="py-1">Dia da Semana</TableHead>
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
                                  if (!rawPlaca && equipName) {
                                    rawPlaca = equipName.toString().trim().toUpperCase();
                                  }
                                  const warn = getEquipmentWarning(equipName, rawPlaca);

                                  // Determine valley start and end times for preview
                                  // Matches HH or HH:MM on both sides
                                  const timeRegex = /(\d{1,2}(?::\d{2})?)\s*(?:-|as|to|às|a|x)\s*(\d{1,2}(?::\d{2})?)/i;
                                  const normalizeTimePreview = (t: string): string => {
                                    if (!t) return t;
                                    t = t.trim();
                                    if (/^\d{1,2}$/.test(t)) return t.padStart(2, "0") + ":00";
                                    const pts = t.split(":");
                                    return pts[0].padStart(2, "0") + ":" + (pts[1] || "00").padStart(2, "0");
                                  };
                                  const rawValley = (row.horariovale || row.valley_time || row.horario || "").toString().trim();
                                  const match = rawValley.match(timeRegex);
                                  let valley_start: string | null = null;
                                  if (match) {
                                    valley_start = normalizeTimePreview(match[1]);
                                  } else if (rawValley) {
                                    valley_start = normalizeTimePreview(rawValley);
                                  }

                                  let isNightShift = false;
                                  if (valley_start) {
                                    const parts = valley_start.split(":");
                                    const startHour = parseInt(parts[0], 10);
                                    if (!isNaN(startHour) && startHour >= 18) {
                                      isNightShift = true;
                                    }
                                  }

                                  const rawOS = (row.os || row.ordemdeservico || row.osnumber || "").toString().trim();
                                  const rowDateStr = getRowTargetDate(row, selectedDate);
                                  const rowDateObj = new Date(rowDateStr + "T12:00:00");
                                  
                                  // Compute the weekday display string
                                  let displayWeekday = format(rowDateObj, "EEEE", { locale: ptBR }).toUpperCase();
                                  
                                  if (isNightShift && rawOS.includes("/")) {
                                    const nextDayDateObj = addDays(rowDateObj, 1);
                                    displayWeekday = `${format(rowDateObj, "EEE", { locale: ptBR }).toUpperCase()} & ${format(nextDayDateObj, "EEE", { locale: ptBR }).toUpperCase()}`;
                                  } else if (valley_start) {
                                    const parts = valley_start.split(":");
                                    const startHour = parseInt(parts[0], 10);
                                    if (!isNaN(startHour) && startHour >= 0 && startHour < 7) {
                                      displayWeekday = format(addDays(rowDateObj, 1), "EEEE", { locale: ptBR }).toUpperCase();
                                    }
                                  }

                                  return (
                                    <TableRow key={idx} className={warn?.type === "unavailable" ? "bg-rose-50/50" : ""}>
                                      <TableCell className="py-1 font-mono text-[10px] text-indigo-700 capitalize">{displayWeekday}</TableCell>
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

            <div className="overflow-x-auto">
              <Table className="min-w-[1000px] w-full text-[10.5px] [&_td]:py-1 [&_td]:px-1.5 [&_th]:py-1 [&_th]:px-1.5">
                <TableHeader className="bg-slate-100/50">
                  <TableRow className="text-[10px] uppercase font-black tracking-wider text-slate-600">
                    <TableHead className="py-2.5 w-8">
                      <input
                        type="checkbox"
                        className="accent-indigo-600 w-3.5 h-3.5 cursor-pointer"
                        checked={habitualSchedules.length > 0 && habitualSchedules.every(s => selectedHabituaisIds.has(s.id))}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedHabituaisIds(new Set(habitualSchedules.map(s => s.id)));
                          } else {
                            setSelectedHabituaisIds(new Set());
                          }
                        }}
                        title="Selecionar todos"
                      />
                    </TableHead>
                    <TableHead className="py-2.5">Dia da Semana</TableHead>
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
                <TableBody className="divide-y divide-slate-100 text-[10.5px] font-bold text-slate-900">
                  {habitualSchedules.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={14} className="text-center py-8 text-slate-400 italic font-black">Nenhuma demanda habitual importada ainda. Use o botão "Importar Programação" acima.</TableCell>
                    </TableRow>
                  ) : (
                    habitualSchedules.map(s => {
                      const activeStops = correctiveLogs.filter(l => l.schedule_id === s.id);
                      const isCurrentlyBroken = activeStops.some(l => !l.stop_end);
                      const schedDateParsed = new Date(s.scheduled_date + "T12:00:00");
                      const displayDateStr = format(schedDateParsed, "EEEE", { locale: ptBR });
                      const isCheckedH = selectedHabituaisIds.has(s.id);
                      
                      return (
                        <TableRow key={s.id} className={`hover:bg-slate-50/50 ${isCurrentlyBroken ? "bg-red-50/20" : ""} ${isCheckedH ? "bg-indigo-50/50" : ""}`}>
                          <TableCell className="w-8">
                            <input
                              type="checkbox"
                              className="accent-indigo-600 w-3.5 h-3.5 cursor-pointer"
                              checked={isCheckedH}
                              onChange={e => {
                                const next = new Set(selectedHabituaisIds);
                                if (e.target.checked) next.add(s.id); else next.delete(s.id);
                                setSelectedHabituaisIds(next);
                              }}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-indigo-700 font-black capitalize">{displayDateStr}</TableCell>
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
                                  setEditScheduledDate(s.scheduled_date || "");
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
          {/* Executive Presentation Buttons and Header info */}
          <div className="flex justify-between items-center bg-slate-900 text-white rounded-xl p-4 shadow border border-slate-800">
            <div>
              <h2 className="font-black text-sm uppercase tracking-wider text-indigo-400">📊 Painel Gerencial de Aderência</h2>
              <p className="text-[10px] text-slate-400 uppercase font-black mt-0.5">Indicadores Operacionais e Gerenciamento de Custos</p>
            </div>
            <div className="flex justify-end gap-2 bg-[#242424] p-1 rounded-lg border border-zinc-800">
              <button
                onClick={() => setAdherenceViewMode("charts")}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase transition-all duration-200 flex items-center gap-1.5 ${
                  adherenceViewMode === "charts"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-zinc-400 hover:bg-zinc-800 text-zinc-300"
                }`}
              >
                📊 Relatório Gerencial
              </button>
              <button
                onClick={() => setAdherenceViewMode("table")}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase transition-all duration-200 flex items-center gap-1.5 ${
                  adherenceViewMode === "table"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-zinc-400 hover:bg-zinc-800 text-zinc-300"
                }`}
              >
                📋 Tabela de Localidades
              </button>
            </div>
          </div>



          {adherenceViewMode === "charts" ? (
            <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0c0c0c] border-2 border-[#2b2b2b] rounded-2xl p-6 shadow-2xl space-y-6 text-white">
              {/* SVG Gradient definitions for cylindrical blue bars */}
              <svg width="0" height="0" className="absolute">
                <defs>
                  <linearGradient id="horizontalCylinder" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#062e7d" />
                    <stop offset="30%" stopColor="#2563eb" />
                    <stop offset="70%" stopColor="#2563eb" />
                    <stop offset="100%" stopColor="#062e7d" />
                  </linearGradient>
                  <linearGradient id="verticalCylinder" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#062e7d" />
                    <stop offset="30%" stopColor="#2563eb" />
                    <stop offset="70%" stopColor="#2563eb" />
                    <stop offset="100%" stopColor="#062e7d" />
                  </linearGradient>
                </defs>
              </svg>

              <div className="flex flex-col gap-3 border-b border-[#2b2b2b] pb-4">
                {/* Row 1: title + adherence badge */}
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-slate-100">📊 Relatório Executivo Gerencial</h3>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase mt-1">Indicadores e Distribuição de Paradas Corretivas</p>
                  </div>
                  <div className="bg-[#242424] border border-[#3e3e3e] rounded-lg px-3 py-1.5 text-center">
                    <span className="text-[8px] font-black uppercase tracking-wider text-zinc-500 block">Aderência Geral</span>
                    <span className={`text-sm font-black ${analyticsReport.overallAdherence >= 90 ? "text-emerald-400" : analyticsReport.overallAdherence >= 75 ? "text-amber-400" : "text-red-400"}`}>
                      {analyticsReport.overallAdherence}%
                    </span>
                  </div>
                </div>

                {/* Row 2: date filter for this report */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Filtrar Dados:</span>

                  {/* Mode selector */}
                  <div className="flex items-center bg-[#1a1a1a] border border-[#3e3e3e] rounded-lg p-0.5 gap-0.5">
                    {(["single", "range", "month"] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setReportDateMode(mode)}
                        className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all ${
                          reportDateMode === mode
                            ? "bg-indigo-600 text-white shadow"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {mode === "single" ? "Dia" : mode === "range" ? "Período" : "Mês/Ano"}
                      </button>
                    ))}
                  </div>

                  {/* Single date */}
                  {reportDateMode === "single" && (
                    <input
                      type="date"
                      value={reportSingleDate}
                      onChange={e => setReportSingleDate(e.target.value)}
                      className="h-7 rounded-lg border border-[#3e3e3e] bg-[#1a1a1a] text-[10px] font-bold text-zinc-200 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  )}

                  {/* Date range */}
                  {reportDateMode === "range" && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={reportStartDate}
                        onChange={e => setReportStartDate(e.target.value)}
                        className="h-7 rounded-lg border border-[#3e3e3e] bg-[#1a1a1a] text-[10px] font-bold text-zinc-200 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <span className="text-[9px] text-zinc-500 font-bold">até</span>
                      <input
                        type="date"
                        value={reportEndDate}
                        onChange={e => setReportEndDate(e.target.value)}
                        className="h-7 rounded-lg border border-[#3e3e3e] bg-[#1a1a1a] text-[10px] font-bold text-zinc-200 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  )}

                  {/* Month / Year */}
                  {reportDateMode === "month" && (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={reportMonth}
                        onChange={e => setReportMonth(e.target.value)}
                        className="h-7 rounded-lg border border-[#3e3e3e] bg-[#1a1a1a] text-[10px] font-bold text-zinc-200 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="01">Janeiro</option>
                        <option value="02">Fevereiro</option>
                        <option value="03">Março</option>
                        <option value="04">Abril</option>
                        <option value="05">Maio</option>
                        <option value="06">Junho</option>
                        <option value="07">Julho</option>
                        <option value="08">Agosto</option>
                        <option value="09">Setembro</option>
                        <option value="10">Outubro</option>
                        <option value="11">Novembro</option>
                        <option value="12">Dezembro</option>
                      </select>
                      <input
                        type="number"
                        value={reportYear}
                        onChange={e => setReportYear(e.target.value)}
                        min="2020"
                        max="2099"
                        className="h-7 w-20 rounded-lg border border-[#3e3e3e] bg-[#1a1a1a] text-[10px] font-bold text-zinc-200 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* ─── Summary Panel ─── */}
              {(() => {
                const fmtMin = (m: number) => {
                  const hh = Math.floor(m / 60);
                  const mm = Math.floor(m % 60);
                  const ss = 0;
                  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
                };
                const avgPerEquip = analyticsReport.totalScheduledCount > 0
                  ? analyticsReport.totalPlannedMinutes / analyticsReport.totalScheduledCount
                  : 0;
                const periodLabel = reportDateMode === "single"
                  ? reportSingleDate.split("-").reverse().join("/")
                  : reportDateMode === "range"
                  ? `${reportStartDate.split("-").reverse().join("/")} → ${reportEndDate.split("-").reverse().join("/")}`
                  : `${reportMonth}/${reportYear}`;

                return (
                  <div className="w-full border border-[#3e3e3e] rounded-xl overflow-hidden text-[11px] font-bold uppercase tracking-wider">
                    {/* Header row */}
                    <div className="grid grid-cols-2">
                      {/* Left: period + non-attendance + attendance */}
                      <div className="bg-[#1e3a5f] border-r border-[#3e3e3e]">
                        <div className="flex items-center gap-3 px-4 py-2 border-b border-[#2b4a70]">
                          <span className="text-[9px] text-blue-300 tracking-widest">PERÍODO:</span>
                          <span className="text-white font-black">{periodLabel}</span>
                        </div>
                        <div className="grid grid-cols-2 divide-x divide-[#2b4a70]">
                          <div className="px-4 py-2.5">
                            <div className="text-[8px] text-blue-300 mb-1">NÃO ATENDIMENTO</div>
                            <div className="text-white font-mono font-black text-sm">{fmtMin(analyticsReport.totalBreakdownMinutes)}</div>
                          </div>
                          <div className="px-4 py-2.5">
                            <div className="text-[8px] text-blue-300 mb-1">ATENDIMENTO</div>
                            <div className="text-white font-mono font-black text-sm">{fmtMin(analyticsReport.totalUptimeMinutes)}</div>
                          </div>
                        </div>
                      </div>

                      {/* Right: derived metrics */}
                      <div className="bg-[#1a2a40]">
                        <div className="grid grid-cols-2 divide-x divide-[#2b3a50] border-b border-[#2b3a50]">
                          <div className="px-4 py-2.5">
                            <div className="text-[8px] text-blue-300 mb-1">TOTAL HORAS PERDIDAS</div>
                            <div className="text-red-400 font-mono font-black text-sm">{fmtMin(analyticsReport.totalBreakdownMinutes)}</div>
                          </div>
                          <div className="px-4 py-2.5">
                            <div className="text-[8px] text-blue-300 mb-1">TOTAL DE HORAS</div>
                            <div className="text-white font-mono font-black text-sm">{fmtMin(analyticsReport.totalPlannedMinutes)}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 divide-x divide-[#2b3a50]">
                          <div className="px-4 py-2.5">
                            <div className="text-[8px] text-blue-300 mb-1">HORA POR EQUIPAMENTO</div>
                            <div className="text-white font-mono font-black text-sm">{fmtMin(avgPerEquip)}</div>
                          </div>
                          <div className="px-4 py-2.5">
                            <div className="text-[8px] text-blue-300 mb-1">TOTAL DE EQUIPAMENTOS</div>
                            <div className="text-white font-mono font-black text-sm">{analyticsReport.totalScheduledCount}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Aderência footer */}
                    <div className={`flex items-center justify-between px-6 py-3 ${
                      analyticsReport.overallAdherence > 95 ? "bg-indigo-700" : analyticsReport.overallAdherence >= 95 ? "bg-amber-600" : "bg-red-700"
                    }`}>
                      <span className="text-white text-xs tracking-widest">ADERÊNCIA:</span>
                      <span className="text-white font-black text-2xl font-mono tracking-tight">
                        {analyticsReport.overallAdherence.toFixed(2).replace('.', ',')}%
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* LEFT COLUMN (lg:col-span-5) */}
                <div className="lg:col-span-5 flex flex-col gap-6">
                  
                  {/* 1. EQUIPAMENTO (Horizontal Bar) */}
                  <div 
                    onClick={() => setExpandedChart("equipment")}
                    className="bg-gradient-to-b from-[#2a2a2a] to-[#1c1c1c] border border-[#3e3e3e] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.5)] rounded-xl p-4 flex flex-col h-[340px] cursor-pointer hover:border-indigo-500/50 transition-all duration-300 group"
                  >
                    <h4 className="text-[11px] font-black uppercase text-center tracking-wider text-white mb-4">EQUIPAMENTO</h4>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analyticsReport.chartDataEquipment}
                          layout="vertical"
                          margin={{ top: 10, right: 75, left: 10, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" horizontal={false} vertical={true} />
                          <XAxis type="number" stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                          <YAxis dataKey="name" type="category" stroke="#a1a1aa" fontSize={8} width={130} tickLine={false} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                            labelStyle={{ color: '#a1a1aa', fontWeight: 'bold', fontSize: '9px' }}
                            itemStyle={{ color: '#60a5fa', fontSize: '9px' }}
                            formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                          />
                          <Bar dataKey="minutes" fill="url(#horizontalCylinder)" barSize={26}>
                            <LabelList dataKey="minutes" position="right" formatter={(v) => formatMinutesToHHMMSS(Number(v))} fill="#ffffff" fontSize={9} offset={8} className="font-bold font-mono" />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 4. MANUTENÇÃO (Line Chart) */}
                  <div 
                    onClick={() => setExpandedChart("maintenance")}
                    className="bg-gradient-to-b from-[#2a2a2a] to-[#1c1c1c] border border-[#3e3e3e] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.5)] rounded-xl p-4 flex flex-col h-[340px] cursor-pointer hover:border-indigo-500/50 transition-all duration-300 group"
                  >
                    <h4 className="text-[11px] font-black uppercase text-center tracking-wider text-white mb-4">MANUTENÇÃO</h4>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={analyticsReport.chartDataTypes.length > 0 ? analyticsReport.chartDataTypes : [{ name: "SEM DADOS", minutes: 0 }]}
                          margin={{ top: 15, right: 20, left: 10, bottom: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" />
                          <XAxis dataKey="name" stroke="#a1a1aa" fontSize={8} />
                          <YAxis stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                            labelStyle={{ color: '#a1a1aa', fontWeight: 'bold', fontSize: '9px' }}
                            itemStyle={{ color: '#60a5fa', fontSize: '9px' }}
                            formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                          />
                          <Line type="monotone" dataKey="minutes" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 5 }} activeDot={{ r: 8 }}>
                            <LabelList dataKey="minutes" position="top" formatter={(v) => formatMinutesToHHMMSS(Number(v))} fill="#ffffff" fontSize={9} className="font-bold font-mono" offset={10} />
                          </Line>
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                </div>

                {/* RIGHT COLUMN (lg:col-span-7) */}
                <div className="lg:col-span-7 flex flex-col gap-6">
                  
                  {/* Row 1: DATA and ADERÊNCIA */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* 2. DATA (Vertical Bar) */}
                    <div 
                      onClick={() => setExpandedChart("date")}
                      className="bg-gradient-to-b from-[#2a2a2a] to-[#1c1c1c] border border-[#3e3e3e] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.5)] rounded-xl p-4 flex flex-col h-[240px] cursor-pointer hover:border-indigo-500/50 transition-all duration-300 group"
                    >
                      <h4 className="text-[11px] font-black uppercase text-center tracking-wider text-white mb-2">DATA</h4>
                      <div className="flex-1 min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={analyticsReport.chartDataDates}
                            margin={{ top: 20, right: 10, left: 10, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" vertical={false} />
                            <XAxis dataKey="name" stroke="#a1a1aa" fontSize={8} />
                            <YAxis stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                              labelStyle={{ color: '#a1a1aa', fontWeight: 'bold', fontSize: '9px' }}
                              itemStyle={{ color: '#60a5fa', fontSize: '9px' }}
                              formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                            />
                            <Bar dataKey="minutes" fill="url(#verticalCylinder)" barSize={36}>
                              <LabelList dataKey="minutes" position="top" formatter={(v) => Number(v) > 0 ? formatMinutesToHHMMSS(Number(v)) : ""} fill="#ffffff" fontSize={9} offset={8} className="font-bold font-mono" />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* 3. ADERÊNCIA (Gauge) */}
                    <div 
                      onClick={() => setExpandedChart("adherence")}
                      className="bg-gradient-to-b from-[#2a2a2a] to-[#1c1c1c] border border-[#3e3e3e] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.5)] rounded-xl p-4 flex flex-col h-[240px] cursor-pointer hover:border-indigo-500/50 transition-all duration-300 group"
                    >
                      <h4 className="text-[11px] font-black uppercase text-center tracking-wider text-white mb-2">ADERÊNCIA</h4>
                      <div className="flex-1 flex flex-col items-center justify-center relative min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={[
                                { value: Math.min(95, analyticsReport.overallAdherence), color: "#ef4444" }, // Red zone
                                { value: Math.max(0, Math.min(5, analyticsReport.overallAdherence - 95)), color: "#10b981" }, // Green zone
                                { value: Math.max(0, 100 - analyticsReport.overallAdherence), color: "#1f2937" } // Gap
                              ]}
                              dataKey="value"
                              innerRadius="65%"
                              outerRadius="85%"
                              startAngle={180}
                              endAngle={0}
                              paddingAngle={0}
                              stroke="none"
                            >
                              <Cell fill="#ef4444" />
                              <Cell fill="#10b981" />
                              <Cell fill="#242424" />
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute top-[60%] flex flex-col items-center">
                          <span className="text-3xl font-black text-white">{analyticsReport.overallAdherence.toFixed(2).replace('.', ',')}%</span>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* 5. MOTORISTA/OPERADOR (Horizontal Bar) */}
                  <div 
                    onClick={() => setExpandedChart("operator")}
                    className="bg-gradient-to-b from-[#2a2a2a] to-[#1c1c1c] border border-[#3e3e3e] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.5)] rounded-xl p-4 flex flex-col h-[220px] cursor-pointer hover:border-indigo-500/50 transition-all duration-300 group"
                  >
                    <h4 className="text-[11px] font-black uppercase text-center tracking-wider text-white mb-2">MOTORISTA/OPERADOR</h4>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analyticsReport.chartDataOperator}
                          layout="vertical"
                          margin={{ top: 5, right: 75, left: 10, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" horizontal={false} vertical={true} />
                          <XAxis type="number" stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                          <YAxis dataKey="name" type="category" stroke="#a1a1aa" fontSize={8} width={120} tickLine={false} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                            labelStyle={{ color: '#a1a1aa', fontWeight: 'bold', fontSize: '9px' }}
                            itemStyle={{ color: '#60a5fa', fontSize: '9px' }}
                            formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                          />
                          <Bar dataKey="minutes" fill="url(#horizontalCylinder)" barSize={16}>
                            <LabelList dataKey="minutes" position="right" formatter={(v) => formatMinutesToHHMMSS(Number(v))} fill="#ffffff" fontSize={9} offset={8} className="font-bold font-mono" />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 6. PLACA (Vertical Bar) */}
                  <div 
                    onClick={() => setExpandedChart("plates")}
                    className="bg-gradient-to-b from-[#2a2a2a] to-[#1c1c1c] border border-[#3e3e3e] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_8px_16px_rgba(0,0,0,0.5)] rounded-xl p-4 flex flex-col h-[220px] cursor-pointer hover:border-indigo-500/50 transition-all duration-300 group"
                  >
                    <h4 className="text-[11px] font-black uppercase text-center tracking-wider text-white mb-2">PLACA</h4>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analyticsReport.chartDataPlates}
                          margin={{ top: 20, right: 10, left: 10, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" vertical={false} />
                          <XAxis dataKey="name" stroke="#a1a1aa" fontSize={8} />
                          <YAxis stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                            labelStyle={{ color: '#a1a1aa', fontWeight: 'bold', fontSize: '9px' }}
                            itemStyle={{ color: '#60a5fa', fontSize: '9px' }}
                            formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                          />
                          <Bar dataKey="minutes" fill="url(#verticalCylinder)" barSize={36}>
                            <LabelList dataKey="minutes" position="top" formatter={(v) => formatMinutesToHHMMSS(Number(v))} fill="#ffffff" fontSize={9} offset={8} className="font-bold font-mono" />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                </div>

              </div>
            </div>
          ) : (
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
                      {analytics.localList.map(g => {
                        const isExpanded = expandedLocal === g.local;
                        return (
                          <Fragment key={g.local}>
                            <TableRow 
                              className="hover:bg-slate-50/50 cursor-pointer transition-colors"
                              onClick={() => setExpandedLocal(isExpanded ? null : g.local)}
                            >
                              <TableCell className="uppercase flex items-center gap-1.5 py-3">
                                <ChevronRight className={`h-4 w-4 text-slate-405 shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                                <span className="font-bold text-slate-900">{g.local}</span>
                              </TableCell>
                              <TableCell>{g.totalScheduled}</TableCell>
                              <TableCell>{g.totalBreakdowns} paradas</TableCell>
                              <TableCell className="font-mono text-red-600">{g.breakdownHours} hrs</TableCell>
                              <TableCell className="text-right">
                                <span className={`px-2 py-0.5 rounded font-black ${g.adherence >= 90 ? "bg-emerald-100 text-emerald-700" : g.adherence >= 75 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                                  {g.adherence}%
                                </span>
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-slate-50/30 hover:bg-slate-50/30">
                                <TableCell colSpan={5} className="p-3 border-t border-b">
                                  <div className="bg-white border rounded-lg p-3 shadow-inner space-y-2">
                                    <h4 className="text-[10px] font-black uppercase text-indigo-900 tracking-wider flex items-center gap-1">
                                      📋 Equipamentos Vinculados a {g.local}
                                    </h4>
                                    <Table className="text-[10px] w-full min-w-full">
                                      <TableHeader className="bg-slate-50 text-[9px] font-black uppercase">
                                        <TableRow>
                                          <TableHead className="py-1">Equipamento</TableHead>
                                          <TableHead className="py-1">Placa</TableHead>
                                          <TableHead className="py-1">Operador</TableHead>
                                          <TableHead className="py-1">OS</TableHead>
                                          <TableHead className="py-1">Tempo Parado</TableHead>
                                          <TableHead className="py-1 text-right">Aderência</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody className="font-bold text-slate-800 text-[10px]">
                                        {schedules
                                          .filter(s => matchesDateFilter(s.scheduled_date) && (s.local || "OUTROS") === g.local)
                                          .map(s => {
                                            const stops = correctiveLogs.filter(l => l.schedule_id === s.id);
                                            let breakdownMinutes = 0;
                                            stops.forEach(st => {
                                              if (st.stop_start) {
                                                const start = new Date(st.stop_start).getTime();
                                                const end = st.stop_end ? new Date(st.stop_end).getTime() : timeTick;
                                                const diff = Math.floor((end - start) / 60000);
                                                if (diff > 0) breakdownMinutes += diff;
                                              }
                                            });
                                            const totalMinutes = 720;
                                            const uptime = Math.max(0, totalMinutes - breakdownMinutes);
                                            const adherenceScore = Math.round((uptime / totalMinutes) * 100);
                                            const hasActiveStop = stops.some(st => st.stop_start && !st.stop_end);
  
                                            return (
                                              <TableRow key={s.id} className={hasActiveStop ? "bg-red-50/20 animate-pulse-slow" : ""}>
                                                <TableCell className="py-1.5">{s.equipment || "—"}</TableCell>
                                                <TableCell className="py-1.5">
                                                  <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] ${hasActiveStop ? "bg-red-100 text-red-700 border border-red-200" : "bg-slate-100 text-slate-700 border border-slate-200"}`}>
                                                    {s.plate}
                                                  </span>
                                                </TableCell>
                                                <TableCell className="py-1.5 uppercase">{s.operator || "—"}</TableCell>
                                                <TableCell className="py-1.5 font-mono">{s.os_number || "—"}</TableCell>
                                                <TableCell className={`py-1.5 font-mono ${breakdownMinutes > 0 ? "text-red-600" : "text-slate-400"}`}>
                                                  {(breakdownMinutes / 60).toFixed(1)} hrs
                                                </TableCell>
                                                <TableCell className="py-1.5 text-right">
                                                  <span className={`px-1.5 py-0.5 rounded font-black ${adherenceScore >= 90 ? "bg-emerald-100 text-emerald-700" : adherenceScore >= 75 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                                                    {adherenceScore}%
                                                  </span>
                                                </TableCell>
                                              </TableRow>
                                            );
                                          })}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
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
          )}
        </TabsContent>

        <TabsContent value="corretivas" className="space-y-6 mt-0">
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b p-3">
              <h2 className="font-black text-slate-800 text-xs uppercase tracking-wider">Equipamentos em Corretiva (Filtrados)</h2>
            </div>
            
            <div className="overflow-x-auto">
              <Table className="min-w-[900px] w-full text-[10.5px] [&_td]:py-1 [&_td]:px-1.5 [&_th]:py-1 [&_th]:px-1.5">
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
                <TableBody className="divide-y divide-slate-100 text-[10.5px] font-bold text-slate-900">
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
                        <TableRow 
                          key={s.id} 
                          className="hover:bg-slate-50/50 bg-red-50/10 cursor-pointer"
                          onClick={() => {
                            setDetailsSchedule(s);
                            setDetailsOpen(true);
                          }}
                        >
                          <TableCell className="font-mono text-slate-700">{s.equipment || "—"}</TableCell>
                          <TableCell>
                            <span className="px-2 py-0.5 rounded font-mono bg-red-100 text-red-700 border border-red-200">
                              {s.plate}
                            </span>
                          </TableCell>
                          <TableCell className="text-indigo-800 uppercase">{s.local || "—"}</TableCell>
                          <TableCell className="font-mono text-slate-600">{s.os_number || "—"}</TableCell>
                          <TableCell className="font-mono text-red-600">{(breakdownMinutes / 60).toFixed(1)} hrs</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-col gap-1.5">
                              {stops.map(l => (
                                <div key={l.id} className="text-[10px] text-slate-600 flex items-center justify-between gap-2 border-b border-slate-100/55 pb-1 last:border-0 last:pb-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    ⚠️ <span className="font-mono font-bold">{format(new Date(l.stop_start), "HH:mm")} → {l.stop_end ? format(new Date(l.stop_end), "HH:mm") : "Parado"}</span>
                                    {l.reason && <span className="text-slate-400 font-medium">({l.reason})</span>}
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {!l.stop_end && (
                                      <Button 
                                        size="icon" 
                                        variant="outline" 
                                        className="h-4 w-4 text-emerald-600 border-emerald-300 hover:bg-emerald-50 rounded"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const time = prompt("Hora do retorno (HH:MM) ex: 14:30");
                                          if (time) handleFinishStop(l.id, time);
                                        }}
                                        title="Registrar Retorno da corretiva (Liberar)"
                                      >
                                        <CheckCircle2 className="h-3 w-3" />
                                      </Button>
                                    )}
                                    <Button 
                                      size="icon" 
                                      variant="outline" 
                                      className="h-4 w-4 text-indigo-600 border-indigo-200 hover:bg-indigo-50 rounded"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openEditStop(l);
                                      }}
                                      title="Editar Parada"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                    <Button 
                                      size="icon" 
                                      variant="outline" 
                                      className="h-4 w-4 text-red-600 border-red-200 hover:bg-red-50 rounded"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm("Tem certeza que deseja excluir esta parada?")) {
                                          handleDeleteStop(l.id);
                                        }
                                      }}
                                      title="Excluir Parada"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
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
              <Label className="text-[10px] font-black uppercase">Dia da Semana (Programação)</Label>
              <select 
                value={editScheduledDate} 
                onChange={e => setEditScheduledDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 capitalize"
              >
                <option value="2000-01-02">Domingo</option>
                <option value="2000-01-03">Segunda-feira</option>
                <option value="2000-01-04">Terça-feira</option>
                <option value="2000-01-05">Quarta-feira</option>
                <option value="2000-01-06">Quinta-feira</option>
                <option value="2000-01-07">Sexta-feira</option>
                <option value="2000-01-08">Sábado</option>
                {/* Allow editing actual dates for non-template schedules if needed, but display nicely */}
                {editScheduledDate && !["2000-01-02", "2000-01-03", "2000-01-04", "2000-01-05", "2000-01-06", "2000-01-07", "2000-01-08"].includes(editScheduledDate) && (
                  <option value={editScheduledDate}>
                    {format(new Date(editScheduledDate + "T12:00:00"), "dd/MM/yyyy (EEEE)", { locale: ptBR })}
                  </option>
                )}
              </select>
            </div>

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

      {/* Edit Corrective Stop Dialog */}
      <Dialog open={editStopOpen} onOpenChange={setEditStopOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-black uppercase text-slate-800 flex items-center gap-2">
              <Pencil className="h-5 w-5 text-red-650" />
              Editar Parada Corretiva
            </DialogTitle>
            <DialogDescription className="sr-only">Edite as informações ou encerre a parada corretiva selecionada.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Hora da Quebra / Parada (HH:MM)</Label>
              <Input 
                type="time" 
                value={editStopStartStr} 
                onChange={e => setEditStopStartStr(e.target.value)} 
                className="font-mono font-bold"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Hora do Retorno / Liberação (HH:MM)</Label>
              <Input 
                type="time" 
                value={editStopEndStr} 
                onChange={e => setEditStopEndStr(e.target.value)} 
                className="font-mono font-bold"
                placeholder="ex: 14:30"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Motivo Principal</Label>
              <Input 
                value={editStopReason} 
                onChange={e => setEditStopReason(e.target.value)} 
                className="font-bold"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] font-black uppercase">Observações</Label>
              <Input 
                value={editStopNotes} 
                onChange={e => setEditStopNotes(e.target.value)} 
              />
            </div>
          </div>
          <DialogFooter className="flex justify-between items-center w-full gap-2">
            {editingStopLog && (
              <Button 
                variant="destructive" 
                onClick={() => {
                  if (confirm("Tem certeza que deseja excluir esta parada?")) {
                    handleDeleteStop(editingStopLog.id);
                    setEditStopOpen(false);
                  }
                }}
                className="font-bold text-xs"
              >
                Excluir Parada
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={() => setEditStopOpen(false)} className="font-bold text-xs">Cancelar</Button>
              <Button onClick={handleSaveEditStop} className="bg-red-650 hover:bg-red-700 text-white font-bold text-xs">Salvar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black uppercase text-slate-800 flex items-center gap-2">
              <Activity className="h-5 w-5 text-indigo-600" />
              Detalhes do Equipamento Escalado
            </DialogTitle>
            <DialogDescription className="sr-only">Informações detalhadas do agendamento diário e histórico de paradas.</DialogDescription>
          </DialogHeader>
          
          {detailsSchedule && (
            <div className="space-y-5 py-3 text-xs">
              {/* Header card */}
              <div className="p-3.5 bg-slate-50 border rounded-xl flex flex-col gap-2">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-sm font-black uppercase text-slate-900">
                    {detailsSchedule.equipment || "—"}
                  </span>
                  <span className="px-2 py-0.5 rounded font-mono font-black text-indigo-700 bg-indigo-50 border border-indigo-200">
                    {detailsSchedule.plate}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-500 font-semibold mt-1">
                  <div>Modelo: <strong className="text-slate-850 font-bold">{detailsSchedule.model || "—"}</strong></div>
                  <div>Turno: <strong className="text-slate-850 font-bold uppercase">{detailsSchedule.shift || "—"}</strong></div>
                </div>
              </div>

              {/* General details grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-1">
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">Horário Planejado</span>
                  <span className="font-mono font-bold text-slate-800 text-xs">
                    {detailsSchedule.valley_start || "—"} às {detailsSchedule.valley_end || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">Centro de Custo</span>
                  <span className="font-mono font-bold text-slate-800 text-xs">{detailsSchedule.cost_center || "—"}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">Frente / Local</span>
                  <span className="font-bold text-indigo-900 text-xs uppercase">{detailsSchedule.local || "—"}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">Ordem de Serviço (OS)</span>
                  <span className="font-mono font-bold text-slate-800 text-xs">{detailsSchedule.os_number || "—"}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">Atividade</span>
                  <span className="font-bold text-slate-800 text-xs">{detailsSchedule.activity || "—"}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">Operador / Motorista</span>
                  <span className="font-bold text-slate-800 text-xs uppercase">{detailsSchedule.operator || "—"}</span>
                </div>
              </div>

              <hr className="border-slate-100" />

              {/* Corrective Logs Section */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="font-black text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Wrench className="h-3.5 w-3.5 text-red-500" /> Histórico de Paradas Corretivas
                  </h4>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="h-6 text-[9px] font-black uppercase tracking-tight text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => {
                      setActiveSchedule(detailsSchedule);
                      setStopStartStr(format(new Date(), "HH:mm"));
                      setStopEndStr("");
                      setStopReason("");
                      setStopNotes("");
                      setStopOpen(true);
                    }}
                  >
                    + Lançar Parada
                  </Button>
                </div>

                <div className="space-y-2">
                  {(() => {
                    const stops = correctiveLogs.filter(l => l.schedule_id === detailsSchedule.id);
                    if (stops.length === 0) {
                      return (
                        <div className="text-center py-4 bg-emerald-50/30 border border-emerald-100 rounded-lg text-emerald-800 font-bold uppercase text-[9px]">
                          ✓ Nenhuma parada corretiva registrada. Equipamento 100% Operacional!
                        </div>
                      );
                    }
                    return stops.map(log => {
                      const durMin = log.stop_end 
                        ? Math.round((new Date(log.stop_end).getTime() - new Date(log.stop_start).getTime()) / 60000)
                        : null;
                      return (
                        <div key={log.id} className="p-3 bg-slate-50 border rounded-lg flex justify-between items-center gap-3">
                          <div className="space-y-1 col-span-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-black text-slate-700">
                                ⏰ {format(new Date(log.stop_start), "HH:mm")} → {log.stop_end ? format(new Date(log.stop_end), "HH:mm") : "Parado"}
                              </span>
                              {durMin !== null && (
                                <span className="text-[9px] font-black bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded shrink-0">
                                  {durMin >= 60 ? `${Math.floor(durMin / 60)}h ${durMin % 60}m` : `${durMin}m`}
                                </span>
                              )}
                            </div>
                            <div className="font-bold text-slate-800 uppercase text-[10px]">
                              Motivo: {log.reason}
                            </div>
                            {log.notes && (
                              <div className="text-[10px] text-slate-400 font-medium italic">
                                Obs: {log.notes}
                              </div>
                            )}
                          </div>

                          <div className="flex gap-1.5 shrink-0">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-6 text-[9px] font-black uppercase text-indigo-700 border-indigo-200 hover:bg-indigo-50 px-2"
                              onClick={() => openEditStop(log)}
                            >
                              Editar
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-6 text-[9px] font-black uppercase text-red-600 border-red-200 hover:bg-red-50 px-2"
                              onClick={() => {
                                if (confirm("Tem certeza que deseja excluir esta parada?")) {
                                  handleDeleteStop(log.id);
                                }
                              }}
                            >
                              Excluir
                            </Button>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setDetailsOpen(false)} className="bg-slate-800 hover:bg-slate-900 text-white font-bold w-full uppercase tracking-wider text-xs">
              Fechar Detalhes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expanded Chart Dialog */}
      <Dialog open={!!expandedChart} onOpenChange={() => { setExpandedChart(null); setExpandedSearch(""); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-zinc-950 text-white border border-zinc-800">
          <DialogHeader>
            <DialogTitle className="font-black uppercase text-indigo-400 flex items-center gap-2 text-base">
              🔍 {expandedChart === "equipment" && "Tempo Parado por Equipamento"}
              {expandedChart === "date" && "Tempo Parado por Data"}
              {expandedChart === "adherence" && "Aderência Geral e por Localidade"}
              {expandedChart === "operator" && "Tempo Parado por Motorista/Operador"}
              {expandedChart === "plates" && "Tempo Parado por Placa"}
              {expandedChart === "maintenance" && "Motivos de Manutenção Corretiva"}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400 uppercase font-bold">
              Visão expandida e detalhada com todos os dados do período selecionado.
            </DialogDescription>
          </DialogHeader>

          {expandedChart && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 py-4">
              {/* Chart Column */}
              <div className="lg:col-span-7 bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col h-[380px]">
                <span className="text-[10px] font-black uppercase text-center tracking-wider text-zinc-500 mb-4 block">Visualização Gráfica</span>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    {(() => {
                      if (expandedChart === "equipment") {
                        const data = analyticsReport.fullChartDataEquipment
                          .filter(item => item.name.toLowerCase().includes(expandedSearch.toLowerCase()));
                        return (
                          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" horizontal={false} vertical={true} />
                            <XAxis type="number" stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                            <YAxis dataKey="name" type="category" stroke="#a1a1aa" fontSize={8} width={80} tickLine={false} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                              formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                            />
                            <Bar dataKey="minutes" fill="url(#horizontalCylinder)" barSize={16}>
                              <LabelList dataKey="minutes" position="right" formatter={(v) => formatMinutesToHHMMSS(Number(v))} fill="#ffffff" fontSize={8} className="font-bold font-mono" offset={8} />
                            </Bar>
                          </BarChart>
                        );
                      }
                      if (expandedChart === "plates") {
                        const data = analyticsReport.fullChartDataPlates
                          .filter(item => item.name.toLowerCase().includes(expandedSearch.toLowerCase()));
                        return (
                          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" horizontal={false} vertical={true} />
                            <XAxis type="number" stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                            <YAxis dataKey="name" type="category" stroke="#a1a1aa" fontSize={8} width={80} tickLine={false} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                              formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                            />
                            <Bar dataKey="minutes" fill="url(#horizontalCylinder)" barSize={16}>
                              <LabelList dataKey="minutes" position="right" formatter={(v) => formatMinutesToHHMMSS(Number(v))} fill="#ffffff" fontSize={8} className="font-bold font-mono" offset={8} />
                            </Bar>
                          </BarChart>
                        );
                      }
                      if (expandedChart === "operator") {
                        const data = analyticsReport.fullChartDataOperator
                          .filter(item => item.name.toLowerCase().includes(expandedSearch.toLowerCase()));
                        return (
                          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" horizontal={false} vertical={true} />
                            <XAxis type="number" stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                            <YAxis dataKey="name" type="category" stroke="#a1a1aa" fontSize={8} width={80} tickLine={false} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                              formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                            />
                            <Bar dataKey="minutes" fill="url(#horizontalCylinder)" barSize={16}>
                              <LabelList dataKey="minutes" position="right" formatter={(v) => formatMinutesToHHMMSS(Number(v))} fill="#ffffff" fontSize={8} className="font-bold font-mono" offset={8} />
                            </Bar>
                          </BarChart>
                        );
                      }
                      if (expandedChart === "date") {
                        return (
                          <BarChart data={analyticsReport.chartDataDates} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" vertical={false} />
                            <XAxis dataKey="name" stroke="#a1a1aa" fontSize={8} />
                            <YAxis stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                              formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                            />
                            <Bar dataKey="minutes" fill="url(#verticalCylinder)" barSize={36}>
                              <LabelList dataKey="minutes" position="top" formatter={(v) => Number(v) > 0 ? formatMinutesToHHMMSS(Number(v)) : ""} fill="#ffffff" fontSize={9} offset={8} className="font-bold font-mono" />
                            </Bar>
                          </BarChart>
                        );
                      }
                      if (expandedChart === "adherence") {
                        return (
                          <PieChart>
                            <Pie
                              data={[
                                { value: Math.min(95, analyticsReport.overallAdherence), color: "#ef4444" },
                                { value: Math.max(0, Math.min(5, analyticsReport.overallAdherence - 95)), color: "#10b981" },
                                { value: Math.max(0, 100 - analyticsReport.overallAdherence), color: "#1f2937" }
                              ]}
                              dataKey="value"
                              innerRadius="65%"
                              outerRadius="85%"
                              startAngle={180}
                              endAngle={0}
                              paddingAngle={0}
                              stroke="none"
                            >
                              <Cell fill="#ef4444" />
                              <Cell fill="#10b981" />
                              <Cell fill="#242424" />
                            </Pie>
                          </PieChart>
                        );
                      }
                      if (expandedChart === "maintenance") {
                        return (
                          <LineChart data={analyticsReport.chartDataTypes.length > 0 ? analyticsReport.chartDataTypes : [{ name: "SEM DADOS", minutes: 0 }]} margin={{ top: 15, right: 20, left: 10, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" />
                            <XAxis dataKey="name" stroke="#a1a1aa" fontSize={8} />
                            <YAxis stroke="#a1a1aa" fontSize={8} tickFormatter={(v) => formatMinutesToHHMMSS(Number(v))} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                              formatter={(value: any) => [formatMinutesToHHMMSS(Number(value)), "Tempo Parado"]}
                            />
                            <Line type="monotone" dataKey="minutes" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 5 }} activeDot={{ r: 8 }}>
                              <LabelList dataKey="minutes" position="top" formatter={(v) => formatMinutesToHHMMSS(Number(v))} fill="#ffffff" fontSize={9} className="font-bold font-mono" offset={10} />
                            </Line>
                          </LineChart>
                        );
                      }
                      return <div className="text-zinc-500 text-xs">Sem visualização gráfica disponível.</div>;
                    })()}
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Data Table Column */}
              <div className="lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col h-[380px]">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Dados Completos</span>
                  {(expandedChart === "equipment" || expandedChart === "plates" || expandedChart === "operator") && (
                    <Input
                      type="text"
                      placeholder="Pesquisar..."
                      value={expandedSearch}
                      onChange={(e) => setExpandedSearch(e.target.value)}
                      className="w-32 h-6 text-[10px] bg-zinc-800 border-zinc-700 text-white font-bold"
                    />
                  )}
                </div>

                <div className="flex-1 overflow-y-auto text-xs scrollbar-thin">
                  <Table>
                    <TableHeader className="bg-zinc-850 sticky top-0 z-10">
                      <TableRow className="border-b border-zinc-800 text-[9px] font-black uppercase text-zinc-400">
                        <TableHead>{expandedChart === "adherence" ? "Localidade" : "Nome/Item"}</TableHead>
                        <TableHead className="text-right">
                          {expandedChart === "adherence" ? "Aderência" : "Tempo Parado"}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="font-bold text-zinc-350">
                      {(() => {
                        if (expandedChart === "equipment") {
                          return analyticsReport.fullChartDataEquipment
                            .filter(item => item.name.toLowerCase().includes(expandedSearch.toLowerCase()))
                            .map(item => (
                              <TableRow key={item.name} className="border-b border-zinc-850 hover:bg-zinc-800/40">
                                <TableCell className="py-2 text-zinc-200">{item.name}</TableCell>
                                <TableCell className="py-2 text-right font-mono text-zinc-400">{formatMinutesToHHMMSS(item.minutes)}</TableCell>
                              </TableRow>
                            ));
                        }
                        if (expandedChart === "plates") {
                          return analyticsReport.fullChartDataPlates
                            .filter(item => item.name.toLowerCase().includes(expandedSearch.toLowerCase()))
                            .map(item => (
                              <TableRow key={item.name} className="border-b border-zinc-850 hover:bg-zinc-800/40">
                                <TableCell className="py-2 text-zinc-200">{item.name}</TableCell>
                                <TableCell className="py-2 text-right font-mono text-zinc-400">{formatMinutesToHHMMSS(item.minutes)}</TableCell>
                              </TableRow>
                            ));
                        }
                        if (expandedChart === "operator") {
                          return analyticsReport.fullChartDataOperator
                            .filter(item => item.name.toLowerCase().includes(expandedSearch.toLowerCase()))
                            .map(item => (
                              <TableRow key={item.name} className="border-b border-zinc-850 hover:bg-zinc-800/40">
                                <TableCell className="py-2 text-zinc-200">{item.name}</TableCell>
                                <TableCell className="py-2 text-right font-mono text-zinc-400">{formatMinutesToHHMMSS(item.minutes)}</TableCell>
                              </TableRow>
                            ));
                        }
                        if (expandedChart === "date") {
                          return analyticsReport.chartDataDates.map(item => (
                            <TableRow key={item.name} className="border-b border-zinc-850 hover:bg-zinc-800/40">
                              <TableCell className="py-2 text-zinc-200">{item.name}</TableCell>
                              <TableCell className="py-2 text-right font-mono text-zinc-400">{formatMinutesToHHMMSS(item.minutes)}</TableCell>
                            </TableRow>
                          ));
                        }
                        if (expandedChart === "adherence") {
                          return analyticsReport.localList.map(item => (
                            <TableRow key={item.local} className="border-b border-zinc-850 hover:bg-zinc-800/40">
                              <TableCell className="py-2 text-zinc-200 uppercase">{item.local}</TableCell>
                              <TableCell className="py-2 text-right">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                  item.adherence >= 90 ? "bg-emerald-950 text-emerald-400 border border-emerald-900" :
                                  item.adherence >= 75 ? "bg-amber-950 text-amber-400 border border-amber-900" :
                                  "bg-rose-950 text-rose-400 border border-rose-900"
                                }`}>
                                  {item.adherence}%
                                </span>
                              </TableCell>
                            </TableRow>
                          ));
                        }
                        if (expandedChart === "maintenance") {
                          return analyticsReport.chartDataTypes.map(item => (
                            <TableRow key={item.name} className="border-b border-zinc-850 hover:bg-zinc-800/40">
                              <TableCell className="py-2 text-zinc-200">{item.name}</TableCell>
                              <TableCell className="py-2 text-right font-mono text-zinc-400">{formatMinutesToHHMMSS(item.minutes)}</TableCell>
                            </TableRow>
                          ));
                        }
                        return null;
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="border-t border-zinc-800 pt-3">
            <Button onClick={() => { setExpandedChart(null); setExpandedSearch(""); }} className="bg-zinc-800 hover:bg-zinc-700 text-white font-bold w-full uppercase text-xs">
              Fechar Detalhes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </Tabs>
  );
}
