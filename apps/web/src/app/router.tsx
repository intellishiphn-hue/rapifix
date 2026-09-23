import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { PageLoader } from "@/components/ui/Feedback";
import { AppShell } from "./layout/AppShell";
import { RequireAuth, RequirePermission } from "./guards/Guards";
import { COMING_SOON } from "./navigation";
import { LoginPage } from "@/features/auth/LoginPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
const DashboardPage = page(() => import("@/features/dashboard/DashboardPage"), "DashboardPage");
const CustomersPage = page(() => import("@/features/customers/CustomersPage"), "CustomersPage");
const CustomerDetailPage = page(() => import("@/features/customers/CustomerDetailPage"), "CustomerDetailPage");
const VehiclesPage = page(() => import("@/features/vehicles/VehiclesPage"), "VehiclesPage");
const VehicleDetailPage = page(() => import("@/features/vehicles/VehicleDetailPage"), "VehicleDetailPage");
const SettingsPage = page(() => import("@/features/settings/SettingsPage"), "SettingsPage");
const WorkOrdersPage = page(() => import("@/features/work-orders/WorkOrdersPage"), "WorkOrdersPage");
const NewWorkOrderPage = page(() => import("@/features/work-orders/NewWorkOrderPage"), "NewWorkOrderPage");
const WorkOrderDetailPage = page(() => import("@/features/work-orders/WorkOrderDetailPage"), "WorkOrderDetailPage");
const UsersPage = page(() => import("@/features/users/UsersPage"), "UsersPage");
function page<K extends string>(loader: () => Promise<Record<K, ComponentType>>, key: K) {
  return lazy(() => loader().then((m) => ({ default: m[key] })));
}
const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<PageLoader />}>{children}</Suspense>;

import { ComingSoonPage } from "@/features/placeholder/ComingSoonPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/recuperar", element: <ForgotPasswordPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <RequirePermission permission="dashboard.view"><S><DashboardPage /></S></RequirePermission> },
      { path: "clientes", element: <RequirePermission permission="customers.read"><S><CustomersPage /></S></RequirePermission> },
      { path: "clientes/:id", element: <RequirePermission permission="customers.read"><S><CustomerDetailPage /></S></RequirePermission> },
      { path: "vehiculos", element: <RequirePermission permission="vehicles.read"><S><VehiclesPage /></S></RequirePermission> },
      { path: "vehiculos/:id", element: <RequirePermission permission="vehicles.read"><S><VehicleDetailPage /></S></RequirePermission> },
      { path: "ordenes", element: <RequirePermission permission="orders.read"><S><WorkOrdersPage /></S></RequirePermission> },
      { path: "ordenes/nueva", element: <RequirePermission permission="orders.create"><S><NewWorkOrderPage /></S></RequirePermission> },
      { path: "ordenes/:id", element: <RequirePermission permission="orders.read"><S><WorkOrderDetailPage /></S></RequirePermission> },
      { path: "configuracion", element: <RequirePermission permission="settings.read"><S><SettingsPage /></S></RequirePermission> },
      { path: "usuarios", element: <RequirePermission permission="users.manage"><S><UsersPage /></S></RequirePermission> },
      ...COMING_SOON.map((i) => ({ path: i.to.slice(1), element: <ComingSoonPage /> })),
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
