import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, CreditCard, Save } from "lucide-react";
import type { OnlinePayConfigStatus } from "@rapifix/shared";
import { callable } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";

const getOnlinePayConfig = callable<Record<string, never>, OnlinePayConfigStatus>("getOnlinePayConfig");
const saveOnlinePayConfig = callable<{ enabled: boolean; serviceFee: boolean; secretKey?: string; webhookSecret?: string }, { ok: boolean; portals: number }>("saveOnlinePayConfig");

/** Pagos en línea con ROKI. Las llaves se escriben aquí y nunca se vuelven a mostrar. */
export function OnlinePayCard({ isAdmin }: { isAdmin: boolean }) {
  const [cfg, setCfg] = useState<OnlinePayConfigStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [serviceFee, setServiceFee] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await getOnlinePayConfig({});
      setCfg(c);
      setEnabled(c.enabled);
      setServiceFee(c.serviceFee);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const save = async () => {
    const key = secretKey.trim();
    if (key && !/^sk_(test|live)_[A-Za-z0-9]+$/.test(key)) {
      toast.error("La llave secreta debe empezar con sk_test_ o sk_live_");
      return;
    }
    setSaving(true);
    try {
      const r = await saveOnlinePayConfig({ enabled, serviceFee, ...(key ? { secretKey: key } : {}), ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}) });
      toast.success(enabled ? `Pagos en línea activos (${r.portals} links actualizados)` : "Configuración guardada");
      setSecretKey("");
      setWebhookSecret("");
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast.success("Copiado"));

  return (
    <Card>
      <CardHeader title="Pagos en línea (ROKI)" description="Botón 'Pagar en línea' en el link que recibe el cliente." />
      <div className="space-y-4 p-5 text-sm">
        {!cfg ? (
          <p className="text-slate-500">Cargando…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <CreditCard className="h-4 w-4 text-slate-400" />
              <span className={cfg.enabled ? "font-semibold text-emerald-700" : "font-semibold text-slate-500"}>{cfg.enabled ? "Activo" : "Inactivo"}</span>
              {cfg.environment && (
                <span className={cfg.environment === "live" ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700" : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700"}>
                  {cfg.environment === "live" ? "PRODUCCIÓN" : "PRUEBAS (sandbox)"}
                </span>
              )}
            </div>
            <div className="space-y-1 text-xs text-slate-500">
              <p>Llave secreta: {cfg.keyLast4 ? <b className="text-slate-700">••••{cfg.keyLast4}</b> : "sin configurar"}</p>
              <p>Secreto del webhook: {cfg.hasWebhookSecret ? <b className="text-slate-700">configurado</b> : "sin configurar"}</p>
            </div>

            <Field label="URL del webhook" hint="Regístrela en el portal de ROKI → Connect → Webhooks, en el mismo ambiente de la llave.">
              <div className="flex gap-2">
                <Input readOnly value={cfg.webhookUrl} className="font-mono text-xs" />
                <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => copy(cfg.webhookUrl)} aria-label="Copiar URL" />
              </div>
            </Field>

            {isAdmin ? (
              <>
                <Field label={cfg.keyLast4 ? "Cambiar llave secreta" : "Llave secreta"} hint="sk_test_… para pruebas o sk_live_… para cobrar de verdad. No se vuelve a mostrar.">
                  <Input type="password" autoComplete="off" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="sk_test_…" className="font-mono" />
                </Field>
                <Field label={cfg.hasWebhookSecret ? "Cambiar secreto del webhook" : "Secreto del webhook"} hint="Se muestra en ROKI al registrar el webhook.">
                  <Input type="password" autoComplete="off" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} className="font-mono" />
                </Field>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-brand-600" />
                  Mostrar "Pagar en línea" a los clientes
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={serviceFee} onChange={(e) => setServiceFee(e.target.checked)} className="h-4 w-4 accent-brand-600" />
                  Cobrar la comisión de la pasarela al cliente
                </label>
                <Button className="w-full" icon={<Save className="h-4 w-4" />} loading={saving} onClick={() => void save()}>Guardar pagos en línea</Button>
              </>
            ) : (
              <p className="text-xs text-slate-500">Solo el administrador puede cambiar esta configuración.</p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
