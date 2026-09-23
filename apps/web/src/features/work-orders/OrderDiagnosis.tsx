import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Save, X } from "lucide-react";
import { diagnosisSchema, EMPTY_DIAGNOSIS, type DiagnosisInput, type WorkOrder } from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { saveWorkOrderSection } from "./api";

const COMMON_OBD: Record<string, string> = {
  P0300: "Fallo de encendido aleatorio",
  P0171: "Mezcla pobre (banco 1)",
  P0420: "Eficiencia del catalizador baja",
  P0442: "Fuga pequeña en sistema EVAP",
  P0128: "Temperatura del refrigerante baja",
  P0401: "Flujo EGR insuficiente",
};

export function OrderDiagnosis({ order }: { order: WorkOrder }) {
  const { can, role, user } = useAuth();
  const [value, setValue] = useState<DiagnosisInput>(EMPTY_DIAGNOSIS);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    const d = order.diagnosis;
    setValue(d ? { reportedProblem: d.reportedProblem ?? "", technicianDiagnosis: d.technicianDiagnosis ?? "", recommendations: d.recommendations ?? "", observations: d.observations ?? "", testsPerformed: d.testsPerformed ?? "", obdCodes: d.obdCodes ?? [] } : { ...EMPTY_DIAGNOSIS, reportedProblem: order.reason });
  }, [order.diagnosis, order.reason, dirty]);

  const assigned = role !== "technician" || (user && order.technicianIds.includes(user.uid));
  const editable = can("orders.diagnose") && order.isOpen && !!assigned;
  const completed = !!order.diagnosis?.completedAt;

  const set = <K extends keyof DiagnosisInput>(k: K, v: DiagnosisInput[K]) => {
    setValue((s) => ({ ...s, [k]: v }));
    setDirty(true);
  };

  const addCode = () => {
    const c = code.trim().toUpperCase();
    if (!/^[PBCU][0-9A-F]{4}$/.test(c)) {
      toast.error("Código OBD no válido (ej. P0300)");
      return;
    }
    if (!value.obdCodes.includes(c)) set("obdCodes", [...value.obdCodes, c]);
    setCode("");
  };

  const save = async (complete: boolean) => {
    const parsed = diagnosisSchema.safeParse(value);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Revise el diagnóstico");
      return;
    }
    if (complete && !parsed.data.technicianDiagnosis.trim()) {
      toast.error("Escriba el diagnóstico del técnico antes de completarlo");
      return;
    }
    setSaving(true);
    try {
      await saveWorkOrderSection({ orderId: order.id, section: "diagnosis", data: parsed.data, complete: complete || completed });
      setDirty(false);
      toast.success(complete && !completed ? "Diagnóstico completado" : "Diagnóstico guardado");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-5">
      {completed && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> Diagnóstico completado el {formatDate(order.diagnosis?.completedAt, true)}
        </div>
      )}
      {!assigned && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Solo el técnico asignado puede editar el diagnóstico.</p>}
      <fieldset disabled={!editable} className="grid gap-4 lg:grid-cols-2">
        <Field label="Problema reportado por el cliente" className="lg:col-span-2">
          <Textarea value={value.reportedProblem} onChange={(e) => set("reportedProblem", e.target.value)} rows={2} />
        </Field>
        <Field label="Diagnóstico del técnico" className="lg:col-span-2">
          <Textarea value={value.technicianDiagnosis} onChange={(e) => set("technicianDiagnosis", e.target.value)} rows={5} placeholder="Qué se encontró y por qué" />
        </Field>
        <Field label="Pruebas realizadas">
          <Textarea value={value.testsPerformed} onChange={(e) => set("testsPerformed", e.target.value)} rows={3} placeholder="Escáner, prueba de ruta, compresión..." />
        </Field>
        <Field label="Recomendaciones">
          <Textarea value={value.recommendations} onChange={(e) => set("recommendations", e.target.value)} rows={3} />
        </Field>
        <Field label="Observaciones" className="lg:col-span-2">
          <Textarea value={value.observations} onChange={(e) => set("observations", e.target.value)} rows={2} />
        </Field>
        <div className="lg:col-span-2">
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">Códigos de error OBD</div>
          <div className="flex flex-wrap items-center gap-2">
            {value.obdCodes.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-2.5 py-1 font-mono text-xs font-semibold text-white" title={COMMON_OBD[c]}>
                {c}
                {editable && <button type="button" onClick={() => set("obdCodes", value.obdCodes.filter((x) => x !== c))} aria-label={`Quitar ${c}`}><X className="h-3 w-3" /></button>}
              </span>
            ))}
            {editable && (
              <div className="flex gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCode())} placeholder="P0300" className="w-28 font-mono uppercase" maxLength={5} />
                <Button variant="secondary" onClick={addCode}>Agregar</Button>
              </div>
            )}
            {!value.obdCodes.length && !editable && <span className="text-sm text-slate-400">Sin códigos</span>}
          </div>
          {value.obdCodes.some((c) => COMMON_OBD[c]) && (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
              {value.obdCodes.filter((c) => COMMON_OBD[c]).map((c) => <li key={c}><b className="font-mono">{c}</b>: {COMMON_OBD[c]}</li>)}
            </ul>
          )}
        </div>
      </fieldset>
      {editable && (
        <div className="sticky bottom-0 -mx-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur">
          <Button variant="secondary" icon={<Save className="h-4 w-4" />} onClick={() => void save(false)} loading={saving} disabled={!dirty}>Guardar</Button>
          {!completed && <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => void save(true)} loading={saving}>Marcar diagnóstico completado</Button>}
        </div>
      )}
    </div>
  );
}
