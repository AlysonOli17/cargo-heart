import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock, ShieldCheck } from "lucide-react";
import logoCompleto from "@/assets/logo-completo.png";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — Disponibilidade Frota Busato" }] }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/" });
    });
  }, [nav]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error("Email ou senha incorretos. Verifique seus dados ou contate o administrador.");
    } else {
      toast.success("Bem-vindo!");
      nav({ to: "/" });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="w-full max-w-md space-y-6">
        {/* Logo card */}
        <div className="flex flex-col items-center gap-2">
          <img src={logoCompleto} alt="Busato Soluções Inteligentes" className="h-16 object-contain" />
          <span className="text-xs font-black tracking-widest uppercase text-slate-400">Gestão de Frota</span>
        </div>

        <Card className="w-full p-8 border-2 shadow-lg">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
              <Lock className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-900">Acesso Restrito</h1>
              <p className="text-xs text-slate-500 font-medium">Gestão de frota em tempo real</p>
            </div>
          </div>

          <form onSubmit={handle} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-slate-600">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="seu@email.com"
                className="font-medium"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-slate-600">Senha</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                className="font-medium"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider"
              disabled={loading}
            >
              {loading ? "Verificando..." : "Entrar"}
            </Button>
          </form>
        </Card>

        {/* Info box */}
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <ShieldCheck className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-black uppercase text-amber-800">Acesso por convite</p>
            <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
              O acesso ao sistema é concedido exclusivamente pelo administrador.
              Entre em contato com a equipe responsável para solicitar seu acesso.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}