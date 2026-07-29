import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  getSchedulesByDate, getCorrectivesByDate, getOpenCorrectives,
  getDailySummary, openCorrective, closeCorrective,
} from "@/lib/cco-service";
import type { DailySchedule, Corrective, Contract } from "@/lib/cco-service";
import {
  Truck, Wrench, CheckCircle2, Clock, AlertTriangle, RefreshCw,
  Play, Square, ChevronDown, ChevronUp, Filter, Activity,
  TrendingUp, TrendingDown, Circle
} from "lucide-react";
import { format, formatDistanceToNow, differenceInMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/cco")({
  component: CCOPage,
});

const STATUS_CONFIG = {
  agendado: { label: "Agendado", color: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
  operando: { label: "Operando", color: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  corretiva: { label: "Em Corretiva", color: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  finalizado: { label: "Finalizado", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-400" },
  ausente: { label: "Ausente", color: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
};

const PROBLEM_TYPES = [
  { value: "mecanico", label: "Mecânico" },
  { value: "eletrico", label: "Elétrico" },
  { value: "pneu", label: "Pneu" },
  { value: "abastecimento", label: "Abastecimento" },
  { value: "operador", label: "Operador" },
  { value: "acidente", label: "Acidente" },
  { value: "outro", label: "Outro" },
];

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export default function CCOPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const today = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(today);

  const [schedules, setSchedules] = useState<any[]>([]);
  const [correctives, setCorrectives] = useState<any[]>([]);
  const [openCorrectives, setOpenCorrectives] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Corrective modal state
  const [correctiveModal, setCorrectiveModal] = useState<{
    open: boolean;
    mode: "open" | "close";
    schedule: any | null;
    corrective: any | null;
  }>({ open: false, mode: "open", schedule: null, corrective: null });
  const [problemType, setProblemType] = useState("mecanico");
  const [problemDesc, setProblemDesc] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Filters
  const [contractFilter, setContractFilter] = useState<string>("all");
  const [shiftFilter, setShiftFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading]);

  const loadData = async () => {
    setDataLoading(true);
    try {
      const [sched, corr, open] = await Promise.allSettled([
        getSchedulesByDate(selectedDate),
        getCorrectivesByDate(selectedDate),
        getOpenCorrectives(),
      ]);
      setSchedules(sched.status === "fulfilled" ? sched.value : []);
      setCorrectives(corr.status === "fulfilled" ? corr.value : []);
      setOpenCorrectives(open.status === "fulfilled" ? open.value : []);

      // Summary view may not exist before migration - ignore errors
      try {
        const sum = await getDailySummary(selectedDate);
        setSummary(sum || []);
      } catch { setSummary([]); }
    } catch (e) {
      console.error("loadData error:", e);
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Real-time subscription
    const channel = supabase
      .channel("cco-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_schedules" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "correctives" }, loadData)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedDate]);

  // KPIs
  const kpis = useMemo(() => {
    const total = schedules.length;
    const operating = schedules.filter(s => s.status === "operando").length;
    const inCorrective = schedules.filter(s => s.status === "corretiva").length;
    const finished = schedules.filter(s => s.status === "finalizado").length;
    const scheduled = schedules.filter(s => s.status === "agendado").length;

    const totalMinutesLost = correctives
      .filter(c => c.minutes_lost)
      .reduce((acc, c) => acc + (c.minutes_lost || 0), 0);

    const openCount = openCorrectives.length;

    return { total, operating, inCorrective, finished, scheduled, totalMinutesLost, openCount };
  }, [schedules, correctives, openCorrectives]);

  // Filtered + grouped schedules
  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      const matchContract = contractFilter === "all" || s.contracts?.name?.includes(contractFilter);
      const matchShift = shiftFilter === "all" || s.shift === shiftFilter;
      const matchStatus = statusFilter === "all" || s.status === statusFilter;
      return matchContract && matchShift && matchStatus;
    });
  }, [schedules, contractFilter, shiftFilter, statusFilter]);

  const groupedSchedules = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const s of filteredSchedules) {
      const key = `${s.contracts?.name || "Sem contrato"} — ${s.shift} — ${s.team || "Geral"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return groups;
  }, [filteredSchedules]);

  // Handle open corrective
  async function handleOpenCorrective() {
    if (!correctiveModal.schedule || !user) return;
    setSaving(true);
    try {
      await openCorrective({
        schedule_id: correctiveModal.schedule.id,
        date: selectedDate,
        equipment_identifier: correctiveModal.schedule.equipment_identifier,
        plate: correctiveModal.schedule.plate,
        contract_id: correctiveModal.schedule.contract_id,
        start_time: new Date().toISOString(),
        problem_type: problemType as any,
        description: problemDesc || undefined,
        created_by: user.id,
      });
      setCorrectiveModal({ open: false, mode: "open", schedule: null, corrective: null });
      setProblemType("mecanico");
      setProblemDesc("");
      await loadData();
    } catch (e: any) {
      alert("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  // Handle close corrective
  async function handleCloseCorrective() {
    if (!correctiveModal.corrective || !user) return;
    setSaving(true);
    try {
      await closeCorrective(
        correctiveModal.corrective.id,
        new Date().toISOString(),
        resolutionNotes || undefined,
        user.id,
      );
      // Re-check if there are other open correctives for the same schedule
      const remaining = openCorrectives.filter(
        c => c.schedule_id === correctiveModal.corrective.schedule_id && c.id !== correctiveModal.corrective.id
      );
      if (remaining.length === 0) {
        // Set status back to operando
        await (supabase as any)
          .from("daily_schedules")
          .update({ status: "operando" })
          .eq("id", correctiveModal.corrective.schedule_id);
      }
      setCorrectiveModal({ open: false, mode: "open", schedule: null, corrective: null });
      setResolutionNotes("");
      await loadData();
    } catch (e: any) {
      alert("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(schedule: any, newStatus: string) {
    await (supabase as any).from("daily_schedules").update({ status: newStatus }).eq("id", schedule.id);
    await loadData();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-foreground">
              CCO Dashboard
            </h1>
            <p className="text-muted-foreground text-sm font-medium capitalize">
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("pt-BR", {
                weekday: "long", day: "2-digit", month: "long", year: "numeric"
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={loadData}
              className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <RefreshCw className={cn("w-4 h-4", dataLoading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KPICard label="Total" value={kpis.total} icon={Truck} color="slate" />
          <KPICard label="Operando" value={kpis.operating} icon={Activity} color="emerald" />
          <KPICard label="Agendado" value={kpis.scheduled} icon={Clock} color="blue" />
          <KPICard label="Em Corretiva" value={kpis.inCorrective} icon={Wrench} color="red" pulse={kpis.inCorrective > 0} />
          <KPICard label="Finalizado" value={kpis.finished} icon={CheckCircle2} color="teal" />
          <KPICard
            label="Horas Perdidas"
            value={`${Math.floor(kpis.totalMinutesLost / 60)}h ${kpis.totalMinutesLost % 60}m`}
            icon={TrendingDown}
            color="amber"
            valueSmall
          />
          <KPICard label="Paradas Abertas" value={kpis.openCount} icon={AlertTriangle} color="orange" pulse={kpis.openCount > 0} />
        </div>

        {/* Open correctives alert */}
        {openCorrectives.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <h3 className="font-black text-red-700 text-sm uppercase tracking-widest">
                {openCorrectives.length} Corretiva{openCorrectives.length > 1 ? "s" : ""} em Andamento
              </h3>
            </div>
            <div className="space-y-2">
              {openCorrectives.map(c => (
                <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-red-100">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 text-red-500" />
                    <div>
                      <span className="font-black text-sm text-red-800">
                        {c.daily_schedules?.equipment_identifier || c.equipment_identifier}
                      </span>
                      {c.daily_schedules?.plate && (
                        <span className="text-red-500 text-xs font-mono ml-2">{c.daily_schedules.plate}</span>
                      )}
                      <span className="text-red-600 text-xs font-medium ml-2">
                        — {PROBLEM_TYPES.find(p => p.value === c.problem_type)?.label}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-red-500 text-xs font-mono">
                      {formatDistanceToNow(new Date(c.start_time), { locale: ptBR, addSuffix: false })} parado
                    </span>
                    <button
                      onClick={() => setCorrectiveModal({ open: true, mode: "close", schedule: null, corrective: c })}
                      className="px-2 py-1 text-xs font-bold bg-emerald-500 text-white rounded-md hover:bg-emerald-600 transition-colors"
                    >
                      Liberar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <FilterPill label="Todos" active={contractFilter === "all"} onClick={() => setContractFilter("all")} />
          <FilterPill label="Habitual" active={contractFilter === "Habitual"} onClick={() => setContractFilter("Habitual")} />
          <FilterPill label="Eventual" active={contractFilter === "Eventual"} onClick={() => setContractFilter("Eventual")} />
          <div className="w-px h-4 bg-border mx-1" />
          <FilterPill label="Dia" active={shiftFilter === "Dia"} onClick={() => setShiftFilter(shiftFilter === "Dia" ? "all" : "Dia")} />
          <FilterPill label="Noite" active={shiftFilter === "Noite"} onClick={() => setShiftFilter(shiftFilter === "Noite" ? "all" : "Noite")} />
          <div className="w-px h-4 bg-border mx-1" />
          <FilterPill label="Operando" active={statusFilter === "operando"} onClick={() => setStatusFilter(statusFilter === "operando" ? "all" : "operando")} color="emerald" />
          <FilterPill label="Corretiva" active={statusFilter === "corretiva"} onClick={() => setStatusFilter(statusFilter === "corretiva" ? "all" : "corretiva")} color="red" />
          <FilterPill label="Agendado" active={statusFilter === "agendado"} onClick={() => setStatusFilter(statusFilter === "agendado" ? "all" : "agendado")} color="blue" />
        </div>

        {/* Schedule table */}
        {dataLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filteredSchedules.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Truck className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-bold text-sm">Nenhuma programação encontrada</p>
            <p className="text-xs mt-1">Importe o Excel do dia na aba Programação</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(groupedSchedules.entries()).map(([group, rows]) => (
              <ScheduleGroup
                key={group}
                label={group}
                rows={rows}
                correctives={correctives}
                onOpenCorrective={s => {
                  setCorrectiveModal({ open: true, mode: "open", schedule: s, corrective: null });
                  setProblemType("mecanico");
                  setProblemDesc("");
                }}
                onStatusChange={handleStatusChange}
                onCloseCorrective={corrective => {
                  setCorrectiveModal({ open: true, mode: "close", schedule: null, corrective });
                  setResolutionNotes("");
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Corrective Modal */}
      {correctiveModal.open && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              {correctiveModal.mode === "open" ? (
                <>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                      <Wrench className="w-5 h-5 text-red-600" />
                    </div>
                    <div>
                      <h3 className="font-black text-foreground">Registrar Corretiva</h3>
                      <p className="text-sm text-muted-foreground font-medium">
                        {correctiveModal.schedule?.equipment_identifier} · {correctiveModal.schedule?.plate}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
                        Tipo do Problema
                      </label>
                      <select
                        value={problemType}
                        onChange={e => setProblemType(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        {PROBLEM_TYPES.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
                        Descrição (opcional)
                      </label>
                      <textarea
                        value={problemDesc}
                        onChange={e => setProblemDesc(e.target.value)}
                        rows={3}
                        placeholder="Descreva o problema..."
                        className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-6">
                    <button
                      onClick={() => setCorrectiveModal({ open: false, mode: "open", schedule: null, corrective: null })}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      id="btn-open-corrective"
                      onClick={handleOpenCorrective}
                      disabled={saving}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-60 transition-colors"
                    >
                      {saving ? "Salvando..." : "Registrar Parada"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-black text-foreground">Registrar Retorno</h3>
                      <p className="text-sm text-muted-foreground font-medium">
                        {correctiveModal.corrective?.daily_schedules?.equipment_identifier || correctiveModal.corrective?.equipment_identifier}
                      </p>
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded-xl p-3 mb-4">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Tempo parado</p>
                    <p className="text-2xl font-black text-foreground mt-1">
                      {formatDuration(differenceInMinutes(new Date(), new Date(correctiveModal.corrective?.start_time)))}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
                      Observações de Resolução (opcional)
                    </label>
                    <textarea
                      value={resolutionNotes}
                      onChange={e => setResolutionNotes(e.target.value)}
                      rows={3}
                      placeholder="O que foi feito para resolver..."
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div className="flex gap-2 mt-6">
                    <button
                      onClick={() => setCorrectiveModal({ open: false, mode: "open", schedule: null, corrective: null })}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      id="btn-close-corrective"
                      onClick={handleCloseCorrective}
                      disabled={saving}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                    >
                      {saving ? "Salvando..." : "Registrar Retorno"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function KPICard({ label, value, icon: Icon, color, pulse, valueSmall }: {
  label: string; value: string | number; icon: any; color: string; pulse?: boolean; valueSmall?: boolean;
}) {
  const colorMap: Record<string, string> = {
    slate: "bg-slate-50 text-slate-600 border-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    red: "bg-red-50 text-red-700 border-red-200",
    teal: "bg-teal-50 text-teal-700 border-teal-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
  };
  return (
    <div className={cn("rounded-xl border p-3 relative overflow-hidden", colorMap[color] || colorMap.slate)}>
      {pulse && (
        <span className="absolute top-2 right-2 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      )}
      <Icon className="w-4 h-4 opacity-60 mb-1.5" />
      <p className={cn("font-black leading-none", valueSmall ? "text-lg" : "text-2xl")}>{value}</p>
      <p className="text-[9px] font-bold uppercase tracking-widest opacity-70 mt-1">{label}</p>
    </div>
  );
}

function FilterPill({ label, active, onClick, color }: {
  label: string; active: boolean; onClick: () => void; color?: string;
}) {
  const colorActive: Record<string, string> = {
    emerald: "bg-emerald-600 text-white border-emerald-600",
    red: "bg-red-600 text-white border-red-600",
    blue: "bg-blue-600 text-white border-blue-600",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-bold border transition-all",
        active
          ? (color ? colorActive[color] : "bg-primary text-primary-foreground border-primary")
          : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function ScheduleGroup({ label, rows, correctives, onOpenCorrective, onStatusChange, onCloseCorrective }: {
  label: string;
  rows: any[];
  correctives: any[];
  onOpenCorrective: (s: any) => void;
  onStatusChange: (s: any, status: string) => void;
  onCloseCorrective: (c: any) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const inCorrective = rows.filter(r => r.status === "corretiva").length;
  const operating = rows.filter(r => r.status === "operando").length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      {/* Group header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors border-b border-border"
      >
        <div className="flex items-center gap-3">
          {inCorrective > 0 && (
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          )}
          <span className="font-black text-xs uppercase tracking-widest text-foreground">{label}</span>
          <span className="text-[10px] text-muted-foreground font-medium">{rows.length} equip.</span>
          {operating > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase">{operating} op.</span>
          )}
          {inCorrective > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[9px] font-black uppercase animate-pulse">{inCorrective} corr.</span>
          )}
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[800px]">
            <thead>
              <tr className="border-b border-border text-[9px] font-black text-muted-foreground uppercase tracking-widest bg-muted/10">
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Equipamento</th>
                <th className="px-4 py-2">Placa</th>
                <th className="px-4 py-2">Operador</th>
                <th className="px-4 py-2">Turno / Horário</th>
                <th className="px-4 py-2">Local</th>
                <th className="px-4 py-2">Paradas Hoje</th>
                <th className="px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(row => {
                const rowCorrectives = correctives.filter(c => c.schedule_id === row.id);
                const openCorr = rowCorrectives.find(c => !c.resolved);
                const totalMinsLost = rowCorrectives
                  .filter(c => c.minutes_lost)
                  .reduce((a, c) => a + (c.minutes_lost || 0), 0);
                const cfg = STATUS_CONFIG[row.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.agendado;

                return (
                  <tr key={row.id} className={cn(
                    "hover:bg-muted/20 transition-colors",
                    row.status === "corretiva" && "bg-red-50/50"
                  )}>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9px] font-black uppercase", cfg.color)}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot, row.status === "corretiva" && "animate-pulse")} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-black text-sm text-foreground">{row.equipment_identifier}</p>
                      {row.model && <p className="text-[10px] text-muted-foreground font-medium">{row.model}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-xs text-foreground">{row.plate || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{row.operator_name || "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-bold text-foreground">{row.turno}</p>
                      {row.schedule_start && row.schedule_end && (
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {row.schedule_start?.slice(0, 5)} — {row.schedule_end?.slice(0, 5)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground max-w-[180px] truncate" title={row.location || ""}>
                        {row.location || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground">{rowCorrectives.length}x</span>
                        {totalMinsLost > 0 && (
                          <span className="text-[10px] text-amber-600 font-bold">
                            {Math.floor(totalMinsLost / 60)}h{totalMinsLost % 60}m perdidos
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {/* Quick status changes */}
                        {row.status === "agendado" && (
                          <button
                            onClick={() => onStatusChange(row, "operando")}
                            className="px-2 py-1 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded-md hover:bg-emerald-200 transition-colors"
                            title="Marcar como operando"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                        {row.status === "operando" && (
                          <>
                            <button
                              onClick={() => onOpenCorrective(row)}
                              className="px-2 py-1 text-[10px] font-bold bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
                              title="Registrar corretiva"
                            >
                              <Wrench className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onStatusChange(row, "finalizado")}
                              className="px-2 py-1 text-[10px] font-bold bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
                              title="Finalizar"
                            >
                              <Square className="w-3 h-3" />
                            </button>
                          </>
                        )}
                        {row.status === "corretiva" && openCorr && (
                          <button
                            onClick={() => onCloseCorrective(openCorr)}
                            className="px-2 py-1 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded-md hover:bg-emerald-200 transition-colors flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Liberar</span>
                          </button>
                        )}
                        {row.status === "agendado" && (
                          <button
                            onClick={() => onOpenCorrective(row)}
                            className="px-2 py-1 text-[10px] font-bold bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
                            title="Registrar corretiva diretamente"
                          >
                            <Wrench className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
