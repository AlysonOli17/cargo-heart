// Forçando as chaves diretamente para evitar erros de ambiente na Vercel
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// ENDEREÇOS TRAVADOS (NÃO EDITAR)
const FIXED_URL = "https://zqzutizokctwpagnxanw.supabase.co";
const FIXED_KEY = "sb_publishable_ZqQhQ4v5-vHIwz_liZ4zfQ_7PXnWE6i";

function createSupabaseClient() {
  // Ignora completamente o ambiente e usa os valores fixos
  return createClient<Database>(FIXED_URL, FIXED_KEY, {
    auth: {
      storage: typeof window !== 'undefined' ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    }
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
