import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
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
const QuotesPage = page(() => import("@/features/quotes/QuotesPage"), "QuotesPage");
const DirectQuotePage = page(() => import("@/features/quotes/DirectQuotePage"), "DirectQuotePage");
const PortalLinksPage = page(() => import("@/features/portal/PortalLinksPage"), "PortalLinksPage");
const PortalPage = page(() => import("@/features/portal/PortalPage"), "PortalPage");
const PrintOrderPage = page(() => import("@/features/print/PrintPages"), "PrintOrderPage");
const PrintQuotePage = page(() => import("@/features/print/PrintPages"), "PrintQuotePage");
const UsersPage = page(() => import("@/features/users/UsersPage"), "UsersPage");
function page<K extends string>(loader: () => Promise<Record<K, ComponentType>>, key: K) {
  return lazy(() => loader().then((m) => ({ default: m[key] })));
}
function RedirectToPortal({ suffix }: { suffix: string }) {
  const { token } = useParams();
  return <Navigate to={`/orden/${token}${suffix}`} replace />;
}
const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<PageLoader />}>{children}</Suspense>;

import { ComingSoonPage } from "@/features/placeholder/ComingSoonPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/recuperar", element: <ForgotPasswordPage /> },
  // Portal público del cliente (sin cuenta). /aprobar y /seguimiento redirigen al mismo link.
  { path: "/orden/:token", element: <S><PortalPage /></S> },
  { path: "/orden/:token/cotizacion", element: <S><PortalPage /></S> },
  { path: "/aprobar/:token", element: <RedirectToPortal suffix="/cotizacion" /> },
  { path: "/seguimiento/:token", element: <RedirectToPortal suffix="" /> },
  // Documentos imprimibles (requieren sesión, sin menú)
  { path: "/imprimir/orden/:id", element: <RequireAuth><S><PrintOrderPage /></S></RequireAuth> },
  { path: "/imprimir/cotizacion/:id", element: <RequireAuth><S><PrintQuotePage /></S></RequireAuth> },
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
      { path: "cotizaciones", element: <RequirePermission permission="orders.read"><S><QuotesPage /></S></RequirePermission> },
      { path: "cotizaciones/nueva", element: <RequirePermission permission="quotes.manage"><S><DirectQuotePage /></S></RequirePermission> },
      { path: "cotizaciones/:id", element: <RequirePermission permission="orders.read"><S><DirectQuotePage /></S></RequirePermission> },
      { path: "portal", element: <RequirePermission permission="orders.read"><S><PortalLinksPage /></S></RequirePermission> },
      { path: "configuracion", element: <RequirePermission permission="settings.read"><S><SettingsPage /></S></RequirePermission> },
      { path: "usuarios", element: <RequirePermission permission="users.manage"><S><UsersPage /></S></RequirePermission> },
      ...COMING_SOON.map((i) => ({ path: i.to.slice(1), element: <ComingSoonPage /> })),
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
