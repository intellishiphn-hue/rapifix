# Fase 5: Agenda, mantenimiento, técnicos, proveedores, compras, gastos y reportes

## Qué quedó implementado

| Área | Detalle |
|---|---|
| Agenda | Vista día y semana (7:00 a 18:00), filtro por técnico con su color, citas de recepción, diagnóstico, entrega, mantenimiento u otras. Cliente registrado o no registrado, vehículo, orden y técnico. Estados: agendada, confirmada, atendida, no se presentó, cancelada. WhatsApp de confirmación o recordatorio. "Recibir vehículo" abre la nueva orden con el vehículo ya elegido. El técnico ve sus citas en solo lectura |
| Mantenimiento | Se generan solos al entregar una orden que tenga servicios con intervalo (ej. cambio de aceite cada 90 días o 5,000 km). Un registro por vehículo y servicio. Estados programado, próximo (15 días o 500 km antes), vencido, realizado y descartado, recalculados cada mañana. Recordatorio por WhatsApp, agendar cita, marcar realizado. También se pueden crear a mano |
| Servicios | Nuevos campos "Repetir cada (días)" y "Repetir cada (km)" |
| Vehículo y orden | Tarjeta de mantenimientos en el vehículo. Botón "Agendar cita" o "Agendar entrega" en la orden |
| Técnicos y empleados | Personal con teléfono, especialidad y color de agenda. Por técnico: órdenes abiertas, entregadas en el mes, horas de mano de obra y el ingreso que generó |
| Proveedores | Ficha, búsqueda, saldo por pagar, historial de compras y pagos |
| Compras | Número CMP-0001, factura del proveedor, vencimiento según días de crédito. Las líneas del inventario suben la existencia y el costo promedio. Pago de contado o a crédito, abonos (PP-0001), compras vencidas resaltadas. Anular una compra sin pagos revierte el inventario |
| Gastos | GAS-0001 con categoría, método, proveedor opcional y comprobante (foto o PDF). Lista y totales por mes y por categoría. Se anulan con motivo; no se borran |
| Cuentas por cobrar | Órdenes y ventas con saldo, entregadas con saldo resaltadas, cobrar desde ahí y recordatorio de pago por WhatsApp |
| Reportes | Período (hoy, semana, mes, mes anterior, año o personalizado). Pestañas según rol: Resumen financiero y flujo de caja, Órdenes, Servicios y repuestos (con margen para gerencia), Técnicos, Ventas, Gastos, Inventario. Exportar a Excel e imprimir o guardar en PDF |
| Dashboard | Cobrado por día (30 días), citas de hoy, mantenimientos vencidos y próximos, cuentas por pagar vencidas. El técnico ve sus órdenes y sus citas del día |
| Cambio de aceite estimado | Como el cliente no dice cuánto maneja, el sistema lo calcula con los kilometrajes de sus visitas; si no hay historial, usa el promedio de Configuración (1,500 km/mes: 5,000 km en unos 3 meses y medio). Las órdenes que llevan aceite programan "Cambio de aceite" aunque no usen un servicio del catálogo (5,000 km o 6 meses, lo que llegue primero). "Revisar órdenes pasadas" lo aplica a las entregas de los últimos 12 meses |
| Avisos desde el Dashboard | Tarjeta "Toca mantenimiento" con los clientes a los que ya les toca o está por tocarles y no se les ha avisado en 30 días. "Avisar a todos uno por uno" abre WhatsApp con el mensaje listo y pasa al siguiente |
| Revisión diaria | 6:00 AM: estados de mantenimiento y vencimiento de cotizaciones que pasaron su fecha de validez |

## Cloud Functions nuevas

| Function | Qué hace |
|---|---|
| `saveAppointment`, `setAppointmentStatus` | Citas de la agenda |
| `saveMaintenance`, `maintenanceAction` | Mantenimientos manuales, realizado, descartar, recordatorio enviado |
| `saveEmployeeProfile` | Datos del técnico o empleado |
| `saveSupplier` | Proveedores |
| `createPurchase`, `paySupplier`, `voidPurchase` | Compras, abonos y anulación (con inventario) |
| `saveExpense`, `voidExpense` | Gastos |
| `onOrderDelivered` | Programa los mantenimientos al entregar |
| `dailyMaintenance` | Revisión diaria de las 6:00 AM |

## Permisos

| Módulo | Admin | Gerente | Recepción | Técnico | Bodega | Vendedor |
|---|---|---|---|---|---|---|
| Agenda | Todo | Todo | Todo | Ver | No | Ver |
| Mantenimiento | Todo | Todo | Todo | No | No | No |
| Técnicos y empleados | Editar | Editar | Ver | No | No | No |
| Proveedores y compras | Todo | Todo | No | No | Registrar (sin pagar ni anular) | No |
| Gastos | Todo | Todo | No | No | No | No |
| Reportes | Todos | Todos | Órdenes y servicios | No | Inventario | Ventas |

## Cómo probarlo

1. Servicios: poner "Repetir cada 90 días / 5000 km" al cambio de aceite (si se cargó el catálogo demo antes de esta fase, los intervalos no vienen puestos).
2. Hacer una orden con ese servicio aprobado y pasarla a Entregado. En Mantenimiento debe aparecer como "Programado".
3. Agenda: crear una cita para hoy. Aparece en el Dashboard. Enviar la confirmación por WhatsApp.
4. Proveedores: crear uno. Compras → Nueva compra con un repuesto del inventario, a crédito. Revisar que subió la existencia. Registrar un abono.
5. Gastos: registrar la luz con foto del recibo.
6. Reportes: revisar el mes y exportar a Excel.

## Pendiente

- Plantillas editables de WhatsApp y envío automático de recordatorios: Fase 6.
- La factura fiscal con CAI sigue pendiente (los comprobantes son internos).
