import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Clock, MapPin, Truck, Wrench, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type ServiceRequest = {
  id: string;
  created_at: string;
  contrato: string | null;
  nome_completo: string | null;
  matricula: string | null;
  consegue_atuar: string | null;
  local_operacao: string | null;
  detalhes_local: string | null;
  placa_tag: string | null;
  tipo_equipamento: string | null;
  onde_problema: string | null;
  descricao_problema: string | null;
  status: string;
  equipe_atendimento: string | null;
  prioridade: string | null;
};

export function TriagemInbox() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReq, setSelectedReq] = useState<ServiceRequest | null>(null);
  
  // Forms para Gerar OS
  const [equipe, setEquipe] = useState("");
  const [obs, setObs] = useState("");

  const loadRequests = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("service_requests")
      .select("*")
      .eq("status", "pendente")
      .order("created_at", { ascending: false });
      
    if (!error && data) {
      setRequests(data as ServiceRequest[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadRequests();
    
    const ch = supabase.channel("service-requests-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_requests" }, loadRequests)
      .subscribe();
      
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleGerarOS = async () => {
    if (!selectedReq || !equipe) {
      toast.error("Selecione a equipe de atendimento");
      return;
    }

    // Atualiza a solicitação para em_atendimento
    const { error: reqError } = await supabase
      .from("service_requests")
      .update({
        status: "em_atendimento",
        equipe_atendimento: equipe,
        observacoes_cco: obs
      })
      .eq("id", selectedReq.id);

    if (reqError) {
      toast.error("Erro ao gerar O.S: " + reqError.message);
      return;
    }

    // Tentar encontrar o equipamento pela placa/tag e atualizar o status dele
    if (selectedReq.placa_tag) {
       // Buscar placa
       const { data: eq } = await supabase.from("equipment").select("id, maintenance_problem").ilike("identifier", `%${selectedReq.placa_tag.trim()}%`).maybeSingle();
       
       if (eq) {
          const dateTag = `[TRIAGEM ${new Date().toLocaleDateString('pt-BR')}]`;
          const msg = `${dateTag} Encaminhado para ${equipe}. Relato: ${selectedReq.descricao_problema} \n` + (eq.maintenance_problem || "");
          await supabase.from("equipment").update({
             status: "manutencao",
             maintenance_problem: msg,
             maintenance_priority: selectedReq.prioridade === 'alta' ? 'Crítica' : 'Média',
             maintenance_type: "Manutenção Geral"
          }).eq("id", eq.id);
       }
    }

    toast.success("O.S Gerada e equipe notificada!");
    setSelectedReq(null);
    setEquipe("");
    setObs("");
    loadRequests();
  };

  if (loading) return <div className="text-center p-8 text-muted-foreground font-bold uppercase">Carregando triagem...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h2 className="text-lg font-black uppercase text-slate-800 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-indigo-600" /> Caixa de Entrada (Solicitações via Forms)
        </h2>
        <Badge variant="secondary" className="font-black text-sm">{requests.length} PENDENTES</Badge>
      </div>

      {requests.length === 0 ? (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-12 text-center text-slate-400 font-bold uppercase">
          Nenhuma solicitação pendente no momento.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {requests.map(req => {
             const timeAgo = formatDistanceToNow(new Date(req.created_at), { addSuffix: true, locale: ptBR });
             const isUrgent = req.prioridade === 'alta' || req.consegue_atuar?.toLowerCase().includes("não");
             
             return (
               <Card 
                 key={req.id} 
                 onClick={() => setSelectedReq(req)}
                 className={`p-4 cursor-pointer hover:shadow-md transition-all border-l-4 ${isUrgent ? 'border-l-red-500 bg-red-50/20' : 'border-l-blue-500 bg-blue-50/10'}`}
               >
                 <div className="flex justify-between items-start mb-2">
                    <Badge variant={isUrgent ? "destructive" : "default"} className="uppercase text-[9px] font-black">
                      {isUrgent ? 'URGENTE' : 'NORMAL'}
                    </Badge>
                    <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {timeAgo}
                    </span>
                 </div>
                 
                 <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-slate-600" />
                      <span className="font-black text-lg uppercase text-slate-800">{req.placa_tag || "SEM PLACA"}</span>
                    </div>
                    
                    <div className="text-[11px] text-slate-600 uppercase font-bold bg-slate-100 p-1.5 rounded">
                      <MapPin className="h-3 w-3 inline mr-1" />
                      {req.local_operacao || "Local não informado"}
                    </div>
                    
                    <div className="text-xs text-slate-700 line-clamp-2 mt-2 font-medium">
                      "{req.descricao_problema}"
                    </div>
                 </div>
                 
                 <div className="mt-4 pt-2 border-t text-[10px] text-slate-500 font-bold uppercase flex justify-between">
                    <span>{req.nome_completo}</span>
                    <span className="text-primary">{req.contrato}</span>
                 </div>
               </Card>
             );
          })}
        </div>
      )}

      {/* Dialog de Despacho / Gerar OS */}
      <Dialog open={!!selectedReq} onOpenChange={(o) => !o && setSelectedReq(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black uppercase flex items-center gap-2 text-indigo-700">
              <Wrench className="h-5 w-5" /> Despacho de Solicitação
            </DialogTitle>
          </DialogHeader>
          
          {selectedReq && (
            <div className="space-y-6 py-2">
               {/* Resumo dos dados do Forms */}
               <div className="bg-slate-50 p-4 rounded-xl border space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-400">Placa / Equipamento</p>
                      <p className="font-mono font-bold text-lg">{selectedReq.placa_tag}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-400">Solicitante</p>
                      <p className="font-bold">{selectedReq.nome_completo} ({selectedReq.matricula})</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-400">Local</p>
                      <p className="font-bold">{selectedReq.local_operacao}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-400">Urgência (Pode rodar?)</p>
                      <p className={`font-black ${selectedReq.consegue_atuar?.toLowerCase().includes("não") ? "text-red-600" : "text-emerald-600"}`}>
                        {selectedReq.consegue_atuar}
                      </p>
                    </div>
                  </div>
                  <div className="pt-2 border-t">
                    <p className="text-[10px] font-black uppercase text-slate-400">Problema Relatado</p>
                    <p className="font-medium bg-white p-2 rounded border mt-1">{selectedReq.descricao_problema}</p>
                  </div>
               </div>

               {/* Ações do CCO */}
               <div className="space-y-4">
                 <h3 className="font-black uppercase text-xs text-slate-500">Ação do Controlador (CCO)</h3>
                 
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase">Equipe de Atendimento</Label>
                    <Select value={equipe} onValueChange={setEquipe}>
                      <SelectTrigger className="h-12 font-bold text-sm">
                        <SelectValue placeholder="Selecione quem vai atender..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Mecânica Base">🛠️ Mecânica Base (Reparo Robusto)</SelectItem>
                        <SelectItem value="Mecânica de Área">🔧 Mecânica de Área (Reparo Rápido)</SelectItem>
                        <SelectItem value="Lubrificação e Pneus">🛞 Lubrificação e Pneus</SelectItem>
                        <SelectItem value="Comboio">⛽ Comboio (Abastecimento)</SelectItem>
                      </SelectContent>
                    </Select>
                 </div>
                 
                 <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase">Observações Internas (Opcional)</Label>
                    <Textarea 
                      value={obs} 
                      onChange={e => setObs(e.target.value)} 
                      placeholder="Instruções para o mecânico..."
                      className="resize-none h-20"
                    />
                 </div>
               </div>
            </div>
          )}
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSelectedReq(null)} className="font-bold uppercase">
              Cancelar
            </Button>
            <Button onClick={handleGerarOS} className="font-black uppercase bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
              <CheckCircle2 className="h-4 w-4" /> Gerar O.S Oficial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
