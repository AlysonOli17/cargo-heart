import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/AppLayout";
import { getCorrectivesByDate, openCorrective, closeCorrective, updateCorrective, deleteCorrective, getSchedulesByDate } from "@/lib/cco-service";
import { supabase } from "@/integrations/supabase/client";
import {
  Wrench, CheckCircle2, Clock, AlertTriangle, Plus, Filter,
  ChevronDown, RefreshCw, Circle, Pencil, Trash2
} from "lucide-react";
import { format, formatDistanceToNow, differenceInMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/corretivas")({
  component: CorretivasPage,
});

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const toDatetimeLocal = (isoString?: string | null) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const PROBLEM_TYPES = [
  { value: "mecanico", label: "Mecânico", color: "bg-red-100 text-red-700 border-red-200" },
  { value: "eletrico", label: "Elétrico", color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  { value: "pneu", label: "Pneu", color: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "abastecimento", label: "Abastecimento", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "operador", label: "Operador", color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "acidente", label: "Acidente", color: "bg-pink-100 text-pink-700 border-pink-200" },
  { value: "outro", label: "Outro", color: "bg-slate-100 text-slate-700 border-slate-200" },
];

export default function CorretivasPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const today = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = useState(today);
  const [correctives, setCorrectives] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "closed">("all");

  // Modal
  const [modal, setModal] = useState<{
    open: boolean;
    mode: "open" | "close" | "edit";
    schedule: any | null;
    corrective: any | null;
  }>({ open: false, mode: "open", schedule: null, corrective: null });
  const [problemType, setProblemType] = useState("mecanico");
  const [description, setDescription] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [saving, setSaving] = useState(false);

  // Schedule picker for new corrective
  const [scheduleSearch, setScheduleSearch] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading]);

  const loadData = async () => {
    setDataLoading(true);
    try {
      const [corr, sched] = await Promise.all([
        getCorrectivesByDate(selectedDate),
        getSchedulesByDate(selectedDate),
      ]);
      setCorrectives(corr || []);
      setSchedules(sched || []);
    } catch (e) {
      console.error(e);
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel("correctives-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "correctives" }, loadData)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedDate]);

  const filtered = correctives.filter(c => {
    if (filterStatus === "open") return !c.resolved;
    if (filterStatus === "closed") return c.resolved;
    return true;
  });

  const stats = {
    total: correctives.length,
    open: correctives.filter(c => !c.resolved).length,
    closed: correctives.filter(c => c.resolved).length,
    totalMinutes: correctives.filter(c => c.minutes_lost).reduce((a, c) => a + (c.minutes_lost || 0), 0),
  };

  async function handleOpenCorrective() {
    if (!modal.schedule || !user) return;
    setSaving(true);
    try {
      await openCorrective({
        schedule_id: modal.schedule.id,
        date: selectedDate,
        equipment_identifier: modal.schedule.equipment_identifier,
        plate: modal.schedule.plate,
        contract_id: modal.schedule.contract_id,
        start_time: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
        problem_type: problemType as any,
        description: description || undefined,
        created_by: user.id,
      });
      setModal({ open: false, mode: "open", schedule: null, corrective: null });
      setProblemType("mecanico");
      setDescription("");
      await loadData();
    } catch (e: any) {
      alert("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCloseCorrective() {
    if (!modal.corrective || !user) return;
    setSaving(true);
    try {
      await closeCorrective(
        modal.corrective.id,
        endTime ? new Date(endTime).toISOString() : new Date().toISOString(),
        resolutionNotes || undefined,
        user.id
      );

      // Check remaining open correctives for that schedule
      const remaining = correctives.filter(c =>
        c.schedule_id === modal.corrective.schedule_id && !c.resolved && c.id !== modal.corrective.id
      );
      if (remaining.length === 0) {
        await supabase.from("daily_schedules").update({ status: "operando" }).eq("id", modal.corrective.schedule_id);
      }

      setModal({ open: false, mode: "open", schedule: null, corrective: null });
      setResolutionNotes("");
      await loadData();
    } catch (e: any) {
      alert("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEditCorrective() {
    if (!modal.corrective || !user) return;
    setSaving(true);
    try {
      await updateCorrective(modal.corrective.id, {
        start_time: startTime ? new Date(startTime).toISOString() : undefined,
        end_time: endTime ? new Date(endTime).toISOString() : null,
        problem_type: problemType,
        description: description || null,
        resolution_notes: resolutionNotes || null,
      });
      setModal({ open: false, mode: "open", schedule: null, corrective: null });
      await loadData();
    } catch (e: any) {
      alert("Erro: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCorrective(id: string) {
    if (!confirm("Tem certeza que deseja excluir este registro de corretiva? Essa ação não pode ser desfeita.")) return;
    try {
      await deleteCorrective(id);
      await loadData();
    } catch (e: any) {
      alert("Erro: " + e.message);
    }
  }

  const filteredSchedules = schedules.filter(s =>
    (s.equipment_identifier || "").toLowerCase().includes(scheduleSearch.toLowerCase()) ||
    (s.plate || "").toLowerCase().includes(scheduleSearch.toLowerCase()) ||
    (s.operator_name || "").toLowerCase().includes(scheduleSearch.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-foreground">Corretivas</h1>
            <p className="text-muted-foreground text-sm font-medium">Registro e controle de paradas por manutenção</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button onClick={loadData} className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <RefreshCw className={cn("w-4 h-4", dataLoading && "animate-spin")} />
            </button>
            <button
              onClick={() => {
                setStartTime(toDatetimeLocal(new Date().toISOString()));
                setModal({ open: true, mode: "open", schedule: null, corrective: null });
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nova Corretiva
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Paradas", value: stats.total, color: "bg-slate-50 border-slate-200 text-slate-700" },
            { label: "Em Andamento", value: stats.open, color: "bg-red-50 border-red-200 text-red-700", pulse: stats.open > 0 },
            { label: "Resolvidas", value: stats.closed, color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
            { label: "Horas Perdidas", value: `${Math.floor(stats.totalMinutes / 60)}h ${stats.totalMinutes % 60}m`, color: "bg-amber-50 border-amber-200 text-amber-700" },
          ].map(stat => (
            <div key={stat.label} className={cn("rounded-xl border p-4 relative", stat.color)}>
              {(stat as any).pulse && (
                <span className="absolute top-2 right-2 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
                </span>
              )}
              <p className="text-2xl font-black">{stat.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-muted/50 rounded-xl p-1 w-fit">
          {([["all", "Todas"], ["open", "Em Andamento"], ["closed", "Resolvidas"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterStatus(key)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                filterStatus === key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Correctives list */}
        {dataLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Wrench className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-bold text-sm">Nenhuma corretiva {filterStatus !== "all" ? `${filterStatus === "open" ? "em andamento" : "resolvida"}` : ""}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(c => {
              const problemConfig = PROBLEM_TYPES.find(p => p.value === c.problem_type) || PROBLEM_TYPES[6];
              const durationMinutes = c.resolved
                ? (c.minutes_lost || 0)
                : differenceInMinutes(new Date(), new Date(c.start_time));
              const durationH = Math.floor(durationMinutes / 60);
              const durationM = durationMinutes % 60;

              return (
                <div
                  key={c.id}
                  className={cn(
                    "bg-card border rounded-xl p-4 shadow-sm transition-all",
                    !c.resolved ? "border-red-200 bg-red-50/30" : "border-border"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="flex flex-col gap-2">
                        <div className={cn(
                          "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                          !c.resolved ? "bg-red-100" : "bg-emerald-100"
                        )}>
                          {!c.resolved
                            ? <Wrench className="w-4 h-4 text-red-600" />
                            : <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          }
                        </div>
                        {user?.role === "admin" && (
                          <div className="flex flex-col gap-1 mt-1">
                            <button
                              onClick={() => {
                                setProblemType(c.problem_type);
                                setDescription(c.description || "");
                                setResolutionNotes(c.resolution_notes || "");
                                setStartTime(toDatetimeLocal(c.start_time));
                                setEndTime(toDatetimeLocal(c.end_time));
                                setModal({ open: true, mode: "edit", schedule: null, corrective: c });
                              }}
                              className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                              title="Editar"
                            >
                              <Pencil className="w-3.5 h-3.5 mx-auto" />
                            </button>
                            <button
                              onClick={() => handleDeleteCorrective(c.id)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                              title="Excluir"
                            >
                              <Trash2 className="w-3.5 h-3.5 mx-auto" />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-sm text-foreground">
                            {c.daily_schedules?.equipment_identifier || c.equipment_identifier}
                          </span>
                          {(c.daily_schedules?.plate || c.plate) && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {c.daily_schedules?.plate || c.plate}
                            </span>
                          )}
                          <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black uppercase border", problemConfig.color)}>
                            {problemConfig.label}
                          </span>
                          {!c.resolved && (
                            <span className="flex items-center gap-1 text-red-600 text-[10px] font-bold">
                              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                              Em andamento
                            </span>
                          )}
                        </div>
                        {c.daily_schedules?.operator_name && (
                          <p className="text-xs text-muted-foreground font-medium mt-0.5">
                            Operador: {c.daily_schedules.operator_name}
                          </p>
                        )}
                        {c.description && (
                          <p className="text-xs text-foreground/70 font-medium mt-1 bg-muted/50 rounded-lg px-2 py-1">
                            {c.description}
                          </p>
                        )}
                        {c.resolved && c.resolution_notes && (
                          <p className="text-xs text-emerald-700 font-medium mt-1 bg-emerald-50 rounded-lg px-2 py-1">
                            ✓ {c.resolution_notes}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-2">
                          <span className="text-[10px] text-muted-foreground font-medium">
                            Início: {format(new Date(c.start_time), "HH:mm")}
                          </span>
                          {c.end_time && (
                            <span className="text-[10px] text-muted-foreground font-medium">
                              Retorno: {format(new Date(c.end_time), "HH:mm")}
                            </span>
                          )}
                          <span className={cn(
                            "text-[10px] font-black",
                            !c.resolved ? "text-red-600" : "text-amber-600"
                          )}>
                            {durationH > 0 ? `${durationH}h ${durationM}min` : `${durationM}min`}
                            {!c.resolved ? " parado" : " perdidos"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {!c.resolved && (
                      <button
                        onClick={() => {
                          setEndTime(toDatetimeLocal(new Date().toISOString()));
                          setModal({ open: true, mode: "close", schedule: null, corrective: c });
                          setResolutionNotes("");
                        }}
                        className="px-3 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
                      >
                        Registrar Retorno
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6">
              {modal.mode === "open" ? (
                <>
                  <h3 className="font-black text-foreground text-lg mb-5">Nova Corretiva</h3>

                  {/* Schedule selector */}
                  <div className="mb-4">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">
                      Equipamento
                    </label>
                    {modal.schedule ? (
                      <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-primary bg-primary/5">
                        <div>
                          <p className="font-bold text-sm text-foreground">{modal.schedule.equipment_identifier}</p>
                          <p className="text-xs text-muted-foreground">{modal.schedule.plate} · {modal.schedule.operator_name}</p>
                        </div>
                        <button onClick={() => setModal(m => ({ ...m, schedule: null }))} className="text-muted-foreground hover:text-foreground">
                          <CheckCircle2 className="w-4 h-4 text-primary" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          value={scheduleSearch}
                          onChange={e => setScheduleSearch(e.target.value)}
                          onFocus={() => setScheduleSearch(scheduleSearch || " ")}
                          placeholder="Clique ou busque por equipamento, placa ou operador..."
                          className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                          autoComplete="off"
                        />
                        {scheduleSearch.trim() !== "" || scheduleSearch === " " ? (
                          <div className="absolute left-0 right-0 mt-1 max-h-52 overflow-y-auto border border-border rounded-xl bg-card shadow-xl z-10">
                            {filteredSchedules.length === 0 ? (
                              <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                                <p>Nenhum equipamento na programação de {selectedDate}</p>
                                <p className="mt-1 text-[10px]">Mude a data ou cadastre uma corretiva avulsa:</p>
                                <button
                                  onClick={() => {
                                    const identifier = (scheduleSearch || "").trim();
                                    if (identifier && identifier !== " ") {
                                      setModal(m => ({ ...m, schedule: { id: null, equipment_identifier: identifier, plate: "-", operator_name: "-", contract_id: null } }));
                                      setScheduleSearch("");
                                    }
                                  }}
                                  className="mt-2 px-3 py-1 bg-primary text-primary-foreground rounded-lg text-[10px] font-bold"
                                >
                                  Usar "{scheduleSearch.trim()}" como equipamento
                                </button>
                              </div>
                            ) : filteredSchedules.slice(0, 20).map(s => (
                              <button
                                key={s.id}
                                onClick={() => { setModal(m => ({ ...m, schedule: s })); setScheduleSearch(""); }}
                                className="w-full text-left px-3 py-2.5 hover:bg-accent transition-colors border-b border-border/50 last:border-0"
                              >
                                <p className="font-bold text-sm text-foreground">{s.equipment_identifier}</p>
                                <p className="text-[10px] text-muted-foreground">{s.plate} · {s.operator_name} · {s.location}</p>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {schedules.length === 0 && (
                          <p className="text-[10px] text-amber-600 font-medium mt-1">
                            ⚠ Nenhuma programação para esta data. Mude a data para ver equipamentos.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mb-4">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Tipo do Problema</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PROBLEM_TYPES.map(p => (
                        <button
                          key={p.value}
                          onClick={() => setProblemType(p.value)}
                          className={cn(
                            "px-3 py-2 rounded-xl border text-xs font-bold transition-all",
                            problemType === p.value ? p.color + " ring-2 ring-offset-1 ring-current" : "border-border text-muted-foreground hover:bg-accent"
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Hora que parou</label>
                    <input
                      type="datetime-local"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <div className="mb-6">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Descrição (opcional)</label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={2}
                      placeholder="Descreva o problema..."
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => setModal({ open: false, mode: "open", schedule: null, corrective: null })}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors">
                      Cancelar
                    </button>
                    <button
                      onClick={handleOpenCorrective}
                      disabled={saving || !modal.schedule}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-60 transition-colors"
                    >
                      {saving ? "Salvando..." : "Registrar Parada"}
                    </button>
                  </div>
                </>
              ) : modal.mode === "close" ? (
                <>
                  <h3 className="font-black text-foreground text-lg mb-2">Registrar Retorno</h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    {modal.corrective?.daily_schedules?.equipment_identifier || modal.corrective?.equipment_identifier}
                  </p>

                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                    <p className="text-xs font-bold text-red-600 uppercase tracking-widest">Tempo parado</p>
                    <p className="text-3xl font-black text-red-700 mt-1">
                      {(() => {
                        const mins = differenceInMinutes(new Date(), new Date(modal.corrective?.start_time));
                        return `${Math.floor(mins / 60)}h ${mins % 60}min`;
                      })()}
                    </p>
                    <p className="text-xs text-red-500 font-medium mt-1">
                      Iniciado às {modal.corrective?.start_time ? format(new Date(modal.corrective.start_time), "HH:mm") : "—"}
                    </p>
                  </div>

                  <div className="mb-4">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Hora que retornou</label>
                    <input
                      type="datetime-local"
                      value={endTime}
                      onChange={e => setEndTime(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <div className="mb-6">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Observações de Resolução (opcional)</label>
                    <textarea
                      value={resolutionNotes}
                      onChange={e => setResolutionNotes(e.target.value)}
                      rows={3}
                      placeholder="O que foi feito para resolver..."
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => setModal({ open: false, mode: "open", schedule: null, corrective: null })}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors">
                      Cancelar
                    </button>
                    <button
                      onClick={handleCloseCorrective}
                      disabled={saving}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                    >
                      {saving ? "Salvando..." : "Registrar Retorno"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="font-black text-foreground text-lg mb-5">Editar Corretiva</h3>
                  
                  <div className="mb-4">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Equipamento</label>
                    <div className="px-3 py-2.5 rounded-xl border border-border bg-muted/50">
                      <p className="font-bold text-sm text-foreground">
                        {modal.corrective?.daily_schedules?.equipment_identifier || modal.corrective?.equipment_identifier}
                      </p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Tipo do Problema</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PROBLEM_TYPES.map(p => (
                        <button
                          key={p.value}
                          onClick={() => setProblemType(p.value)}
                          className={cn(
                            "px-3 py-2 rounded-xl border text-xs font-bold transition-all",
                            problemType === p.value ? p.color + " ring-2 ring-offset-1 ring-current" : "border-border text-muted-foreground hover:bg-accent"
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Hora que parou</label>
                      <input
                        type="datetime-local"
                        value={startTime}
                        onChange={e => setStartTime(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Hora que retornou</label>
                      <input
                        type="datetime-local"
                        value={endTime}
                        onChange={e => setEndTime(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                        disabled={!modal.corrective?.resolved && !endTime}
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Descrição</label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {modal.corrective?.resolved && (
                    <div className="mb-6">
                      <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Observações de Resolução</label>
                      <textarea
                        value={resolutionNotes}
                        onChange={e => setResolutionNotes(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={() => setModal({ open: false, mode: "open", schedule: null, corrective: null })}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors">
                      Cancelar
                    </button>
                    <button
                      onClick={handleEditCorrective}
                      disabled={saving}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-60 transition-colors"
                    >
                      {saving ? "Salvando..." : "Salvar Edição"}
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
