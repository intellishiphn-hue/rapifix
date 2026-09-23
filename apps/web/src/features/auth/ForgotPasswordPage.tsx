import { useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { MailCheck } from "lucide-react";
import { auth } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { AuthLayout } from "./AuthLayout";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      auth.languageCode = "es";
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (err) {
      // Por seguridad no revelamos si el correo existe
      const msg = errorMessage(err);
      if (msg.includes("incorrectos")) setSent(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      {sent ? (
        <div>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><MailCheck className="h-6 w-6" /></div>
          <h2 className="text-2xl font-bold tracking-tight">Revise su correo</h2>
          <p className="mt-2 text-sm text-slate-500">Si el correo está registrado, recibirá un enlace para crear una nueva contraseña. Revise también la carpeta de spam.</p>
          <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-brand-700 hover:underline">Volver a iniciar sesión</Link>
        </div>
      ) : (
        <>
          <h2 className="text-2xl font-bold tracking-tight">Recuperar contraseña</h2>
          <p className="mt-1 text-sm text-slate-500">Le enviaremos un enlace para restablecerla.</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Correo electrónico">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <Button type="submit" size="lg" className="w-full" loading={loading}>Enviar enlace</Button>
            <div className="text-center">
              <Link to="/login" className="text-sm font-medium text-slate-500 hover:text-slate-800">Volver</Link>
            </div>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
