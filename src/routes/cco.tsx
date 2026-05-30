import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { 
  LayoutDashboard, 
  Truck, 
  Wrench, 
  User, 
  Calendar, 
  AlertTriangle, 
  Activity, 
  CheckCircle2, 
  Hourglass, 
  Plus, 
  Trash2, 
  MapPin, 
  Clock, 
  FolderSync 
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/cco")({
  head: () => ({ meta: [{ title: "CCO Centro de Controle Operacional — Frota Busato" }] }),
  component: () => <AppLayout><CCOPage /></AppLayout>,
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
  maintenance_expected_return: string | null;
  maintenance_problem: string | null;
  te_tag?: string;
  implement_type?: string;
};

type Allocation = {
  id: string;
  scheduled_date: string;
  equipment_id: string;
  operator_name: string;
  service_front: string;
  shift: string;
  notes: string | null;
};

type Programming = {
  id: string;
  scheduled_date: string;
  stop_type: string;
  notes: string | null;
  equipment_id: string;
};

function CCOPage() {
  const { user } = useAuth();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [programming, setProgramming] = useState<Programming[]>([]);
  const [usinaSchedules, setUsinaSchedules] = useState<any[]>([]);
  const [correctiveLogs, setCorrectiveLogs] = useState<any[]>([]);
  
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [activeTab, setActiveTab] = useState("atendimento"); // Default to Atendimento Diário dashboard
  const [localFilter, setLocalFilter] = useState("Todos");
  const [contractFilter, setContractFilter] = useState("Todos");
  const [drillDownContract, setDrillDownContract] = useState<string | null>(null);
  const [selectedDashboardContract, setSelectedDashboardContract] = useState<string | null>(null);
  
  // States for new allocation dialog
  const [newAllocOpen, setNewAllocOpen] = useState(false);
  const [allocEqId, setAllocEqId] = useState("");
  const [allocOperator, setAllocOperator] = useState("");
  const [allocFront, setAllocFront] = useState("");
  const [allocShift, setAllocShift] = useState("12 HORAS (Dia)");
  const [allocNotes, setAllocNotes] = useState("");

  // States for Agendar Parada (moved from CCM Manutenção)
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedEqId, setSchedEqId] = useState("");
  const [schedDate, setSchedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [schedStopType, setSchedStopType] = useState("Manutenção Geral");
  const [schedNotes, setSchedNotes] = useState("");

  const loadData = async () => {
    // 1. Carrega equipamentos de forma independente
    try {
      const { data: eqs } = await supabase.from("equipment").select("*").order("identifier");
      const parsedEqs = (eqs ?? []).map((eq: any) => {
        let te_tag = "";
        let implement_type = "";
        try {
          if (eq.notes && (eq.notes.startsWith("{") || eq.notes.startsWith("["))) {
            const parsedNotes = JSON.parse(eq.notes);
            te_tag = parsedNotes.te_tag || "";
            implement_type = parsedNotes.implement_type || "";
          }
        } catch (_) {}
        return { ...eq, te_tag, implement_type };
      });
      setEquipment(parsedEqs);
      localStorage.setItem("local_equipment", JSON.stringify(parsedEqs));
    } catch (_) {
      const localEqs = JSON.parse(localStorage.getItem("local_equipment") || "[]");
      setEquipment(localEqs);
    }

    // 2. Carrega alocações do CCO
    try {
      const { data: allocs, error: eAlloc } = await supabase.from("cco_allocations").select("*").eq("scheduled_date", selectedDate);
      if (eAlloc) throw eAlloc;
      setAllocations((allocs ?? []) as Allocation[]);
    } catch (_) {
      const localAllocs = JSON.parse(localStorage.getItem("local_cco_allocations") || "[]");
      setAllocations(localAllocs.filter((a: any) => a.scheduled_date === selectedDate));
    }

    // 3. Carrega programações CCM
    try {
      const { data: progs, error: eProg } = await supabase.from("programming").select("*").eq("is_completed", false);
      if (eProg) throw eProg;
      setProgramming((progs ?? []) as Programming[]);
    } catch (_) {}

    // 4. Carrega escalas Usina — busca data real E templates (2000-01-0x)
    try {
      let { data: scheds, error: eSched } = await supabase
        .from("usina_daily_schedules")
        .select("*")
        .or(`scheduled_date.eq.${selectedDate},and(scheduled_date.gte.2000-01-02,scheduled_date.lte.2000-01-08)`);
      if (eSched) throw eSched;

      const dayScheds = (scheds ?? []).filter((s: any) => s.scheduled_date === selectedDate);

      if (dayScheds.length === 0) {
        // Clone template for selectedDate's day of week
        const selectedDayOfWeek = new Date(selectedDate + "T12:00:00").getDay();
        const templateDateStr = format(addDays(new Date("2000-01-02T12:00:00"), selectedDayOfWeek), "yyyy-MM-dd");
        const templatesForDay = (scheds ?? []).filter((s: any) => s.scheduled_date === templateDateStr);

        if (templatesForDay.length > 0) {
          const clones = templatesForDay.map((t: any) => ({
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
          if (eInsert) throw eInsert;

          if (inserted) {
            scheds = [...(scheds ?? []).filter((s: any) => s.scheduled_date === selectedDate), ...inserted];
          }
        }
      }

      const finalScheds = (scheds ?? []).filter((s: any) => s.scheduled_date === selectedDate);
      setUsinaSchedules(finalScheds);

      // Merge with local storage instead of overwriting other dates
      const localScheds = JSON.parse(localStorage.getItem("local_usina_schedules") || "[]");
      const otherDatesScheds = localScheds.filter((s: any) => s.scheduled_date !== selectedDate);
      const merged = [...otherDatesScheds, ...finalScheds];
      localStorage.setItem("local_usina_schedules", JSON.stringify(merged));
    } catch (_) {
      const localScheds = JSON.parse(localStorage.getItem("local_usina_schedules") || "[]");
      setUsinaSchedules(localScheds.filter((s: any) => s.scheduled_date === selectedDate));
    }

    // 5. Carrega logs de paradas
    try {
      const { data: logs, error: eLogs } = await supabase.from("usina_corrective_logs").select("*");
      if (eLogs) throw eLogs;
      setCorrectiveLogs(logs ?? []);
      localStorage.setItem("local_usina_corrective_logs", JSON.stringify(logs ?? []));
    } catch (_) {
      const localLogs = JSON.parse(localStorage.getItem("local_usina_corrective_logs") || "[]");
      setCorrectiveLogs(localLogs);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadData();
    const chEq = supabase.channel("cco-eq-rt").on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, loadData).subscribe();
    const chProg = supabase.channel("cco-prog-rt").on("postgres_changes", { event: "*", schema: "public", table: "programming" }, loadData).subscribe();
    const chSched = supabase.channel("cco-sched-rt").on("postgres_changes", { event: "*", schema: "public", table: "usina_daily_schedules" }, loadData).subscribe();
    const chLogs = supabase.channel("cco-logs-rt").on("postgres_changes", { event: "*", schema: "public", table: "usina_corrective_logs" }, loadData).subscribe();
    
    return () => {
      supabase.removeChannel(chEq);
      supabase.removeChannel(chProg);
      supabase.removeChannel(chSched);
      supabase.removeChannel(chLogs);
    };
  }, [user, selectedDate]);

  const handleCreateAllocation = async () => {
    if (!allocEqId || !allocOperator || !allocFront) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    const payload = {
      scheduled_date: selectedDate,
      equipment_id: allocEqId,
      operator_name: allocOperator,
      service_front: allocFront,
      shift: allocShift,
      notes: allocNotes,
      owner_id: user?.id
    };

    try {
      const { error } = await supabase.from("cco_allocations").insert(payload);
      if (error) throw error;
      toast.success("Programação operacional criada!");
      setNewAllocOpen(false);
      setAllocEqId("");
      setAllocOperator("");
      setAllocFront("");
      setAllocNotes("");
      loadData();
    } catch (err: any) {
      // Direct LocalStorage fallback if table is not created in remote schema
      const localAllocs = JSON.parse(localStorage.getItem("local_cco_allocations") || "[]");
      localAllocs.push({ ...payload, id: Math.random().toString(36).substring(2) });
      localStorage.setItem("local_cco_allocations", JSON.stringify(localAllocs));
      
      toast.success("Programação salva localmente (offline)");
      // Force refresh locally
      setAllocations(localAllocs.filter((a: any) => a.scheduled_date === selectedDate));
      setNewAllocOpen(false);
      setAllocEqId("");
      setAllocOperator("");
      setAllocFront("");
      setAllocNotes("");
    }
  };

  const handleDeleteAllocation = async (id: string) => {
    try {
      const { error } = await supabase.from("cco_allocations").delete().eq("id", id);
      if (error) throw error;
      toast.success("Programação operário removida");
      loadData();
    } catch (err) {
      const localAllocs = JSON.parse(localStorage.getItem("local_cco_allocations") || "[]");
      const filtered = localAllocs.filter((a: any) => a.id !== id);
      localStorage.setItem("local_cco_allocations", JSON.stringify(filtered));
      setAllocations(filtered.filter((a: any) => a.scheduled_date === selectedDate));
      toast.success("Removido localmente");
    }
  };

  const handleConfirmSchedule = async () => {
    if (!schedEqId) {
      toast.error("Selecione o equipamento");
      return;
    }
    const { error } = await supabase.from("programming").insert({
      equipment_id: schedEqId,
      scheduled_date: schedDate,
      day_of_week: "Calendário",
      stop_type: schedStopType,
      notes: schedNotes,
      owner_id: user?.id
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Parada agendada com sucesso!");
      setScheduleOpen(false);
      setSchedEqId("");
      setSchedNotes("");
      loadData();
    }
  };

  // D+1 Date helper
  const dateDPlus1 = format(addDays(new Date(selectedDate + "T12:00:00"), 1), "yyyy-MM-dd");

  // Get unavailable list for D+1
  const dPlus1Unavailable = useMemo(() => {
    return equipment.filter(eq => {
      // Find if has program scheduled for D+1 date
      const hasDPlus1Prog = programming.some(p => p.equipment_id === eq.id && p.scheduled_date === dateDPlus1);
      const inOficinaNow = eq.status === "manutencao" || eq.status === "indisponivel";
      return hasDPlus1Prog || inOficinaNow;
    });
  }, [equipment, programming, dateDPlus1]);

  // Grouped active allocations for Usina & Porto
  const usinaAllocations = useMemo(() => {
    return allocations.filter(a => {
      const eq = equipment.find(e => e.id === a.equipment_id);
      return eq?.contract_type === "Usina";
    });
  }, [allocations, equipment]);

  const portoAllocations = useMemo(() => {
    return allocations.filter(a => {
      const eq = equipment.find(e => e.id === a.equipment_id);
      return eq?.contract_type === "Porto";
    });
  }, [allocations, equipment]);

  // Available equipment list
  const availableEqs = useMemo(() => {
    return equipment.filter(eq => {
      const isAllocated = allocations.some(a => a.equipment_id === eq.id);
      const isOficina = eq.status === "manutencao" || eq.status === "indisponivel";
      return !isAllocated && !isOficina;
    });
  }, [equipment, allocations]);

  // Daily Attendance Dashboard computations
  const getScheduleContract = (s: any) => {
    if (s.client) {
      const clientUpper = s.client.trim().toUpperCase();
      if (clientUpper.includes("USINA")) return "USINA";
      if (clientUpper.includes("PORTO")) return "PORTO";
      if (clientUpper.includes("EVENTUAL")) return "EVENTUAL";
    }
    // Fallback to equipment registered contract_type if daily client field is not set
    const sEqClean = s.equipment?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const sPlateClean = s.plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const eq = equipment.find(e => {
      const eIdClean = e.identifier?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const ePlateClean = e.plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      return (sEqClean && eIdClean === sEqClean) || (sPlateClean && ePlateClean === sPlateClean);
    });
    if (eq?.contract_type) {
      const typeUpper = eq.contract_type.trim().toUpperCase();
      if (typeUpper === "USINA" || typeUpper === "PORTO" || typeUpper === "EVENTUAL") {
        return typeUpper;
      }
    }
    return "USINA";
  };

  const filteredScheds = useMemo(() => {
    return usinaSchedules.filter(s => {
      const contractType = getScheduleContract(s);
      const matchesContract = contractFilter === "Todos" || contractType.toLowerCase() === contractFilter.toLowerCase();
      const matchesLocal = localFilter === "Todos" || s.local === localFilter;

      return matchesContract && matchesLocal;
    });
  }, [usinaSchedules, equipment, contractFilter, localFilter]);

  const stats = useMemo(() => {
    const total = filteredScheds.length;
    const naoAtendidos = filteredScheds.filter(s => {
      const activeStops = correctiveLogs.filter(l => l.schedule_id === s.id);
      const isCurrentlyBroken = activeStops.some(l => !l.stop_end);
      return isCurrentlyBroken;
    });
    const atendidos = total - naoAtendidos.length;
    const pct = total > 0 ? Math.round((atendidos / total) * 100) : 100;

    return {
      total,
      atendidos,
      naoAtendidos: naoAtendidos.length,
      naoAtendidosList: naoAtendidos,
      pct
    };
  }, [filteredScheds, correctiveLogs]);

  // Dashboard filtering for Left Gauge
  const dashboardScheds = useMemo(() => {
    return filteredScheds.filter(s => {
      const contractKey = getScheduleContract(s);
      return !selectedDashboardContract || contractKey === selectedDashboardContract.toUpperCase();
    });
  }, [filteredScheds, equipment, selectedDashboardContract]);

  const dashboardStats = useMemo(() => {
    const total = dashboardScheds.length;
    const naoAtendidos = dashboardScheds.filter(s => {
      const activeStops = correctiveLogs.filter(l => l.schedule_id === s.id);
      const isCurrentlyBroken = activeStops.some(l => !l.stop_end);
      return isCurrentlyBroken;
    });
    const atendidos = total - naoAtendidos.length;
    const pct = total > 0 ? Math.round((atendidos / total) * 100) : 100;

    return {
      total,
      atendidos,
      naoAtendidos: naoAtendidos.length,
      naoAtendidosList: naoAtendidos,
      pct
    };
  }, [dashboardScheds, correctiveLogs]);

  const contractStats = useMemo(() => {
    const defaults = ["USINA", "PORTO", "EVENTUAL"];
    const map: Record<string, { total: number, eventuais: number, naoAtendidos: number, atendidos: number }> = {};
    
    defaults.forEach(d => {
      map[d] = { total: 0, eventuais: 0, naoAtendidos: 0, atendidos: 0 };
    });

    filteredScheds.forEach(s => {
      const contractKey = getScheduleContract(s);
      const activeStops = correctiveLogs.filter(l => l.schedule_id === s.id);
      const isBroken = activeStops.some(l => !l.stop_end);

      if (!map[contractKey]) {
        map[contractKey] = { total: 0, eventuais: 0, naoAtendidos: 0, atendidos: 0 };
      }

      map[contractKey].total++;
      if (contractKey === "EVENTUAL") {
        map[contractKey].eventuais++;
      }
      if (isBroken) {
        map[contractKey].naoAtendidos++;
      } else {
        map[contractKey].atendidos++;
      }
    });

    return Object.keys(map).map(name => {
      const item = map[name];
      const pct = item.total > 0 ? Math.round((item.atendidos / item.total) * 100) : 100;
      return {
        name,
        pct,
        total: item.total,
        eventuais: item.eventuais,
        naoAtendidos: item.naoAtendidos,
        atendidos: item.atendidos
      };
    });
  }, [filteredScheds, equipment, correctiveLogs]);

  const drillDownData = useMemo(() => {
    if (!drillDownContract) return null;
    
    const compScheds = filteredScheds.filter(s => {
      const sEqClean = s.equipment?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const sPlateClean = s.plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const eq = equipment.find(e => {
        const eIdClean = e.identifier?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        const ePlateClean = e.plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        return (sEqClean && eIdClean === sEqClean) || (sPlateClean && ePlateClean === sPlateClean);
      });
      
      // Default: USINA
      let contractKey = "USINA";
      if (eq?.contract_type) {
        const typeUpper = eq.contract_type.trim().toUpperCase();
        if (typeUpper === "USINA" || typeUpper === "PORTO" || typeUpper === "EVENTUAL") {
          contractKey = typeUpper;
        }
      }
      return contractKey === drillDownContract.toUpperCase();
    });

    const typeMap: Record<string, { total: number, atendidos: number, naoAtendidos: number, items: any[] }> = {};
    compScheds.forEach(s => {
      const sEqClean = s.equipment?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const sPlateClean = s.plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const eq = equipment.find(e => {
        const eIdClean = e.identifier?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        const ePlateClean = e.plate?.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        return (sEqClean && eIdClean === sEqClean) || (sPlateClean && ePlateClean === sPlateClean);
      });

      const eqType = eq?.type || "Outros / Avulso";
      if (!typeMap[eqType]) {
        typeMap[eqType] = { total: 0, atendidos: 0, naoAtendidos: 0, items: [] };
      }

      const activeStops = correctiveLogs.filter(l => l.schedule_id === s.id);
      const isBroken = activeStops.some(l => !l.stop_end);

      typeMap[eqType].total++;
      if (isBroken) {
        typeMap[eqType].naoAtendidos++;
      } else {
        typeMap[eqType].atendidos++;
      }
      typeMap[eqType].items.push({ schedule: s, isBroken });
    });

    return Object.keys(typeMap).map(type => ({
      type,
      ...typeMap[type]
    }));
  }, [drillDownContract, filteredScheds, equipment, correctiveLogs]);

  const distinctLocals = useMemo(() => {
    const list = new Set<string>();
    usinaSchedules.forEach(s => {
      if (s.local) list.add(s.local);
    });
    return Array.from(list);
  }, [usinaSchedules]);

  return (
    <div className="space-y-6">




      {/* Main Tab Panels */}
      <Tabs defaultValue="atendimento" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex justify-between items-center bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <TabsList className="bg-transparent border-none gap-1">
            <TabsTrigger value="atendimento" className="font-bold text-xs uppercase px-6 h-10 rounded-lg">Gestão de Atendimento</TabsTrigger>
            <TabsTrigger value="ccm" className="font-bold text-xs uppercase px-6 h-10 rounded-lg flex items-center gap-1.5">
              CCM Oficina
              {dPlus1Unavailable.length > 0 && (
                <span className="h-2 w-2 bg-red-500 rounded-full animate-ping" />
              )}
            </TabsTrigger>
          </TabsList>


        </div>

        {/* Tab 0: Gestão de Atendimento Diário */}
        <TabsContent value="atendimento" className="mt-6 space-y-6">
          <div className="bg-teal-700 text-white p-3 rounded-xl flex flex-col md:flex-row items-center justify-between gap-3 shadow">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 animate-pulse text-teal-300" />
              <Button 
                onClick={() => setScheduleOpen(true)}
                className="bg-teal-800 hover:bg-teal-900 border border-teal-650 text-white font-black uppercase text-[10px] tracking-wider h-8 rounded-lg"
              >
                <Calendar className="h-4 w-4 mr-1.5" />
                Agendar Parada
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <span>Contrato:</span>
                <select 
                  value={contractFilter}
                  onChange={e => setContractFilter(e.target.value)}
                  className="bg-teal-800 text-white border border-teal-600 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400 font-bold"
                >
                  <option value="Todos">Todos</option>
                  <option value="Usina">Usina</option>
                  <option value="Porto">Porto</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 text-xs font-bold">
                <span>Local:</span>
                <select 
                  value={localFilter}
                  onChange={e => setLocalFilter(e.target.value)}
                  className="bg-teal-800 text-white border border-teal-600 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400 font-bold"
                >
                  <option value="Todos">Todos</option>
                  {distinctLocals.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              <input 
                type="date" 
                value={selectedDate} 
                onChange={(e) => setSelectedDate(e.target.value)} 
                className="bg-teal-800 text-white border border-teal-600 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400 font-bold font-mono h-8 cursor-pointer" 
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: Gauge & KPIs & Meta */}
            <div className="lg:col-span-6 space-y-6">
              
                          <Card className="bg-white shadow-sm border border-slate-200">
                <CardHeader className="bg-slate-50 border-b py-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-[9px] font-black text-slate-700 uppercase tracking-wider">
                    Atendimento {selectedDashboardContract ? `— Contrato ${selectedDashboardContract}` : ""}
                  </CardTitle>
                  {selectedDashboardContract && (
                    <Button 
                      variant="ghost" 
                      onClick={() => {
                        setSelectedDashboardContract(null);
                      }} 
                      className="h-5 px-1.5 text-[8px] font-black uppercase text-indigo-650 hover:text-indigo-800 p-0"
                    >
                      Limpar Filtro [x]
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="p-3 flex flex-col items-center">
                  <div className="relative w-full max-w-[130px] h-[65px] mb-2">
                    <svg viewBox="0 0 100 50" className="w-full h-full">
                      {/* Gauge Base Ring */}
                      <path 
                        d="M 10 50 A 40 40 0 0 1 90 50" 
                        fill="none" 
                        stroke="#e2e8f0" 
                        strokeWidth="12" 
                        strokeLinecap="round" 
                      />
                      {/* Gauge Color Segments */}
                      <path 
                        d="M 10 50 A 40 40 0 0 1 90 50" 
                        fill="none" 
                        stroke="#ef4444" // Red (0-75%)
                        strokeWidth="12" 
                        strokeLinecap="round" 
                        strokeDasharray="94.2 125.6"
                      />
                      <path 
                        d="M 10 50 A 40 40 0 0 1 90 50" 
                        fill="none" 
                        stroke="#f59e0b" // Yellow (75-90%)
                        strokeWidth="12" 
                        strokeDasharray="18.8 125.6"
                        strokeDashoffset="-94.2"
                      />
                      <path 
                        d="M 10 50 A 40 40 0 0 1 90 50" 
                        fill="none" 
                        stroke="#10b981" // Green (90-100%)
                        strokeWidth="12" 
                        strokeLinecap="round" 
                        strokeDasharray="12.6 125.6"
                        strokeDashoffset="-113"
                      />
                      
                      {/* Needle Indicator */}
                      {(() => {
                        const angle = (dashboardStats.pct / 100) * 180 - 180;
                        return (
                          <g transform={`translate(50,50) rotate(${angle})`}>
                            <line x1="0" y1="0" x2="-35" y2="0" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" />
                            <circle cx="0" cy="0" r="4" fill="#334155" />
                          </g>
                        );
                      })()}
                    </svg>
                  </div>
                  <div className="text-xl font-black text-slate-800 tracking-tighter">
                    [{dashboardStats.pct}.00%]
                  </div>

                  {/* Meta Status Indicator inside Gauge Card */}
                  <div className={`mt-2 w-full p-2 rounded-lg text-white text-center flex flex-col items-center justify-center ${stats.pct >= 95 ? "bg-teal-650" : stats.pct >= 85 ? "bg-amber-600" : "bg-red-650"}`}>
                    <span className="font-black text-[9px] uppercase tracking-wider">
                      {stats.pct >= 95 ? "✓ Meta Atingida!" : stats.pct >= 85 ? "⚠️ Próximo da Meta" : "🚨 Abaixo da Meta"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* KPIs stack */}
              <div className="grid grid-cols-3 gap-2">
                <Card className="bg-slate-50 border border-slate-200">
                  <CardContent className="p-2 text-center">
                    <p className="text-[8.5px] font-black uppercase text-slate-550 tracking-tighter leading-none">Total Programado</p>
                    <h3 className="text-lg font-black text-slate-850 mt-1">{stats.total}</h3>
                  </CardContent>
                </Card>

                <Card className="bg-slate-50 border border-slate-200">
                  <CardContent className="p-2 text-center">
                    <p className="text-[8.5px] font-black uppercase text-slate-555 tracking-tighter leading-none">Total Atendido</p>
                    <h3 className="text-lg font-black text-emerald-700 mt-1">{stats.atendidos}</h3>
                  </CardContent>
                </Card>

                <Card className="bg-slate-50 border border-slate-200">
                  <CardContent className="p-2 text-center">
                    <p className="text-[8.5px] font-black uppercase text-slate-555 tracking-tighter leading-none">Não Atendido</p>
                    <h3 className="text-lg font-black text-rose-700 mt-1">{stats.naoAtendidos}</h3>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Right Column: Company Grid */}
            <div className="lg:col-span-6 space-y-4">
              <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                <div className="bg-slate-50 border-b p-3">
                  <h3 className="font-black text-slate-800 text-xs uppercase tracking-wider">Performance por Contrato (Clique para detalhar)</h3>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-100/50">
                      <TableRow className="text-[9px] uppercase font-black text-slate-600">
                        <TableHead>Contrato</TableHead>
                        <TableHead className="text-center">%</TableHead>
                        <TableHead className="text-center">Total</TableHead>
                        <TableHead className="text-center">Não Atend.</TableHead>
                        <TableHead className="text-center">Atend.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs font-bold text-slate-800">
                      {contractStats.map((comp, idx) => {
                        const isRowActive = selectedDashboardContract === comp.name;
                        return (
                          <TableRow 
                            key={idx} 
                            className={`hover:bg-slate-50 transition-colors ${isRowActive ? "bg-teal-50/30 border-l-4 border-l-teal-600" : ""}`}
                          >
                            <TableCell className="font-black text-slate-900 py-3 uppercase">
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="h-2 w-2 rounded-full bg-teal-500" />
                                  <span>{comp.name}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (selectedDashboardContract === comp.name) {
                                        setSelectedDashboardContract(null);
                                      } else {
                                        setSelectedDashboardContract(comp.name);
                                      }
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase border transition-all ${
                                      selectedDashboardContract === comp.name 
                                        ? "bg-teal-600 text-white border-teal-600" 
                                        : "bg-slate-50 text-slate-650 border-slate-200 hover:bg-slate-100"
                                    }`}
                                  >
                                    Filtrar
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDrillDownContract(comp.name);
                                    }}
                                    className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase border bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 transition-all ml-auto"
                                  >
                                    Tipos
                                  </button>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-center py-3">
                              <span className={`px-2 py-0.5 rounded font-black ${comp.pct >= 95 ? "bg-emerald-100 text-emerald-700" : comp.pct >= 85 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                                {comp.pct}%
                              </span>
                            </TableCell>
                            <TableCell className="text-center py-3">{comp.total}</TableCell>
                            <TableCell className="text-center py-3 text-rose-600">{comp.naoAtendidos}</TableCell>
                            <TableCell className="text-center py-3 text-emerald-600">{comp.atendidos}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

          </div>

          {/* Bottom Table: Detalhamento dos Não Atendimentos */}
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden mt-6">
            <div className="bg-rose-50 border-b border-rose-100 p-3">
              <h3 className="font-black text-rose-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 animate-pulse text-rose-600" />
                Detalhamento dos Não Atendimentos
              </h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="text-[9px] uppercase font-black text-slate-600">
                    <TableHead>OS</TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Equipamento</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Local</TableHead>
                    <TableHead>Observação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs font-bold text-slate-800">
                  {stats.naoAtendidosList.map((s, idx) => {
                    const activeStops = correctiveLogs.filter(l => l.schedule_id === s.id && !l.stop_end);
                    const contractKey = getScheduleContract(s);
                    return (
                      <TableRow key={idx} className="bg-rose-50/20 hover:bg-rose-50/40">
                        <TableCell className="font-mono text-slate-600">{s.os_number || "—"}</TableCell>
                        <TableCell className="uppercase">{contractKey}</TableCell>
                        <TableCell className="font-mono text-slate-700">
                          {s.equipment} {s.plate ? `(${s.plate})` : ""}
                        </TableCell>
                        <TableCell className="text-rose-600 uppercase text-[10px] font-black">
                          ⚠️ Em Corretiva
                        </TableCell>
                        <TableCell className="uppercase text-slate-500">{s.local || "—"}</TableCell>
                        <TableCell className="italic text-slate-400 font-medium max-w-[200px] truncate" title={activeStops[0]?.reason || ""}>
                          {activeStops[0]?.reason || "Parada mecânica sem justificativa"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {stats.naoAtendidosList.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-emerald-600 italic font-black uppercase text-[10px]">
                        ✓ 100% de Atendimento. Nenhuma pendência registrada hoje!
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>



        {/* Tab 3: CCM Oficina (D+1 Focus) */}
        <TabsContent value="ccm" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left 2 Columns: D+1 Alerta de Indisponibilidade Planejada */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-red-50 border-red-200 border-2 rounded-xl p-4">
                <h2 className="text-sm font-black uppercase text-red-700 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-600 animate-bounce" />
                  CCM Planejamento D+1 (Indisponíveis para amanhã {dateDPlus1.split('-').reverse().slice(0,2).join('/')})
                </h2>
                <p className="text-xs text-red-600 mt-1">Lista de equipamentos que possuem preventiva agendada, lavagem programada, ou aperto de mola programados para amanhã.</p>
              </div>

              <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
                <div className="divide-y divide-slate-100">
                  {dPlus1Unavailable.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 italic font-bold">Nenhum equipamento agendado ou em oficina para amanhã.</div>
                  ) : (
                    dPlus1Unavailable.map(eq => {
                      const tomorrowProg = programming.find(p => p.equipment_id === eq.id && p.scheduled_date === dateDPlus1);
                      const isNowInOficina = eq.status === "manutencao" || eq.status === "indisponivel";
                      return (
                        <div key={eq.id} className="p-4 flex justify-between items-center hover:bg-red-50/10">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded text-xs">{eq.identifier}</span>
                              <span className="text-xs font-bold text-slate-600 uppercase">{eq.type}</span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-3">
                              {tomorrowProg && (
                                <span className="text-[10px] font-black text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100 uppercase">
                                  {tomorrowProg.stop_type}: {tomorrowProg.notes || "Parada programada"}
                                </span>
                              )}
                              {isNowInOficina && (
                                <span className="text-[10px] font-black text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-100 uppercase">
                                  Ativo na Oficina: {eq.maintenance_problem || "Ajustes mecânicos"}
                                </span>
                              )}
                            </div>
                          </div>
                          {eq.maintenance_expected_return && (
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-50 border p-1 rounded">
                              Previsão: {format(new Date(eq.maintenance_expected_return), "dd/MM HH:mm")}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Oficina em tempo real */}
            <div className="space-y-4">
              <div className="bg-slate-900 text-white rounded-xl p-4">
                <h3 className="text-xs font-black uppercase tracking-wider flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-orange-500" />
                  Status Oficina Atual
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">Intervenções mecânicas em andamento nas últimas horas.</p>
              </div>

              <div className="space-y-2">
                {equipment.filter(eq => eq.status === "manutencao" || eq.status === "indisponivel").map(eq => (
                  <Card key={eq.id} className="border-2 border-orange-100">
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex justify-between items-start">
                        <span className="font-mono font-black text-sm text-slate-800">{eq.identifier}</span>
                        <span className="text-[8px] bg-orange-100 text-orange-700 font-black uppercase px-2 py-0.5 rounded-full">Oficina</span>
                      </div>
                      <p className="text-[10px] text-slate-500 italic font-medium">"{eq.maintenance_problem || "Sem detalhes da avaria"}"</p>
                    </CardContent>
                  </Card>
                ))}
                {equipment.filter(eq => eq.status === "manutencao" || eq.status === "indisponivel").length === 0 && (
                  <div className="text-center p-6 text-xs text-slate-400 italic font-bold">Oficina vazia no momento.</div>
                )}
              </div>
            </div>

          </div>
        </TabsContent>
      </Tabs>

      {/* Contract Equipment Type Drill-down Dialog */}
      <Dialog open={!!drillDownContract} onOpenChange={() => setDrillDownContract(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black uppercase text-slate-800 flex items-center gap-2">
              <Truck className="h-5 w-5 text-teal-600" />
              Detalhamento de Equipamentos — Contrato {drillDownContract}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="text-[10px] uppercase font-black text-slate-600">
                    <TableHead>Tipo de Equipamento</TableHead>
                    <TableHead className="text-center">Total Escala</TableHead>
                    <TableHead className="text-center text-emerald-600">Atendidos</TableHead>
                    <TableHead className="text-center text-rose-600">Não Atendidos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs font-bold text-slate-800">
                  {drillDownData?.map((d, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="uppercase">{d.type}</TableCell>
                      <TableCell className="text-center">{d.total}</TableCell>
                      <TableCell className="text-center text-emerald-600 font-black">{d.atendidos}</TableCell>
                      <TableCell className="text-center text-rose-600 font-black">{d.naoAtendidos}</TableCell>
                    </TableRow>
                  ))}
                  {(!drillDownData || drillDownData.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-slate-400 italic">
                        Nenhum equipamento alocado hoje.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            
            {drillDownData && drillDownData.length > 0 && (
              <div className="space-y-2 mt-4">
                <p className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Lista detalhada de equipamentos:</p>
                <div className="max-h-60 overflow-y-auto border rounded-xl divide-y divide-slate-100 p-2 space-y-2">
                  {drillDownData.flatMap(d => d.items).map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs py-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono bg-slate-100 border px-1.5 py-0.5 rounded text-[11px] text-slate-700">{item.schedule.equipment || "—"}</span>
                        <span className="font-mono text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded text-[10px]">{item.schedule.plate}</span>
                        <span className="text-slate-500 text-[10px] uppercase font-semibold">({item.schedule.local})</span>
                      </div>
                      <div>
                        {item.isBroken ? (
                          <Badge className="bg-red-100 text-red-700 border border-red-200 text-[9px] font-black uppercase">⚠️ Parado / Corretiva</Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] font-black uppercase">✓ Operacional</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setDrillDownContract(null)} className="font-bold">Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog for Agendar Parada */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black uppercase flex items-center gap-2">
              <Calendar className="h-5 w-5 text-teal-600" />
              Agendar Parada
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="flex flex-col space-y-2">
              <Label className="text-[10px] font-black uppercase">Equipamento</Label>
              <Select value={schedEqId} onValueChange={setSchedEqId}>
                <SelectTrigger className="h-10 font-bold">
                  <SelectValue placeholder="Selecione o equipamento..." />
                </SelectTrigger>
                <SelectContent>
                  {equipment.map((eq) => (
                    <SelectItem key={eq.id} value={eq.id}>
                      {eq.identifier} ({eq.type || "—"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">Data da Parada</Label>
                <Input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} className="h-10 font-bold" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase">Tipo de Parada</Label>
                <Select value={schedStopType} onValueChange={setSchedStopType}>
                  <SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Manutenção Geral", "MEV", "Lavador", "Mola", "Borracharia", "Preventiva", "Elétrica", "Motor", "Solda"].map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase">Observações / Notas</Label>
              <textarea 
                value={schedNotes} 
                onChange={(e) => setSchedNotes(e.target.value)} 
                placeholder="Motivo do agendamento..." 
                className="flex min-h-[80px] w-full rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <Button 
              onClick={handleConfirmSchedule} 
              className="w-full h-12 font-black uppercase bg-teal-700 hover:bg-teal-600 text-white"
            >
              CONFIRMAR AGENDAMENTO
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
