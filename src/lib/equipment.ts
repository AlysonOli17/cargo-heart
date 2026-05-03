export const STATUS_LABELS = {
  disponivel: "Disponível",
  com_cliente: "Com Cliente",
  manutencao: "Manutenção",
  em_atendimento: "Em Atendimento",
} as const;

export type EquipmentStatus = keyof typeof STATUS_LABELS;

export const STATUS_COLORS: Record<EquipmentStatus, string> = {
  disponivel: "bg-[oklch(0.65_0.18_150)] text-white",
  com_cliente: "bg-[oklch(0.6_0.18_250)] text-white",
  manutencao: "bg-[oklch(0.65_0.2_50)] text-white",
  em_atendimento: "bg-[oklch(0.6_0.2_300)] text-white",
};