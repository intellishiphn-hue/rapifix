import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, FileCheck2, Landmark, Loader2, Paperclip, XCircle } from "lucide-react";
import { formatMoney, PROOF_MAX_BYTES, type PublicProof, type SubmitPaymentProofInput } from "@rapifix/shared";
import { callable } from "@/lib/firebase";
import { errorMessage } from "@/lib/errors";
import { compressImage, fileToBase64 } from "@/lib/storage";
import { MoneyInput } from "@/features/quotes/MoneyInput";

const submitPaymentProof = callable<SubmitPaymentProofInput, { ok: boolean }>("submitPaymentProof");

const inputCls = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100";

/** Estado del último comprobante (lo que ve el cliente mientras caja lo revisa). */
export function ProofStatus({ proof, paid }: { proof: PublicProof | null | undefined; paid: boolean }) {
  if (!proof) return null;
  if (proof.status === "pending") {
    return <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><Clock className="mt-0.5 h-4 w-4 shrink-0" /> Comprobante recibido ({formatMoney(proof.amount)}). Lo estamos verificando.</p>;
  }
  if (proof.status === "approved" && paid) {
    return <p className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Pago confirmado. ¡Gracias!</p>;
  }
  if (proof.status === "rejected") {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> No pudimos verificar su comprobante{proof.reason ? `: ${proof.reason}` : "."} Puede enviar otro o escribirnos por WhatsApp.
      </p>
    );
  }
  return null;
}

/**
 * "Ya transferí / deposité: subir comprobante". Nunca marca nada como pagado:
 * el comprobante queda por revisar hasta que caja lo aprueba.
 */
export function ProofUpload({ token, kind, banks, defaultAmount, proof }: {
  token: string;
  kind: "wash" | "order";
  banks: string[];
  defaultAmount: number;
  proof: PublicProof | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [bank, setBank] = useState(banks.length === 1 ? banks[0]! : "");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(defaultAmount);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Si caja rechaza el comprobante, se vuelve a ofrecer el formulario
  useEffect(() => {
    if (proof?.status && proof.status !== "pending") setSent(false);
  }, [proof?.status, proof?.at]);

  const pending = proof?.status === "pending";
  if (pending || sent) {
    return sent && !pending
      ? <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><Clock className="mt-0.5 h-4 w-4 shrink-0" /> Comprobante recibido. Lo estamos verificando.</p>
      : null;
  }

  const pick = (f: File | undefined) => {
    setError("");
    if (!f) return;
    if (!(f.type.startsWith("image/") || f.type === "application/pdf")) return setError("El comprobante debe ser una foto o un PDF.");
    if (f.type === "application/pdf" && f.size > PROOF_MAX_BYTES) return setError("El PDF supera 5 MB.");
    setFile(f);
  };

  const send = async () => {
    setError("");
    if (!bank.trim()) return setError("Seleccione el banco donde transfirió o depositó.");
    if (amount <= 0) return setError("Indique el monto que pagó.");
    if (!file) return setError("Adjunte la foto o el PDF del comprobante.");
    setBusy(true);
    try {
      let blob: Blob = file;
      let contentType: SubmitPaymentProofInput["contentType"] = "application/pdf";
      if (file.type !== "application/pdf") {
        blob = await compressImage(file);
        contentType = "image/jpeg";
      }
      if (blob.size > PROOF_MAX_BYTES) throw new Error("El archivo supera 5 MB.");
      const fileBase64 = await fileToBase64(blob);
      await submitPaymentProof({ token, kind, bank: bank.trim(), reference: reference.trim(), amount, fileBase64, contentType });
      setSent(true);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-800 hover:bg-slate-50">
        <Landmark className="h-5 w-5 text-slate-500" /> Ya transferí / deposité: subir comprobante
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-4">
      <p className="font-semibold text-slate-900">Subir comprobante de transferencia o depósito</p>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Banco donde pagó</span>
        {banks.length ? (
          <select value={bank} onChange={(e) => setBank(e.target.value)} className={inputCls}>
            <option value="">Seleccione el banco…</option>
            {banks.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        ) : (
          <input value={bank} onChange={(e) => setBank(e.target.value)} maxLength={60} placeholder="Ej. BAC Credomatic" className={inputCls} />
        )}
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Número de referencia <span className="font-normal text-slate-400">(opcional)</span></span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className={inputCls} />
      </label>
      <div className="text-sm">
        <span className="mb-1 block font-medium text-slate-700">Monto</span>
        <MoneyInput value={amount} onChange={setAmount} />
      </div>
      <div className="text-sm">
        <span className="mb-1 block font-medium text-slate-700">Foto o PDF del comprobante</span>
        <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" onClick={() => input.current?.click()} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white text-sm font-semibold text-slate-600 hover:border-brand-500 hover:text-brand-700">
          {file ? <><FileCheck2 className="h-4 w-4 text-emerald-600" /> <span className="truncate">{file.name}</span></> : <><Paperclip className="h-4 w-4" /> Elegir foto o PDF</>}
        </button>
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)} className="h-11 flex-1 rounded-xl border border-slate-200 bg-white text-sm font-semibold">Volver</button>
        <button onClick={() => void send()} disabled={busy} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Enviar comprobante
        </button>
      </div>
      <p className="text-xs text-slate-500">Revisamos cada comprobante con el banco. Le confirmamos el pago en este mismo link.</p>
    </div>
  );
}
