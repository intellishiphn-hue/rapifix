import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { cn } from "@/lib/cn";

const KEY = "rapifix.sidebarCollapsed";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {
        /* sin almacenamiento local */
      }
      return !c;
    });
  };

  return (
    <div className="min-h-full">
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggle} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className={cn("flex min-h-screen flex-col transition-[padding] duration-200", collapsed ? "lg:pl-[76px]" : "lg:pl-64")}>
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
