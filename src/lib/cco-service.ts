import { supabase } from "@/integrations/supabase/client";

export type DailySchedule = {
  id: string; date: string; shift: string; contract_id: string;
  team: string | null; equipment_id: string | null; equipment_identifier: string;
  plate: string | null; model: string | null; operator_id: string | null;
  operator_name: string | null; cost_center: string | null; location: string | null;
  activity: string | null; work_order: string | null; turno: string | null;
  schedule_start: string | null; schedule_end: string | null;
  status: "agendado" | "operando" | "corretiva" | "finalizado" | "ausente";
  actual_start: string | null; actual_end: string | null;
  imported_from: string | null; created_by: string | null;
  created_at: string; updated_at: string;
};

export type Corrective = {
  id: string; schedule_id: string; date: string;
  equipment_identifier: string; plate: string | null; contract_id: string | null;
  start_time: string; end_time: string | null; minutes_lost: number | null;
  problem_type: string; description: string | null; resolved: boolean;
  resolution_notes: string | null; created_by: string | null;
  resolved_by: string | null; created_at: string; updated_at: string;
};

export type Contract = {
  id: string; name: string; type: string; client: string; active: boolean; created_at: string;
};

export type Equipment = {
  id: string; identifier: string; plate: string | null; model: string | null;
  type_id: string | null; contract_id: string | null; active: boolean; created_at: string;
};

export type Operator = {
  id: string; name: string; active: boolean; created_at: string;
};

export type Profile = {
  id: string; name: string; role: string; active: boolean; created_at: string; updated_at: string;
};

const db = supabase as any;

// ── Contracts ────────────────────────────────────────────────────────────────
export async function getContracts(): Promise<Contract[]> {
  const { data, error } = await db.from("contracts").select("*").eq("active", true).order("name");
  if (error) throw error;
  return data || [];
}

// ── Daily Schedules ───────────────────────────────────────────────────────────
export async function getSchedulesByDate(date: string) {
  const { data, error } = await db
    .from("daily_schedules")
    .select(`*, contracts(name, type, client)`)
    .eq("date", date)
    .order("shift")
    .order("team")
    .order("equipment_identifier");
  if (error) throw error;
  return data || [];
}

export async function getSchedulesByDateRange(startDate: string, endDate: string) {
  const { data, error } = await db
    .from("daily_schedules")
    .select(`*, contracts(name, type, client)`)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertSchedules(schedules: Partial<DailySchedule>[]) {
  const { data, error } = await db.from("daily_schedules").insert(schedules).select();
  if (error) throw error;
  return data || [];
}

export async function updateScheduleStatus(id: string, status: DailySchedule["status"], extra?: { actual_start?: string; actual_end?: string }) {
  const { error } = await db.from("daily_schedules").update({ status, ...extra }).eq("id", id);
  if (error) throw error;
}

export async function deleteSchedulesByDate(date: string) {
  const { error } = await db.from("daily_schedules").delete().eq("date", date);
  if (error) throw error;
}

// ── Correctives ───────────────────────────────────────────────────────────────
export async function getCorrectivesByDate(date: string) {
  const { data, error } = await db
    .from("correctives")
    .select(`*, daily_schedules(equipment_identifier, plate, operator_name, team), contracts(name)`)
    .eq("date", date)
    .order("start_time", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getCorrectivesByDateRange(startDate: string, endDate: string) {
  const { data, error } = await db
    .from("correctives")
    .select(`*, daily_schedules(equipment_identifier, plate, operator_name, team), contracts(name, type, client)`)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: false })
    .order("start_time", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function openCorrective(payload: {
  schedule_id: string; date: string; equipment_identifier: string;
  plate: string | null; contract_id: string | null; start_time: string;
  problem_type: string; description?: string; created_by?: string;
}) {
  const { data, error } = await db
    .from("correctives")
    .insert({ ...payload, resolved: false })
    .select()
    .single();
  if (error) throw error;
  await updateScheduleStatus(payload.schedule_id, "corretiva");
  return data;
}

export async function closeCorrective(id: string, end_time: string, resolution_notes?: string, resolved_by?: string) {
  const { data, error } = await db
    .from("correctives")
    .update({ end_time, resolution_notes, resolved_by })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getOpenCorrectives() {
  const { data, error } = await db
    .from("correctives")
    .select(`*, daily_schedules(equipment_identifier, plate, operator_name, location, team), contracts(name)`)
    .eq("resolved", false)
    .order("start_time");
  if (error) throw error;
  return data || [];
}

// ── Equipment ─────────────────────────────────────────────────────────────────
export async function getEquipment() {
  const { data, error } = await db
    .from("equipment")
    .select(`*, equipment_types(name), contracts(name)`)
    .eq("active", true)
    .order("identifier");
  if (error) throw error;
  return data || [];
}

// ── Operators ─────────────────────────────────────────────────────────────────
export async function getOperators(): Promise<Operator[]> {
  const { data, error } = await db.from("operators").select("*").eq("active", true).order("name");
  if (error) throw error;
  return data || [];
}

// ── Metrics ───────────────────────────────────────────────────────────────────
export async function getDailySummary(date: string) {
  const { data, error } = await db.from("v_daily_corrective_summary").select("*").eq("date", date);
  if (error) throw error;
  return data || [];
}

export async function getCorrectiveStats(startDate: string, endDate: string) {
  const { data, error } = await db
    .from("correctives")
    .select(`date, equipment_identifier, plate, contract_id, minutes_lost, problem_type, resolved, contracts(name, type, client)`)
    .gte("date", startDate)
    .lte("date", endDate);
  if (error) throw error;
  return data || [];
}
