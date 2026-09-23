import { useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { ROLE_LABELS } from "@rapifix/shared";
import { useAuth, useDisplayName } from "@/lib/auth/useAuth";
import { Avatar } from "@/components/common/Avatar";
import { GlobalSearch } from "./GlobalSearch";

export function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const { role, user, signOut } = useAuth();
  const name = useDisplayName();
  const [menu, setMenu] = useState(false);

  return (
    <header className="sticky top-0 z-30 print:hidden flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur sm:px-6">
      <button onClick={onOpenMobile} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Abrir menú">
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex-1">
        <GlobalSearch />
      </div>
      <div className="relative">
        <button onClick={() => setMenu((m) => !m)} onBlur={() => setTimeout(() => setMenu(false), 150)} className="flex items-center gap-2.5 rounded-xl p-1 pr-2 hover:bg-slate-100">
          <Avatar name={name} />
          <span className="hidden text-left leading-tight md:block">
            <span className="block text-sm font-semibold text-slate-900">{name}</span>
            <span className="block text-xs text-slate-500">{role ? ROLE_LABELS[role] : ""}</span>
          </span>
        </button>
        {menu && (
          <div className="animate-pop absolute right-0 top-12 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[var(--shadow-pop)]">
            <div className="px-3 py-2">
              <div className="truncate text-sm font-semibold">{name}</div>
              <div className="truncate text-xs text-slate-500">{user?.email}</div>
            </div>
            <button onMouseDown={() => void signOut()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
