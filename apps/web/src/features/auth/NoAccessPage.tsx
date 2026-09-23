import { useState } from "react";
import { KeyRound, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/useAuth";
import { callable } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { AuthLayout } from "./AuthLayout";

const bootstrapAdmin = callable<void, { ok: boolean }>("bootstrapAdmin");

/**
 * Usuario autenticado sin rol. Si es el primer arranque, el correo autorizado
 * (BOOTSTRAP_ADMIN_EMAIL) puede reclamar el rol de administrador una sola vez.
 */
export function NoAccessPage() {
  const { user, signOut, refreshClaims } = useAuth();
  const [loading, setLoading] = useState(false);

  const claim = async () => {
    setLoading(true);
    try {
      await bootstrapAdmin();
      await refreshClaims();
      toast.success("Listo. Ahora es administrador de RAPIFIX.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const retry = async () => {
    setLoading(true);
    await refreshClaims().catch(() => undefined);
    setLoading(false);
  };

  return (
    <AuthLayout>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><ShieldAlert className="h-6 w-6" /></div>
      <h2 className="text-2xl font-bold tracking-tight">Cuenta sin permisos</h2>
      <p className="mt-2 text-sm text-slate-500">
        La cuenta <b className="text-slate-800">{user?.email}</b> todavía no tiene un rol asignado. Pida al administrador que le asigne uno.
      </p>
      <div className="mt-8 space-y-2.5">
        <Button className="w-full" variant="secondary" onClick={retry} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>Ya me asignaron un rol</Button>
        <Button className="w-full" variant="dark" onClick={claim} loading={loading} icon={<KeyRound className="h-4 w-4" />}>Configuración inicial (primer administrador)</Button>
        <Button className="w-full" variant="ghost" onClick={() => void signOut()} icon={<LogOut className="h-4 w-4" />}>Cerrar sesión</Button>
      </div>
      <p className="mt-6 text-xs text-slate-400">La configuración inicial solo funciona una vez y únicamente para el correo autorizado del dueño.</p>
    </AuthLayout>
  );
}
