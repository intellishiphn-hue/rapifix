import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { collection, limit, query, where } from "firebase/firestore";
import { Check, Droplets, FileText, Wrench, X } from "lucide-react";
import {
  catalogCol, formatMoney, PAYMENT_METHOD_LABELS, PROOF_METHODS,
  type PaymentProof, type ReviewPaymentProofInput, type ReviewPaymentProofResult,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useAuth } from "@/lib/auth/useAuth";
import { useQueryData } from "@/lib/firestore/hooks";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatPlate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { MoneyInput } from "@/features/quotes/MoneyInput";
import { openPaymentReceipt } from "./api";

export const reviewPaymentProof = callable<ReviewPaymentProofInput, ReviewPaymentProofResult>("reviewPaymentProof");

/** Caja (admin, gerencia, recepción, vendedor) revisa los comprobantes. */
export function useCanReviewProofs() {
  const { can } = useAuth();
  return can("payments.read");
}

/**
 * Comprobantes por revisar (lavados y órdenes), en tiempo real. Un solo campo en la consulta (sin índices compuestos);
 * se ordena en memoria. Firestore comparte la misma suscripción entre los componentes que la usan.
 */
export function usePendingProofs(enabled = true) {
  const state = useQueryData<PaymentProof>(
    enabled ? query(collection(db, catalogCol.paymentProofs(TENANT_ID)), where("status", "==", "pending"), limit(200)) : null,
    `payment-proofs-pending|${enabled}`,
  );
  const data = [...state.data].sort((a, b) => msOf(a.createdAt) - msOf(b.createdAt));
  return { ...state, data };
}

const msOf = (v: unknown): number => {
  const t = v as { toMillis?: () => number; seconds?: number } | null;
  return t?.toMillis ? t.toMillis() : typeof t?.seconds === "number" ? t.seconds * 1000 : 0;
};

/** Link al lavado (cola del carwash) o a la pestaña Pagos de la orden. */
export const proofTargetUrl = (p: PaymentProof) => (p.kind === "wash" ? `/carwash?lavado=${p.washId}` : `/ordenes/${p.orderId}?tab=pagos`);

/** Un comprobante enviado por el cliente: ver archivo, aprobar (registra el pago) o rechazar. */
export function ProofReviewCard({ proof: p, washTotal, orderBalance, showTarget }: { proof: PaymentProof; washTotal?: number; orderBalance?: number; showTarget?: boolean }) {
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [method, setMethod] = useState<(typeof PROOF_METHODS)[number]>("transfer");
  const isWash = p.kind === "wash";
  const [amount, setAmount] = useState(isWash ? washTotal ?? p.amount : Math.min(p.amount, orderBalance ?? p.amount));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (mode === "reject" && reason.trim().length < 3) return toast.error("Indique el motivo del rechazo");
    if (mode === "approve" && !isWash && amount <= 0) return toast.error("Indique el monto");
    setBusy(true);
    try {
      const r = await reviewPaymentProof(
        mode === "approve"
          ? { proofId: p.id, action: "approve", method, ...(isWash ? {} : { amount }) }
          : { proofId: p.id, action: "reject", reason: reason.trim() },
      );
      toast.success(r.already ? "Este comprobante ya estaba revisado." : r.status === "approved" ? `Pago registrado: ${p.code}` : "Comprobante rechazado. El cliente verá el motivo en su link.");
      setMode("idle");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
            {isWash ? <Droplets className="h-4 w-4 text-sky-600" /> : <Wrench className="h-4 w-4 text-slate-500" />}
            {showTarget ? <Link to={proofTargetUrl(p)} className="text-brand-700 hover:underline">{p.code}</Link> : p.code}
            {p.plate && <span className="rounded border border-slate-400 px-1 font-mono text-xs">{formatPlate(p.plate)}</span>}
            {p.customerName && <span className="font-normal text-slate-600">{p.customerName}</span>}
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            {p.bank}{p.reference ? ` · Ref. ${p.reference}` : ""} · enviado {formatDate(p.createdAt, true)}
          </div>
        </div>
        <div className="tabular text-base font-bold text-slate-900">{formatMoney(p.amount)}</div>
      </div>

      {mode === "idle" && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => void openPaymentReceipt(p.receiptPath).catch((e) => toast.error(errorMessage(e)))}>
            Ver comprobante
          </Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" icon={<Check className="h-4 w-4" />} onClick={() => setMode("approve")}>Aprobar</Button>
          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<X className="h-4 w-4" />} onClick={() => setMode("reject")}>Rechazar</Button>
        </div>
      )}

      {mode === "approve" && (
        <div className="mt-3 space-y-3 rounded-lg bg-white p-3">
          <p className="text-xs text-slate-600">Confirme que el dinero ya aparece en la cuenta {p.bank ? `de ${p.bank}` : ""} antes de aprobar. Se registra el pago con este comprobante.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Método">
              <Select value={method} onChange={(e) => setMethod(e.target.value as (typeof PROOF_METHODS)[number])}>
                {PROOF_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
              </Select>
            </Field>
            {isWash ? (
              <Field label="Monto" hint="El lavado se cobra completo.">
                <div className="tabular flex h-10 items-center font-semibold">{washTotal != null ? formatMoney(washTotal) : "Total del lavado"}</div>
              </Field>
            ) : (
              <Field label="Monto" hint={orderBalance != null ? `Saldo de la orden: ${formatMoney(orderBalance)}` : undefined}>
                <MoneyInput value={amount} onChange={setAmount} />
              </Field>
            )}
          </div>
          {isWash && washTotal != null && washTotal !== p.amount && (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">El cliente indicó {formatMoney(p.amount)} y el lavado es de {formatMoney(washTotal)}. Si el monto no cuadra, rechace y cobre en caja.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Volver</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" loading={busy} onClick={() => void submit()}>Aprobar y registrar pago</Button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="mt-3 space-y-3 rounded-lg bg-white p-3">
          <Field label="Motivo (lo verá el cliente)" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder="Ej.: no aparece en el estado de cuenta; la foto no se lee" autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Volver</Button>
            <Button size="sm" variant="danger" loading={busy} onClick={() => void submit()}>Rechazar comprobante</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Comprobantes pendientes de un lavado o de una orden (aviso ámbar con las acciones). */
export function PendingProofsPanel({ washId, orderId, washTotal, orderBalance, className }: { washId?: string; orderId?: string; washTotal?: number; orderBalance?: number; className?: string }) {
  const canReview = useCanReviewProofs();
  const { data } = usePendingProofs(canReview);
  const list = data.filter((p) => (washId ? p.washId === washId : orderId ? p.orderId === orderId : false));
  if (!canReview || !list.length) return null;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Comprobante por revisar ({list.length})</div>
      {list.map((p) => <ProofReviewCard key={p.id} proof={p} washTotal={washTotal} orderBalance={orderBalance} />)}
    </div>
  );
}
