import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { STATUS_LABELS, type EquipmentStatus } from "@/lib/equipment";
import { Wrench, Users, CircleCheck, Activity, Calendar } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { format, isValid } from "date-fns";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Disponibilidade Frota Busato" }] }),
  component: () => <AppLayout><Dashboard /></AppLayout>,
});

type Equipment = {
  id: string; identifier: string; type: string | null; brand: string | null; model: string | null;
  status: EquipmentStatus; current_client_id: string | null;
  maintenance_expected_return: string | null;
};

const TYPE_COLORS: Record<string, string> = {
  "CAMINHÃO PIPA": "oklch(0.65_0.18_250)", 
  "MALHA PENEIRA": "oklch(0.65_0.18_150)", 
  "CAMINHÃO": "oklch(0.65_0.18_200)",      
  "RETROESCAVADEIRA": "oklch(0.65_0.18_30)", 
  "MINI CARREGADEIRA": "oklch(0.65_0.18_300)", 
  "PENEIRA ROTATIVA": "oklch(0.65_0.18_100)", 
};

const getColorForType = (type: string) => {
  const upper = type.toUpperCase();
  if (TYPE_COLORS[upper]) return TYPE_COLORS[upper];
  const hash = type.split("").reduce((acc, char) => char.charCodeAt(0) + acc, 0);
  const hue = hash % 360;
  return `oklch(0.65 0.15 ${hue})`;
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
    const ch = supabase.channel("dashboard")
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
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-2 border-b">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground/90">Monitoramento de Frota</h1>
          <p className="text-muted-foreground flex items-center gap-2 mt-2 font-medium">
             Gestão em tempo real Busato Locações
          </p>
        </div>
        <div className="flex items-center gap-3">
           <div className="text-right px-4 border-r">
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">Frota Total</p>
              <p className="text-3xl font-black">{equipment.length}</p>
           </div>
           <div className="text-right px-4 bg-[oklch(0.65_0.18_150)]/5 rounded-xl py-2">
              <p className="text-[10px] uppercase font-bold text-[oklch(0.55_0.18_150)] tracking-tighter">Disponíveis</p>
              <p className="text-3xl font-black text-[oklch(0.55_0.18_150)]">{equipment.filter(e => e.status === 'disponivel').length}</p>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {sortedTypes.length === 0 ? (
          <div className="col-span-full py-32 text-center border-2 border-dashed rounded-3xl bg-muted/10">
             <p className="text-muted-foreground font-medium">Aguardando cadastro de equipamentos...</p>
          </div>
        ) : (
          sortedTypes.map((type) => {
            const items = groupedEquipment[type];
            const available = items.filter(e => e.status === "disponivel").length;
            const typeColor = getColorForType(type);
            
            return (
              <Card key={type} 
                style={{ borderColor: `${typeColor}20` }}
                className="overflow-hidden border-2 shadow-xl shadow-foreground/5 bg-card/50 backdrop-blur-sm group transition-all hover:translate-y-[-2px]">
                <div 
                  style={{ backgroundColor: `${typeColor}15` }}
                  className="p-5 border-b flex items-center justify-between">
                  <div>
                    <h2 style={{ color: typeColor }} className="text-xl font-black uppercase tracking-tighter">{type}</h2>
                    <p className="text-xs font-bold text-muted-foreground/60">{items.length} UNIDADES</p>
                  </div>
                  <div className="flex items-baseline gap-1 bg-background/80 px-3 py-1.5 rounded-full border shadow-sm">
                    <span className="text-sm font-black text-[oklch(0.55_0.18_150)]">{available}</span>
                    <span className="text-[10px] font-bold text-muted-foreground/50 uppercase ml-1">Disponíveis</span>
                  </div>
                </div>
                
                <div className="p-5">
                   <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {items.map((eq) => {
                        const isMaint = eq.status === 'manutencao';
                        const dateObj = isMaint && eq.maintenance_expected_return ? new Date(eq.maintenance_expected_return + "T00:00:00") : null;
                        const hasValidDate = dateObj && isValid(dateObj);

                        return (
                          <div key={eq.id} className={`flex flex-col gap-1.5 p-3 rounded-2xl border transition-all ${
                            eq.status === 'disponivel' 
                              ? 'bg-[oklch(0.65_0.18_150)]/5 border-transparent hover:border-[oklch(0.65_0.18_150)]/20' 
                              : isMaint 
                                ? 'bg-[oklch(0.65_0.2_50)]/5 border-[oklch(0.65_0.2_50)]/10'
                                : 'bg-muted/30 border-transparent hover:border-foreground/10'
                          }`}>
                             <div className="flex items-center justify-between">
                                <StatusDot status={eq.status} />
                                {isMaint && hasValidDate && (
                                   <div className="flex items-center gap-1 text-[9px] font-bold text-[oklch(0.6_0.2_50)] bg-background/80 px-1.5 py-0.5 rounded-md border border-[oklch(0.65_0.2_50)]/20">
                                      <Calendar className="h-2.5 w-2.5" />
                                      {format(dateObj, "dd/MM")}
                                   </div>
                                )}
                             </div>
                             <p className="font-black text-sm tracking-tight truncate">{eq.identifier}</p>
                             <p className="text-[10px] font-bold text-muted-foreground/70 truncate uppercase leading-none">
                               {eq.model || eq.brand || '—'}
                             </p>
                          </div>
                        );
                      })}
                   </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
