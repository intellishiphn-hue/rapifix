import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import type { Permission } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { PageLoader, EmptyState } from "@/components/ui/Feedback";
import { NoAccessPage } from "@/features/auth/NoAccessPage";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <div className="flex h-screen items-center justify-center"><PageLoader label="Iniciando RAPIFIX..." /></div>;
  if (status === "signedOut") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === "noRole") return <NoAccessPage />;
  return <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-7 w-7" />}
        title="Sin acceso a este módulo"
        description="Su rol no tiene permiso para ver esta sección. Si lo necesita, solicítelo al administrador."
      />
    );
  }
  return <>{children}</>;
}
