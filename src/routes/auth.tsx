import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Truck } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Entrar — Disponibilidade Frota Busato" }] }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/" });
    });
  }, [nav]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });
      
      if (error) {
        console.error("Signup error:", error);
        toast.error(error.message);
      } else if (data.user) {
        console.log("Signup success:", data.user);
        // Se a conta já existe mas não foi confirmada, o Supabase pode não retornar erro mas também não criar uma nova.
        if (data.session) {
           toast.success("Conta criada e logada!");
           nav({ to: "/" });
        } else {
           toast.success("Solicitação enviada com sucesso!", {
             description: "IMPORTANTE: Verifique seu email para confirmar o cadastro (caso necessário) e aguarde a liberação do administrador.",
             duration: 10000,
           });
           setIsSignUp(false);
           setPassword("");
        }
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.error("Login error:", error);
        toast.error(error.message);
      } else { 
        toast.success("Bem-vindo!"); 
        nav({ to: "/" }); 
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background to-secondary">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <Truck className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold">Disponibilidade Frota Busato</span>
        </div>
        <h1 className="text-2xl font-bold mb-1">{isSignUp ? "Criar conta" : "Entrar"}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {isSignUp ? "Preencha os dados para solicitar acesso" : "Gestão de frota em tempo real"}
        </p>
        
        <form onSubmit={handle} className="space-y-4">
          {isSignUp && (
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Seu nome" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="exemplo@email.com" />
          </div>
          <div className="space-y-2">
            <Label>Senha</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="Mínimo 6 caracteres" />
          </div>
          
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Processando..." : (isSignUp ? "Solicitar acesso" : "Entrar")}
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t text-center">
          <button 
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-sm text-primary hover:underline font-medium"
          >
            {isSignUp ? "Já tenho uma conta. Voltar para login" : "Não tem conta? Clique aqui para criar"}
          </button>
        </div>

        {!isSignUp && (
          <p className="mt-4 text-[10px] text-muted-foreground text-center">
            * Novos cadastros ficam bloqueados até que um administrador aprove o perfil.
          </p>
        )}
      </Card>
    </div>
  );
}