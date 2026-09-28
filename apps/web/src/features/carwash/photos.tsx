import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addDoc, collection, deleteDoc, doc, orderBy, query, serverTimestamp } from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import { toast } from "sonner";
import { Camera, ChevronLeft, ChevronRight, ImageIcon, Loader2, Trash2, X } from "lucide-react";
import {
  carwashCol, carwashStoragePath, groupWashPhotos, washPhotoSlots, WASH_PHOTO_STAGE_LABELS, WASH_PHOTO_STAGES, WASH_PHOTOS_PER_STAGE,
  type Wash, type WashPhoto, type WashPhotoStage,
} from "@rapifix/shared";
import { db, storage, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { newId, uploadImage } from "@/lib/storage";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { msOf } from "./ui";

// ============================================================================
// Datos
// ============================================================================

export function useWashPhotos(washId: string | undefined) {
  return useQueryData<WashPhoto>(
    washId ? query(collection(db, carwashCol.washPhotos(TENANT_ID, washId)), orderBy("at", "asc")) : null,
    `wash-photos-${washId}`,
  );
}

/** Fotos agrupadas por etapa (las recién subidas, sin hora del servidor todavía, van al final). */
export function useWashPhotoGroups(washId: string | undefined) {
  const state = useWashPhotos(washId);
  const groups = useMemo(() => {
    const g = groupWashPhotos(state.data.map((photo) => ({ stage: photo.stage, at: msOf(photo.at) || Number.MAX_SAFE_INTEGER, photo })), Number.MAX_SAFE_INTEGER);
    return { entry: g.entry.map((x) => x.photo), exit: g.exit.map((x) => x.photo) } as Record<WashPhotoStage, WashPhoto[]>;
  }, [state.data]);
  return { ...state, groups };
}

async function uploadWashPhoto(washId: string, stage: WashPhotoStage, file: File, uid: string, byName: string) {
  const path = carwashStoragePath.photo(TENANT_ID, washId, newId());
  const url = await uploadImage(file, path);
  await addDoc(collection(db, carwashCol.washPhotos(TENANT_ID, washId)), {
    url, storagePath: path, stage, by: uid, byName: byName.slice(0, 120), at: serverTimestamp(),
  });
}

/**
 * Sube fotos en segundo plano (comprimidas) con un aviso de progreso.
 * Nunca lanza: si una foto falla, se avisa con un toast y el resto sigue.
 */
export async function uploadWashPhotos(
  wash: { id: string; code?: string },
  stage: WashPhotoStage,
  files: File[],
  who: { uid: string; name: string },
): Promise<number> {
  if (!files.length) return 0;
  const label = `fotos de ${WASH_PHOTO_STAGE_LABELS[stage].toLowerCase()}`;
  const id = toast.loading(`Subiendo ${label}${wash.code ? ` de ${wash.code}` : ""}…`);
  let ok = 0;
  let lastError = "";
  for (let i = 0; i < files.length; i++) {
    if (files.length > 1) toast.loading(`Subiendo ${label} (${i + 1}/${files.length})…`, { id });
    try {
      await uploadWashPhoto(wash.id, stage, files[i]!, who.uid, who.name);
      ok++;
    } catch (err) {
      lastError = errorMessage(err);
    }
  }
  const failed = files.length - ok;
  if (!failed) toast.success(ok === 1 ? "Foto guardada" : `${ok} fotos guardadas`, { id });
  else {
    toast.error(
      `${failed === files.length ? "No se pudieron subir las fotos" : `No se pudo${failed === 1 ? "" : "ieron"} subir ${failed} de ${files.length} fotos`}. Puede intentarlo de nuevo desde el detalle del lavado.`,
      { id, description: lastError || undefined, duration: 8000 },
    );
  }
  return ok;
}

export async function deleteWashPhoto(washId: string, photo: WashPhoto) {
  await deleteDoc(doc(db, carwashCol.washPhotos(TENANT_ID, washId), photo.id));
  await deleteObject(storageRef(storage, photo.storagePath)).catch(() => undefined);
}

// ============================================================================
// Cámara (input oculto reutilizable)
// ============================================================================

interface PickTarget { wash: { id: string; code?: string }; stage: WashPhotoStage; existing: number }

/**
 * Botón de cámara desde cualquier lugar (cola, detalle, aviso de "listo").
 * Renderice `element` una vez y llame `pick()` dentro de un clic del usuario.
 */
export function useWashPhotoPicker() {
  const { user } = useAuth();
  const name = useDisplayName();
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<PickTarget | null>(null);

  const pick = (wash: PickTarget["wash"], stage: WashPhotoStage, existing: number) => {
    if (washPhotoSlots(existing) === 0) {
      toast.info(`Ya tiene ${WASH_PHOTOS_PER_STAGE} fotos de ${WASH_PHOTO_STAGE_LABELS[stage].toLowerCase()} (el máximo).`);
      return;
    }
    target.current = { wash, stage, existing };
    input.current?.click();
  };

  const onFiles = (list: FileList | null) => {
    const t = target.current;
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
    if (input.current) input.current.value = "";
    if (!t || !files.length || !user) return;
    const slots = washPhotoSlots(t.existing);
    if (files.length > slots) toast.info(`Solo se guardan ${slots} foto${slots === 1 ? "" : "s"} más (máximo ${WASH_PHOTOS_PER_STAGE} por etapa).`);
    void uploadWashPhotos(t.wash, t.stage, files.slice(0, slots), { uid: user.uid, name });
  };

  const element = (
    <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => onFiles(e.target.files)} />
  );
  return { pick, element };
}

// ============================================================================
// Fotos por subir (Registrar carro)
// ============================================================================

export interface PendingPhoto { key: string; file: File; url: string }

/** Fotos de ingreso elegidas antes de registrar el carro (vista previa local). */
export function usePendingPhotos(open: boolean) {
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const current = useRef<PendingPhoto[]>([]);
  current.current = photos;
  const clear = () => {
    for (const p of current.current) URL.revokeObjectURL(p.url);
    setPhotos([]);
  };
  useEffect(() => {
    if (!open) clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => () => current.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const add = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
    const slots = washPhotoSlots(current.current.length);
    if (files.length > slots) toast.info(`Máximo ${WASH_PHOTOS_PER_STAGE} fotos de ingreso.`);
    const next = files.slice(0, slots).map((file) => ({ key: newId(), file, url: URL.createObjectURL(file) }));
    setPhotos((cur) => [...cur, ...next]);
  };
  const remove = (key: string) => {
    const p = current.current.find((x) => x.key === key);
    if (p) URL.revokeObjectURL(p.url);
    setPhotos((cur) => cur.filter((x) => x.key !== key));
  };
  /** Entrega los archivos y vacía la lista (las vistas previas se liberan) */
  const take = (): File[] => {
    const files = current.current.map((p) => p.file);
    clear();
    return files;
  };
  return { photos, add, remove, take };
}

export function PendingPhotosField({ photos, onAdd, onRemove }: { photos: PendingPhoto[]; onAdd: (files: FileList | null) => void; onRemove: (key: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const full = photos.length >= WASH_PHOTOS_PER_STAGE;
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-slate-700">
        Fotos de ingreso <span className="font-normal text-slate-400">· opcional, hasta {WASH_PHOTOS_PER_STAGE}</span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.key} className="relative h-20 w-20 overflow-hidden rounded-xl bg-slate-100">
            <img src={p.url} alt="Foto de ingreso" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onRemove(p.key)}
              aria-label="Quitar foto"
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {!full && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-brand-400 hover:text-brand-700"
          >
            <Camera className="h-6 w-6" />
            <span className="text-[11px] font-semibold">{photos.length ? "Otra" : "Tomar foto"}</span>
          </button>
        )}
      </div>
      {photos.length > 0 && <p className="mt-1.5 text-xs text-slate-500">Se suben al registrar el carro.</p>}
    </div>
  );
}

// ============================================================================
// Galería del lavado (detalle)
// ============================================================================

export function WashPhotosSection({ wash, onPick }: { wash: Wash; onPick: (stage: WashPhotoStage, existing: number) => void }) {
  const { can } = useAuth();
  const { groups, loading, error } = useWashPhotoGroups(wash.id);
  const [viewing, setViewing] = useState<{ stage: WashPhotoStage; index: number } | null>(null);
  const canUpload = can("carwash.create") && wash.status !== "cancelled";
  const canDelete = can("carwash.manage");
  const suggestExit = (wash.status === "ready" || wash.status === "delivered") && groups.exit.length === 0 && !loading;

  if (!canUpload && !loading && !groups.entry.length && !groups.exit.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-800"><Camera className="h-4 w-4 text-slate-500" /> Fotos</div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="space-y-3">
        {WASH_PHOTO_STAGES.map((stage) => {
          const list = groups[stage];
          const full = list.length >= WASH_PHOTOS_PER_STAGE;
          return (
            <div key={stage}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {WASH_PHOTO_STAGE_LABELS[stage]} <span className="ml-0.5 font-normal normal-case text-slate-400">{list.length}/{WASH_PHOTOS_PER_STAGE}</span>
                </span>
                {canUpload && !full && (
                  <Button
                    size="sm"
                    variant={stage === "exit" && suggestExit ? "primary" : "secondary"}
                    icon={<Camera className="h-4 w-4" />}
                    onClick={() => onPick(stage, list.length)}
                  >
                    Agregar fotos de {WASH_PHOTO_STAGE_LABELS[stage].toLowerCase()}
                  </Button>
                )}
              </div>
              {loading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</div>
              ) : list.length ? (
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                  {list.map((p, i) => (
                    <button key={p.id} type="button" onClick={() => setViewing({ stage, index: i })} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                      <img src={p.url} alt={`${WASH_PHOTO_STAGE_LABELS[stage]} ${i + 1}`} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  {stage === "exit" && suggestExit ? "Opcional: tome fotos de cómo se entrega el carro." : "Sin fotos"}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {viewing && groups[viewing.stage][viewing.index] && (
        <PhotoViewer
          photos={groups[viewing.stage]}
          index={viewing.index}
          title={`${wash.code} · ${WASH_PHOTO_STAGE_LABELS[viewing.stage]}`}
          onIndex={(index) => setViewing({ ...viewing, index })}
          onClose={() => setViewing(null)}
          onDelete={canDelete ? async (p) => {
            await deleteWashPhoto(wash.id, p);
            toast.success("Foto eliminada");
            setViewing(null);
          } : undefined}
        />
      )}
    </div>
  );
}

/** Foto en grande sobre el detalle (Escape o fondo cierran solo el visor). */
function PhotoViewer({
  photos, index, title, onIndex, onClose, onDelete,
}: {
  photos: WashPhoto[]; index: number; title: string; onIndex: (i: number) => void; onClose: () => void; onDelete?: (p: WashPhoto) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const photo = photos[index]!;
  useEffect(() => setConfirming(false), [photo.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "ArrowRight" && index < photos.length - 1) onIndex(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [index, photos.length, onClose, onIndex]);

  const remove = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(photo);
    } catch (err) {
      toast.error(errorMessage(err));
      setDeleting(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title} · {index + 1} de {photos.length}</div>
          <div className="truncate text-xs text-white/70">{photo.byName}{msOf(photo.at) ? ` · ${formatDate(photo.at, true)}` : ""}</div>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 hover:bg-white/10" aria-label="Cerrar"><X className="h-5 w-5" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
        <img src={photo.url} alt="" className="max-h-[calc(100dvh-9rem)] max-w-full rounded-lg object-contain" />
        {index > 0 && (
          <button onClick={() => onIndex(index - 1)} className="absolute left-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" aria-label="Anterior"><ChevronLeft className="h-6 w-6" /></button>
        )}
        {index < photos.length - 1 && (
          <button onClick={() => onIndex(index + 1)} className="absolute right-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" aria-label="Siguiente"><ChevronRight className="h-6 w-6" /></button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
        {onDelete && !confirming && (
          <Button variant="ghost" className="text-red-300 hover:bg-white/10 hover:text-red-200" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirming(true)}>Eliminar</Button>
        )}
        {onDelete && confirming && (
          <>
            <span className="text-sm text-white/80">¿Eliminar esta foto permanentemente?</span>
            <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setConfirming(false)}>No</Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>Sí, eliminar</Button>
          </>
        )}
        <a href={photo.url} target="_blank" rel="noreferrer"><Button variant="secondary" icon={<ImageIcon className="h-4 w-4" />}>Abrir original</Button></a>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  // Portal al body: dentro del diálogo (con animación/transform) "fixed" no cubriría la pantalla
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-ink-950/95" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>,
    document.body,
  );
}

/** Iconito con el número de fotos para la tarjeta de la cola. */
export function PhotoCountChip({ wash, className }: { wash: Pick<Wash, "photoCount">; className?: string }) {
  if (!wash.photoCount) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-600", className)} title={`${wash.photoCount} foto${wash.photoCount === 1 ? "" : "s"}`}>
      <Camera className="h-3 w-3" />{wash.photoCount}
    </span>
  );
}
