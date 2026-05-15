import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type CriticalEquipment = {
  id: string;
  identifier: string;
  maintenance_problem: string;
  days_stopped: number;
  expected_return?: string | null;
  is_overdue?: boolean;
};

export function MaintenanceGovernanceAlert() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<{ department: string; receives_alerts: boolean } | null>(null);
  const [criticalItems, setCriticalItems] = useState<CriticalEquipment[]>([]);
  const [isTimeToShow, setIsTimeToShow] = useState(false);

  const check = async () => {
    if (!user) return;

    // 1. Carrega perfil e regras de alerta
    const [{ data: prof }, { data: rls }] = await Promise.all([
      supabase.from("profiles").select("department, receives_alerts").eq("id", user.id).maybeSingle(),
      supabase.from("alert_rules").select("*").eq("is_active", true).eq("rule_type", "maintenance_duration").maybeSingle()
    ]);

    setProfile(prof);
    const rule = rls as any;
    const threshold = rule?.threshold_days ?? 5;
    const alertHour = rule?.alert_time ? parseInt(rule.alert_time.split(':')[0]) : 10;

    // 2. Verifica se já passou do horário definido na regra
    const now = new Date();
    const currentHour = now.getHours();
    setIsTimeToShow(currentHour >= alertHour);

    // 3. Busca equipamentos em manutenção há mais de X dias que NÃO foram verificados hoje
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: eqs } = await supabase.from("equipment")
      .select("id, identifier, maintenance_problem, maintenance_started_at, last_verified_at, maintenance_expected_return, alert_user_id")
      .in("status", ["manutencao", "indisponivel", "finalizacao", "programado"]);

    const critical = (eqs ?? []).filter(e => {
      if (!e.maintenance_started_at) return false;
      
      const start = new Date(e.maintenance_started_at);
      const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 3600 * 24));
      
      const lastVerified = e.last_verified_at ? new Date(e.last_verified_at) : null;
      const verifiedToday = lastVerified && lastVerified >= todayStart;

      const isDurationCritical = diffDays >= threshold && !verifiedToday;
      
      const isOverdue = e.maintenance_expected_return ? new Date(e.maintenance_expected_return) < now : false;
      const isUserAlerted = e.alert_user_id === user.id;

      return isDurationCritical || (isOverdue && isUserAlerted);
    }).map(e => ({
      id: e.id,
      identifier: e.identifier,
      maintenance_problem: e.maintenance_problem || "Sem descrição",
      days_stopped: Math.floor((now.getTime() - new Date(e.maintenance_started_at!).getTime()) / (1000 * 3600 * 24)),
      expected_return: e.maintenance_expected_return,
      is_overdue: e.maintenance_expected_return ? new Date(e.maintenance_expected_return) < now : false
    }));

    setCriticalItems(critical);
  };

  const verify = async (e: CriticalEquipment, checkNote: string = "Verificação diária realizada.") => {
    const dateTag = new Date().toLocaleDateString('pt-BR');
    const finalProblem = (e.maintenance_problem || "") + "\n" + dateTag + " " + checkNote;
    const { error } = await supabase.from("equipment").update({ 
      maintenance_problem: finalProblem,
      last_verified_at: new Date().toISOString()
    }).eq("id", e.id);
    
    if (!error) {
      toast.success(`Situação de ${e.identifier} confirmada para hoje!`);
      check();
    }
  };

  useEffect(() => {
    if (!user) return;
    check();
    
    const channel = supabase.channel("governance-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, check)
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_rules" }, check)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, check)
      .subscribe();

    const interval = setInterval(check, 1000 * 60 * 5);
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Regra de exibição: 
  // - Precisa ser 10h ou mais
  // - Usuário deve estar marcado para receber alertas
  // - Usuário deve ser da Manutenção ou Operação (ou Admin)
  // - Deve haver itens críticos
  if (!isTimeToShow || !profile?.receives_alerts || criticalItems.length === 0) return null;

  return (
    <div className="bg-red-600 text-white animate-in slide-in-from-top duration-500 z-[100] sticky top-0 shadow-2xl">
      <div className="container mx-auto px-4 py-3 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-full animate-pulse">
            <AlertCircle className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="font-black uppercase text-xs tracking-widest leading-none">Alerta de Governança — {new Date().toLocaleDateString('pt-BR')}</p>
            <h2 className="text-sm font-bold">Existem {criticalItems.length} alertas de manutenção que exigem sua atenção imediata.</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-center">
          {criticalItems.slice(0, 3).map(item => (
            <div key={item.id} className="bg-black/20 hover:bg-black/30 transition-colors p-2 rounded-lg flex items-center gap-3 border border-white/10 group">
              <div className="text-left">
                <p className="font-mono font-black text-xs leading-none flex items-center gap-1">
                  {item.identifier} 
                  {item.is_overdue && <Clock className="h-3 w-3 text-yellow-300 animate-pulse" />}
                </p>
                <p className={cn("text-[10px] font-bold uppercase", item.is_overdue ? "text-yellow-200" : "opacity-80")}>
                  {item.is_overdue ? "⚠️ PREVISÃO VENCIDA" : `${item.days_stopped} dias parado`}
                </p>
              </div>
              <Button 
                onClick={() => verify(item)}
                size="sm" 
                className="h-8 bg-white text-red-600 hover:bg-red-50 font-black text-[9px] uppercase px-3"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" /> Confirmar Verificação
              </Button>
            </div>
          ))}
          {criticalItems.length > 3 && (
            <div className="text-[10px] font-black uppercase opacity-60 ml-2">
              + {criticalItems.length - 3} máquinas
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
