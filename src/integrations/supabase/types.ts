export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ContractType = "Habitual" | "Eventual";
export type ContractClient = "Usina" | "Porto";
export type ShiftType = "Dia" | "Noite";
export type ScheduleStatus = "agendado" | "operando" | "corretiva" | "finalizado" | "ausente";
export type CorrectiveProblemType = "mecanico" | "eletrico" | "pneu" | "abastecimento" | "operador" | "acidente" | "outro";
export type UserRole = "cco_operador" | "supervisor" | "analista" | "gerente" | "admin";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          role: UserRole;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      contracts: {
        Row: {
          id: string;
          name: string;
          type: ContractType;
          client: ContractClient;
          active: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["contracts"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["contracts"]["Insert"]>;
      };
      equipment_types: {
        Row: {
          id: string;
          name: string;
          active: boolean;
        };
        Insert: Omit<Database["public"]["Tables"]["equipment_types"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["equipment_types"]["Insert"]>;
      };
      equipment: {
        Row: {
          id: string;
          identifier: string;
          plate: string | null;
          model: string | null;
          type_id: string | null;
          contract_id: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["equipment"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["equipment"]["Insert"]>;
      };
      operators: {
        Row: {
          id: string;
          name: string;
          active: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["operators"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["operators"]["Insert"]>;
      };
      daily_schedules: {
        Row: {
          id: string;
          date: string;
          shift: ShiftType;
          contract_id: string;
          team: string | null;
          equipment_id: string | null;
          equipment_identifier: string;
          plate: string | null;
          model: string | null;
          operator_id: string | null;
          operator_name: string | null;
          cost_center: string | null;
          location: string | null;
          activity: string | null;
          work_order: string | null;
          turno: string | null;
          schedule_start: string | null;
          schedule_end: string | null;
          status: ScheduleStatus;
          actual_start: string | null;
          actual_end: string | null;
          imported_from: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["daily_schedules"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["daily_schedules"]["Insert"]>;
      };
      correctives: {
        Row: {
          id: string;
          schedule_id: string;
          date: string;
          equipment_identifier: string;
          plate: string | null;
          contract_id: string | null;
          start_time: string;
          end_time: string | null;
          minutes_lost: number | null;
          problem_type: CorrectiveProblemType;
          description: string | null;
          resolved: boolean;
          resolution_notes: string | null;
          created_by: string | null;
          resolved_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["correctives"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["correctives"]["Insert"]>;
      };
    };
    Views: {
      v_daily_corrective_summary: {
        Row: {
          date: string;
          contract_id: string;
          contract_name: string;
          total_correctives: number;
          resolved_correctives: number;
          open_correctives: number;
          total_minutes_lost: number;
          total_hours_lost: number;
        };
      };
    };
  };
}
