import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, Plus, Pencil, Shield, ShieldCheck, ShieldOff,
  Search, CheckCircle2, X, Mail, Lock, Eye, EyeOff,
  RefreshCw, UserCheck, UserX, Crown
} from "lucide-react";

export const Route = createFileRoute("/usuarios")({
  component: UsuariosPage,
});

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const ROLES = [
  { value: "admin", label: "Administrador", icon: Crown, color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "gerente", label: "Gerente", icon: ShieldCheck, color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "supervisor", label: "Supervisor", icon: Shield, color: "bg-sky-100 text-sky-700 border-sky-200" },
  { value: "analista", label: "Analista", icon: UserCheck, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { value: "cco_operador", label: "CCO Operador", icon: Users, color: "bg-slate-100 text-slate-700 border-slate-200" },
];

function getRoleInfo(role: string) {
  return ROLES.find(r => r.value === role) || ROLES[ROLES.length - 1];
}

export default function UsuariosPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modal de criar usuário
  const [createModal, setCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState("cco_operador");
  const [showPassword, setShowPassword] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");

  // Modal de editar usuário
  const [editModal, setEditModal] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading]);

  const loadProfiles = async () => {
    setDataLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error) setProfiles(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => { loadProfiles(); }, []);

  const filtered = profiles.filter(p =>
    (p.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (p.role || "").toLowerCase().includes(search.toLowerCase())
  );

  async function handleCreate() {
    if (!createEmail || !createPassword || !createName) {
      setCreateError("Preencha todos os campos obrigatórios.");
      return;
    }
    setCreateSaving(true);
    setCreateError("");
    try {
      // Create user in Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: createEmail,
        password: createPassword,
        options: { data: { name: createName } },
      });
      if (authError) throw authError;

      if (authData.user) {
        // Upsert profile with correct role
        const { error: profileError } = await supabase
          .from("profiles")
          .upsert({
            id: authData.user.id,
            name: createName,
            role: createRole,
            active: true,
          });
        if (profileError) throw profileError;
      }

      setCreateModal(false);
      setCreateEmail("");
      setCreateName("");
      setCreatePassword("");
      setCreateRole("cco_operador");
      await loadProfiles();
    } catch (e: any) {
      setCreateError(e.message || "Erro ao criar usuário.");
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleEdit() {
    if (!editModal) return;
    setEditSaving(true);
    try {
      await supabase
        .from("profiles")
        .update({ name: editName, role: editRole })
        .eq("id", editModal.id);
      setEditModal(null);
      await loadProfiles();
    } catch (e: any) {
      alert("Erro: " + e.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleToggleActive(profile: any) {
    await supabase
      .from("profiles")
      .update({ active: !profile.active })
      .eq("id", profile.id);
    await loadProfiles();
  }

  const isAdmin = user?.role === "admin";

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-foreground">Usuários</h1>
            <p className="text-muted-foreground text-sm font-medium">Gestão de acesso e permissões do sistema</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadProfiles} className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <RefreshCw className={cn("w-4 h-4", dataLoading && "animate-spin")} />
            </button>
            {isAdmin && (
              <button
                onClick={() => { setCreateModal(true); setCreateError(""); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Novo Usuário
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total", value: profiles.length, color: "bg-slate-50 border-slate-200 text-slate-700" },
            { label: "Ativos", value: profiles.filter(p => p.active).length, color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
            { label: "Inativos", value: profiles.filter(p => !p.active).length, color: "bg-red-50 border-red-200 text-red-700" },
            { label: "Admins", value: profiles.filter(p => p.role === "admin").length, color: "bg-purple-50 border-purple-200 text-purple-700" },
          ].map(stat => (
            <div key={stat.label} className={cn("rounded-xl border p-4", stat.color)}>
              <p className="text-2xl font-black">{stat.value}</p>
              <p className="text-xs font-bold uppercase tracking-widest opacity-70 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou perfil..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Users Table */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Usuário</th>
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Perfil</th>
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Criado em</th>
                  {isAdmin && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {dataLoading ? (
                  <tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">Carregando...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12">
                      <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground font-medium">Nenhum usuário encontrado</p>
                    </td>
                  </tr>
                ) : filtered.map(profile => {
                  const roleInfo = getRoleInfo(profile.role);
                  const RoleIcon = roleInfo.icon;
                  const isCurrentUser = profile.id === user?.id;
                  return (
                    <tr key={profile.id} className={cn(
                      "border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors",
                      !profile.active && "opacity-50"
                    )}>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="text-sm font-black text-primary">
                              {(profile.name || "?").charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-bold text-foreground">
                              {profile.name || "Sem nome"}
                              {isCurrentUser && <span className="ml-2 text-[10px] bg-primary/10 text-primary rounded-full px-2 py-0.5 font-bold">Você</span>}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">{profile.id.substring(0, 8)}...</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold", roleInfo.color)}>
                          <RoleIcon className="w-3 h-3" />
                          {roleInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold",
                          profile.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        )}>
                          {profile.active ? <CheckCircle2 className="w-3 h-3" /> : <X className="w-3 h-3" />}
                          {profile.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground font-medium">
                        {profile.created_at ? new Date(profile.created_at).toLocaleDateString("pt-BR") : "-"}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setEditModal(profile); setEditName(profile.name || ""); setEditRole(profile.role || "cco_operador"); }}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              title="Editar"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {!isCurrentUser && (
                              <button
                                onClick={() => handleToggleActive(profile)}
                                className={cn(
                                  "p-1.5 rounded-lg transition-colors",
                                  profile.active
                                    ? "text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                    : "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50"
                                )}
                                title={profile.active ? "Desativar" : "Ativar"}
                              >
                                {profile.active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create User Modal */}
      {createModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-black text-foreground text-lg">Novo Usuário</h3>
                <button onClick={() => setCreateModal(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Nome Completo *</label>
                  <input
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                    placeholder="Ex: João Silva"
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">E-mail *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="email"
                      value={createEmail}
                      onChange={e => setCreateEmail(e.target.value)}
                      placeholder="usuario@busatoloc.com.br"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Senha Inicial *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={createPassword}
                      onChange={e => setCreatePassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Perfil de Acesso *</label>
                  <div className="grid grid-cols-1 gap-2">
                    {ROLES.map(role => {
                      const Icon = role.icon;
                      return (
                        <button
                          key={role.value}
                          onClick={() => setCreateRole(role.value)}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-xl border text-left transition-all",
                            createRole === role.value
                              ? role.color + " ring-2 ring-offset-1 ring-current"
                              : "border-border text-muted-foreground hover:bg-accent"
                          )}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <div>
                            <p className="text-xs font-bold">{role.label}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {createError && (
                  <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                    {createError}
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => setCreateModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreate}
                  disabled={createSaving}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-60 transition-opacity"
                >
                  {createSaving ? "Criando..." : "Criar Usuário"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-black text-foreground text-lg">Editar Usuário</h3>
                <button onClick={() => setEditModal(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Nome</label>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground block mb-1.5">Perfil de Acesso</label>
                  <div className="grid grid-cols-1 gap-2">
                    {ROLES.map(role => {
                      const Icon = role.icon;
                      return (
                        <button
                          key={role.value}
                          onClick={() => setEditRole(role.value)}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-xl border text-left transition-all",
                            editRole === role.value
                              ? role.color + " ring-2 ring-offset-1 ring-current"
                              : "border-border text-muted-foreground hover:bg-accent"
                          )}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <p className="text-xs font-bold">{role.label}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => setEditModal(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-bold hover:bg-accent transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleEdit}
                  disabled={editSaving}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-60 transition-opacity"
                >
                  {editSaving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
