import { useState } from "react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { MailCheck } from "lucide-react";
import { auth } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { AuthLayout, authDisplay } from "./AuthLayout";

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
          <h2 className="text-[1.6rem] leading-tight text-[#011955]" style={authDisplay}>Revisa tu correo</h2>
          <p className="mt-2 text-sm text-slate-500">Si el correo está registrado, recibirás un enlace para crear una nueva contraseña. Revisa también la carpeta de spam.</p>
          <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-[#0052e0] hover:underline">Volver a iniciar sesión</Link>
        </div>
      ) : (
        <>
          <h2 className="text-[1.75rem] leading-tight text-[#011955]" style={authDisplay}>Recuperar contraseña</h2>
          <p className="mt-2 text-sm text-slate-500">Te enviaremos un enlace para restablecerla.</p>
          <form onSubmit={submit} className="mt-8 space-y-4" aria-busy={loading}>
            <Field label="Correo electrónico">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </Field>
            {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</div>}
            <Button type="submit" size="lg" className="w-full !rounded-full !bg-[#011955] hover:!bg-[#0b2a7a]" loading={loading}>Enviar enlace</Button>
            <div className="text-center">
              <Link to="/login" className="inline-flex min-h-[40px] items-center text-sm font-medium text-slate-500 hover:text-slate-800">Volver a iniciar sesión</Link>
            </div>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
