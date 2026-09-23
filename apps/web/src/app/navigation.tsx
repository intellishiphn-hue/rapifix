import type { LucideIcon } from "lucide-react";
import {
  BarChart3, Boxes, CalendarDays, Car, ClipboardList, CreditCard, FileText, Globe, LayoutDashboard,
  MessageCircle, Package, Receipt, Settings, ShieldCheck, ShoppingCart, Truck, Users, Wrench, HardHat, CalendarClock, ClipboardPlus, HandCoins,
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
      { label: "Órdenes de trabajo", to: "/ordenes", icon: ClipboardList, permission: "orders.read" },
      { label: "Agenda", to: "/agenda", icon: CalendarDays, permission: "agenda.read" },
    ],
  },
  {
    label: "Clientes",
    items: [
      { label: "Clientes", to: "/clientes", icon: Users, permission: "customers.read" },
      { label: "Vehículos", to: "/vehiculos", icon: Car, permission: "vehicles.read" },
      { label: "Cotizaciones", to: "/cotizaciones", icon: FileText, permission: "orders.read" },
      { label: "Mantenimiento", to: "/mantenimiento", icon: CalendarClock, permission: "maintenance.manage" },
      { label: "Portal del cliente", to: "/portal", icon: Globe, permission: "orders.read" },
      { label: "WhatsApp", to: "/whatsapp", icon: MessageCircle, phase: 6 },
    ],
  },
  {
    label: "Ventas y finanzas",
    items: [
      { label: "Punto de venta", to: "/pos", icon: ShoppingCart, permission: "sales.create" },
      { label: "Pagos", to: "/pagos", icon: CreditCard, permission: "payments.read" },
      { label: "Cuentas por cobrar", to: "/cuentas-por-cobrar", icon: HandCoins, permission: "payments.read" },
      { label: "Gastos", to: "/gastos", icon: Receipt, permission: "expenses.manage" },
      { label: "Reportes", to: "/reportes", icon: BarChart3, permission: "reports.view" },
    ],
  },
  {
    label: "Inventario",
    items: [
      { label: "Inventario", to: "/inventario", icon: Boxes, permission: "catalog.read" },
      { label: "Productos y repuestos", to: "/productos", icon: Package, permission: "catalog.read" },
      { label: "Servicios", to: "/servicios", icon: Wrench, permission: "catalog.read" },
      { label: "Compras", to: "/compras", icon: ClipboardPlus, permission: "purchases.manage" },
      { label: "Proveedores", to: "/proveedores", icon: Truck, permission: "suppliers.manage" },
    ],
  },
  {
    label: "Administración",
    items: [
      { label: "Técnicos y empleados", to: "/empleados", icon: HardHat, permission: "employees.read" },
      { label: "Usuarios y permisos", to: "/usuarios", icon: ShieldCheck, permission: "users.manage" },
      { label: "Configuración", to: "/configuracion", icon: Settings, permission: "settings.read" },
    ],
  },
];

export const COMING_SOON = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.phase);
