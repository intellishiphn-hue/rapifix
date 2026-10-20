import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import "@fontsource-variable/archivo/wdth.css";
import { usePublicLogo } from "@/lib/branding";

const display = { fontFamily: '"Archivo Variable", Inter, sans-serif', fontStretch: "116%", fontWeight: 800, letterSpacing: "-0.025em" } as const;

/** Logo oficial sobre fondo blanco; si no carga, el engrane del favicon con el nombre */
function AuthLogo({ size = "md" }: { size?: "md" | "lg" }) {
  const logo = usePublicLogo();
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return (
      <span className="inline-flex rounded-xl bg-white px-2.5 py-2 shadow-sm">
        <img src={logo} alt="RAPIFIX" onError={() => setFailed(true)} className={size === "lg" ? "h-12 max-w-[220px] object-contain" : "h-9 max-w-[170px] object-contain"} />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2.5" role="img" aria-label="RAPIFIX">
      <img src="/favicon.svg" alt="" aria-hidden className={size === "lg" ? "h-11 w-11 rounded-lg" : "h-9 w-9 rounded-lg"} />
      <span aria-hidden className="text-white" style={{ ...display, fontSize: size === "lg" ? 28 : 22, lineHeight: 1 }}>RAPIFIX</span>
    </span>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#000a2b] lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca (mismo lenguaje visual que el sitio público) */}
      <div className="relative isolate overflow-hidden bg-[radial-gradient(120%_80%_at_30%_0%,#0b2a7a_0%,#021240_45%,#000a2b_80%)] px-5 pb-10 pt-6 text-white sm:px-10 lg:flex lg:flex-col lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/2 opacity-80 [mask-image:linear-gradient(to_top,#000,transparent)]"
          style={{
            backgroundImage: "linear-gradient(rgb(59 140 255 / 0.16) 1px, transparent 1px), linear-gradient(90deg, rgb(59 140 255 / 0.16) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            transform: "perspective(600px) rotateX(60deg)",
            transformOrigin: "50% 100%",
          }}
        />
        <div aria-hidden className="pointer-events-none absolute -right-24 top-1/3 -z-10 h-80 w-80 rounded-full bg-[#3b8cff]/20 blur-3xl" />
        <div className="flex items-center justify-between gap-4">
          <Link to="/inicio" aria-label="RAPIFIX, ir al sitio"><AuthLogo /></Link>
          <Link to="/inicio" className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-3 text-sm font-medium text-white/75 hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Volver al sitio
          </Link>
        </div>
        <div className="mt-10 max-w-md lg:mt-auto">
          <p className="flex items-center gap-3 text-sm font-semibold text-white/80">
            <span className="h-[3px] w-7 rounded-full bg-[#ea0101]" aria-hidden /> Panel de gestión
          </p>
          <h1 className="mt-4 text-[clamp(2rem,4vw,3.4rem)] leading-[0.98]" style={display}>Cada vehículo, bajo control.</h1>
          <p className="mt-5 hidden text-base leading-relaxed text-[#a9b6d6] sm:block">
            Recepción, diagnóstico, cotización, reparación y entrega en un solo lugar. Y tus clientes siempre saben cómo va su vehículo.
          </p>
        </div>
        <p className="mt-auto hidden pt-12 text-xs text-white/45 lg:block">RAPIFIX Centro Automotriz. Acceso exclusivo para el personal.</p>
      </div>

      {/* Formulario */}
      <div className="flex items-start justify-center bg-[#f1f4fa] px-4 py-10 sm:px-10 lg:items-center lg:rounded-l-[32px]">
        <div className="w-full max-w-[400px] rounded-[28px] bg-white p-7 shadow-[0_30px_80px_-40px_rgb(1_25_85/0.45)] sm:p-9">
          {children}
        </div>
      </div>
    </div>
  );
}

export const authDisplay = display;
