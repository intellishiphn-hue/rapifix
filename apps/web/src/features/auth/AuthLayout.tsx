import type { ReactNode } from "react";
import { Logo } from "@/components/common/Logo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 h-[26rem] w-[26rem] rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative"><Logo light /></div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
            Cada vehículo, <span className="text-brand-400">bajo control.</span>
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-400">
            Recepción, diagnóstico, cotización, reparación y entrega en un solo lugar. Y sus clientes siempre saben cómo va su vehículo.
          </p>
        </div>
        <div className="relative text-xs text-slate-500">RAPIFIX · Sistema de Gestión para Taller Automotriz</div>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden"><Logo /></div>
          {children}
        </div>
      </div>
    </div>
  );
}
