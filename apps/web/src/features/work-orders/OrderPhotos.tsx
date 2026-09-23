import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Eye, EyeOff, ImagePlus, Plus, Trash2 } from "lucide-react";
import { PHOTO_STAGE_LABELS, PHOTO_STAGES, RECEPTION_ANGLES, type OrderPhoto, type PhotoStage, type WorkOrder } from "@rapifix/shared";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Field";
import { ErrorState, Skeleton } from "@/components/ui/Feedback";
import { deleteOrderPhoto, updateOrderPhoto, uploadOrderPhoto, useOrderPhotos } from "./api";

type Target = { stage: PhotoStage; angle?: string };

export function OrderPhotos({ order }: { order: WorkOrder }) {
  const { user, role } = useAuth();
  const byName = useDisplayName();
  const { data, loading, error } = useOrderPhotos(order.id);
  const [busy, setBusy] = useState<{ label: string; pct: number } | null>(null);
  const [viewing, setViewing] = useState<OrderPhoto | null>(null);
  const [caption, setCaption] = useState("");
  const [deleting, setDeleting] = useState<OrderPhoto | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<Target>({ stage: "reception" });

  const assigned = role !== "technician" || (user && order.technicianIds.includes(user.uid));
  const canUpload = ["admin", "manager", "reception", "technician"].includes(role ?? "") && !!assigned;
  const canDelete = role === "admin" || role === "manager";

  const pick = (t: Target) => {
    target.current = t;
    input.current?.click();
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    const t = target.current;
    const list = Array.from(files).slice(0, 12);
    try {
      for (let i = 0; i < list.length; i++) {
        const label = `${PHOTO_STAGE_LABELS[t.stage]}${t.angle ? ` · ${RECEPTION_ANGLES.find((a) => a.key === t.angle)?.label}` : ""}`;
        setBusy({ label: `${label} (${i + 1}/${list.length})`, pct: 0 });
        await uploadOrderPhoto(order.id, list[i]!, { stage: t.stage, angle: t.angle }, user.uid, byName, (pct) => setBusy({ label, pct }));
      }
      toast.success(list.length === 1 ? "Foto guardada" : `${list.length} fotos guardadas`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const saveCaption = async () => {
    if (!viewing) return;
    try {
      await updateOrderPhoto(order.id, viewing.id, { caption: caption.trim() });
      toast.success("Comentario guardado");
      setViewing({ ...viewing, caption: caption.trim() });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const toggleVisible = async (p: OrderPhoto) => {
    try {
      await updateOrderPhoto(order.id, p.id, { visibleToCustomer: !p.visibleToCustomer });
      setViewing(viewing && viewing.id === p.id ? { ...p, visibleToCustomer: !p.visibleToCustomer } : viewing);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteOrderPhoto(order.id, deleting);
      toast.success("Foto eliminada");
      setDeleting(null);
      setViewing(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (error) return <ErrorState message={error} />;
  const reception = data.filter((p) => p.stage === "reception");

  return (
    <div className="space-y-7 p-5">
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void upload(e.target.files)} />
      {busy && (
        <div className="sticky top-16 z-10 flex items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lg">
          <Camera className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">Subiendo {busy.label}</span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/20"><div className="h-full bg-brand-400" style={{ width: `${busy.pct}%` }} /></div>
        </div>
      )}

      <section>
        <h3 className="mb-1 font-semibold">Fotos de ingreso</h3>
        <p className="mb-3 text-sm text-slate-500">Toque cada recuadro para tomar la foto desde el celular.</p>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{RECEPTION_ANGLES.map((a) => <Skeleton key={a.key} className="aspect-[4/3]" />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {RECEPTION_ANGLES.map((a) => {
              const photo = reception.find((p) => p.angle === a.key);
              return photo ? (
                <button key={a.key} onClick={() => { setViewing(photo); setCaption(photo.caption); }} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
                  <img src={photo.url} alt={a.label} className="h-full w-full object-cover" loading="lazy" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-left text-xs font-semibold text-white">{a.label}</span>
                </button>
              ) : (
                <button
                  key={a.key}
                  disabled={!canUpload || !!busy}
                  onClick={() => pick({ stage: "reception", angle: a.key })}
                  className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-white text-slate-500 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
                >
                  <Camera className="h-6 w-6" />
                  <span className="text-xs font-semibold">{a.label}</span>
                </button>
              );
            })}
          </div>
        )}
        {reception.filter((p) => !p.angle).length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {reception.filter((p) => !p.angle).map((p) => <Thumb key={p.id} photo={p} onClick={() => { setViewing(p); setCaption(p.caption); }} />)}
          </div>
        )}
      </section>

      {PHOTO_STAGES.filter((s) => s !== "reception").map((stage) => {
        const photos = data.filter((p) => p.stage === stage);
        return (
          <section key={stage}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">{PHOTO_STAGE_LABELS[stage]} <span className="ml-1 text-sm font-normal text-slate-400">{photos.length}</span></h3>
              {canUpload && order.isOpen && (
                <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={!!busy} onClick={() => pick({ stage })}>Agregar</Button>
              )}
            </div>
            {photos.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {photos.map((p) => <Thumb key={p.id} photo={p} onClick={() => { setViewing(p); setCaption(p.caption); }} />)}
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400">Sin fotos</p>
            )}
          </section>
        );
      })}

      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="xl"
        title={viewing ? `${PHOTO_STAGE_LABELS[viewing.stage]}${viewing.angle ? ` · ${RECEPTION_ANGLES.find((a) => a.key === viewing.angle)?.label ?? ""}` : ""}` : ""}
        description={viewing ? `${viewing.byName} · ${formatDate(viewing.at, true)}` : ""}
        footer={
          viewing && (
            <>
              {canDelete && <Button variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(viewing)}>Eliminar</Button>}
              {canUpload && (
                <Button variant="secondary" icon={viewing.visibleToCustomer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} onClick={() => void toggleVisible(viewing)}>
                  {viewing.visibleToCustomer ? "Ocultar al cliente" : "Mostrar al cliente"}
                </Button>
              )}
              <Button onClick={() => setViewing(null)}>Cerrar</Button>
            </>
          )
        }
      >
        {viewing && (
          <div className="space-y-4">
            <img src={viewing.url} alt="" className="mx-auto max-h-[58vh] rounded-lg object-contain" />
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {viewing.visibleToCustomer ? <><Eye className="h-3.5 w-3.5" /> Visible en el portal del cliente</> : <><EyeOff className="h-3.5 w-3.5" /> Solo uso interno</>}
            </div>
            {canUpload && (
              <div className="flex gap-2">
                <Input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={200} placeholder="Comentario de la foto (ej. golpe en puerta trasera)" />
                <Button variant="secondary" onClick={() => void saveCaption()} disabled={caption.trim() === viewing.caption}>Guardar</Button>
              </div>
            )}
            {!canUpload && viewing.caption && <p className="text-sm text-slate-700">{viewing.caption}</p>}
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => void remove()} danger title="Eliminar foto" message="La foto se eliminará permanentemente." confirmLabel="Eliminar" />
      {!canUpload && !data.length && !loading && <p className="text-center text-sm text-slate-400"><ImagePlus className="mx-auto mb-2 h-6 w-6" />No hay fotos en esta orden.</p>}
    </div>
  );
}

function Thumb({ photo, onClick }: { photo: OrderPhoto; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100">
      <img src={photo.url} alt={photo.caption} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
      {!photo.visibleToCustomer && <span className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white"><EyeOff className="h-3 w-3" /></span>}
      {photo.caption && <span className={cn("absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white")}>{photo.caption}</span>}
    </button>
  );
}
