import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Using untyped client to avoid conflicts with existing schema types
export const supabase = createClient(supabaseUrl, supabaseKey);
