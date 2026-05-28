import { supabase } from "@/integrations/supabase/client";

export interface Contract {
  id: string;
  name: string;
  description?: string;
}

export interface Equipment {
  id: string;
  identifier: string; // Plate / tag
  type: string;       // Escavadeira, Caminhão, etc.
  brand?: string;
  model?: string;
  status: 'disponivel' | 'com_cliente' | 'manutencao';
  current_client_id: string | null; // Assigned contract ID
  is_reserve: boolean; // Spare equipment flag
  notes: string;
}

export interface Movement {
  id: string;
  created_at: string;
  equipment_id: string;
  equipment_identifier: string;
  equipment_type: string;
  from_contract: string | null;
  to_contract: string | null;
  status: string;
  notes: string;
}

// Seed data
const DEFAULT_CONTRACTS: Contract[] = [
  { id: "c1", name: "Contrato Vale S.A. - Mina de Carajás" },
  { id: "c2", name: "Contrato Anglo American - Minas-Rio" },
  { id: "c3", name: "Contrato CSN Mineração - Casa de Pedra" },
  { id: "c4", name: "Contrato ArcelorMittal - Serra Azul" }
];

const DEFAULT_EQUIPMENT: Equipment[] = [
  { id: "eq1", identifier: "ESC-201", type: "Escavadeira Hidráulica", brand: "CAT", model: "320D L", status: "com_cliente", current_client_id: "c1", is_reserve: false, notes: "Operando em turno A" },
  { id: "eq2", identifier: "CAM-502", type: "Caminhão Fora de Estrada", brand: "Komatsu", model: "HD785", status: "com_cliente", current_client_id: "c1", is_reserve: false, notes: "Transporte de minério" },
  { id: "eq3", identifier: "ESC-202", type: "Escavadeira Hidráulica", brand: "CAT", model: "320D L", status: "disponivel", current_client_id: null, is_reserve: true, notes: "Equipamento reserva estratégico na base" },
  { id: "eq4", identifier: "CAM-503", type: "Caminhão Fora de Estrada", brand: "Komatsu", model: "HD785", status: "disponivel", current_client_id: null, is_reserve: true, notes: "Reserva disponível" },
  { id: "eq5", identifier: "GER-101", type: "Gerador de Energia", brand: "Cummins", model: "500kVA", status: "com_cliente", current_client_id: "c2", is_reserve: false, notes: "Alimentando britagem" },
  { id: "eq6", identifier: "PA-301", type: "Pá Carregadeira", brand: "Volvo", model: "L120H", status: "manutencao", current_client_id: null, is_reserve: false, notes: "Troca de mangueira hidráulica" },
  { id: "eq7", identifier: "PA-302", type: "Pá Carregadeira", brand: "Volvo", model: "L120H", status: "disponivel", current_client_id: null, is_reserve: true, notes: "Reserva disponível" },
  { id: "eq8", identifier: "ESC-203", type: "Escavadeira Hidráulica", brand: "John Deere", model: "210G", status: "com_cliente", current_client_id: "c3", is_reserve: false, notes: "Operando na praça de britagem" }
];

const DEFAULT_MOVEMENTS: Movement[] = [
  {
    id: "m1",
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    equipment_id: "eq1",
    equipment_identifier: "ESC-201",
    equipment_type: "Escavadeira Hidráulica",
    from_contract: null,
    to_contract: "Contrato Vale S.A. - Mina de Carajás",
    status: "com_cliente",
    notes: "Mobilização inicial do contrato"
  },
  {
    id: "m2",
    created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    equipment_id: "eq6",
    equipment_identifier: "PA-301",
    equipment_type: "Pá Carregadeira",
    from_contract: "Contrato Anglo American - Minas-Rio",
    to_contract: null,
    status: "manutencao",
    notes: "Retirado para manutenção preventiva"
  }
];

// LocalStorage helpers
const getLocal = <T>(key: string, def: T): T => {
  if (typeof window === "undefined") return def;
  const val = localStorage.getItem(key);
  return val ? JSON.parse(val) : def;
};

const setLocal = <T>(key: string, val: T) => {
  if (typeof window !== "undefined") {
    localStorage.setItem(key, JSON.stringify(val));
  }
};

// Main Data Access Interface
export const DataService = {
  // --- CONTRACTS ---
  async getContracts(): Promise<Contract[]> {
    try {
      const { data, error } = await supabase.from("clients").select("id, name, notes").order("name");
      if (error || !data) throw error || new Error("No data");
      return data.map(c => ({ id: c.id, name: c.name, description: c.notes || "" }));
    } catch (e) {
      console.warn("Supabase contracts failed, using localStorage fallback", e);
      const local = getLocal<Contract[]>("app_contracts", []);
      if (local.length === 0) {
        setLocal("app_contracts", DEFAULT_CONTRACTS);
        return DEFAULT_CONTRACTS;
      }
      return local;
    }
  },

  async addContract(name: string, description: string): Promise<Contract> {
    const newContract: Contract = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      name,
      description
    };
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("clients").insert({
        id: newContract.id,
        name,
        notes: description,
        owner_id: user?.user?.id || "fallback-owner"
      }).select().single();
      if (error || !data) throw error || new Error("Insert failed");
      return { id: data.id, name: data.name, description: data.notes || "" };
    } catch (e) {
      console.warn("Supabase add contract failed, using localStorage fallback", e);
      const list = await this.getContracts();
      list.push(newContract);
      setLocal("app_contracts", list);
      return newContract;
    }
  },

  // --- EQUIPMENT ---
  async getEquipment(): Promise<Equipment[]> {
    try {
      const { data, error } = await supabase.from("equipment").select("*").order("identifier");
      if (error || !data) throw error || new Error("No data");
      return data.map(e => {
        let is_reserve = false;
        let cleanNotes = e.notes || "";
        try {
          if (e.notes && (e.notes.startsWith("{") || e.notes.startsWith("["))) {
            const parsed = JSON.parse(e.notes);
            is_reserve = !!parsed.is_reserve;
            cleanNotes = parsed.realNotes || "";
          } else if (e.notes && e.notes.includes("[RESERVE]")) {
            is_reserve = true;
            cleanNotes = e.notes.replace("[RESERVE]", "").trim();
          }
        } catch (_) {}
        
        return {
          id: e.id,
          identifier: e.identifier,
          type: e.type || "Outro",
          brand: e.brand || "",
          model: e.model || "",
          status: e.status === "com_cliente" ? "com_cliente" : e.status === "manutencao" ? "manutencao" : "disponivel",
          current_client_id: e.current_client_id,
          is_reserve,
          notes: cleanNotes
        };
      });
    } catch (e) {
      console.warn("Supabase equipment failed, using localStorage fallback", e);
      const local = getLocal<Equipment[]>("app_equipment", []);
      if (local.length === 0) {
        setLocal("app_equipment", DEFAULT_EQUIPMENT);
        return DEFAULT_EQUIPMENT;
      }
      return local;
    }
  },

  async saveEquipment(eq: Omit<Equipment, "id"> & { id?: string }): Promise<Equipment> {
    const id = eq.id || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
    const serializedNotes = JSON.stringify({
      realNotes: eq.notes,
      is_reserve: eq.is_reserve
    });

    const mapped = {
      id,
      identifier: eq.identifier,
      type: eq.type,
      brand: eq.brand || null,
      model: eq.model || null,
      status: eq.status,
      current_client_id: eq.status === "com_cliente" ? eq.current_client_id : null,
      notes: serializedNotes,
    };

    try {
      const { data: user } = await supabase.auth.getUser();
      let res;
      if (eq.id) {
        const { data, error } = await supabase.from("equipment")
          .update({ ...mapped, updated_at: new Date().toISOString() })
          .eq("id", eq.id)
          .select()
          .single();
        if (error) throw error;
        res = data;
      } else {
        const { data, error } = await supabase.from("equipment")
          .insert({ ...mapped, owner_id: user?.user?.id || "fallback-owner" })
          .select()
          .single();
        if (error) throw error;
        res = data;
      }

      return {
        id: res.id,
        identifier: res.identifier,
        type: res.type || "",
        brand: res.brand || "",
        model: res.model || "",
        status: res.status === "com_cliente" ? "com_cliente" : res.status === "manutencao" ? "manutencao" : "disponivel",
        current_client_id: res.current_client_id,
        is_reserve: eq.is_reserve,
        notes: eq.notes
      };
    } catch (e) {
      console.warn("Supabase save equipment failed, using localStorage fallback", e);
      const list = await this.getEquipment();
      const finalEq: Equipment = { ...eq, id };
      const idx = list.findIndex(item => item.id === id);
      if (idx >= 0) {
        list[idx] = finalEq;
      } else {
        list.push(finalEq);
      }
      setLocal("app_equipment", list);
      return finalEq;
    }
  },

  async deleteEquipment(id: string): Promise<boolean> {
    try {
      const { error } = await supabase.from("equipment").delete().eq("id", id);
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn("Supabase delete equipment failed, using localStorage fallback", e);
      const list = await this.getEquipment();
      const filtered = list.filter(item => item.id !== id);
      setLocal("app_equipment", filtered);
      return true;
    }
  },

  // --- MOVEMENTS ---
  async getMovements(): Promise<Movement[]> {
    try {
      const { data, error } = await supabase.from("movements").select(`
        id, created_at, to_status, notes, equipment_id,
        equipment ( identifier, type )
      `).order("created_at", { ascending: false });
      if (error || !data) throw error;
      
      // Let's load contracts to resolve contract names
      const contracts = await this.getContracts();
      const contractMap = new Map(contracts.map(c => [c.id, c.name]));

      return data.map((m: any) => ({
        id: m.id,
        created_at: m.created_at,
        equipment_id: m.equipment_id,
        equipment_identifier: m.equipment?.identifier || "Equipamento",
        equipment_type: m.equipment?.type || "Outro",
        from_contract: null,
        to_contract: m.to_status === "com_cliente" ? (contractMap.get(m.notes || "") || m.notes) : null,
        status: m.to_status,
        notes: m.notes || "Movimentação padrão"
      }));
    } catch (e) {
      console.warn("Supabase movements failed, using localStorage fallback", e);
      const local = getLocal<Movement[]>("app_movements", []);
      if (local.length === 0) {
        setLocal("app_movements", DEFAULT_MOVEMENTS);
        return DEFAULT_MOVEMENTS;
      }
      return local;
    }
  },

  async logMovement(equipment: Equipment, fromContractName: string | null, toContractName: string | null, actionNotes: string): Promise<Movement> {
    const newMovement: Movement = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      created_at: new Date().toISOString(),
      equipment_id: equipment.id,
      equipment_identifier: equipment.identifier,
      equipment_type: equipment.type,
      from_contract: fromContractName,
      to_contract: toContractName,
      status: equipment.status,
      notes: actionNotes
    };

    try {
      const { data: user } = await supabase.auth.getUser();
      await supabase.from("movements").insert({
        equipment_id: equipment.id,
        to_status: equipment.status,
        notes: actionNotes || (toContractName ? `Alocado ao contrato ${toContractName}` : `Alterado para ${equipment.status}`),
        owner_id: user?.user?.id || "fallback-owner"
      });
    } catch (e) {
      console.warn("Supabase log movement failed, logged to local storage only", e);
    }

    const list = await this.getMovements();
    list.unshift(newMovement);
    setLocal("app_movements", list);
    return newMovement;
  }
};
