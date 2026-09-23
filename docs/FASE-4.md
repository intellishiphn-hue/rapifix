# Fase 4: Inventario, productos, servicios, punto de venta y pagos

## Qué quedó implementado

| Área | Detalle |
|---|---|
| Productos y repuestos | Catálogo con código, categoría, marca, proveedor, unidad, precio, existencia mínima, ubicación, ISV y activo/inactivo. Existencia inicial al crear |
| Costos | En documento aparte: solo administración, gerencia y bodega los ven. Costo promedio ponderado con cada compra |
| Inventario | Entradas (compras), salidas, ajustes por conteo y devoluciones. La existencia solo cambia por movimientos (protegido en el servidor) y nunca queda negativa. Alerta de productos bajo mínimo o agotados |
| Servicios | Mano de obra y servicios con precio fijo y horas estimadas |
| Cotizaciones | Botón "Del catálogo": agrega productos o servicios con su precio (y costo, para quien lo ve) |
| Descuento de inventario en órdenes | En la pestaña Repuestos, cada repuesto aprobado que viene del catálogo tiene "Descontar del inventario" (una sola vez por línea) |
| Pagos en la orden | Pestaña Pagos: total, pagado y saldo. Pagos totales o abonos en efectivo, transferencia, tarjeta u otro, con cálculo de cambio. Comprobante imprimible |
| Anulación | Los pagos no se borran: se anulan con motivo (solo administración y gerencia) y el saldo se recalcula |
| Punto de venta | Búsqueda de productos y servicios, líneas libres, cantidades, precio y descuento por línea, cliente opcional, pago dividido, saldo pendiente (con cliente). Descuenta inventario y registra pagos en una sola operación. Comprobante imprimible |
| Pagos | Pantalla con lo cobrado hoy, 7 días, mes o todo, totales por método |
| Dashboard | Cobrado hoy, cobrado este mes y cuentas por cobrar |
| Datos demo | "Cargar catálogo demo" en Configuración: 8 repuestos con existencias y 6 servicios |

## Cloud Functions nuevas

| Function | Qué hace |
|---|---|
| `registerInventoryMovement` | Entradas, salidas, ajustes y devoluciones con costo promedio |
| `consumeOrderPart` | Descuenta un repuesto aprobado de una orden |
| `registerPayment` | Pago o abono sobre orden o venta, con recibo REC-0001 |
| `voidPayment` | Anula un pago y recalcula el saldo |
| `createSale` | Venta de mostrador V-0001: inventario y pagos en una transacción |
| `seedDemoCatalog` | Catálogo de demostración |

## Otros cambios

- Mensajes de WhatsApp: se abren con `api.whatsapp.com/send` (la redirección de `wa.me` dañaba los emojis) y la firma usa 🚗.

## Cómo probarlo

1. Configuración → "Cargar catálogo demo".
2. Inventario: el refrigerante aparece bajo mínimo. Registrar una entrada.
3. En una orden → Cotización → "Del catálogo" → agregar pastillas y mano de obra → enviar → registrar aprobación.
4. Repuestos → "Descontar del inventario". Verificar la existencia en Productos.
5. Pagos → registrar un abono y luego el resto. Imprimir el comprobante.
6. Punto de venta: vender un aceite en efectivo con cambio.

## Pendiente

- Ventas con saldo: cobrar el saldo desde una lista de ventas (Fase 5, con reportes y cuentas por cobrar).
- Factura fiscal con CAI del SAR: por ahora los comprobantes son internos.
