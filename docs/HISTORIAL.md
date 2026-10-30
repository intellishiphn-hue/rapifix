# Mi historial RAPIFIX

Link privado y permanente donde un cliente (o una empresa con flotilla) ve, sin cuenta:

- sus vehículos con placa, marca, modelo, año y el último kilometraje (km o millas);
- próximos mantenimientos (vencidos, próximos y programados) con botón "Agendar cita";
- historial de visitas: fecha de ingreso y entrega, kilometraje, trabajos realizados, repuestos cambiados,
  total, pagado, saldo y los recibos (REC) de cada pago; las órdenes abiertas salen como "En el taller";
- cotizaciones enviadas que esperan aprobación, con su link;
- carwash: lavados, tarjeta de sellos y membresía activa;
- empresas: resumen de la flotilla (unidades, visitas y gasto del año, saldo y vencido según su forma de pago)
  y "Lo que toca en la flotilla" (mantenimientos de todas las unidades por urgencia). Buscador por placa con más de 5 unidades.

## Ruta

Una sola ruta para los dos casos: **`/historial/:token`**. El documento dice si es de un cliente (`kind: "customer"`)
o de una empresa (`kind: "company"`) y la página se adapta. No hay `/flota/`.

## Cómo funciona

| Pieza | Dónde |
| --- | --- |
| Lógica pura (qué sale y qué no, agrupaciones, totales, recorte por tamaño) | `packages/shared/src/history.ts` (`buildHistoryView`, `parsePublicHistory`) |
| Lectura de Firestore y escritura del documento público | `functions/src/lib/history.ts` (`buildHistory`) |
| Callables | `functions/src/callable/history.ts` |
| Triggers | `functions/src/triggers/history.ts` |
| Página pública | `apps/web/src/features/landing/HistoryPage.tsx` + `historyData.ts` (API REST, sin SDK de Firestore) |
| Tarjeta del panel | `apps/web/src/features/history/HistoryLinkCard.tsx` (ficha del cliente y de la empresa) |

- El link se guarda en el cliente o la empresa en el campo `history`:
  `{ token, enabled, createdAt, updatedAt, updatedBy }`. Solo lo escriben las funciones.
- La copia pública vive en `publicHistory/{token}`. La arma el servidor; la página solo lee ese documento.
- Token: 24 caracteres aleatorios (`secureToken`, alfabeto sin letras confusas, unos 118 bits).

### Callables (admin, gerencia y recepción)

- `enableHistoryLink({ kind, id })`: crea el link y construye el documento de inmediato. Si ya está activo, devuelve el mismo.
- `regenerateHistoryLink({ kind, id })`: borra el documento público viejo, crea otro token y lo construye.
- `disableHistoryLink({ kind, id })`: borra el documento público y apaga el link.

Cada cambio queda en `auditLogs` (con una nota y sin el token). El trigger de auditoría ignora el campo `history`
para no duplicar el registro ni copiar el token.

### Triggers (rehacen el historial del cliente y de la empresa afectados)

`onWorkOrderHistory` (estado, entrega, totales, pagos, kilometraje, dueño, link del portal), `onQuoteHistory`
(ignora borradores), `onMaintenanceHistory` (la fecha estimada se compara por día), `onWashHistory`,
`onLoyaltyHistory`, `onMembershipHistory`, `onVehicleHistory` (también rehace al dueño anterior),
`onCustomerHistory` (nombre) y `onCompanyHistory` (nombre y forma de pago).

- Cada trigger solo actúa si cambió un campo que se muestra.
- `buildHistory` no hace nada si el link no está activo, y no escribe si el contenido es igual (compara un hash).
- Cada construcción lee todo de nuevo, así un evento atrasado se corrige con el siguiente cambio.
  Antes de escribir confirma que el token sigue siendo el mismo (no deja documentos huérfanos al regenerar).

### Límites de tamaño

Por vehículo: últimas 50 visitas, 30 lavados, 10 cotizaciones abiertas, 12 mantenimientos; 40 líneas y 10 pagos por visita;
hasta 150 vehículos. Si aun así el documento pasa de 900 KB, se quitan primero los lavados y luego las visitas más viejas
(dejando al menos 5 visitas por vehículo) y la página avisa que se muestran las más recientes.

## Seguridad

- `publicHistory/{token}`: `get` público con el token exacto; nadie lista; nadie escribe desde el navegador.
- `buildHistoryView` copia solo campos de una lista blanca. Nunca salen: costos (`unitCost`), pago a técnicos (`techPay`),
  comisiones, notas internas, eventos internos, nombres del personal, referencias de pago, VIN, ni datos de otros clientes.
  Lo verifican las pruebas de `packages/shared/src/__tests__/history.test.ts`.
- Solo se muestran los vehículos vigentes del dueño: si el vehículo se archivó o cambió de dueño, desaparece
  (el trigger del vehículo rehace también el historial del dueño anterior). Las órdenes de un dueño anterior
  del mismo carro no se muestran. Los vehículos asignados a una empresa se ven en el historial de la empresa, no en el del chofer.
- Cada visita enlaza a su portal `/orden/:token` (detalle y recibo) mientras ese link funcione: el portal de la orden
  vence 30 días después de la entrega y el del lavado 90 días; la página oculta el enlace cuando ya venció.
- La página agrega `<meta name="robots" content="noindex, nofollow">`, Hosting manda `X-Robots-Tag: noindex` en
  `/historial/**` y `robots.txt` tiene `Disallow: /historial/`. La petición REST va con `no-referrer`.
- No se registran visitas a la página (no hay callable pública).

## Qué desplegar

1. Reglas: `npm run deploy:rules` (nuevo `publicHistory` y campo `history` del cliente protegido).
2. Funciones: `npm run deploy:functions` (3 callables y 9 triggers nuevos; cambio en `auditWriter`).
3. Hosting: `npm run deploy:hosting` (ruta `/historial/:token`, tarjeta del panel, `robots.txt`, encabezado `X-Robots-Tag`).

No hacen falta índices nuevos (consultas de igualdad simple e `in`).

## Cómo activarlo para clientes existentes

No se activa solo para nadie. En el panel, abra la ficha del cliente (o de la empresa) y en la tarjeta
**"Historial para el cliente"** toque **Activar link**. El historial se arma en ese momento con todo lo que ya existe
(órdenes, pagos, mantenimientos y lavados viejos incluidos). Luego **Enviar por WhatsApp** prepara el mensaje con el link
(al WhatsApp del cliente, o al contacto de la empresa; si no tiene, al encargado de flota).

- **Cambiar link**: si el cliente lo compartió con alguien más. El anterior deja de funcionar al instante.
- **Desactivar**: el link deja de funcionar y el cliente ve "Este enlace ya no está disponible. Escríbenos por WhatsApp".

Desde "Mi historial", "Agendar cita" abre `/agendar` con el motivo, la placa, el vehículo y el servicio ya escritos
(`?motivo=&placa=&vehiculo=&detalle=`).
