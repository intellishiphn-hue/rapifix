import { NavLink } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, X } from "lucide-react";
import { NAV_GROUPS } from "@/app/navigation";
import { useAuth } from "@/lib/auth/useAuth";
import { useSettings } from "@/features/settings/api";
import { Logo } from "@/components/common/Logo";
import { cn } from "@/lib/cn";

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { can } = useAuth();
  const { settings } = useSettings();

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-ink-950/60 lg:hidden" onClick={onCloseMobile} />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col print:hidden bg-ink-900 text-slate-300 transition-[width,transform] duration-200",
          collapsed ? "lg:w-[76px]" : "lg:w-64",
          "w-72",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-white/5 px-4", collapsed ? "lg:justify-center lg:px-0" : "justify-between")}>
          <div className={cn(collapsed && "lg:hidden")}>
            <Logo light logoUrl={settings.logoUrl || undefined} />
          </div>
          {collapsed && (
            <div className="hidden lg:block">
              <Logo light compact />
            </div>
          )}
          <button onClick={onCloseMobile} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 lg:hidden" aria-label="Cerrar menú">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((i) => !i.permission || can(i.permission));
            if (!items.length) return null;
            return (
              <div key={group.label}>
                <div className={cn("mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500", collapsed && "lg:hidden")}>
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        onClick={onCloseMobile}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            "group flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-colors",
                            collapsed && "lg:justify-center lg:px-0",
                            isActive ? "bg-brand-600 text-white shadow-lg shadow-brand-900/40" : "hover:bg-white/5 hover:text-white",
                          )
                        }
                      >
                        <item.icon className="h-[18px] w-[18px] shrink-0" />
                        <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>{item.label}</span>
                        {item.phase && (
                          <span className={cn("rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500", collapsed && "lg:hidden")}>
                            F{item.phase}
                          </span>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <button
          onClick={onToggleCollapsed}
          className="hidden items-center gap-2 border-t border-white/5 px-6 py-3.5 text-xs font-medium text-slate-500 hover:text-white lg:flex"
        >
          {collapsed ? <ChevronsRight className="mx-auto h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Colapsar menú</>}
        </button>
      </aside>
    </>
  );
}
