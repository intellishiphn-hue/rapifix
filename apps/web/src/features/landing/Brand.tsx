import { useState } from "react";
import { cn } from "@/lib/cn";
import { BUSINESS } from "./business";

/** Logo oficial: el último que guardó el login/portal en este navegador o el de business.ts */
function officialLogo(): string | undefined {
  try {
    const cached = localStorage.getItem("rapifix.logoUrl");
    if (cached && /^https:\/\//.test(cached)) return cached;
  } catch {
    /* sin almacenamiento */
  }
  return BUSINESS.logoUrl;
}

/**
 * Logo de RAPIFIX. Usa el archivo oficial (sobre fondo blanco, como en el login y el portal).
 * Si no se puede cargar, muestra el engrane oficial del favicon con el nombre.
 */
export function BrandLogo({ tone = "dark", size = "md", className }: { tone?: "dark" | "light"; size?: "md" | "lg"; className?: string }) {
  const [src] = useState(officialLogo);
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <span className={cn("inline-flex items-center rounded-xl bg-white shadow-sm", size === "lg" ? "px-3 py-2" : "px-2 py-1.5", className)}>
        <img
          src={src}
          alt="RAPIFIX"
          onError={() => setFailed(true)}
          className={cn("w-auto object-contain", size === "lg" ? "h-12 max-w-[220px]" : "h-8 max-w-[150px]")}
          decoding="async"
        />
      </span>
    );
  }
  return <BrandFallback tone={tone} size={size} className={className} />;
}

export function BrandFallback({ tone = "dark", size = "md", className }: { tone?: "dark" | "light"; size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="RAPIFIX" role="img">
      <img src="/favicon.svg" alt="" aria-hidden className={cn("rounded-lg", size === "lg" ? "h-11 w-11" : "h-9 w-9")} />
      <span
        aria-hidden
        className={cn("lp-display leading-none", size === "lg" ? "text-[28px]" : "text-[21px]", tone === "dark" ? "text-white" : "text-[var(--lp-navy)]")}
      >
        RAPIFIX
      </span>
    </span>
  );
}
