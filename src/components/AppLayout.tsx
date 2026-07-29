import { useState, useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, CalendarDays, Wrench, BarChart3, Settings,
  LogOut, Menu, X, Truck, ChevronRight, Bell, User
} from "lucide-react";

const navItems = [
  { to: "/cco", label: "CCO Dashboard", icon: LayoutDashboard, description: "Visão do dia em tempo real" },
  { to: "/programacao", label: "Programação", icon: CalendarDays, description: "Importar e gerenciar programação" },
  { to: "/corretivas", label: "Corretivas", icon: Wrench, description: "Registrar paradas e retornos" },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3, description: "Métricas e análises" },
  { to: "/cadastros", label: "Cadastros", icon: Settings, description: "Equipamentos, operadores e contratos" },
];

const ROLE_LABELS: Record<string, string> = {
  cco_operador: "CCO Operador",
  supervisor: "Supervisor",
  analista: "Analista",
  gerente: "Gerente",
  admin: "Administrador",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouterState();
  const currentPath = router.location.pathname;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`
          flex flex-col bg-card border-r border-border transition-all duration-300 z-20
          ${sidebarOpen ? "w-64" : "w-16"}
        `}
      >
        {/* Logo */}
        <div className={`flex items-center gap-3 px-4 py-5 border-b border-border ${!sidebarOpen && "justify-center px-2"}`}>
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10 shrink-0">
            <Truck className="w-5 h-5 text-primary" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <p className="font-black text-sm tracking-tight text-foreground uppercase">Busato</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">CCO System</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <ul className="space-y-1 px-2">
            {navItems.map((item) => {
              const isActive = currentPath === item.to || currentPath.startsWith(item.to + "/");
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all group
                      ${isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }
                      ${!sidebarOpen && "justify-center px-2"}
                    `}
                    title={!sidebarOpen ? item.label : undefined}
                  >
                    <item.icon className={`shrink-0 ${sidebarOpen ? "w-4 h-4" : "w-5 h-5"}`} />
                    {sidebarOpen && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User section */}
        {user && (
          <div className={`border-t border-border p-3 ${!sidebarOpen && "flex justify-center"}`}>
            {sidebarOpen ? (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate text-foreground">{user.name}</p>
                  <p className="text-[10px] text-muted-foreground font-medium truncate">
                    {ROLE_LABELS[user.role] || user.role}
                  </p>
                </div>
                <button
                  onClick={signOut}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Sair"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={signOut}
                className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Sair"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <div>
              <h1 className="font-black text-foreground text-sm uppercase tracking-wide">
                {navItems.find(n => currentPath.startsWith(n.to))?.label || "CCO"}
              </h1>
              <p className="text-[10px] text-muted-foreground font-medium">
                {navItems.find(n => currentPath.startsWith(n.to))?.description || ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LiveClock />
            <button className="p-2 rounded-lg text-muted-foreground hover:bg-accent transition-colors relative">
              <Bell className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="text-right hidden sm:block">
      <p className="font-mono font-black text-sm text-foreground">
        {time.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
      <p className="text-[10px] text-muted-foreground font-medium capitalize">
        {time.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}
      </p>
    </div>
  );
}
