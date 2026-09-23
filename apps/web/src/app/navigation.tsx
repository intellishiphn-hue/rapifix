import type { LucideIcon } from "lucide-react";
import {
  BarChart3, Boxes, CalendarDays, Car, ClipboardList, CreditCard, FileText, Globe, LayoutDashboard,
  MessageCircle, Package, Receipt, Settings, ShieldCheck, ShoppingCart, Truck, Users, Wrench, HardHat, CalendarClock,
} from "lucide-react";
import type { Permission } from "@rapifix/shared";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Fase en la que se construye. Si existe, el módulo aún no está disponible. */
  phase?: number;
}

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Operación",
    items: [
      { label: "Dashboard", to: "/", icon: LayoutDashboard, permission: "dashboard.view" },
      { label: "Órdenes de trabajo", to: "/ordenes", icon: ClipboardList, phase: 2 },
      { label: "Agenda", to: "/agenda", icon: CalendarDays, phase: 5 },
    ],
  },
  {
    label: "Clientes",
    items: [
      { label: "Clientes", to: "/clientes", icon: Users, permission: "customers.read" },
      { label: "Vehículos", to: "/vehiculos", icon: Car, permission: "vehicles.read" },
      { label: "Cotizaciones", to: "/cotizaciones", icon: FileText, phase: 3 },
      { label: "Mantenimiento", to: "/mantenimiento", icon: CalendarClock, phase: 5 },
      { label: "Portal del cliente", to: "/portal", icon: Globe, phase: 3 },
      { label: "WhatsApp", to: "/whatsapp", icon: MessageCircle, phase: 6 },
    ],
  },
  {
    label: "Ventas y finanzas",
    items: [
      { label: "Punto de venta", to: "/pos", icon: ShoppingCart, phase: 4 },
      { label: "Pagos", to: "/pagos", icon: CreditCard, phase: 4 },
      { label: "Gastos", to: "/gastos", icon: Receipt, phase: 5 },
      { label: "Reportes", to: "/reportes", icon: BarChart3, phase: 5 },
    ],
  },
  {
    label: "Inventario",
    items: [
      { label: "Inventario", to: "/inventario", icon: Boxes, phase: 4 },
      { label: "Productos y repuestos", to: "/productos", icon: Package, phase: 4 },
      { label: "Servicios", to: "/servicios", icon: Wrench, phase: 4 },
      { label: "Proveedores", to: "/proveedores", icon: Truck, phase: 5 },
    ],
  },
  {
    label: "Administración",
    items: [
      { label: "Técnicos y empleados", to: "/empleados", icon: HardHat, phase: 5 },
      { label: "Usuarios y permisos", to: "/usuarios", icon: ShieldCheck, permission: "users.manage" },
      { label: "Configuración", to: "/configuracion", icon: Settings, permission: "settings.read" },
    ],
  },
];

export const COMING_SOON = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.phase);
