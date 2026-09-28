import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileCheck2, Paperclip, X } from "lucide-react";
import { methodNeedsBank } from "@rapifix/shared";
import { errorMessage } from "@/lib/errors";
import { Field, Input, Select } from "@/components/ui/Field";
import { useSettings } from "@/features/settings/api";
import { uploadPaymentReceipt } from "./api";

export interface PaymentDetail { bank: string; reference: string; receiptPath: string | null }
export const EMPTY_DETAIL: PaymentDetail = { bank: "", reference: "", receiptPath: null };

/** Mensaje de error si faltan datos obligatorios para el método. */
export function detailError(method: string, d: PaymentDetail): string | null {
  if (methodNeedsBank(method) && !d.bank.trim()) return "Indique el banco o la cuenta donde entró el dinero";
  return null;
}

/** Botón para subir comprobante (foto o PDF). */
export function ReceiptUpload({ value, onChange, compact }: { value: string | null; onChange: (path: string | null) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setProgress(0);
    try {
      onChange(await uploadPaymentReceipt(file, setProgress));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {value ? (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
          <FileCheck2 className="h-4 w-4" /> Comprobante adjunto
          <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 hover:bg-emerald-100" aria-label="Quitar comprobante"><X className="h-3 w-3" /></button>
        </span>
      ) : (
        <button type="button" disabled={progress !== null} onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-500 hover:text-brand-700 disabled:opacity-60">
          <Paperclip className="h-4 w-4" />
          {progress !== null ? `Subiendo ${progress}%` : compact ? "Comprobante" : "Subir comprobante (foto o PDF)"}
        </button>
      )}
    </div>
  );
}

/** Campos extra según el método: banco/terminal, referencia y comprobante. */
export function PaymentDetailFields({ method, value, onChange }: { method: string; value: PaymentDetail; onChange: (d: PaymentDetail) => void }) {
  const { settings } = useSettings();
  if (method === "cash") return null;
  const isBank = methodNeedsBank(method);
  const isCard = method === "card";
  const options = isBank ? settings.bankAccounts ?? [] : isCard ? settings.cardTerminals ?? [] : [];
  const set = (p: Partial<PaymentDetail>) => onChange({ ...value, ...p });
  // Con una sola terminal (ROKI) no se pregunta: se guarda sola.
  const singleTerminal = isCard && options.length === 1 ? options[0]! : null;
  if (singleTerminal && value.bank !== singleTerminal) queueMicrotask(() => onChange({ ...value, bank: singleTerminal }));
  return (
    <div className="space-y-4">
      {(isBank || (isCard && options.length > 1)) && (
        <Field label={isBank ? "Banco / cuenta" : "Terminal"} required={isBank} hint={isBank ? "Dónde entró el dinero, para cuadrar con el estado de cuenta." : "Con qué terminal se pasó la tarjeta."}>
          {options.length ? (
            <Select value={value.bank} onChange={(e) => set({ bank: e.target.value })}>
              <option value="">{isBank ? "Seleccione el banco…" : "Seleccione…"}</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
              {value.bank && !options.includes(value.bank) && <option value={value.bank}>{value.bank}</option>}
            </Select>
          ) : (
            <Input value={value.bank} onChange={(e) => set({ bank: e.target.value })} maxLength={60} placeholder={isBank ? "Ej. BAC Credomatic" : "Ej. ROKI"} />
          )}
        </Field>
      )}
      <Field label={isCard ? "No. de autorización / transacción" : isBank ? "No. de referencia o boleta" : "Referencia"} hint={isCard ? "El número que aparece en el voucher." : undefined}>
        <Input value={value.reference} onChange={(e) => set({ reference: e.target.value })} maxLength={80} />
      </Field>
      <Field label="Comprobante" hint={isBank ? "Foto de la boleta o captura de la transferencia." : "Opcional: foto del voucher."}>
        <ReceiptUpload value={value.receiptPath} onChange={(receiptPath) => set({ receiptPath })} />
      </Field>
    </div>
  );
}
