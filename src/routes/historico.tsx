import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { STATUS_LABELS, type EquipmentStatus } from "@/lib/equipment";

export const Route = createFileRoute("/historico")({
  head: () => ({ meta: [{ title: "Histórico — Disponibilidade Frota Busato" }] }),
  component: () => <AppLayout><HistoryPage /></AppLayout>,
});

type Movement = {
  id: string; created_at: string; equipment_id: string;
  from_status: EquipmentStatus | null; to_status: EquipmentStatus;
  from_client_id: string | null; to_client_id: string | null; notes: string | null;
};
type ReqRow = {
  id: string; created_at: string; status: string; equipment_id: string; client_id: string;
  requested_by: string; decided_by: string | null; decided_at: string | null;
  is_replacement: boolean; replacement_plate: string | null; replacement_reason: string | null; notes: string | null;
};

function HistoryPage() {
  const { user } = useAuth();
  const [movs, setMovs] = useState<Movement[]>([]);
  const [reqs, setReqs] = useState<ReqRow[]>([]);
  const [eqMap, setEqMap] = useState<Record<string, string>>({});
  const [clientMap, setClientMap] = useState<Record<string, string>>({});
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");

  const load = async () => {
    const [{ data: m }, { data: r }, { data: eq }, { data: c }, { data: p }] = await Promise.all([
      supabase.from("movements").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("equipment_requests").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("equipment").select("id,identifier"),
      supabase.from("clients").select("id,name"),
      supabase.from("profiles").select("id,full_name,email"),
    ]);
    setMovs((m ?? []) as Movement[]);
    setReqs((r ?? []) as ReqRow[]);
    const em: Record<string, string> = {}; (eq ?? []).forEach((x: any) => { em[x.id] = x.identifier; });
    const cm: Record<string, string> = {}; (c ?? []).forEach((x: any) => { cm[x.id] = x.name; });
    const pm: Record<string, string> = {}; (p ?? []).forEach((x: any) => { pm[x.id] = x.full_name || x.email || x.id.slice(0, 8); });
    setEqMap(em); setClientMap(cm); setProfileMap(pm);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("hist-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "movements" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment_requests" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const f = filter.toLowerCase().trim();
  const filteredMovs = useMemo(() => movs.filter(m => !f
    || (eqMap[m.equipment_id] ?? "").toLowerCase().includes(f)
    || (clientMap[m.to_client_id ?? ""] ?? "").toLowerCase().includes(f)
    || (clientMap[m.from_client_id ?? ""] ?? "").toLowerCase().includes(f)
  ), [movs, f, eqMap, clientMap]);

  const filteredReqs = useMemo(() => reqs.filter(r => !f
    || (eqMap[r.equipment_id] ?? "").toLowerCase().includes(f)
    || (clientMap[r.client_id] ?? "").toLowerCase().includes(f)
    || (r.replacement_plate ?? "").toLowerCase().includes(f)
  ), [reqs, f, eqMap, clientMap]);

  const exportCSV = (rows: string[][], filename: string) => {
    const csv = rows.map(r => r.map(c => `"${(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <History className="h-7 w-7 text-primary" />Histórico
          </h1>
          <p className="text-muted-foreground">Todas as movimentações e solicitações</p>
        </div>
        <Input placeholder="Filtrar por equipamento, cliente ou placa..." value={filter}
          onChange={(e) => setFilter(e.target.value)} className="max-w-sm" />
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Movimentações ({filteredMovs.length})</h2>
          <button onClick={() => exportCSV(
            [["Data/Hora", "Equipamento", "De", "Para", "Cliente origem", "Cliente destino"],
              ...filteredMovs.map(m => [
                format(new Date(m.created_at), "dd/MM/yyyy HH:mm:ss"),
                eqMap[m.equipment_id] ?? "",
                m.from_status ? STATUS_LABELS[m.from_status] : "",
                STATUS_LABELS[m.to_status],
                m.from_client_id ? (clientMap[m.from_client_id] ?? "") : "",
                m.to_client_id ? (clientMap[m.to_client_id] ?? "") : "",
              ])],
            `movimentacoes_${format(new Date(), "yyyy-MM-dd")}.csv`)}
            className="text-xs underline text-muted-foreground hover:text-foreground">
            Exportar CSV
          </button>
        </div>
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Data/Hora</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>De</TableHead>
                <TableHead>Para</TableHead>
                <TableHead>Cliente origem</TableHead>
                <TableHead>Cliente destino</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMovs.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem registros.</TableCell></TableRow>
              ) : filteredMovs.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{format(new Date(m.created_at), "dd/MM/yyyy HH:mm:ss")}</TableCell>
                  <TableCell className="font-mono">{eqMap[m.equipment_id] ?? "—"}</TableCell>
                  <TableCell>{m.from_status ? STATUS_LABELS[m.from_status] : <span className="text-muted-foreground italic text-xs">cadastro</span>}</TableCell>
                  <TableCell>{STATUS_LABELS[m.to_status]}</TableCell>
                  <TableCell>{m.from_client_id ? (clientMap[m.from_client_id] ?? "—") : "—"}</TableCell>
                  <TableCell>{m.to_client_id ? (clientMap[m.to_client_id] ?? "—") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Solicitações ({filteredReqs.length})</h2>
          <button onClick={() => exportCSV(
            [["Data", "Equipamento", "Cliente", "Status", "Solicitante", "Substituição", "Placa substituída", "Motivo", "Observação"],
              ...filteredReqs.map(r => [
                format(new Date(r.created_at), "dd/MM/yyyy HH:mm:ss"),
                eqMap[r.equipment_id] ?? "", clientMap[r.client_id] ?? "", r.status,
                profileMap[r.requested_by] ?? "",
                r.is_replacement ? "Sim" : "Não",
                r.replacement_plate ?? "", r.replacement_reason ?? "", r.notes ?? "",
              ])],
            `solicitacoes_${format(new Date(), "yyyy-MM-dd")}.csv`)}
            className="text-xs underline text-muted-foreground hover:text-foreground">
            Exportar CSV
          </button>
        </div>
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Data</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Solicitante</TableHead>
                <TableHead>Subst.</TableHead>
                <TableHead>Placa subst.</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReqs.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Sem solicitações.</TableCell></TableRow>
              ) : filteredReqs.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{format(new Date(r.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                  <TableCell className="font-mono">{eqMap[r.equipment_id] ?? "—"}</TableCell>
                  <TableCell>{clientMap[r.client_id] ?? "—"}</TableCell>
                  <TableCell>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      r.status === "aprovado" ? "bg-[oklch(0.65_0.18_150)]/15 text-[oklch(0.45_0.18_150)]"
                        : r.status === "rejeitado" ? "bg-[oklch(0.65_0.2_30)]/15 text-[oklch(0.5_0.2_30)]"
                        : "bg-[oklch(0.65_0.2_50)]/15 text-[oklch(0.5_0.2_50)]"
                    }`}>{r.status}</span>
                  </TableCell>
                  <TableCell className="text-xs">{profileMap[r.requested_by] ?? "—"}</TableCell>
                  <TableCell>{r.is_replacement ? "Sim" : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.replacement_plate ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-[240px] truncate" title={r.replacement_reason ?? ""}>{r.replacement_reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}