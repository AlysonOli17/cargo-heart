import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { 
  Wrench, 
  CheckCircle2, 
  ArrowRightLeft,
  Inbox,
  Move,
  Anchor,
  Activity,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Clock,
  Calendar,
  AlertTriangle,
  Gauge,
  Hash,
  Info,
  User,
  ShieldAlert,
  Truck,
  Layers,
  Filter
} from "lucide-react";

export const Route = createFileRoute("/fidelizacao")({
  head: () => ({ meta: [{ title: "Fidelização Kanban — Controle de Frota" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string;
  identifier: string;
  type: string | null;
  brand: string | null;
  model: string | null;
  status: string;
  contract_type: string | null;
  notes: string | null;
  owner_id: string;
  current_client_id: string | null;
  maintenance_started_at: string | null;
  maintenance_expected_return: string | null;
  maintenance_problem: string | null;
  hour_meter: number | null;
  serial_number: string | null;
  year: number | null;
  maintenance_priority: string | null;
  maintenance_responsible: string | null;
  maintenance_type: string | null;
  te_tag?: string;
  implement_type?: string;
  capacity?: string;
  description?: string;
};

type Contract = {
  id: string;
  name: string;
};

const getTypeColors = (type: string) => {
  const normalized = type.toUpperCase().trim();
  if (normalized.includes("PENEIRA") && normalized.includes("MALHA")) {
    return {
      header: "bg-blue-50/70 border-blue-200/50 hover:bg-blue-50 text-blue-700",
      folder: "text-blue-500",
      badge: "bg-blue-100 text-blue-800",
      tag: "bg-blue-50 text-blue-700 border-blue-100",
      borderColor: "border-blue-500"
    };
  }
  if (normalized.includes("PENEIRA") && normalized.includes("ROTATIVA")) {
    return {
      header: "bg-indigo-50/70 border-indigo-200/50 hover:bg-indigo-50 text-indigo-700",
      folder: "text-indigo-500",
      badge: "bg-indigo-100 text-indigo-800",
      tag: "bg-indigo-50 text-indigo-700 border-indigo-100",
      borderColor: "border-indigo-500"
    };
  }
  if (normalized.includes("CARREGADEIRA")) {
    return {
      header: "bg-emerald-50/70 border-emerald-200/50 hover:bg-emerald-50 text-emerald-700",
      folder: "text-emerald-500",
      badge: "bg-emerald-100 text-emerald-800",
      tag: "bg-emerald-50 text-emerald-700 border-emerald-100",
      borderColor: "border-emerald-500"
    };
  }
  if (normalized.includes("ESCAVADEIRA")) {
    return {
      header: "bg-purple-50/70 border-purple-200/50 hover:bg-purple-50 text-purple-700",
      folder: "text-purple-500",
      badge: "bg-purple-100 text-purple-800",
      tag: "bg-purple-50 text-purple-700 border-purple-100",
      borderColor: "border-purple-500"
    };
  }
  if (normalized.includes("CAMINHÃO")) {
    return {
      header: "bg-amber-50/70 border-amber-200/50 hover:bg-amber-50 text-amber-700",
      folder: "text-amber-500",
      badge: "bg-amber-100 text-amber-800",
      tag: "bg-amber-50 text-amber-700 border-amber-100",
      borderColor: "border-amber-500"
    };
  }
  
  const palette = [
    { header: "bg-teal-50/70 border-teal-200/50 text-teal-700 hover:bg-teal-50", folder: "text-teal-500", badge: "bg-teal-100 text-teal-800", tag: "bg-teal-50 text-teal-700 border-teal-100", borderColor: "border-teal-500" },
    { header: "bg-pink-50/70 border-pink-200/50 text-pink-700 hover:bg-pink-50", folder: "text-pink-500", badge: "bg-pink-100 text-pink-800", tag: "bg-pink-50 text-pink-700 border-pink-100", borderColor: "border-pink-500" },
    { header: "bg-rose-50/70 border-rose-200/50 text-rose-700 hover:bg-rose-50", folder: "text-rose-500", badge: "bg-rose-100 text-rose-800", tag: "bg-rose-50 text-rose-700 border-rose-100", borderColor: "border-rose-500" },
    { header: "bg-cyan-50/70 border-cyan-200/50 text-cyan-700 hover:bg-cyan-50", folder: "text-cyan-500", badge: "bg-cyan-100 text-cyan-800", tag: "bg-cyan-50 text-cyan-700 border-cyan-100", borderColor: "border-cyan-500" }
  ];
  let sum = 0;
  for (let i = 0; i < normalized.length; i++) sum += normalized.charCodeAt(i);
  return palette[sum % palette.length];
};

function Dashboard() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [movingEq, setMovingEq] = useState<Equipment | null>(null);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const loadData = async () => {
    try {
      const [{ data: eqs, error: eqErr }, { data: cons, error: conErr }] = await Promise.all([
        supabase
          .from("equipment")
          .select("id, identifier, type, brand, model, status, contract_type, notes, owner_id, current_client_id, maintenance_started_at, maintenance_expected_return, maintenance_problem, hour_meter, serial_number, year, maintenance_priority, maintenance_responsible, maintenance_type")
          .order("identifier"),
        supabase.from("clients").select("id, name").order("name")
      ]);

      if (eqErr) throw eqErr;
      if (conErr) throw conErr;

      const parsed = (eqs ?? []).map((eq: any) => {
        let te_tag = "";
        let implement_type = "";
        let capacity = "";
        let description = "";
        
        try {
          if (eq.notes && (eq.notes.startsWith("{") || eq.notes.startsWith("["))) {
            const parsedNotes = JSON.parse(eq.notes);
            te_tag = parsedNotes.te_tag || "";
            implement_type = parsedNotes.implement_type || "";
            capacity = parsedNotes.capacity || "";
            description = parsedNotes.description || "";
          }
        } catch (_) {}
        
        return {
          ...eq,
          te_tag,
          implement_type,
          capacity,
          description
        };
      });

      setEquipment(parsed);
      setContracts(cons || []);
    } catch (e) {
      toast.error("Erro ao carregar dados do banco.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const ch = supabase.channel("fidelizacao-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, loadData)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleMove = async (eq: Equipment, destColumn: 'reservas' | 'usina' | 'porto' | 'oficina') => {
    let status = eq.status;
    let contract_type = eq.contract_type;
    let notes = eq.notes || "";
    let maintenance_started_at = eq.maintenance_started_at;
    let maintenance_expected_return = eq.maintenance_expected_return;

    if (destColumn === 'reservas') {
      status = "disponivel";
      contract_type = "Eventual";
      notes = "Movido para Reserva Disponíveis";
      maintenance_started_at = null;
      maintenance_expected_return = null;
    } else if (destColumn === 'usina') {
      status = "operacional";
      contract_type = "Usina";
      notes = "Fidelizado em Usina Habitual";
      maintenance_started_at = null;
      maintenance_expected_return = null;
    } else if (destColumn === 'porto') {
      status = "operacional";
      contract_type = "Porto";
      notes = "Fidelizado em Porto Habitual";
      maintenance_started_at = null;
      maintenance_expected_return = null;
    } else if (destColumn === 'oficina') {
      status = "manutencao";
      notes = "Entrada em Manutenção / Oficina";
      maintenance_started_at = new Date().toISOString();
      maintenance_expected_return = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    }

    try {
      const { error } = await supabase
        .from("equipment")
        .update({
          status,
          contract_type,
          notes,
          maintenance_started_at,
          maintenance_expected_return,
          updated_at: new Date().toISOString()
        })
        .eq("id", eq.id);

      if (error) throw error;

      await supabase.from("movements").insert({
        equipment_id: eq.id,
        to_status: status,
        notes: notes,
        owner_id: eq.owner_id
      });

      toast.success(`${eq.identifier} movido com sucesso!`);
      setMovingEq(null);
      loadData();
    } catch (err: any) {
      toast.error("Erro ao atualizar no banco: " + err.message);
    }
  };

  const toggleGroup = (columnKey: string, type: string) => {
    const key = `${columnKey}-${type}`;
    setCollapsedGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const isMaintenance = (status: string) => status === "manutencao" || status === "indisponivel";
  
  const colReservas = equipment.filter(e => !isMaintenance(e.status) && (e.status === "disponivel" || (e.contract_type !== "Usina" && e.contract_type !== "Porto" && e.status !== "com_cliente")));
  const colUsina = equipment.filter(e => !isMaintenance(e.status) && e.contract_type === "Usina" && e.status !== "disponivel");
  const colPorto = equipment.filter(e => !isMaintenance(e.status) && e.contract_type === "Porto" && e.status !== "disponivel");
  const colOficina = equipment.filter(e => isMaintenance(e.status));

  const groupByType = (eqList: Equipment[]) => {
    const groups: Record<string, Equipment[]> = {};
    eqList.forEach(e => {
      const type = e.type || "OUTROS";
      if (!groups[type]) groups[type] = [];
      groups[type].push(e);
    });
    return groups;
  };

  const contractMap = new Map(contracts.map(c => [c.id, c.name]));
  const oficinaGrouped = groupByType(colOficina);
  const oficinaTypes = Object.keys(oficinaGrouped).sort();

  return (
    <div className="space-y-6 animate-in fade-in duration-500 flex flex-col min-h-[calc(100vh-10rem)]">
      
      {/* 3 columns in evidence: USINA, PORTO, and RESERVA DISPONIVEIS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        
        {/* COLUMN 1: USINA HABITUAL */}
        <KanbanColumn 
          title="USINA HABITUAL" 
          badgeColor="bg-indigo-100 text-indigo-700" 
          count={colUsina.length}
          borderColor="border-indigo-500"
          headerBg="bg-indigo-50/30"
        >
          <GroupedList 
            columnKey="usina"
            groupedEq={groupByType(colUsina)}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            contractMap={contractMap}
            onMoveClick={setMovingEq}
          />
        </KanbanColumn>

        {/* COLUMN 2: PORTO HABITUAL */}
        <KanbanColumn 
          title="PORTO HABITUAL" 
          badgeColor="bg-emerald-100 text-emerald-700" 
          count={colPorto.length}
          borderColor="border-emerald-500"
          headerBg="bg-emerald-50/30"
        >
          <GroupedList 
            columnKey="porto"
            groupedEq={groupByType(colPorto)}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            contractMap={contractMap}
            onMoveClick={setMovingEq}
          />
        </KanbanColumn>

        {/* COLUMN 3: RESERVA DISPONIVEIS */}
        <KanbanColumn 
          title="RESERVA DISPONIVEIS" 
          badgeColor="bg-sky-100 text-sky-700" 
          count={colReservas.length}
          borderColor="border-sky-500"
          headerBg="bg-sky-50/50"
        >
          <GroupedList 
            columnKey="reservas"
            groupedEq={groupByType(colReservas)}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            contractMap={contractMap}
            onMoveClick={setMovingEq}
          />
        </KanbanColumn>

      </div>

      {/* Grid of 3 columns for OFICINA / MANUTENÇÃO */}
      <div className="border border-slate-200 rounded-2xl bg-white shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 bg-rose-50/40 border-b border-rose-100 flex items-center justify-between border-t-4 border-rose-500">
          <h3 className="font-extrabold text-xs text-slate-900 tracking-tight leading-none flex items-center gap-2">
            <Wrench className="h-4 w-4 text-rose-500" />
            OFICINA / MANUTENÇÃO
          </h3>
          <Badge className="bg-rose-100 text-rose-700 font-bold border-none text-[10px]">{colOficina.length}</Badge>
        </div>
        
        <div className="p-4 bg-slate-50/30">
          {colOficina.length === 0 ? (
            <div className="w-full border border-dashed border-slate-200 rounded-xl p-8 text-center text-slate-400">
              Nenhum equipamento em manutenção.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
              {oficinaTypes.map(type => {
                const list = oficinaGrouped[type];
                const colors = getTypeColors(type);
                return (
                  <div key={type} className="w-full flex flex-col border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
                    <div className={`p-3 border-b flex items-center justify-between border-t-4 ${colors.borderColor} ${colors.header}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderOpen className={`h-4 w-4 flex-shrink-0 ${colors.folder}`} />
                        <span className="font-extrabold text-[10px] tracking-tight uppercase truncate">{type}</span>
                      </div>
                      <Badge className={`${colors.badge} font-bold border-none text-[9px]`}>{list.length}</Badge>
                    </div>
                    <div className="p-2.5 space-y-2 bg-slate-50/50 max-h-[500px] overflow-y-auto scrollbar-thin">
                      {list.map(eq => (
                        <EquipmentCard 
                          key={eq.id}
                          eq={eq}
                          colors={colors}
                          contractMap={contractMap}
                          onMoveClick={setMovingEq}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Move Dialog Modal */}
      {movingEq && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Move className="h-5 w-5 text-indigo-600" />
                Mover Equipamento
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Selecione o destino para <strong className="text-slate-950 font-mono">{movingEq.identifier}</strong>
              </p>
            </div>
            <CardContent className="p-4 space-y-2">
              <button 
                onClick={() => handleMove(movingEq, 'reservas')}
                className="w-full text-left p-3 rounded-xl border border-sky-100 bg-sky-50/30 hover:bg-sky-50 text-sky-800 font-semibold text-xs transition-colors flex items-center justify-between"
              >
                <span>Mover para RESERVA DISPONIVEIS</span>
                <CheckCircle2 className="h-4 w-4 text-sky-500" />
              </button>

              <button 
                onClick={() => handleMove(movingEq, 'usina')}
                className="w-full text-left p-3 rounded-xl border border-indigo-100 bg-indigo-50/30 hover:bg-indigo-50 text-indigo-800 font-semibold text-xs transition-colors flex items-center justify-between"
              >
                <span>Mover para USINA HABITUAL</span>
                <Activity className="h-4 w-4 text-indigo-500" />
              </button>

              <button 
                onClick={() => handleMove(movingEq, 'porto')}
                className="w-full text-left p-3 rounded-xl border border-emerald-100 bg-emerald-50/30 hover:bg-emerald-50 text-emerald-800 font-semibold text-xs transition-colors flex items-center justify-between"
              >
                <span>Mover para PORTO HABITUAL</span>
                <Anchor className="h-4 w-4 text-emerald-500" />
              </button>

              <button 
                onClick={() => handleMove(movingEq, 'oficina')}
                className="w-full text-left p-3 rounded-xl border border-rose-100 bg-rose-50/30 hover:bg-rose-50 text-rose-800 font-semibold text-xs transition-colors flex items-center justify-between"
              >
                <span>Mover para OFICINA / MANUTENÇÃO</span>
                <Wrench className="h-4 w-4 text-rose-500" />
              </button>

              <Button 
                variant="ghost" 
                onClick={() => setMovingEq(null)}
                className="w-full border border-slate-200 rounded-xl h-10 text-xs font-bold text-slate-600 mt-2"
              >
                Cancelar
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}

function KanbanColumn({ title, count, badgeColor, borderColor, headerBg, children }: {
  title: string;
  count: number;
  badgeColor: string;
  borderColor: string;
  headerBg: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="w-full flex flex-col max-h-full border border-slate-200 rounded-2xl bg-white shadow-sm overflow-hidden">
      <div className={`p-4 border-b ${headerBg} flex items-center justify-between flex-shrink-0 border-t-4 ${borderColor}`}>
        <h3 className="font-extrabold text-xs text-slate-900 tracking-tight leading-none truncate max-w-[200px]" title={title}>{title}</h3>
        <Badge className={`${badgeColor} font-bold border-none text-[10px]`}>{count}</Badge>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-slate-50/50 max-h-[calc(100vh-22rem)] min-h-[300px] scrollbar-thin">
        {children}
      </div>
    </Card>
  );
}

const getEquipmentIcon = (type: string | null) => {
  const norm = (type || "").toUpperCase().trim();
  if (norm.includes("CAMINHÃO")) return Truck;
  if (norm.includes("CARREGADEIRA")) return Layers;
  if (norm.includes("PENEIRA")) return Filter;
  if (norm.includes("ESCAVADEIRA")) return Wrench;
  return Wrench; // default fallback icon
};

function EquipmentBadge({ eq, onMoveClick }: {
  eq: Equipment;
  onMoveClick: (eq: Equipment) => void;
}) {
  const details = [
    eq.te_tag ? `TAG: ${eq.te_tag}` : null,
    eq.capacity ? `CAP: ${eq.capacity}` : null,
    eq.type ? `TIPO: ${eq.type}` : null,
    eq.brand ? `FAB: ${eq.brand}` : null,
    eq.model ? `MOD: ${eq.model}` : null
  ].filter(Boolean).join(" | ");
  
  return (
    <button 
      onClick={() => onMoveClick(eq)}
      className="relative flex items-center justify-center px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600 shadow-sm transition-all duration-200 cursor-pointer font-mono font-black text-[10px] text-slate-700 group"
      title={details}
    >
      {eq.identifier}
      
      {/* Premium custom tooltip styled badge */}
      {details && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex bg-slate-900 text-white text-[9px] font-sans py-0.5 px-1.5 rounded shadow-md whitespace-nowrap z-50 pointer-events-none">
          {details}
        </span>
      )}
    </button>
  );
}

function GroupedList({ 
  columnKey, 
  groupedEq, 
  collapsedGroups, 
  onToggleGroup, 
  contractMap,
  onMoveClick 
}: {
  columnKey: string;
  groupedEq: Record<string, Equipment[]>;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (colKey: string, type: string) => void;
  contractMap: Map<string, string>;
  onMoveClick: (eq: Equipment) => void;
}) {
  const types = Object.keys(groupedEq).sort();

  if (types.length === 0) {
    return <EmptyColumnState message="Nenhum equipamento" />;
  }

  return (
    <div className="space-y-3">
      {types.map(type => {
        const list = groupedEq[type];
        const isCollapsed = !!collapsedGroups[`${columnKey}-${type}`];
        const colors = getTypeColors(type);

        return (
          <div key={type} className={`space-y-1.5 border border-slate-100 rounded-xl bg-white overflow-hidden shadow-sm`}>
            <button 
              onClick={() => onToggleGroup(columnKey, type)}
              className={`w-full flex items-center justify-between p-2.5 border-b border-slate-100/50 transition-colors text-left ${colors.header}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen className={`h-4 w-4 flex-shrink-0 ${colors.folder}`} />
                <span className="font-extrabold text-[10px] tracking-tight uppercase truncate">{type}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${colors.badge}`}>
                  {list.length}
                </span>
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </div>
            </button>

            {!isCollapsed && (
              <div className="p-3 flex flex-wrap gap-2 bg-slate-50/10">
                {list.map(eq => (
                  <EquipmentBadge 
                    key={eq.id}
                    eq={eq}
                    onMoveClick={onMoveClick}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EquipmentCard({ eq, colors, contractMap, onMoveClick }: { 
  eq: Equipment; 
  colors: ReturnType<typeof getTypeColors>;
  contractMap: Map<string, string>;
  onMoveClick: (eq: Equipment) => void;
}) {
  const isMaintenanceStatus = eq.status === "manutencao" || eq.status === "indisponivel";
  
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  const calculateDaysStopped = (startStr: string | null) => {
    if (!startStr) return { text: "Entrou hoje", days: 0 };
    const start = new Date(startStr);
    const now = new Date();
    const diff = now.getTime() - start.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    return {
      text: days <= 0 ? "Entrou hoje" : `Parado há ${days} dia(s)`,
      days: Math.max(0, days)
    };
  };

  const resolvedContractName = eq.current_client_id 
    ? contractMap.get(eq.current_client_id) 
    : eq.contract_type;

  const stoppedInfo = calculateDaysStopped(eq.maintenance_started_at);
  const isOverdue = stoppedInfo.days >= 5;

  return (
    <Card className={`border border-slate-100 hover:border-slate-200 rounded-xl p-2.5 shadow-sm hover:shadow transition-all bg-white duration-200 relative group ${isMaintenanceStatus && isOverdue ? 'ring-1 ring-red-200 bg-red-50/10' : ''}`}>
      <div className="space-y-1.5">
        <div className="flex justify-between items-start gap-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h4 className="font-mono font-black text-xs text-slate-900 leading-none">{eq.identifier}</h4>
              {isMaintenanceStatus && eq.maintenance_priority === "Crítica" && (
                <span className="text-[7px] bg-red-100 text-red-700 border border-red-200 px-1 py-0.2 rounded font-black uppercase animate-pulse flex items-center gap-0.5 leading-none">
                  <ShieldAlert className="h-2 w-2" /> CRÍTICA
                </span>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {eq.type && (
                <span className={`text-[7.5px] font-extrabold uppercase border px-1 py-0.2 rounded w-max leading-none ${colors.tag}`}>
                  {eq.type}
                </span>
              )}
              {resolvedContractName && resolvedContractName !== "Eventual" && (
                <span className="text-[7.5px] bg-slate-100 text-slate-600 border border-slate-200 px-1 py-0.2 rounded font-bold uppercase truncate max-w-[100px] leading-none" title={resolvedContractName}>
                  {resolvedContractName}
                </span>
              )}
              {isMaintenanceStatus && eq.maintenance_type && (
                <span className="text-[7.5px] bg-rose-50 text-rose-700 border border-rose-100 px-1 py-0.2 rounded font-bold uppercase leading-none">
                  {eq.maintenance_type}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Basic Brand / Model / Year Details */}
        {(eq.brand || eq.model || eq.year) && (
          <p className="text-[9.5px] text-slate-500 font-semibold leading-none">
            {[eq.brand, eq.model].filter(Boolean).join(" ")}
            {eq.year ? ` (${eq.year})` : ""}
          </p>
        )}

        {/* Excel Import Details */}
        {(eq.te_tag || eq.capacity || eq.description) && (
          <div className="text-[8.5px] text-slate-400 font-semibold space-y-0.5 leading-tight pt-0.5">
            {eq.te_tag && (
              <div>TE+TAG: <strong className="text-slate-600 font-black">{eq.te_tag}</strong></div>
            )}
            {eq.capacity && (
              <div>CAPACIDADE: <strong className="text-slate-600 font-black">{eq.capacity}</strong></div>
            )}
            {eq.description && (
              <div className="text-slate-500 italic">"{eq.description}"</div>
            )}
          </div>
        )}

        {/* Hour Meter & Serial Number & Responsible Details */}
        {(eq.hour_meter || eq.serial_number || (isMaintenanceStatus && eq.maintenance_responsible)) && (
          <div className="text-[8.5px] text-slate-400 font-semibold flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-none">
            {eq.hour_meter && (
              <span className="flex items-center gap-0.5">
                <Gauge className="h-2.5 w-2.5 text-slate-400" />
                <strong className="text-slate-600 font-bold">{eq.hour_meter}h</strong>
              </span>
            )}
            {eq.hour_meter && (eq.serial_number || eq.maintenance_responsible) && <span>•</span>}
            {eq.serial_number && (
              <span className="flex items-center gap-0.5">
                <Hash className="h-2.5 w-2.5 text-slate-400" />
                <strong className="text-slate-600 font-bold uppercase truncate max-w-[60px]">{eq.serial_number}</strong>
              </span>
            )}
            {eq.serial_number && eq.maintenance_responsible && <span>•</span>}
            {isMaintenanceStatus && eq.maintenance_responsible && (
              <span className="flex items-center gap-0.5 text-slate-500">
                <User className="h-2.5 w-2.5 text-indigo-500" />
                <strong className="text-slate-600 font-bold truncate max-w-[80px]">{eq.maintenance_responsible}</strong>
              </span>
            )}
          </div>
        )}

        {/* Maintenance specific layout */}
        {isMaintenanceStatus && (
          <div className="space-y-1.5 pt-0.5">
            {/* Defect / Problem Description */}
            {eq.maintenance_problem && (
              <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-1.5 text-[8.5px] text-amber-800 flex items-start gap-1 font-medium leading-normal">
                <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="line-clamp-2 whitespace-pre-wrap">{eq.maintenance_problem}</span>
                </div>
              </div>
            )}

            {/* Timings */}
            <div className={`border rounded-lg p-1.5 text-[8.5px] font-semibold space-y-0.5 ${isOverdue ? 'bg-red-50/70 border-red-200 text-red-950' : 'bg-rose-50/50 border-rose-100 text-rose-800'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                {eq.maintenance_started_at && (
                  <div className="flex items-center gap-0.5">
                    <Clock className={`h-2.5 w-2.5 ${isOverdue ? 'text-red-500' : 'text-rose-500'}`} />
                    <span>Entrada: <strong className="font-bold">{formatDate(eq.maintenance_started_at)}</strong></span>
                  </div>
                )}
                {eq.maintenance_expected_return && (
                  <div className="flex items-center gap-0.5">
                    <Calendar className={`h-2.5 w-2.5 ${isOverdue ? 'text-red-500' : 'text-rose-500'}`} />
                    <span>Previsão: <strong className="font-bold">{formatDate(eq.maintenance_expected_return)}</strong></span>
                  </div>
                )}
              </div>
              {eq.maintenance_started_at && (
                <div className={`flex items-center justify-between pt-1 border-t text-[8px] uppercase font-black ${isOverdue ? 'border-red-200 text-red-700' : 'border-rose-100/50 text-rose-600'}`}>
                  <span>Tempo Parado:</span>
                  <span className="flex items-center gap-0.5">
                    {isOverdue && <ShieldAlert className="h-2 w-2 text-red-600 animate-bounce" />}
                    {stoppedInfo.text}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {eq.notes && !isMaintenanceStatus && (
          <p className="text-[8.5px] text-slate-400 italic line-clamp-1">
            "{eq.notes}"
          </p>
        )}

        <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[8px] text-slate-400 font-bold uppercase">
            {eq.status === "com_cliente" ? "Fidelizado" : eq.status === "manutencao" ? "Oficina" : "Livre"}
          </span>
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => onMoveClick(eq)}
            className="h-5 text-[8.5px] font-black border-indigo-100 hover:border-indigo-300 text-indigo-600 hover:bg-indigo-50 rounded-md px-1.5 py-0 flex items-center gap-0.5"
          >
            <ArrowRightLeft className="h-2.5 w-2.5" />
            Mover
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EmptyColumnState({ message }: { message: string }) {
  return (
    <div className="border border-dashed border-slate-200 rounded-xl p-4 text-center text-slate-400 flex flex-col items-center justify-center">
      <Inbox className="h-5 w-5 mb-1 text-slate-300" />
      <span className="text-[9px] font-semibold">{message}</span>
    </div>
  );
}
