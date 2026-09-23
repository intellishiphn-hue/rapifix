# RAPIFIX: Arquitectura del Sistema

**Sistema de Gestión para Taller Automotriz**
Documento de arquitectura v1.0 (23 de septiembre de 2026)
Responde a la sección 44 de la especificación: se define todo antes de programar.

---

## 0. Resumen de decisiones clave

| Tema | Decisión |
|---|---|
| Frontend | React 18 + TypeScript + Vite, Tailwind CSS, componentes shadcn/ui (Radix), íconos lucide-react |
| Estado y datos | Hooks propios sobre Firestore en tiempo real (`onSnapshot`), Zustand solo para estado de UI |
| Formularios | React Hook Form + Zod (los mismos esquemas Zod validan en frontend y en Cloud Functions) |
| Gráficos | Recharts |
| Kanban | dnd-kit (arrastrar y soltar, funciona con touch en tablet) |
| PDFs | @react-pdf/renderer (se generan en el navegador, sin costo de servidor) |
| Backend | Firebase: Auth, Firestore, Storage, Cloud Functions (Node 20, TypeScript), Hosting, App Check |
| Hosting | Firebase Hosting con dominio propio (rapifix.com o el que definamos) |
| Código | GitHub, monorepo con npm workspaces, despliegue automático con GitHub Actions |
| Multi-taller | Todos los datos viven bajo `tenants/{tenantId}/...` desde el día 1. RAPIFIX es el primer tenant |
| Dinero | Enteros en centavos (L 1,250.50 se guarda como `125050`). Moneda HNL, ISV 15% configurable |
| WhatsApp | WhatsApp Web mediante un servicio Node.js separado (gateway). Fallback manual siempre disponible |
| Portal público | Un solo link limpio por orden (`/orden/8HD72KQ4MN`) que muestra seguimiento y la cotización por aprobar |

**Requisito importante:** Cloud Functions requiere el plan **Blaze** de Firebase (pago por uso). Para un solo taller el consumo normal queda dentro de la capa gratuita o en pocos dólares al mes. Se configura una alerta de presupuesto (por ejemplo USD 10) desde el primer día. Sin Functions no es posible hacer de forma segura: aprobación pública de cotizaciones, auditoría a prueba de manipulación, roles con custom claims, automatizaciones ni numeración confiable.

---

## 1. Arquitectura propuesta

```
                         ┌───────────────────────────────────────────┐
                         │              FIREBASE HOSTING             │
                         │  app.rapifix.com   → Panel interno (SPA)  │
                         │  rapifix.com/orden → Portal público (lazy)│
                         └───────────────┬───────────────────────────┘
                                         │
        ┌────────────────────────────────┼──────────────────────────────────┐
        │                                │                                  │
┌───────▼────────┐             ┌─────────▼─────────┐               ┌────────▼────────┐
│ Firebase Auth  │             │  Cloud Firestore  │               │ Firebase Storage│
│ email+password │             │ tenants/{tid}/... │               │ fotos, videos,  │
│ custom claims  │             │ publicPortal/...  │               │ comprobantes    │
│ {tid, role}    │             └─────────┬─────────┘               └─────────────────┘
└────────────────┘                       │ triggers
                               ┌─────────▼──────────────────────────┐
                               │        CLOUD FUNCTIONS             │
                               │ • Callables: cambiar estado, pagos,│
                               │   inventario, numeración, roles    │
                               │ • Triggers: motor de eventos,      │
                               │   auditoría, estadísticas, portal  │
                               │ • HTTPS público: aprobar/rechazar  │
                               │ • Programadas: alertas diarias,    │
                               │   mantenimientos, cotiz. expiradas │
                               └─────────┬──────────────────────────┘
                                         │ cola: whatsappOutbox
                               ┌─────────▼──────────────────────────┐
                               │  WHATSAPP GATEWAY (Node.js aparte) │
                               │  PC del taller o VPS pequeño        │
                               │  Sesión guardada SOLO en su disco   │
                               └────────────────────────────────────┘
```

### Principios

1. **La orden de trabajo es el centro.** Clientes, vehículos, cotizaciones, repuestos, fotos, pagos y mensajes se enlazan por `workOrderId`.
2. **Operaciones críticas pasan por Cloud Functions.** Cambios de estado, pagos, movimientos de inventario, numeración, aprobación pública y asignación de roles se ejecutan en el servidor, donde se validan reglas de negocio y se registra auditoría. El CRUD simple (crear cliente, editar vehículo) va directo a Firestore protegido por Security Rules.
3. **La seguridad vive en el servidor.** Las Security Rules y las Functions validan rol y tenant. Ocultar botones en el frontend es solo comodidad visual.
4. **Lo público está aislado.** El portal nunca lee colecciones internas. Lee una copia sanitizada (`publicPortal/{token}`) que solo escriben las Functions.
5. **Un solo lenguaje compartido.** El paquete `@rapifix/shared` contiene tipos, esquemas Zod, máquina de estados, cálculo de totales y renderizado de plantillas. Lo usan el panel, las Functions y el gateway de WhatsApp, así las reglas de negocio nunca se contradicen.
6. **Nada se borra de verdad.** Pagos se anulan (`voided`), órdenes se cancelan, clientes se archivan. El historial queda completo.

### Stack de la interfaz (identidad visual)

| Token | Valor | Uso |
|---|---|---|
| `primary-600` | `#1447E6` | Azul intenso: botones, links, elementos activos |
| `primary-700` | `#0F37B8` | Hover y encabezados |
| `sidebar` | `#0F172A` | Gris oscuro/pizarra: sidebar y barras importantes |
| `surface` | `#FFFFFF` | Tarjetas y áreas de contenido |
| `background` | `#F4F6FB` | Fondo general |
| Tipografía | Inter (UI) con números tabulares para montos | |
| Bordes | radio 12px en tarjetas, 10px en botones | |

Cada estado de orden tiene color propio (ver sección 7), que se usa igual en Kanban, badges, dashboard y portal.

---

## 2. Estructura de carpetas

```
rapifix/
├── apps/
│   └── web/                          # Panel interno + portal público (React + TS)
│       ├── public/
│       ├── src/
│       │   ├── app/                  # Arranque: router, providers, layout, guards
│       │   │   ├── router.tsx
│       │   │   ├── providers.tsx
│       │   │   ├── layout/           # AppShell, Sidebar colapsable, Topbar, búsqueda global
│       │   │   └── guards/           # RequireAuth, RequireRole
│       │   ├── features/             # Un módulo por dominio de negocio
│       │   │   ├── dashboard/
│       │   │   ├── customers/
│       │   │   │   ├── pages/        # CustomersListPage, CustomerDetailPage
│       │   │   │   ├── components/   # CustomerForm, CustomerCard, CustomerVehicles
│       │   │   │   ├── hooks/        # useCustomers, useCustomer
│       │   │   │   └── api.ts        # Lecturas/escrituras a Firestore de este módulo
│       │   │   ├── vehicles/
│       │   │   ├── work-orders/      # Lista, Kanban, detalle con tabs, recepción, diagnóstico
│       │   │   ├── quotes/
│       │   │   ├── pos/
│       │   │   ├── inventory/
│       │   │   ├── catalog/          # productos y servicios
│       │   │   ├── employees/
│       │   │   ├── agenda/
│       │   │   ├── maintenance/
│       │   │   ├── payments/
│       │   │   ├── expenses/
│       │   │   ├── suppliers/
│       │   │   ├── reports/
│       │   │   ├── whatsapp/         # Estado de conexión, QR, bandeja, plantillas
│       │   │   ├── documents/        # Plantillas PDF con @react-pdf/renderer
│       │   │   ├── settings/
│       │   │   └── users/
│       │   ├── portal/               # Portal público: bundle separado (lazy), sin código admin
│       │   │   ├── PortalOrderPage.tsx
│       │   │   ├── QuoteApproval.tsx
│       │   │   └── ProgressTracker.tsx
│       │   ├── components/
│       │   │   ├── ui/               # shadcn/ui: Button, Dialog, Table, Tabs, etc.
│       │   │   └── common/           # EmptyState, PageHeader, Money, StatusBadge, PhotoUploader
│       │   ├── lib/
│       │   │   ├── firebase.ts       # Inicialización (Auth, Firestore, Storage, Functions, App Check)
│       │   │   ├── auth/             # AuthProvider, useAuth, usePermissions
│       │   │   ├── firestore/        # Helpers tipados: converters, paginación, errores
│       │   │   ├── storage/          # Subida con compresión de imágenes
│       │   │   └── format.ts         # Moneda HNL, fechas, teléfonos +504
│       │   └── main.tsx
│       ├── .env.example
│       └── vite.config.ts
├── functions/                        # Cloud Functions (TypeScript)
│   └── src/
│       ├── callable/                 # changeWorkOrderStatus, registerPayment, setUserRole...
│       ├── triggers/                 # onWorkOrderWrite, onPaymentWrite, auditoría genérica
│       ├── public/                   # respondToQuote, markQuoteViewed (HTTPS con App Check)
│       ├── scheduled/                # alertas diarias, mantenimientos, expiración de cotizaciones
│       ├── automation/               # Motor de eventos: reglas, condiciones, acciones
│       ├── portal/                   # Construye publicPortal/{token}
│       ├── stats/                    # Agregados diarios/mensuales para dashboard y reportes
│       └── index.ts
├── services/
│   └── whatsapp-gateway/             # Servicio Node.js independiente (NO se despliega en Firebase)
│       ├── src/
│       │   ├── providers/            # Adaptador intercambiable (Baileys o whatsapp-web.js)
│       │   ├── outbox.ts             # Escucha la cola y envía con control de ritmo
│       │   ├── status.ts             # Heartbeat y QR hacia Firestore
│       │   └── index.ts
│       ├── .env.example
│       └── README.md
├── packages/
│   └── shared/                       # @rapifix/shared
│       └── src/
│           ├── types/                # Interfaces de todas las entidades
│           ├── schemas/              # Esquemas Zod
│           ├── workOrderStatus.ts    # Máquina de estados, transiciones, mapeo Kanban/portal
│           ├── money.ts              # Cálculo de líneas, descuentos, ISV, totales
│           ├── templates.ts          # Render de {{cliente}}, {{vehiculo}}...
│           └── permissions.ts        # Matriz de roles
├── scripts/
│   ├── seed-demo.ts                  # Datos de demostración
│   └── bootstrap-admin.ts            # Crea el primer administrador
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── firebase.json
├── .firebaserc                       # alias: dev → rapifix-dev, prod → rapifix-prod
├── .github/workflows/
│   ├── ci.yml                        # lint + typecheck + tests + build en cada PR
│   └── deploy.yml                    # despliegue a producción al hacer merge a main
├── .gitignore                        # incluye .env*, service-account*.json, sesiones de WhatsApp
├── .env.example
└── README.md
```

**Regla de capas dentro de cada módulo:** `pages` componen pantallas, `components` solo muestran y capturan datos, `hooks` conectan componentes con datos, `api.ts` es el único lugar que habla con Firestore/Functions. La lógica de negocio (totales, transiciones, permisos) vive en `@rapifix/shared`, nunca dentro de un componente.

---

## 3. Arquitectura Firebase

### 3.1 Proyectos y ambientes

| Proyecto | Uso |
|---|---|
| Emulator Suite local | Desarrollo diario, con datos demo, sin tocar la nube |
| `rapifix-dev` | Pruebas en la nube y previews de cada Pull Request |
| `rapifix-prod` | Producción real del taller |

### 3.2 Authentication

- Email + contraseña (usuarios creados por el administrador, no hay registro público).
- **Custom claims** en el token: `{ tid: "rapifix", role: "admin" }`. Los asigna solo la Function `setUserRole` (ejecutable por administradores). El primer admin se crea con `scripts/bootstrap-admin.ts`.
- Las reglas leen el rol directamente del token: rápido y sin lecturas extra.
- Documento `users/{uid}` con nombre, foto, teléfono, estado activo, `employeeId` vinculado.
- Desactivar un usuario revoca sus tokens de inmediato.

### 3.3 Firestore

Todo lo operativo vive bajo `tenants/{tid}/`. Solo tres cosas quedan fuera: `users`, `publicPortal` y `publicQuoteResponses` (ver modelo de datos).

### 3.4 Storage

```
tenants/{tid}/workOrders/{orderId}/photos/{photoId}.jpg
tenants/{tid}/workOrders/{orderId}/videos/{videoId}.mp4
tenants/{tid}/vehicles/{vehicleId}/photos/{photoId}.jpg
tenants/{tid}/expenses/{expenseId}/receipt.{jpg|pdf}
tenants/{tid}/branding/logo.png
```

- Las fotos se comprimen en el navegador antes de subir (máx. 1600px, calidad 0.8), así una foto de celular de 5 MB queda en unos 300 KB. Se genera también una miniatura de 400px.
- `storage.rules` valida tenant, rol, tipo de archivo (imágenes, video, PDF) y tamaño máximo (10 MB foto, 100 MB video).
- Fotos marcadas como "visible para el cliente" copian su URL de descarga al portal público. Las demás nunca salen del panel.

### 3.5 Cloud Functions

| Tipo | Function | Qué hace |
|---|---|---|
| Callable | `createWorkOrder` | Numeración OT-1024 con transacción, crea orden + evento inicial + token de portal |
| Callable | `changeWorkOrderStatus` | Valida transición y rol, guarda historial, dispara motor de eventos |
| Callable | `sendQuote` | Congela la cotización (versión), genera snapshot público, estado "Enviada" |
| Callable | `registerPayment` / `voidPayment` | Registra/anula pagos, recalcula saldo de orden y cliente |
| Callable | `registerInventoryMovement` | Mueve stock con transacción (nunca queda negativo sin permiso) |
| Callable | `postCustomerUpdate` | Centro de comunicación: publica en portal y/o prepara WhatsApp |
| Callable | `queueWhatsAppMessage` | Pone el mensaje en la cola del gateway |
| Callable | `setUserRole` | Asigna rol y tenant (solo admin) |
| HTTPS público | `respondToQuote` | Aprobar/rechazar/pregunta desde el portal (guarda IP, fecha, user agent) |
| HTTPS público | `markQuoteViewed` | Marca la cotización como "Vista por cliente" |
| Trigger | `onWorkOrderWritten` | Actualiza portal, estadísticas, alertas |
| Trigger | `auditWriter` | Escribe `auditLogs` con valor anterior y nuevo en colecciones clave |
| Trigger | `onPaymentWritten`, `onExpenseWritten` | Mantiene agregados diarios y mensuales |
| Programada (6:00 AM) | `dailyAlerts` | Vehículos con muchos días en taller, mantenimientos próximos, cotizaciones por expirar |

### 3.6 App Check

Se activa App Check con reCAPTCHA Enterprise para que los endpoints públicos (aprobación, vista de cotización) solo acepten solicitudes desde la web real de RAPIFIX, y se aplica límite de intentos por IP.

---

## 4. Modelo de datos

Convenciones en todas las entidades:

```ts
interface BaseDoc {
  id: string;
  createdAt: Timestamp; createdBy: string;   // uid
  updatedAt: Timestamp; updatedBy: string;
  archived?: boolean;                         // borrado lógico
}
type Money = number;                          // centavos de Lempira
```

Los datos que se muestran en listas se **desnormalizan** (por ejemplo la orden guarda nombre del cliente y placa) para que una lista de 50 órdenes sea 1 consulta y no 150. Cuando cambia el original, una Function actualiza las copias en órdenes abiertas. Las órdenes cerradas conservan la foto histórica (si el vehículo cambia de dueño, la orden vieja sigue mostrando al dueño de ese momento).

### 4.1 Colecciones raíz

```ts
// users/{uid}
interface User { displayName; email; phone?; photoUrl?; tid: string; role: Role;
                 employeeId?: string; active: boolean; lastLoginAt? }

// tenants/{tid}
interface Tenant { name: "RAPIFIX"; slug; plan; active; createdAt }

// publicPortal/{token}           ← solo escriben Functions, lectura pública por token
interface PublicPortal {
  tid; orderCode: "OT-1024"; workshop: { name; logoUrl; phone; whatsapp; address };
  customerFirstName: "Juan";                  // nunca teléfono, identidad ni dirección
  vehicle: { make; model; year; color; plateMasked: "ABC-123" };
  status; stepIndex: 4; percent: 65; nextStepLabel: "Control de calidad";
  steps: { key; label; done: boolean; at?: Timestamp }[];
  updates: { at; text; photoUrls?: string[] }[];   // últimas 30 visibles al cliente
  quote?: {                                        // presente si hay cotización enviada
    code; status; validUntil; items: { description; type; qty; unitPrice; discount; total }[];
    subtotal; discount; tax; total; diagnosisSummary; photoUrls: string[];
  };
  active: boolean; expiresAt?: Timestamp;          // se cierra 30 días después de entregado
}
```

### 4.2 Bajo `tenants/{tid}/`

```ts
// customers/{id}
interface Customer extends BaseDoc {
  firstName; lastName; fullName; phone; whatsapp /* +504XXXXXXXX */; email?;
  idNumber? /* identidad */; rtn?; address?; city?; notes?;
  status: "active" | "inactive";
  vehicleCount: number; openOrders: number; balanceDue: Money; lastVisitAt?;
  searchKeywords: string[];                    // para búsqueda global
}

// vehicles/{id}
interface Vehicle extends BaseDoc {
  customerId; customer: { fullName; phone };   // desnormalizado
  make; model; year; color; plate /* normalizada: ABC123 */; vin?;
  mileage; mileageUpdatedAt; fuelType; engine?; transmission?;
  coverPhotoUrl?; searchKeywords: string[];
}
// vehicles/{id}/mileageLog/{id}  → { mileage, at, source: "reception" | "delivery" | "manual" }

// workOrders/{id}   ← EL CORAZÓN
interface WorkOrder extends BaseDoc {
  number: 1024; code: "OT-1024";
  status: WorkOrderStatus; statusChangedAt; statusChangedBy;
  type: "repair" | "maintenance" | "warranty" | "diagnosis" | "other";
  priority: "normal" | "high" | "urgent";
  reason: string;                              // motivo de ingreso
  customerId; customer: { fullName; phone; whatsapp };
  vehicleId;  vehicle:  { make; model; year; color; plate };
  technicianIds: string[];                     // userIds (para reglas del técnico)
  technicians: { id; name }[];
  reception?: {
    mileageIn; fuelLevel: 0-8 /* octavos */; exteriorNotes; interiorNotes;
    checklist: { keys; documents; spareTire; jack; tools; triangles; extinguisher: boolean };
    accessories?; otherObjects?; customerSignatureUrl?; receivedAt; receivedBy;
  };
  diagnosis?: {
    reportedProblem; technicianDiagnosis; recommendations; observations;
    testsPerformed; obdCodes: string[]; completedAt; completedBy;
  };
  qc?: { checklist: Record<string, boolean>; notes; passedAt; passedBy };
  totals: { subtotal; discount; tax; total: Money };
  paid: Money; balance: Money;
  activeQuoteId?; portalToken: string; portalEnabled: boolean;
  promisedAt?; deliveredAt?; mileageOut?; cancelReason?;
  searchKeywords: string[];
}
// workOrders/{id}/items/{id}        → líneas reales de trabajo
interface OrderItem { type: "labor" | "part" | "service" | "other";
  description; productId?; serviceId?; quoteId?; qty; unitPrice; discount; taxRate;
  lineTotal: Money; status: "pending" | "approved" | "done";
  technicianId?; inventoryMovementId?; doneAt? }
// workOrders/{id}/events/{id}       → historial inmutable (nadie edita ni borra)
interface OrderEvent { type: "status_change" | "note" | "customer_update" | "photo"
  | "quote" | "payment" | "message" | "assignment";
  fromStatus?; toStatus?; text?; visibleToCustomer: boolean; channels?: ("portal"|"whatsapp")[];
  actorId; actorName; at }
// workOrders/{id}/photos/{id}       → { url; thumbUrl; stage: "reception"|"before"|"during"|"after"
//                                       |"diagnosis"|"damage"; angle?; caption; visibleToCustomer; by; at }
// workOrders/{id}/timeEntries/{id}  → { technicianId; startedAt; endedAt; minutes }
// workOrders/{id}/private/financials → costos y margen (solo admin/gerente)

// quotes/{id}
interface Quote extends BaseDoc {
  number; code: "COT-0045"; version: 1; workOrderId; customerId; vehicleId;
  status: "draft" | "sent" | "viewed" | "approved" | "rejected" | "expired";
  items: QuoteItem[];          // embebidas: atómico, una lectura, se congela al enviar
  totals: { subtotal; discount; tax; total }; validUntil;
  sentAt?; viewedAt?;
  decision?: { result: "approved" | "rejected"; at; approvalId; ip?; userAgent?; comment? };
  questions?: { at; text }[];
}
interface QuoteItem { id; type; description; productId?; serviceId?;
  qty; unitCost /* interno */; unitPrice; discount; taxRate; lineTotal }
```

> Nota: la especificación sugiere una colección `quoteItems`. Propongo **embeber las líneas dentro de la cotización** porque una cotización tiene pocas líneas, se congela al enviarse y así se lee y guarda de forma atómica. Los reportes de "repuestos más vendidos" salen de `workOrders/{id}/items` y de ventas del POS, que sí son colecciones.

```ts
// services/{id}        → { code; name; category; defaultPrice; estimatedHours; taxRate; active }
// products/{id}        → { sku; name; category; brand; supplierId; price; stock; minStock;
//                          location; unit; taxRate; active; searchKeywords }
// productCosts/{productId} → { cost; lastPurchaseCost; avgCost }   (solo admin/gerente/bodega)
// inventoryMovements/{id}  → { productId; type: "in"|"out"|"adjust"|"return"; qty; unitCost;
//                              stockBefore; stockAfter; reason; workOrderId?; saleId?;
//                              purchaseId?; by; at }
// sales/{id}           → venta de mostrador (POS): { number; customerId?; vehicleId?; items;
//                          totals; paid; balance; status }
// payments/{id}        → { number; customerId; workOrderId?; saleId?; amount; method:
//                          "cash"|"transfer"|"card"|"other"; reference?; status: "valid"|"voided";
//                          voidReason?; receivedBy; at }
// expenses/{id}        → { category; description; amount; date; supplierId?; method; receiptUrl? }
// suppliers/{id}       → { name; contactName; phone; email; rtn?; categories; balanceDue }
// purchases/{id}       → compras a proveedores: { supplierId; items; total; paid; balance; status }
// employees/{id}       → { name; phone; specialty; status; userId?; color /* agenda */ }
// appointments/{id}    → { type: "appointment"|"diagnosis"|"delivery"|"reception"|"maintenance";
//                          customerId; vehicleId; workOrderId?; technicianId?; start; durationMin;
//                          status: "scheduled"|"confirmed"|"done"|"no_show"|"cancelled"; notes }
// maintenance/{id}     → { vehicleId; customerId; serviceId; serviceName; lastDate; lastMileage;
//                          intervalDays?; intervalKm?; nextDate?; nextMileage?;
//                          status: "upcoming"|"due"|"overdue"|"done"; reminderSentAt? }
// messages/{id}        → { workOrderId?; customerId; to; body; templateKey?;
//                          mode: "auto"|"manual"; status: "draft"|"queued"|"sending"|"sent"
//                          |"failed"|"manual_opened"; error?; createdBy; sentAt? }
// messageTemplates/{key} → { name; body; active; triggerStatus? }
// notifications/{id}   → avisos internos { toRoles; toUserIds; title; body; link; readBy[] }
// auditLogs/{id}       → { actorId; actorName; action; entity; entityId; before; after; at }
//                          (solo escriben Functions; nadie puede editarlos)
// counters/{name}      → { next: 1025 }  (workOrders, quotes, payments, sales)
// settings/{doc}       → general, taxes, numbering, portal, statuses, automation, inventoryRules
// integrations/whatsapp → { status; qr?; phone?; lastHeartbeatAt; gatewayVersion; command? }
// stats/daily-{yyyy-mm-dd}, stats/monthly-{yyyy-mm} → agregados para dashboard y reportes
```

### 4.3 Búsqueda global

Firestore no tiene búsqueda de texto completo. Para el volumen de un taller se usa un campo `searchKeywords` con términos normalizados (sin tildes, mayúsculas) y sus prefijos: placa, VIN, teléfono, número de OT, nombre, marca, modelo. Escribir `ABC123` hace 3 consultas en paralelo (clientes, vehículos, órdenes) con `array-contains` y agrupa resultados. Si el volumen crece mucho se puede conectar Typesense o Algolia sin cambiar la interfaz.

### 4.4 Índices compuestos principales

| Colección | Campos |
|---|---|
| workOrders | `status` + `statusChangedAt desc` |
| workOrders | `technicianIds` (array-contains) + `status` |
| workOrders | `customerId` + `createdAt desc` |
| workOrders | `vehicleId` + `createdAt desc` |
| quotes | `status` + `sentAt desc` |
| payments | `workOrderId` + `at desc` / `customerId` + `at desc` / `status` + `at` |
| appointments | `technicianId` + `start` |
| maintenance | `status` + `nextDate` |
| messages | `status` + `createdAt` |
| products | `category` + `name` |
| inventoryMovements | `productId` + `at desc` |

---

## 5. Relaciones

```
Customer 1 ─── N Vehicle
Customer 1 ─── N WorkOrder ─── 1 Vehicle
WorkOrder 1 ── N Quote (versiones y cotizaciones adicionales)
WorkOrder 1 ── N OrderItem ─── 0..1 Product / Service
WorkOrder 1 ── N OrderEvent (historial)
WorkOrder 1 ── N Photo
WorkOrder 1 ── N Payment
WorkOrder N ── N Employee (técnicos asignados)
WorkOrder 1 ── 1 PublicPortal (por token)
Product 1 ──── N InventoryMovement
Supplier 1 ─── N Purchase ─── N InventoryMovement
Vehicle 1 ──── N Maintenance ─── 0..1 Service
Appointment ── Customer, Vehicle, WorkOrder?, Employee?
Message ────── Customer, WorkOrder?
```

La **línea de tiempo del vehículo** se arma consultando por `vehicleId`: órdenes, eventos, fotos, pagos, cotizaciones, mantenimientos y el registro de kilometraje, ordenados por fecha.

---

## 6. Roles y permisos

| Módulo | Admin | Gerente | Recepción | Técnico | Bodega | Vendedor |
|---|---|---|---|---|---|---|
| Dashboard | Completo | Completo | Operativo (sin utilidad) | Sus órdenes | Inventario | Ventas del día |
| Clientes / Vehículos | CRUD | CRUD | CRUD | Ver (de sus órdenes) | Ver | CRUD |
| Órdenes | Todo | Todo | Crear, editar, estados | Solo asignadas: diagnóstico, fotos, repuestos, estados permitidos | Ver repuestos | Ver |
| Cotizaciones | Todo | Todo | Crear, enviar | Sugerir líneas | Ver | Ver |
| POS / Pagos | Todo + anular | Todo + anular | Registrar | No | No | Registrar |
| Inventario | Todo | Todo | Ver | Solicitar/usar en su orden | Todo | Ver precio |
| Costos y utilidad | Sí | Sí | No | No | Costos de compra | No |
| Gastos / Proveedores | Todo | Todo | No | No | Proveedores y compras | No |
| Reportes | Todos | Todos | Operativos | No | Inventario | Ventas |
| WhatsApp | Todo | Todo | Enviar | No | No | Enviar |
| Configuración / Usuarios | Todo | Ver | No | No | No | No |
| Auditoría | Ver | Ver | No | No | No | No |

**Transiciones que puede hacer el técnico:** Inspección → Diagnóstico → Esperando cotización, Aprobado → En reparación ↔ Esperando repuestos → Control de calidad. No puede marcar Entregado ni Cancelado.

### Cómo se aplica de verdad (ejemplo de reglas)

```
function signedIn()      { return request.auth != null; }
function inTenant(tid)   { return signedIn() && request.auth.token.tid == tid; }
function role()          { return request.auth.token.role; }
function hasRole(roles)  { return role() in roles; }

match /tenants/{tid}/workOrders/{id} {
  allow read: if inTenant(tid) && (
      hasRole(['admin','manager','reception','warehouse','seller'])
   || (role() == 'technician' && request.auth.uid in resource.data.technicianIds));
  allow create, update, delete: if false;     // solo vía Cloud Functions
}
match /tenants/{tid}/customers/{id} {
  allow read:  if inTenant(tid);
  allow write: if inTenant(tid) && hasRole(['admin','manager','reception','seller'])
               && validCustomer(request.resource.data);
}
match /tenants/{tid}/productCosts/{id} {
  allow read: if inTenant(tid) && hasRole(['admin','manager','warehouse']);
}
match /tenants/{tid}/auditLogs/{id} {
  allow read:  if inTenant(tid) && hasRole(['admin','manager']);
  allow write: if false;
}
match /publicPortal/{token} {
  allow get:  if true;       // quien tenga el link exacto
  allow list: if false;      // imposible listar o adivinar portales
  allow write: if false;
}
```

**Detalle importante de Firestore:** las reglas protegen documentos completos, no campos sueltos. Por eso los costos y márgenes van en documentos separados (`productCosts`, `workOrders/{id}/private/financials`) que técnicos y vendedores no pueden leer, aunque sí vean el producto o la orden.

Las reglas se prueban con `@firebase/rules-unit-testing`: cada rol intenta leer y escribir lo que no debe y el test verifica que falla.

---

## 7. Flujo completo de una orden

### 7.1 Estados

| # | Clave | Etiqueta | Columna Kanban | Paso del portal | Color |
|---|---|---|---|---|---|
| 1 | RECEIVED | Recibido | Recibido | Recepción | slate |
| 2 | INSPECTION | Inspección | Recibido | Inspección | sky |
| 3 | DIAGNOSIS | Diagnóstico | Diagnóstico | Diagnóstico | indigo |
| 4 | AWAITING_QUOTE | Esperando cotización | Diagnóstico | Diagnóstico | violet |
| 5 | QUOTE_SENT | Cotización enviada | Esperando aprobación | Aprobación | amber |
| 6 | AWAITING_APPROVAL | Esperando aprobación | Esperando aprobación | Aprobación | amber |
| 7 | APPROVED | Aprobado | Reparación | Reparación | teal |
| 8 | IN_REPAIR | En reparación | Reparación | Reparación | blue |
| 9 | WAITING_PARTS | Esperando repuestos | Reparación | Reparación | orange |
| 10 | QUALITY_CONTROL | Control de calidad | Control de calidad | Control de calidad | cyan |
| 11 | READY | Listo para entrega | Listo | Vehículo listo | green |
| 12 | DELIVERED | Entregado | Entregado | Entregado | emerald |
| 13 | CANCELLED | Cancelado | (filtro aparte) | Cancelado | red |

Al soltar una tarjeta en una columna del Kanban que agrupa varios estados, el sistema pregunta a cuál (por ejemplo, en Reparación: "En reparación" o "Esperando repuestos"). Si la transición no es válida o el rol no la permite, la tarjeta regresa a su lugar y se muestra el motivo.

### 7.2 Recorrido

```
 1. RECEPCIÓN        Recepción busca por placa. Si no existe, crea cliente + vehículo en el mismo flujo.
                     Captura kilometraje, combustible, checklist, fotos (frente, atrás, laterales,
                     interior, tablero, daños). Firma del cliente opcional en tablet.
                     → createWorkOrder: OT-1024, token de portal, evento "Vehículo recibido".
                     → Automatización: portal activo + mensaje WhatsApp "Vehículo recibido" con link.
 2. INSPECCIÓN       Técnico asignado la toma desde su celular.
 3. DIAGNÓSTICO      Técnico registra diagnóstico, pruebas, códigos OBD, fotos y video.
                     → Estado "Esperando cotización". Notificación interna a recepción.
 4. COTIZACIÓN       Recepción arma líneas (mano de obra, repuestos, servicios) desde el catálogo.
                     sendQuote congela la versión, la publica en el portal.
                     → Estado "Cotización enviada" + WhatsApp con link.
 5. APROBACIÓN       Cliente abre el link (→ "Vista por cliente"), ve fotos y total, toca APROBAR.
                     respondToQuote guarda fecha, hora, IP, ID de aprobación.
                     → Orden pasa a "Aprobado" automáticamente, líneas pasan a "approved",
                       notificación a recepción, portal actualizado.
                     Si rechaza: orden vuelve a revisión. Si pregunta: llega aviso interno.
 6. REPARACIÓN       Técnico marca trabajos hechos, agrega repuestos (descuenta inventario según regla),
                     sube fotos durante/después, registra tiempo. Si falta pieza: "Esperando repuestos".
                     Si aparece un daño adicional: cotización adicional (vuelve a paso 4 solo por lo nuevo).
 7. CONTROL CALIDAD  Checklist de salida (prueba de ruta, niveles, limpieza, piezas viejas al cliente).
 8. LISTO            → Portal "Vehículo listo" + WhatsApp "Listo para entrega" + aviso interno.
 9. PAGO             Pagos totales o abonos. Saldo se recalcula en la orden y en el cliente.
10. ENTREGA          Solo si saldo = 0, o si gerente autoriza "entregar con saldo" (queda en auditoría).
                     Se registra kilometraje de salida.
                     → Se crean/actualizan mantenimientos futuros según servicios hechos
                       (ej. cambio de aceite: +5,000 km o +3 meses).
                     → WhatsApp de agradecimiento.
11. MANTENIMIENTO    Alerta diaria cuando se acerca la fecha. Mensaje de recordatorio preparado.
```

### 7.3 Motor de eventos (automatizaciones)

Cada acción importante emite un evento. Las reglas viven en `settings/automation`, editables desde Configuración, con reglas por defecto:

```ts
{ event: "workOrder.statusChanged", when: { newStatus: "READY" },
  actions: ["portal.update", "whatsapp.prepare:vehiculo_listo", "notify.roles:reception"] }

{ event: "quote.approved",
  actions: ["workOrder.setStatus:APPROVED", "notify.roles:reception", "portal.update"] }

{ event: "workOrder.statusChanged", when: { newStatus: "RECEIVED" },
  actions: ["portal.update", "whatsapp.prepare:vehiculo_recibido"] }
```

`whatsapp.prepare` crea el mensaje con la plantilla ya rellenada. Según la configuración:
- **Modo semiautomático (por defecto):** aparece en la orden para que el empleado lo revise y toque "Enviar".
- **Modo automático:** se envía solo a la cola del gateway (solo para plantillas marcadas como seguras).

Las acciones son idempotentes (si la Function se reintenta, no se duplican mensajes).

---

## 8. Arquitectura de WhatsApp Web

### 8.1 Límites reales (para decidir con los ojos abiertos)

- No existe una forma oficial de automatizar WhatsApp Web. Cualquier envío automático usa librerías **no oficiales** (Baileys o whatsapp-web.js) que imitan a WhatsApp Web.
- Esto **va contra los términos de uso de WhatsApp**. El riesgo principal es que el número sea **bloqueado**, sobre todo si se envían muchos mensajes, a gente que no tiene el número guardado o mensajes repetidos.
- Cuando WhatsApp actualiza su web, estas librerías pueden dejar de funcionar unos días hasta que las actualizan.
- Se necesita un proceso **encendido 24/7**. No puede correr dentro de Cloud Functions (se apagan entre ejecuciones).
- Una sesión = un número. El teléfono debe conectarse a internet al menos cada cierto tiempo (el modo multi-dispositivo aguanta unos 14 días sin el teléfono).

### 8.2 Recomendación

1. **El fallback manual es la base y funciona desde la Fase 2**, sin riesgo de bloqueo: el sistema genera el mensaje y abre `https://wa.me/504XXXXXXXX?text=...` con el texto listo. El empleado solo toca enviar.
2. **El gateway automático es opcional** (Fase 6) y se usa solo para mensajes transaccionales a clientes del taller (nunca campañas masivas), con ritmo humano: 1 mensaje cada 20 a 45 segundos con variación aleatoria y tope diario.
3. Usar un **número dedicado para el sistema** (no el WhatsApp personal del dueño) y que los clientes lo guarden (se les pide en recepción).

### 8.3 Diseño del gateway

```
Panel RAPIFIX                 Firestore                          Gateway (Node.js)
─────────────                 ─────────                          ─────────────────
[Conectar WhatsApp] ──► integrations/whatsapp.command="connect" ──► inicia sesión
                                                                   genera QR
   muestra QR  ◄──────── integrations/whatsapp.qr (dura ~20 s) ◄── escribe QR
   escanea con el celular                                          
   🟢 Conectado ◄──────── status="connected", qr=null  ◄──────────── sesión lista
                          lastHeartbeatAt cada 30 s   ◄──────────── heartbeat

[Enviar por WhatsApp] ──► queueWhatsAppMessage
                          messages/{id}.status="queued" ─────────► escucha la cola
                                                                   reclama con transacción
                                                                   envía con pausa
   ✓ Enviado ◄──────────── status="sent" / "failed" + error ◄────── actualiza
```

- **Firestore funciona como bus de mensajes:** el gateway no necesita abrir puertos ni tener IP pública. Puede correr en una PC del taller o en un VPS de unos USD 5/mes.
- **La sesión de WhatsApp se guarda solo en el disco del gateway** (carpeta `auth_session/`, incluida en `.gitignore`). Nunca en Firestore, nunca en GitHub. El QR es un código temporal de emparejamiento y se borra al conectar.
- El gateway se autentica con una **cuenta de servicio** de Firebase cuyo archivo JSON vive solo en esa máquina.
- El panel considera "Desconectado" si el último heartbeat tiene más de 90 segundos. En ese caso muestra "WhatsApp no está conectado" y el botón "Abrir WhatsApp Web" (fallback manual).
- El proveedor (Baileys o whatsapp-web.js) va detrás de un adaptador. Si uno deja de funcionar, se cambia sin tocar el resto. Recomiendo **Baileys** (no necesita Chrome, consume poca memoria).
- Se ejecuta con PM2 o Docker para que se reinicie solo si se cae.

### 8.4 Mensaje semiautomático en la orden

```
┌ Mensaje sugerido: LISTO PARA ENTREGA ─────────────────────────────┐
│ Hola Juan, ¡su Toyota Corolla 2022 ya está listo para ser retirado │
│ en RAPIFIX! Puede consultar los detalles aquí:                     │
│ https://rapifix.com/orden/8HD72KQ4MN                               │
│                                                                    │
│ [Enviar por WhatsApp]  [Editar mensaje]  [Copiar mensaje]          │
└────────────────────────────────────────────────────────────────────┘
```

Variables disponibles: `{{cliente}}`, `{{vehiculo}}`, `{{placa}}`, `{{orden}}`, `{{total}}`, `{{saldo}}`, `{{link}}`, `{{taller}}`. Las 13 plantillas de la especificación vienen precargadas y son editables.

---

## 9. Arquitectura del portal público

### 9.1 Un solo link por orden

La especificación menciona tres rutas (`/aprobar/`, `/seguimiento/`, `/orden/`). Propongo que el cliente reciba **un solo link** durante toda la reparación:

```
https://rapifix.com/orden/8HD72KQ4MN              → seguimiento + cotización pendiente
https://rapifix.com/orden/8HD72KQ4MN/cotizacion   → abre directo en la cotización
```

`/aprobar/...` y `/seguimiento/...` redirigen a esta ruta, así cualquier formato funciona.

### 9.2 Seguridad del link

- Token de **10 caracteres** con alfabeto sin caracteres confusos (sin 0/O, 1/I/L): unos 800 billones de combinaciones. La especificación muestra 6 caracteres de ejemplo, pero con 10 sigue siendo corto y es imposible de adivinar.
- Las reglas permiten `get` del documento exacto y prohíben `list`: nadie puede recorrer portales.
- El portal no muestra teléfono completo, identidad, dirección, costos internos ni notas internas. Solo nombre de pila, vehículo, avances marcados como visibles, fotos marcadas para el cliente y la cotización.
- El portal se cierra 30 días después de la entrega (muestra "Orden finalizada, contáctenos").
- Las páginas llevan `noindex` para que Google no las indexe.
- Si un link se comparte por error, desde la orden se puede **regenerar el token** (el viejo deja de funcionar).

### 9.3 Aprobación

1. Cliente toca **APROBAR COTIZACIÓN** → pantalla de confirmación con el total.
2. `respondToQuote` (HTTPS, App Check, límite de intentos) valida token y que la cotización siga vigente y en estado "Enviada/Vista".
3. Guarda: resultado, fecha y hora del servidor, `approvalId` único, IP (de la cabecera de Hosting), navegador, comentario.
4. Motor de eventos: orden → APROBADO, aviso a recepción, portal actualizado.
5. **TENGO UNA PREGUNTA** abre un campo de texto: crea aviso interno y evento en la orden, y ofrece también botón directo a WhatsApp del taller.

### 9.4 Rendimiento

El portal es un bundle aparte cargado de forma diferida: el cliente descarga solo el código del portal (liviano, pensado para celular con datos móviles), nunca el panel administrativo.

---

## 10. Plan de desarrollo por fases

Cada fase se entrega funcionando contra Firebase real (no maqueta) y se revisa con el criterio de calidad de la sección 47: guarda y lee datos reales, valida formularios, respeta permisos, maneja errores de Firebase, tiene loaders y estados vacíos, y funciona en celular. Al cerrar cada fase se entrega: qué quedó, archivos creados/modificados, cómo probarlo y qué queda pendiente.

### Fase 1: Base, acceso, clientes y vehículos
- Monorepo, `@rapifix/shared`, configuración Firebase (dev/prod), emuladores, CI en GitHub Actions.
- Auth con roles por custom claims, login, recuperación de contraseña, guardas por rol.
- Layout: sidebar colapsable, topbar, búsqueda global (clientes/vehículos), modo tablet/celular.
- Security Rules base + tests de reglas. Trigger de auditoría genérico.
- Clientes: lista, filtros, crear/editar/archivar, detalle con vehículos.
- Vehículos: lista, crear/editar, cambio de dueño, fotos, registro de kilometraje.
- Dashboard con KPIs reales de lo que ya existe (el resto se completa en fases siguientes).
- Configuración: datos del taller, logo, impuestos, numeración.
- Script de datos demo (clientes, vehículos) y creación del primer admin.

### Fase 2: Órdenes de trabajo
- `createWorkOrder`, `changeWorkOrderStatus`, máquina de estados, historial inmutable.
- Lista, Kanban con arrastrar y soltar, detalle con los 10 tabs y encabezado (OT, cliente, vehículo, placa, estado, técnico, total, saldo).
- Recepción con checklist y fotos guiadas por ángulo. Diagnóstico optimizado para celular (OBD, pruebas, fotos, video).
- Fotos antes/durante/después con comentarios. Línea de tiempo del vehículo.
- Centro de comunicación con **fallback manual de WhatsApp** ya funcional.
- Datos demo: órdenes en distintos estados.

### Fase 3: Cotizaciones, aprobación y portal
- Constructor de cotizaciones con catálogo, descuentos, ISV, versiones.
- `sendQuote`, portal público `/orden/{token}`, aprobación/rechazo/pregunta, "vista por cliente", expiración.
- Barra de progreso del portal, actualizaciones manuales, botón "Contactar a RAPIFIX".
- PDFs: orden de trabajo y cotización con branding RAPIFIX.

### Fase 4: Inventario, catálogo, POS y pagos
- Productos, servicios, categorías, costos separados.
- Movimientos de inventario (entradas, salidas, ajustes, devoluciones), regla de descuento configurable, alertas de stock mínimo.
- Punto de venta con pago parcial y saldo. Pagos y abonos sobre órdenes. Anulaciones con motivo.
- PDFs: comprobante de pago y factura/comprobante.

### Fase 5: Agenda, mantenimiento, técnicos, proveedores, gastos y reportes
- Agenda (día/semana, por técnico) enlazada a cliente, vehículo, orden.
- Mantenimientos por fecha y kilometraje, generados automáticamente al entregar.
- Técnicos: órdenes asignadas, completadas, horas trabajadas, ingresos generados.
- Proveedores, compras, cuentas por pagar. Gastos con comprobante adjunto.
- Reportes con filtros y exportación a Excel/PDF. Dashboard completo con gráficos y alertas.

### Fase 6: WhatsApp Web y automatizaciones
- Gateway Node.js (Baileys) con QR, heartbeat, cola, control de ritmo, reintentos.
- Sección WhatsApp: estado 🟢/🔴, conectar, bandeja de enviados/fallidos.
- Editor de plantillas con vista previa de variables.
- Motor de eventos configurable desde la interfaz. Notificaciones internas.

### Fase 7: Seguridad, auditoría, optimización y deployment
- Revisión completa de Security Rules y Storage Rules con tests por rol.
- Visor de auditoría con filtros. App Check en producción.
- Optimización (paginación, caché offline de Firestore, tamaño de bundles, Lighthouse).
- Dominio propio, SSL, backups programados de Firestore, alerta de presupuesto, monitoreo de errores.
- Manual de uso corto por rol.

---

## Anexos

### A. Facturación en Honduras (SAR)

Una **factura fiscal** en Honduras debe cumplir el Régimen de Facturación del SAR (CAI, rango autorizado, fecha límite de emisión, RTN, etc.). El sistema queda preparado para eso: la configuración admitirá CAI, rango y fecha límite, y el PDF de factura los imprimirá con numeración correlativa controlada por el servidor. Mientras no se configure el CAI, el sistema emite **"Comprobante"** (no fiscal). Conviene validar el formato final con el contador del taller.

### B. GitHub y despliegue

- Repositorio privado. Ramas: `main` (producción), `develop` (pruebas), ramas por fase/funcionalidad con Pull Request.
- `ci.yml`: en cada PR corre lint, typecheck, tests (incluidos tests de reglas con emuladores) y build; publica una vista previa temporal en Firebase Hosting.
- `deploy.yml`: al hacer merge a `main` despliega Hosting, Functions, reglas e índices a `rapifix-prod`.
- Secretos solo en **GitHub Secrets** y en `.env` locales ignorados por git. `.gitignore` incluye: `.env*` (excepto `.env.example`), `*service-account*.json`, `auth_session/`, `node_modules/`, `dist/`, logs de emuladores.
- La configuración web de Firebase (apiKey pública) va en variables de entorno de Vite aunque no sea secreta, para separar dev y prod.

### C. Pendientes por confirmar antes de la Fase 1

1. Nombre de los proyectos Firebase y activación del plan Blaze con alerta de presupuesto.
2. Dominio: ¿se tiene `rapifix.com` (o `.hn`)? Mientras tanto se usa `rapifix.web.app`.
3. Repositorio GitHub (cuenta y nombre).
4. Logo de RAPIFIX en buena resolución y las imágenes de referencia del otro software.
5. Dónde correrá el gateway de WhatsApp (PC del taller o VPS) y si habrá número dedicado.
6. Si se necesita factura fiscal con CAI desde el inicio o comprobante interno primero.
