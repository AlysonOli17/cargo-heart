export const STATUS_LABELS = {
  operacional: "Operacional",
  programado: "Manut. Programada",
  manutencao: "Em Manutenção",
  indisponivel: "Indisponível",
  finalizacao: "Finalização",
  // Mantendo compatibilidade legada por enquanto se necessário
  disponivel: "Operacional",
  com_cliente: "Em Operação",
  em_atendimento: "Ajustes"
} as const;

export type EquipmentStatus = keyof typeof STATUS_LABELS;

export const STATUS_COLORS: Record<string, string> = {
  operacional: "bg-[oklch(0.65_0.18_150)] text-white",      // Verde
  disponivel: "bg-[oklch(0.65_0.18_150)] text-white",       // Verde (Legado)
  programado: "bg-[oklch(0.85_0.15_90)] text-amber-900",   // Amarelo
  manutencao: "bg-[oklch(0.7_0.2_50)] text-white",          // Laranja
  indisponivel: "bg-[oklch(0.6_0.22_27)] text-white",       // Vermelho
  finalizacao: "bg-[oklch(0.6_0.18_250)] text-white",       // Azul
};

export const SUB_STATUS_OPTIONS = {
  operacional: ["Operando", "Disponível", "Em apoio", "Reserva operacional"],
  programado: ["Preventiva agendada", "Lubrificação programada", "Aguardando janela", "Programado para oficina", "Checklist pendente"],
  manutencao: ["Em diagnóstico", "Em reparo", "Elétrica", "Hidráulica", "Motor", "Estrutural", "Pneus", "Solda", "Borracharia"],
  indisponivel: ["Quebra operacional", "Sem partida", "Vazamento crítico", "Freio", "Segurança", "Aguardando peça", "Aguardando fornecedor"],
  finalizacao: ["Teste operacional", "Lavagem", "Ajustes finais", "Aguardando liberação", "Liberado para operação"]
};

export const PRIORITY_COLORS = {
  "Baixa": "bg-slate-100 text-slate-600",
  "Média": "bg-blue-100 text-blue-600",
  "Alta": "bg-orange-100 text-orange-700 font-bold",
  "Crítica": "bg-red-100 text-red-700 font-black animate-pulse",
};