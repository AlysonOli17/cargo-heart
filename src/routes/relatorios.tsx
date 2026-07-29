import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/AppLayout";
import { getCorrectivesByDateRange, getContracts } from "@/lib/cco-service";
import { supabase } from "@/integrations/supabase/client";
import type { Contract } from "@/lib/cco-service";
import {
  BarChart3, Calendar, Clock, Filter, Download, Wrench, Truck,
  TrendingDown, AlertTriangle, ChevronDown
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend
} from "recharts";
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/relatorios")({
  component: RelatoriosPage,
});

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const PROBLEM_LABELS: Record<string, string> = {
  mecanico: "Mecânico", eletrico: "Elétrico", pneu: "Pneu",
  abastecimento: "Abastecimento", operador: "Operador", acidente: "Acidente", outro: "Outro",
};

const CHART_COLORS = ["#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#06b6d4", "#f97316"];

type Period = "day" | "week" | "month" | "year" | "custom";

export default function RelatoriosPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(new Date(), "yyyy-MM-dd"));
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractFilter, setContractFilter] = useState<string>("all");
  const [correctives, setCorrectives] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [activeTab, setActiveTab] = useState<"geral" | "placas" | "operadores" | "contratos">("geral");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading]);

  useEffect(() => {
    getContracts().then(setContracts).catch(console.error);
  }, []);

  function getDateRange(): { start: string; end: string } {
    const today = new Date();
    switch (period) {
      case "day": return { start: format(today, "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "week": return { start: format(subDays(today, 7), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "month": return { start: format(startOfMonth(today), "yyyy-MM-dd"), end: format(endOfMonth(today), "yyyy-MM-dd") };
      case "year": return { start: format(startOfYear(today), "yyyy-MM-dd"), end: format(endOfYear(today), "yyyy-MM-dd") };
      case "custom": return { start: customStart, end: customEnd };
    }
  }

  useEffect(() => {
    const { start, end } = getDateRange();
    setLoadingData(true);
    getCorrectivesByDateRange(start, end)
      .then(data => setCorrectives(data || []))
      .catch(console.error)
      .finally(() => setLoadingData(false));
  }, [period, customStart, customEnd]);

  const filtered = useMemo(() => {
    if (contractFilter === "all") return correctives;
    return correctives.filter(c => c.contracts?.name?.includes(contractFilter) || c.contract_id === contractFilter);
  }, [correctives, contractFilter]);

  // KPIs
  const kpis = useMemo(() => {
    const totalMinutes = filtered.filter(c => c.minutes_lost).reduce((a, c) => a + (c.minutes_lost || 0), 0);
    const avgMinutes = filtered.length > 0 ? totalMinutes / filtered.length : 0;

    const byEquip = new Map<string, number>();
    filtered.forEach(c => {
      const key = c.plate || c.equipment_identifier;
      byEquip.set(key, (byEquip.get(key) || 0) + 1);
    });
    const worstEquip = [...byEquip.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      totalCorrectives: filtered.length,
      totalHoursLost: (totalMinutes / 60).toFixed(1),
      avgMinutesPerStop: Math.round(avgMinutes),
      worstEquip: worstEquip ? `${worstEquip[0]} (${worstEquip[1]}x)` : "—",
    };
  }, [filtered]);

  // Chart: correctives per day
  const perDayData = useMemo(() => {
    const map = new Map<string, { count: number; minutes: number }>();
    filtered.forEach(c => {
      const day = c.date;
      const existing = map.get(day) || { count: 0, minutes: 0 };
      map.set(day, { count: existing.count + 1, minutes: existing.minutes + (c.minutes_lost || 0) });
    });
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date: new Date(date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        Paradas: v.count,
        "Horas Perdidas": parseFloat((v.minutes / 60).toFixed(2)),
      }));
  }, [filtered]);

  // Chart: by problem type
  const byProblemType = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(c => map.set(c.problem_type, (map.get(c.problem_type) || 0) + 1));
    return [...map.entries()].map(([type, count]) => ({
      name: PROBLEM_LABELS[type] || type,
      value: count,
    })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Table: by plate
  const byPlate = useMemo(() => {
    const map = new Map<string, { plate: string; equip: string; count: number; minutes: number }>();
    filtered.forEach(c => {
      const key = c.plate || c.equipment_identifier;
      const existing = map.get(key) || { plate: c.plate || "—", equip: c.equipment_identifier, count: 0, minutes: 0 };
      map.set(key, { ...existing, count: existing.count + 1, minutes: existing.minutes + (c.minutes_lost || 0) });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [filtered]);

  // Table: by operator
  const byOperator = useMemo(() => {
    const map = new Map<string, { name: string; count: number; minutes: number }>();
    filtered.forEach(c => {
      const name = c.daily_schedules?.operator_name || "Desconhecido";
      const existing = map.get(name) || { name, count: 0, minutes: 0 };
      map.set(name, { ...existing, count: existing.count + 1, minutes: existing.minutes + (c.minutes_lost || 0) });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [filtered]);

  if (loading) return null;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-foreground">Relatórios</h1>
            <p className="text-muted-foreground text-sm font-medium">Análise de desempenho, paradas e disponibilidade</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Period */}
          <div className="flex gap-1 bg-muted/50 rounded-xl p-1">
            {([["day", "Hoje"], ["week", "7 dias"], ["month", "Mês"], ["year", "Ano"], ["custom", "Período"]] as [Period, string][]).map(([p, l]) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                  period === p ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {period === "custom" && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <span className="text-muted-foreground text-xs">até</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </>
          )}

          <div className="w-px h-5 bg-border" />

          {/* Contract filter */}
          <select
            value={contractFilter}
            onChange={e => setContractFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-bold rounded-xl border border-border bg-card text-foreground focus:outline-none"
          >
            <option value="all">Todos os contratos</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total Paradas" value={kpis.totalCorrectives} icon={Wrench} color="red" />
          <MetricCard label="Horas Perdidas" value={`${kpis.totalHoursLost}h`} icon={TrendingDown} color="amber" />
          <MetricCard label="Tempo Médio/Parada" value={`${kpis.avgMinutesPerStop}min`} icon={Clock} color="blue" />
          <MetricCard label="Equip. mais parado" value={kpis.worstEquip} icon={AlertTriangle} color="orange" small />
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 border-b border-border">
          {[
            { key: "geral", label: "Visão Geral" },
            { key: "placas", label: "Por Placa" },
            { key: "operadores", label: "Por Operador" },
            { key: "contratos", label: "Por Contrato" },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={cn(
                "px-4 py-2.5 text-sm font-bold border-b-2 transition-all -mb-px",
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === "geral" && (
              <div className="space-y-6">
                {/* Per day chart */}
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h3 className="font-black text-sm uppercase tracking-wide text-foreground mb-4">Paradas por Dia</h3>
                  {perDayData.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-20" />
                      <p className="text-sm font-medium">Nenhum dado no período</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={perDayData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 700 }} className="fill-muted-foreground" />
                        <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                        <Tooltip contentStyle={{ fontSize: 11, fontWeight: 600, borderRadius: 8 }} />
                        <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                        <Bar dataKey="Paradas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Horas Perdidas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Problem type pie */}
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                  <h3 className="font-black text-sm uppercase tracking-wide text-foreground mb-4">Tipos de Problema</h3>
                  {byProblemType.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <p className="text-sm font-medium">Nenhum dado no período</p>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row items-center gap-6">
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={byProblemType} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                            {byProblemType.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ fontSize: 11, fontWeight: 600, borderRadius: 8 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-col gap-2 min-w-[160px]">
                        {byProblemType.map((item, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <span className="text-xs font-bold text-foreground">{item.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground font-bold">{item.value}x</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "placas" && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-border">
                  <h3 className="font-black text-sm uppercase tracking-wide text-foreground">Ranking por Placa</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[600px]">
                    <thead>
                      <tr className="border-b border-border text-[9px] font-black text-muted-foreground uppercase tracking-widest bg-muted/10">
                        <th className="px-4 py-2">#</th>
                        <th className="px-4 py-2">Placa</th>
                        <th className="px-4 py-2">Equipamento</th>
                        <th className="px-4 py-2">Total Paradas</th>
                        <th className="px-4 py-2">Horas Perdidas</th>
                        <th className="px-4 py-2">Média por Parada</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {byPlate.map((item, i) => (
                        <tr key={item.plate} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <span className={cn(
                              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black",
                              i === 0 ? "bg-red-100 text-red-700" : i === 1 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"
                            )}>{i + 1}</span>
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-sm text-foreground">{item.plate}</td>
                          <td className="px-4 py-3 text-sm font-medium text-foreground">{item.equip}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-black text-foreground text-sm">{item.count}</span>
                              <div className="flex-1 max-w-[80px] h-1.5 bg-muted rounded-full">
                                <div
                                  className="h-1.5 bg-red-500 rounded-full"
                                  style={{ width: `${(item.count / byPlate[0]?.count) * 100}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-bold text-amber-600">{(item.minutes / 60).toFixed(1)}h</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                            {item.count > 0 ? `${Math.round(item.minutes / item.count)}min` : "—"}
                          </td>
                        </tr>
                      ))}
                      {byPlate.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">Nenhum dado no período</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "operadores" && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-border">
                  <h3 className="font-black text-sm uppercase tracking-wide text-foreground">Ranking por Operador</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[500px]">
                    <thead>
                      <tr className="border-b border-border text-[9px] font-black text-muted-foreground uppercase tracking-widest bg-muted/10">
                        <th className="px-4 py-2">#</th>
                        <th className="px-4 py-2">Operador</th>
                        <th className="px-4 py-2">Total Paradas</th>
                        <th className="px-4 py-2">Horas Perdidas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {byOperator.map((item, i) => (
                        <tr key={item.name} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <span className={cn(
                              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black",
                              i === 0 ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"
                            )}>{i + 1}</span>
                          </td>
                          <td className="px-4 py-3 font-bold text-sm text-foreground">{item.name}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-black text-foreground text-sm">{item.count}</span>
                              <div className="flex-1 max-w-[80px] h-1.5 bg-muted rounded-full">
                                <div className="h-1.5 bg-red-500 rounded-full"
                                  style={{ width: `${(item.count / byOperator[0]?.count) * 100}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-bold text-amber-600">{(item.minutes / 60).toFixed(1)}h</td>
                        </tr>
                      ))}
                      {byOperator.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground text-sm">Nenhum dado no período</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "contratos" && (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h3 className="font-black text-sm uppercase tracking-wide text-foreground mb-4">Paradas por Contrato</h3>
                {(() => {
                  const map = new Map<string, { name: string; count: number; minutes: number }>();
                  filtered.forEach(c => {
                    const name = c.contracts?.name || "Sem contrato";
                    const ex = map.get(name) || { name, count: 0, minutes: 0 };
                    map.set(name, { ...ex, count: ex.count + 1, minutes: ex.minutes + (c.minutes_lost || 0) });
                  });
                  const data = [...map.values()];
                  return data.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <p className="text-sm font-medium">Nenhum dado no período</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {data.map((item, i) => (
                        <div key={item.name} className="flex items-center gap-4 p-3 bg-muted/20 rounded-xl">
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="font-bold text-sm text-foreground flex-1">{item.name}</span>
                          <span className="font-black text-foreground">{item.count} paradas</span>
                          <span className="text-amber-600 font-bold">{(item.minutes / 60).toFixed(1)}h perdidas</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

function MetricCard({ label, value, icon: Icon, color, small }: {
  label: string; value: string | number; icon: any; color: string; small?: boolean;
}) {
  const colorMap: Record<string, string> = {
    red: "bg-red-50 border-red-200 text-red-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    orange: "bg-orange-50 border-orange-200 text-orange-700",
  };
  return (
    <div className={cn("rounded-2xl border p-5", colorMap[color])}>
      <Icon className="w-5 h-5 opacity-60 mb-3" />
      <p className={cn("font-black leading-tight", small ? "text-base" : "text-2xl")}>{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 mt-1">{label}</p>
    </div>
  );
}
