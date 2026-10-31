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

- arriba y destacadas, las órdenes en curso (en el taller o listas para retirar) con su estado, el avance y los botones
  "Aprobar cotización", "Pagar" y "Ver cómo va" (llevan al portal de la orden, donde ya funcionan aprobar y pagar);
- el detalle completo de cada visita al tocarla (ver "Detalle de cada visita").

## Rutas

- **`/historial/:token`**: el mismo link para los dos casos. El documento dice si es de un cliente (`kind: "customer"`)
  o de una empresa (`kind: "company"`) y la página se adapta. No hay `/flota/`.
- **`/historial/:token/visita/:orderId`**: detalle de una visita (se puede compartir; botón "Volver a mi historial").
- **`/historial/:token/visita/:orderId/recibo/:recibo`**: recibo imprimible de un pago (`REC-...`).

## Cómo funciona

| Pieza | Dónde |
| --- | --- |
| Lógica pura (qué sale y qué no, agrupaciones, totales, recorte por tamaño) | `packages/shared/src/history.ts` (`buildHistoryView`, `parsePublicHistory`) |
| Lectura de Firestore y escritura del documento público | `functions/src/lib/history.ts` (`buildHistory`) |
| Callables | `functions/src/callable/history.ts` |
| Triggers | `functions/src/triggers/history.ts` |
| Página pública | `apps/web/src/features/landing/HistoryPage.tsx` + `historyData.ts` (API REST, sin SDK de Firestore) |
| Tarjeta del panel | `apps/web/src/features/history/HistoryLinkCard.tsx` (ficha del cliente y de la empresa) |
| Detalle de visita (lógica pura) | `packages/shared/src/historyVisit.ts` (`buildVisitDetail`, `parsePublicVisitDetail`, `visitReceipt`) |
| Página de la visita y del recibo | `apps/web/src/features/landing/HistoryVisitPage.tsx` |
| "Activar historial a todos" | `apps/web/src/features/history/BulkHistoryButton.tsx` (Clientes y Empresas) |

- El link se guarda en el cliente o la empresa en el campo `history`:
  `{ token, enabled, source, createdAt, updatedAt, updatedBy, disabledAt, disabledBy }`. Solo lo escriben las funciones.
  `source`: `manual` (ficha), `order` (se activó solo con una orden) o `bulk` ("Activar historial a todos").
- La copia pública vive en `publicHistory/{token}`. La arma el servidor; la página solo lee ese documento.
- Token: 24 caracteres aleatorios (`secureToken`, alfabeto sin letras confusas, unos 118 bits).

## Siempre activo (activación automática)

| Estado (`historyLinkState`) | Qué es | ¿Se activa solo? |
| --- | --- | --- |
| `never` | no existe el campo `history` (nunca se activó) | Sí: al crear una orden o con "Activar historial a todos" |
| `active` | `enabled: true` con token | Ya está activo |
| `disabled` | `enabled: false` (el taller tocó "Desactivar"; guarda `disabledAt` y `disabledBy`) | **Nunca.** Solo a mano desde la ficha |

Los links apagados antes de esta versión no tienen `disabledAt`, pero también cuentan como desactivados a propósito
(la única forma de quedar en `enabled: false` es "Desactivar").

- **Al crear una orden** (`insertWorkOrder`: nueva orden y convertir cotización directa; y de respaldo el trigger
  `onWorkOrderHistory` cuando nace cualquier orden) se activa el historial del cliente y, si el vehículo es de una empresa,
  también el de la empresa. Es una transacción: si dos procesos lo intentan a la vez, solo uno crea el token.
  Nunca hace fallar la orden. No envía mensajes. Queda en `auditLogs` ("El historial se activó solo al crear la orden OT-...").
- Para órdenes de un vehículo de flota, el portal y los mensajes usan el historial **de la empresa**.

## Detalle de cada visita

Para no inflar `publicHistory/{token}` (límite 1 MB), el detalle de cada orden vive aparte en
**`publicHistory/{token}/visits/{orderId}`**. Lo arma el servidor con `buildVisitDetail` y la página lo lee por REST al abrir la visita.

Qué muestra (solo lo que el cliente ya ve hoy en su portal o en los impresos que se le entregan):

- Encabezado: orden, ingreso y entrega, vehículo, kilometraje o millaje (con su unidad) al ingresar y al entregar, tipo de trabajo
  ("Trabajo de garantía" si la orden es de tipo garantía; la orden no registra plazos de garantía).
- Lo que nos contó el cliente (motivo de ingreso). Diagnóstico del técnico, códigos OBD y recomendaciones **solo cuando el
  diagnóstico está completado** (igual que el portal).
- Trabajos y repuestos de la cotización **aprobada vigente**: descripción, tipo, cantidad, precio, descuento y total de la línea;
  subtotal, descuento, cupón, ISV y total (igual que la cotización que vio el cliente).
- Fotos marcadas visibles para el cliente (las mismas URL de descarga de Storage que usa el portal; no vencen).
- "Cómo fue la visita": actualizaciones visibles al cliente con fecha y hora.
- Pagos: método, fecha, monto y recibo `REC-...`; total pagado y saldo. Los comprobantes de transferencia o depósito por revisar
  salen como **"En revisión"** y no cuentan como pagados. Los rechazados no se muestran.
- "Ver recibo": uno por pago, como el recibo del panel (`/imprimir/recibo/:id`), con los datos de RAPIFIX de `business.ts`,
  recibido de (cliente o empresa), concepto, vehículo, método, monto, detalle de la orden, totales, pagos hasta ese recibo y
  saldo después de ese pago. Botón "Imprimir o guardar PDF" (`window.print()`, hoja carta).

Qué **no** sale nunca: costos (`unitCost`), pago a técnicos (`techPay`), comisiones, notas internas de la orden y de la cotización,
**pruebas realizadas y observaciones del técnico** (hoy no se muestran al cliente ni en el portal ni en la orden impresa),
nombres del personal (técnicos, quién recibió el pago), referencias, bancos o terminales de pago, rutas de comprobantes, VIN,
notas de recepción y datos de otros clientes. Lo verifican las pruebas de `packages/shared/src/__tests__/historyVisit.test.ts`.

Cómo se mantiene:

- `buildPortal` rehace también el detalle de esa visita (`refreshVisitDetail`) cada vez que se rehace el portal de la orden:
  cambios de la orden, cotización, pagos, comprobantes, fotos y actualizaciones visibles. No hay trigger nuevo para esto.
- `buildHistory` arma los detalles de las visitas nuevas en la lista y borra los de las que salieron (cancelada, vehículo vendido,
  archivado). Al activar o cambiar el link (y la primera vez que se rehace un historial sin detalles, marcado con `detailsV`)
  arma todos y borra los que sobran.
- Cada detalle guarda un `hash`: si no cambió, no se escribe.
- Al cambiar o desactivar el link se borran todos los detalles del token viejo (`recursiveDelete`). Si el link cambió mientras se
  escribía un detalle, ese detalle se borra.
- Si la visita aún no tiene detalle (historial armado antes de esta versión), la página muestra el resumen que ya trae el historial
  y avisa que el detalle completo estará disponible en unos minutos.

## Portal y mensajes

- El portal `/orden/:token` guarda `history: "/historial/TOKEN"` solo si el historial del dueño está activo y muestra el botón
  **"Ver mi historial RAPIFIX"**. Cuando el link se activa, cambia o se desactiva, `onCustomerHistory` / `onCompanyHistory` rehacen
  los portales de ese dueño que siguen vigentes (abiertos o entregados hace menos de 31 días).
- "Pagar" en el historial abre `/orden/TOKEN#pago` (la página baja sola a la sección de pago).
- WhatsApp: nueva variable **`{{historial}}`** (link del historial; vacía si no está activo, y entonces se quita la frase que la
  presenta). Las plantillas de fábrica "Vehículo listo" (`listo`) y "Agradecimiento" (`entregado`) terminan con
  "Aquí puede ver todo el historial de su vehículo: {{historial}}". Si el taller editó esas plantillas y no puso `{{historial}}`,
  la línea se agrega al final; si ya la trae (o ya trae el link), no se duplica. El envío automático (OpenWA) manda el mismo texto
  que arma el panel, así que también la lleva. El link se busca en la ficha del cliente o de la empresa al preparar el mensaje.

### Callables

- `enableHistoryLink({ kind, id })` (admin, gerencia y recepción): crea el link y construye el historial con todos sus detalles.
  Si ya está activo, devuelve el mismo. Si estaba desactivado, lo activa con un token nuevo.
- `regenerateHistoryLink({ kind, id })`: borra el documento público viejo y sus detalles, crea otro token y lo construye.
- `disableHistoryLink({ kind, id })`: borra el documento público y sus detalles, apaga el link y guarda `disabledAt`/`disabledBy`.
- **Nueva:** `enableHistoryLinksBulk({ kind, cursor })` (solo admin y gerencia): "Activar historial a todos". Ver abajo.

Cada cambio queda en `auditLogs` (con una nota y sin el token). El trigger de auditoría ignora el campo `history`
para no duplicar el registro ni copiar el token.

### Triggers (rehacen el historial del cliente y de la empresa afectados)

`onWorkOrderHistory` (estado, entrega, totales, pagos, kilometraje, dueño, link del portal), `onQuoteHistory`
(ignora borradores), `onMaintenanceHistory` (la fecha estimada se compara por día), `onWashHistory`,
`onLoyaltyHistory`, `onMembershipHistory`, `onVehicleHistory` (también rehace al dueño anterior),
`onCustomerHistory` (nombre; y si cambia el link, rehace los portales vigentes) y `onCompanyHistory` (nombre y forma de pago; igual con el link).
`onWorkOrderHistory` además activa solo el historial cuando nace una orden.

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
- `publicHistory/{token}/visits/{orderId}`: `get` público con la ruta exacta **y solo mientras exista** `publicHistory/{token}`;
  nadie lista (tampoco con `collectionGroup`); nadie escribe. Pruebas en `tests/rules/test/firestore.test.ts`.
- `buildHistoryView` copia solo campos de una lista blanca. Nunca salen: costos (`unitCost`), pago a técnicos (`techPay`),
  comisiones, notas internas, eventos internos, nombres del personal, referencias de pago, VIN, ni datos de otros clientes.
  Lo verifican las pruebas de `packages/shared/src/__tests__/history.test.ts`.
- Solo se muestran los vehículos vigentes del dueño: si el vehículo se archivó o cambió de dueño, desaparece
  (el trigger del vehículo rehace también el historial del dueño anterior). Las órdenes de un dueño anterior
  del mismo carro no se muestran. Los vehículos asignados a una empresa se ven en el historial de la empresa, no en el del chofer.
- El detalle y el recibo de cada visita no vencen (viven en el historial). Los botones que llevan al portal `/orden/:token`
  (ver cómo va, aprobar, pagar) solo salen mientras ese link funcione: el portal de la orden vence 30 días después de la entrega
  y el del lavado 90 días.
- La página agrega `<meta name="robots" content="noindex, nofollow">`, Hosting manda `X-Robots-Tag: noindex` en
  `/historial/**` y `robots.txt` tiene `Disallow: /historial/`. La petición REST va con `no-referrer`.
- No se registran visitas a la página (no hay callable pública).

## Qué desplegar

1. Reglas: `npm run deploy:rules` (nueva subcolección `publicHistory/{token}/visits`).
2. Funciones: `npm run deploy:functions`.
   - **Nueva (1):** `enableHistoryLinksBulk`.
   - **Modificadas (sin crear funciones nuevas):** `enableHistoryLink`, `regenerateHistoryLink`, `disableHistoryLink`,
     `createWorkOrder` y `convertQuoteToOrder` (vía `insertWorkOrder`), `onWorkOrderHistory`, `onCustomerHistory`, `onCompanyHistory`,
     y todas las que llaman a `buildPortal` (ahora también rehace el detalle de la visita; ej. `onWorkOrderWritten`,
     `onOrderEventCreated`, `onOrderPhotoUpdated`, `respondToQuote`, pagos y comprobantes).
   - Si el despliegue completo falla por cuota, se puede desplegar primero solo la nueva:
     `firebase deploy --only functions:enableHistoryLinksBulk` y luego el resto.
3. Hosting: `npm run deploy:hosting` (rutas de la visita y del recibo, botón del portal, botón "Activar historial a todos").

No hacen falta índices nuevos (las consultas de actualizaciones y fotos visibles son las mismas del portal).

## Activar a todos (clientes existentes)

En **Clientes** (o **Empresas**), administración o gerencia toca **"Activar historial a todos"** y confirma.

- Activa a quienes **nunca** tuvieron historial y tienen al menos una orden o un lavado. No toca a los desactivados a propósito.
- A los que ya estaban activos sin detalle de visitas se les arma (columna "Ya activos (completados)").
- Trabaja por partes de 50 (cada llamado se detiene antes de 75 segundos y devuelve un cursor); la ventana sigue llamando y muestra
  el avance ("50 de 312"), cuántos se activaron, cuántos se saltaron y por qué. "Detener" para después del lote en curso; se puede
  volver a correr cuando quiera (es idempotente).
- **No envía mensajes.** El link llega al cliente en el próximo aviso de "vehículo listo" o desde la ficha.

## Uno por uno (ficha del cliente)

Además de "Activar a todos" y de la activación automática con cada orden, se puede activar uno por uno: en el panel, abra la
ficha del cliente (o de la empresa) y en la tarjeta **"Historial para el cliente"** toque **Activar link**. El historial se arma en ese momento con todo lo que ya existe
(órdenes, pagos, mantenimientos y lavados viejos incluidos). Luego **Enviar por WhatsApp** prepara el mensaje con el link
(al WhatsApp del cliente, o al contacto de la empresa; si no tiene, al encargado de flota).

- **Cambiar link**: si el cliente lo compartió con alguien más. El anterior deja de funcionar al instante.
- **Desactivar**: el link deja de funcionar y el cliente ve "Este enlace ya no está disponible. Escríbenos por WhatsApp".

Desde "Mi historial", "Agendar cita" abre `/agendar` con el motivo, la placa, el vehículo y el servicio ya escritos
(`?motivo=&placa=&vehiculo=&detalle=`).
