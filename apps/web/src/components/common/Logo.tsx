import { cn } from "@/lib/cn";

/** Logo provisional de RAPIFIX (se reemplaza por el logo oficial en Configuración). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-9 w-9", className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#1447E6" />
      <path d="M36 10 18 36h12l-4 18 20-28H34l2-16z" fill="#fff" />
    </svg>
  );
}

export function Logo({ light, compact, logoUrl }: { light?: boolean; compact?: boolean; logoUrl?: string }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="RAPIFIX" className={cn("object-contain", compact ? "h-9 w-9" : "h-9 max-w-[160px]")} />;
  }
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <div className="leading-none">
          <div className={cn("text-[19px] font-extrabold tracking-tight", light ? "text-white" : "text-slate-900")}>
            RAPI<span className="text-brand-500">FIX</span>
          </div>
          <div className={cn("mt-1 text-[10px] font-medium uppercase tracking-[0.14em]", light ? "text-slate-400" : "text-slate-500")}>Taller automotriz</div>
        </div>
      )}
    </div>
  );
}
