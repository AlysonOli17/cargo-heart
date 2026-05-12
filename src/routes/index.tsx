import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { STATUS_LABELS, type EquipmentStatus } from "@/lib/equipment";
import { Calendar } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Frota Busato" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; brand: string | null; model: string | null;
  status: EquipmentStatus; current_client_id: string | null;
  maintenance_expected_return: string | null;
};

const TYPE_COLORS: Record<string, string> = {
  "CAMINHÃO PIPA": "oklch(0.55_0.18_250)", // Azul
  "MALHA PENEIRA": "oklch(0.65_0.18_150)", // Verde
  "CAMINHÃO": "oklch(0.6_0.15_200)",      // Ciano
  "RETROESCAVADEIRA": "oklch(0.6_0.2_30)",  // Laranja
  "MINI CARREGADEIRA": "oklch(0.5_0.2_300)", // Roxo
  "PENEIRA ROTATIVA": "oklch(0.55_0.2_100)", // Oliva
};

const getColorForType = (type: string) => {
  const upper = type.toUpperCase();
  if (TYPE_COLORS[upper]) return TYPE_COLORS[upper];
  const hash = type.split("").reduce((acc, char) => char.charCodeAt(0) + acc, 0);
  const hue = hash % 360;
  return `oklch(0.6 0.15 ${hue})`;
};

const StatusDot = ({ status }: { status: EquipmentStatus }) => {
  const colors: Record<EquipmentStatus, string> = {
    disponivel: "bg-[oklch(0.65_0.18_150)]",
    com_cliente: "bg-[oklch(0.55_0.18_250)]",
    manutencao: "bg-[oklch(0.65_0.2_50)]",
    em_atendimento: "bg-[oklch(0.55_0.2_300)]"
  };
  return <div className={`h-2.5 w-2.5 rounded-full ${colors[status]} shadow-sm`} />;
};

const safeFormatDateShort = (dateStr: string | null) => {
  if (!dateStr || dateStr === "" || dateStr === "null") return null;
  try {
    const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  } catch (e) { return null; }
};

function Dashboard() {
  const { user } = useAuth();
  const [equipment, setEquipment] = useState<Equipment[]>([]);

  const load = async () => {
    const { data: e } = await supabase.from("equipment")
      .select("id,identifier,type,brand,model,status,current_client_id,maintenance_expected_return")
      .order("identifier");
    setEquipment((e ?? []) as Equipment[]);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase.channel("dashboard-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const groupedEquipment = equipment.reduce((acc, eq) => {
    const type = eq.type || "Outros";
    if (!acc[type]) acc[type] = [];
    acc[type].push(eq);
    return acc;
  }, {} as Record<string, Equipment[]>);

  const sortedTypes = Object.keys(groupedEquipment).sort();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-2 border-b">
        <div>
          <h1 className="text-3xl font-bold text-foreground/90">Frota Busato</h1>
          <p className="text-muted-foreground flex items-center gap-2 mt-1 font-medium">
             Gestão em tempo real de ativos
          </p>
        </div>
        <div className="flex items-center gap-3">
           <div className="text-right px-4 border-r">
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Total</p>
              <p className="text-3xl font-bold">{equipment.length}</p>
           </div>
           <div className="text-right px-4 bg-muted/50 rounded-xl py-2 border">
              <p className="text-[10px] uppercase font-bold text-[oklch(0.55_0.18_150)] tracking-widest">Disponíveis</p>
              <p className="text-3xl font-bold text-[oklch(0.55_0.18_150)]">{equipment.filter(e => e.status === 'disponivel').length}</p>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {sortedTypes.map((type) => {
          const items = groupedEquipment[type];
          const available = items.filter(e => e.status === "disponivel").length;
          const maintenance = items.filter(e => e.status === "manutencao").length;
          const typeColor = getColorForType(type);
          
          return (
            <Card key={type} 
              style={{ borderColor: `${typeColor}30` }}
              className="overflow-hidden border shadow-sm bg-card/50 backdrop-blur-sm group transition-all hover:shadow-md">
              <div 
                style={{ backgroundColor: `${typeColor}10` }}
                className="p-5 border-b flex items-center justify-between">
                <div>
                  <h2 style={{ color: typeColor }} className="text-xl font-bold uppercase tracking-tight">{type}</h2>
                  <p className="text-[10px] font-semibold text-muted-foreground/80 uppercase">{items.length} Unidades no total</p>
                </div>
                <div className="flex gap-2">
                  <div className="flex items-baseline gap-1 bg-background px-3 py-1.5 rounded-lg border shadow-sm">
                    <span className="text-sm font-bold text-[oklch(0.55_0.18_150)]">{available}</span>
                    <span className="text-[9px] font-bold text-muted-foreground/60 uppercase ml-1">OK</span>
                  </div>
                  <div className="flex items-baseline gap-1 bg-background px-3 py-1.5 rounded-lg border shadow-sm">
                    <span className="text-sm font-bold text-[oklch(0.65_0.2_50)]">{maintenance}</span>
                    <span className="text-[9px] font-bold text-muted-foreground/60 uppercase ml-1">OFICINA</span>
                  </div>
                </div>
              </div>
              
              <div className="p-5">
                 <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {items.map((eq) => {
                      const isMaint = eq.status === 'manutencao';
                      const formattedDate = safeFormatDateShort(eq.maintenance_expected_return);

                      return (
                        <div key={eq.id} className={`flex flex-col gap-1.5 p-3 rounded-xl border transition-all ${
                          eq.status === 'disponivel' 
                            ? 'bg-[oklch(0.65_0.18_150)]/5 border-transparent hover:border-[oklch(0.65_0.18_150)]/30' 
                            : isMaint 
                              ? 'bg-[oklch(0.65_0.2_50)]/5 border-[oklch(0.65_0.2_50)]/20 shadow-sm'
                              : 'bg-muted/30 border-transparent hover:border-foreground/10'
                        }`}>
                           <div className="flex items-center justify-between">
                              <StatusDot status={eq.status} />
                              {isMaint && formattedDate && (
                                 <div className="flex items-center gap-1 text-[9px] font-bold text-[oklch(0.6_0.2_50)] bg-background/80 px-1.5 py-0.5 rounded-md border border-[oklch(0.65_0.2_50)]/20">
                                    <Calendar className="h-2.5 w-2.5" />
                                    {formattedDate}
                                 </div>
                              )}
                           </div>
                           <p className="font-bold text-sm tracking-tight truncate uppercase">{eq.identifier}</p>
                           <p className="text-[10px] font-semibold text-muted-foreground/70 truncate uppercase leading-none">
                             {eq.model || eq.brand || '—'}
                           </p>
                        </div>
                      );
                    })}
                 </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
