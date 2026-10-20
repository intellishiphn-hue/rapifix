import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { toast } from "sonner";
import { auth } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/lib/auth/useAuth";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { AuthLayout, authDisplay } from "./AuthLayout";

/** Solo rutas internas ("/algo"); nada de "//dominio" ni URLs externas. Por defecto, el panel. */
export function safeRedirect(from: unknown): string {
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/\\")) return "/";
  if (from === "/login" || from === "/recuperar") return "/";
  return from;
}

export function LoginPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = safeRedirect((location.state as { from?: unknown } | null)?.from);
  if (status === "ready" || status === "noRole") return <Navigate to={from} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Ingrese su correo y contraseña.");
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      toast.success("Bienvenido a RAPIFIX");
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-[1.75rem] leading-tight text-[#011955]" style={authDisplay}>Iniciar sesión</h2>
      <p className="mt-2 text-sm text-slate-500">Ingresa con el usuario que te asignó el administrador.</p>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate aria-busy={loading}>
        <Field label="Correo electrónico">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@correo.com" autoFocus />
        </Field>
        <Field label="Contraseña">
          <div className="relative">
            <Input type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-10" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700" aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={show}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</div>}
        <Button type="submit" size="lg" className="w-full !rounded-full !bg-[#011955] hover:!bg-[#0b2a7a]" loading={loading} icon={<LogIn className="h-4 w-4" />}>
          Entrar
        </Button>
        <div className="flex flex-col items-center gap-1 pt-1 text-center">
          <Link to="/recuperar" className="inline-flex min-h-[40px] items-center text-sm font-medium text-[#0052e0] hover:underline">¿Olvidaste tu contraseña?</Link>
          <Link to="/inicio" className="inline-flex min-h-[40px] items-center text-sm font-medium text-slate-500 hover:text-slate-800">Volver al sitio</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
