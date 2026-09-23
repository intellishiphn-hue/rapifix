import { useRef, useState } from "react";
import { Camera, ImagePlus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Vehicle, VehiclePhoto } from "@rapifix/shared";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { deleteVehiclePhoto, setCoverPhoto, uploadVehiclePhoto, useVehiclePhotos } from "./api";

export function VehiclePhotos({ vehicle }: { vehicle: Vehicle }) {
  const { user, can, role } = useAuth();
  const byName = useDisplayName();
  const { data, loading, error } = useVehiclePhotos(vehicle.id);
  const [progress, setProgress] = useState<{ done: number; total: number; pct: number } | null>(null);
  const [viewing, setViewing] = useState<VehiclePhoto | null>(null);
  const [deleting, setDeleting] = useState<VehiclePhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const canWrite = can("vehicles.write");
  const canDelete = role === "admin" || role === "manager";

  const upload = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    const list = Array.from(files).slice(0, 12);
    let cover = !vehicle.coverPhotoUrl;
    try {
      for (let i = 0; i < list.length; i++) {
        setProgress({ done: i, total: list.length, pct: 0 });
        await uploadVehiclePhoto(vehicle.id, list[i]!, "", user.uid, byName, cover, (pct) => setProgress({ done: i, total: list.length, pct }));
        cover = false;
      }
      toast.success(list.length === 1 ? "Foto subida" : `${list.length} fotos subidas`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const makeCover = async (p: VehiclePhoto) => {
    if (!user) return;
    try {
      await setCoverPhoto(vehicle.id, p.url, user.uid);
      toast.success("Foto principal actualizada");
      setViewing(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!user || !deleting) return;
    setBusy(true);
    try {
      await deleteVehiclePhoto(vehicle.id, deleting, deleting.url === vehicle.coverPhotoUrl, user.uid);
      toast.success("Foto eliminada");
      setDeleting(null);
      setViewing(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5">
      {canWrite && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void upload(e.target.files)} />
          <Button icon={<Camera className="h-4 w-4" />} onClick={() => cameraRef.current?.click()} disabled={!!progress} className="sm:hidden">Tomar foto</Button>
          <Button variant="secondary" icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileRef.current?.click()} disabled={!!progress}>Subir fotos</Button>
          {progress && (
            <div className="flex min-w-[200px] flex-1 items-center gap-3 text-sm text-slate-600">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${((progress.done + progress.pct / 100) / progress.total) * 100}%` }} />
              </div>
              {progress.done + 1}/{progress.total}
            </div>
          )}
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[4/3]" />)}</div>
      ) : !data.length ? (
        <EmptyState icon={<Camera className="h-7 w-7" />} title="Sin fotos" description="Agregue fotos del vehículo (frente, laterales, interior, daños existentes)." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((p) => (
            <button key={p.id} onClick={() => setViewing(p)} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
              <img src={p.url} alt={p.caption} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
              {p.url === vehicle.coverPhotoUrl && (
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Principal
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="xl"
        title="Foto del vehículo"
        description={viewing ? `${viewing.byName} · ${formatDate(viewing.at, true)}` : ""}
        footer={
          viewing && (
            <>
              {canDelete && <Button variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(viewing)}>Eliminar</Button>}
              {canWrite && viewing.url !== vehicle.coverPhotoUrl && <Button variant="secondary" icon={<Star className="h-4 w-4" />} onClick={() => void makeCover(viewing)}>Usar como principal</Button>}
              <Button onClick={() => setViewing(null)}>Cerrar</Button>
            </>
          )
        }
      >
        {viewing && <img src={viewing.url} alt="" className="mx-auto max-h-[65vh] rounded-lg object-contain" />}
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        loading={busy}
        danger
        title="Eliminar foto"
        message="La foto se eliminará permanentemente. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
      />
    </div>
  );
}
