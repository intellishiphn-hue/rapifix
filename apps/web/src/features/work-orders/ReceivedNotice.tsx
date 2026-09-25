import { useState } from "react";
import { collection, limit, query, where } from "firebase/firestore";
import { Camera, Check, MessageCircle } from "lucide-react";
import { opsCol, type MessageLog, type WorkOrder } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useQueryData } from "@/lib/firestore/hooks";
import { formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useSettings } from "@/features/settings/api";
import { WhatsAppComposer } from "./WhatsAppComposer";
import { messageFromTemplate } from "./whatsapp";

/**
 * Mientras la orden está en "Recibido": aviso al cliente de que recibimos su vehículo, con el link
 * donde ve las fotos de ingreso y el detalle de la recepción. Muestra si ya se envió.
 */
export function ReceivedNotice({ order, onGoPhotos }: { order: WorkOrder; onGoPhotos: () => void }) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const sent = useQueryData<MessageLog>(
    query(collection(db, opsCol.messages(TENANT_ID)), where("orderId", "==", order.id), limit(50)),
    `received-notice-${order.id}`,
  );
  const last = sent.data.filter((m) => m.context === "recibido").sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0))[0];
  const photos = order.photoCount ?? 0;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 bg-emerald-50/60 px-5 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-emerald-900">Avisar al cliente que recibimos su vehículo</div>
        <div className="text-emerald-800/80">
          {last ? (
            <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />Enviado {formatRelative(last.at)} por {last.createdByName}</span>
          ) : photos > 0 ? (
            `El mensaje lleva el link donde verá las ${photos} foto(s) de ingreso y el detalle de la recepción.`
          ) : (
            "Tome primero las fotos de ingreso para que el cliente las vea en su link."
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {photos === 0 && <Button size="sm" variant="secondary" icon={<Camera className="h-4 w-4" />} onClick={onGoPhotos}>Tomar fotos</Button>}
        <Button size="sm" className="bg-[#1faa53] hover:bg-[#178a43]" icon={<MessageCircle className="h-4 w-4" />} onClick={() => setOpen(true)}>
          {last ? "Enviar de nuevo" : "Enviar aviso de recibido"}
        </Button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Vehículo recibido" description="Revise el mensaje y envíelo por WhatsApp.">
        <WhatsAppComposer order={order} context="recibido" initial={messageFromTemplate(order, "recibido", settings)} onSent={() => setOpen(false)} />
      </Dialog>
    </div>
  );
}
