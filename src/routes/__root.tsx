import { Outlet, createRootRoute, redirect } from "@tanstack/react-router";
import { AuthProvider, useAuth } from "@/hooks/use-auth";

function RootInner() {
  return <Outlet />;
}

export const Route = createRootRoute({
  component: () => (
    <AuthProvider>
      <RootInner />
    </AuthProvider>
  ),
});
