import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AppRole = "admin" | "operador" | "visualizador";

export function useRole() {
  const { user, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setRoles([]); setLoading(authLoading); return; }
    let active = true;
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }) => {
      if (!active) return;
      setRoles((data ?? []).map((r: { role: AppRole }) => r.role));
      setLoading(false);
    });
    return () => { active = false; };
  }, [user, authLoading]);

  return {
    roles,
    loading,
    isAdmin: roles.includes("admin"),
    isOperador: roles.includes("operador") || roles.includes("admin"),
    canWrite: roles.includes("admin") || roles.includes("operador"),
  };
}