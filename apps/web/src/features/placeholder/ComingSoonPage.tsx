import { useLocation } from "react-router-dom";
import { Construction } from "lucide-react";
import { COMING_SOON } from "@/app/navigation";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/common/PageHeader";

export function ComingSoonPage() {
  const { pathname } = useLocation();
  const item = COMING_SOON.find((i) => pathname.startsWith(i.to));
  return (
    <>
      <PageHeader title={item?.label ?? "Módulo"} />
      <Card>
        <EmptyState
          icon={<Construction className="h-7 w-7" />}
          title={`Este módulo se construye en la Fase ${item?.phase ?? "?"}`}
          description="La arquitectura ya está preparada para él. Se activará aquí mismo cuando se complete esa fase."
        />
      </Card>
    </>
  );
}
