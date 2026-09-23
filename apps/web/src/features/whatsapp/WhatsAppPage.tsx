import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Eye, History, Info, MessageCircle, RotateCcw, Save, Search } from "lucide-react";
import {
  DEFAULT_TEMPLATES, formatMoney, formatPhone, normalizeText, renderTemplate, TEMPLATE_VARIABLE_LABELS, TEMPLATE_VARIABLES,
  type DefaultTemplate,
} from "@rapifix/shared";
import { useAuth } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { useSettings } from "@/features/settings/api";
import { saveTemplate, useMessageLog, useTemplateOverrides } from "./api";

type Tab = "history" | "templates";

const SAMPLE = (taller: string) => ({
  cliente: "Juan",
  vehiculo: "Toyota Hilux 2021",
  placa: "HAB 1234",
  orden: "OT-1024",
  total: formatMoney(1955_00),
  link: `${window.location.origin}/orden/ABCD2345EF`,
  taller,
  servicio: "su cambio de aceite",
  ultimo: "Su último servicio con nosotros fue el 5 jun 2026 a los 80,000 km.",
});

/** Muestra *negritas* como en WhatsApp */
function WhatsAppPreview({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <div className="rounded-2xl bg-[#e7fbe0] p-3 text-sm leading-relaxed text-slate-800 shadow-sm">
      <p className="whitespace-pre-wrap break-words">
        {parts.map((p, i) => (p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <b key={i}>{p.slice(1, -1)}</b> : <span key={i}>{p}</span>))}
      </p>
    </div>
  );
}

function TemplateEditor({ t, saved, canEdit, taller }: { t: DefaultTemplate; saved: string | undefined; canEdit: boolean; taller: string }) {
  const { user } = useAuth();
  const current = saved?.trim() ? saved : t.body;
  const [text, setText] = useState(current);
  const [busy, setBusy] = useState(false);
  const dirty = text !== current;
  const customized = !!saved?.trim();

  const save = async (value: string) => {
    if (!user) return;
    setBusy(true);
    try {
      await saveTemplate(t.key, value, user.uid);
      toast.success(value ? "Plantilla guardada" : "Se restauró el texto original");
      if (!value) setText(t.body);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const insert = (v: string) => setText((x) => `${x}{{${v}}}`);

  return (
    <div className="grid gap-4 p-5 lg:grid-cols-2">
      <div className="space-y-3">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} disabled={!canEdit} className="font-mono text-[13px]" />
        {canEdit && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button key={v} type="button" onClick={() => insert(v)} title={TEMPLATE_VARIABLE_LABELS[v]}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs text-slate-600 hover:border-brand-400 hover:text-brand-700">
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">Toque una variable para agregarla. Use *asteriscos* para negrita. Si no hay link, la frase que lo introduce se quita sola.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Save className="h-4 w-4" />} loading={busy} disabled={!dirty || !text.trim()} onClick={() => void save(text)}>Guardar</Button>
              {customized && <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} loading={busy} onClick={() => void save("")}>Restaurar original</Button>}
              {dirty && <Button size="sm" variant="ghost" onClick={() => setText(current)}>Descartar cambios</Button>}
            </div>
          </>
        )}
      </div>
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Eye className="h-3.5 w-3.5" /> Vista previa (datos de ejemplo)</div>
        <WhatsAppPreview text={renderTemplate(text, SAMPLE(taller))} />
      </div>
    </div>
  );
}

function TemplatesTab() {
  const { role } = useAuth();
  const canEdit = role === "admin" || role === "manager";
  const { bodies, loading, error } = useTemplateOverrides();
  const { settings } = useSettings();
  const [open, setOpen] = useState<string | null>(DEFAULT_TEMPLATES[0]?.key ?? null);
  if (error) return <ErrorState message={error} />;
  if (loading) return <div className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-slate-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <p>Estos son los mensajes que el sistema prepara para WhatsApp. Los cambios se usan de inmediato en todo el panel.{!canEdit && " Solo administración y gerencia pueden editarlos."}</p>
      </div>
      {DEFAULT_TEMPLATES.map((t) => {
        const customized = !!bodies[t.key]?.trim();
        return (
          <Card key={t.key}>
            <button type="button" onClick={() => setOpen(open === t.key ? null : t.key)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
              <MessageCircle className="h-5 w-5 shrink-0 text-[#1faa53]" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900">{t.name}</div>
                <div className="truncate text-xs text-slate-500">{(bodies[t.key]?.trim() || t.body).replace(/\n+/g, " ")}</div>
              </div>
              {customized && <Badge tone="blue">Editada</Badge>}
            </button>
            {open === t.key && <div className="border-t border-slate-100"><TemplateEditor t={t} saved={bodies[t.key]} canEdit={canEdit} taller={settings.name || "RAPIFIX"} /></div>}
          </Card>
        );
      })}
    </div>
  );
}

function HistoryTab() {
  const { data, loading, error } = useMessageLog(300);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const q = normalizeText(search.trim());
    if (!q) return data;
    const digits = q.replace(/\D/g, "");
    return data.filter((m) =>
      normalizeText(`${m.name} ${m.orderCode ?? ""} ${m.context} ${m.createdByName} ${m.body}`).includes(q) || (digits.length >= 4 && m.to.includes(digits)),
    );
  }, [data, search]);

  return (
    <Card>
      <CardHeader title="Mensajes enviados" description="Cada vez que alguien abre WhatsApp con un mensaje del sistema. Últimos 300." />
      <div className="border-b border-slate-100 p-3 sm:px-5">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente, orden, teléfono o texto..."
            className="h-10 w-full rounded-[10px] border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" />
        </div>
      </div>
      {error ? <ErrorState message={error} /> : loading ? (
        <div className="space-y-3 p-5"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : !rows.length ? (
        <EmptyState icon={<History className="h-7 w-7" />} title={search ? "Sin resultados" : "Todavía no hay mensajes"} description={search ? "Pruebe con otro nombre u orden." : "Aparecerán aquí cuando se envíe el primer WhatsApp desde el panel."} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((m) => (
            <li key={m.id} className="px-5 py-3.5">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-slate-900">{m.name || formatPhone(m.to)}</span>
                  <span className="text-xs text-slate-500">{formatPhone(m.to)}</span>
                  <Badge tone="gray">{m.context}</Badge>
                  {m.orderId && m.orderCode && <Link to={`/ordenes/${m.orderId}`} className="text-xs font-semibold text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{m.orderCode}</Link>}
                  <span className="ml-auto text-xs text-slate-500">{formatDate(m.at, true)} · {m.createdByName}</span>
                  <span className="w-full truncate text-sm text-slate-600">{m.body.replace(/\n+/g, " ")}</span>
                </summary>
                <div className="mt-3 max-w-xl"><WhatsAppPreview text={m.body} /></div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function WhatsAppPage() {
  const [tab, setTab] = useState<Tab>("history");
  return (
    <>
      <PageHeader title="WhatsApp" description="Historial de mensajes y plantillas." />
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#1faa53]" />
        <p>Por ahora los mensajes se envían en modo semiautomático: el sistema abre WhatsApp con el texto listo y la persona toca enviar, sin riesgo de bloqueo del número. El envío 100% automático queda para más adelante.</p>
      </div>
      <div className="mb-4"><Tabs tabs={[{ value: "history", label: "Mensajes enviados" }, { value: "templates", label: "Plantillas" }]} value={tab} onChange={setTab} /></div>
      {tab === "history" ? <HistoryTab /> : <TemplatesTab />}
    </>
  );
}
