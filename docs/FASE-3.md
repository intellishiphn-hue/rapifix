# Fase 3: Cotizaciones, aprobación por link y portal del cliente

## Qué quedó implementado

| Área | Detalle |
|---|---|
| Cotizaciones | Desde la pestaña Cotización de cada orden: líneas de mano de obra, repuestos, servicios y otros cargos con cantidad, precio, descuento e ISV. Costo interno visible solo para administración y gerencia (con margen estimado) |
| Numeración | COT-0001, COT-0002... generada en el servidor. Los totales también los calcula el servidor |
| Estados | Borrador, Enviada, Vista por el cliente, Aprobada, Rechazada, Expirada |
| Versiones | Una cotización enviada no se edita: se crea una nueva versión y la anterior expira |
| Envío | "Enviar al cliente" la congela, la publica en el portal, pasa la orden a "Cotización enviada" y prepara el WhatsApp con el link |
| Portal del cliente | `/orden/{token}`: estado con barra de avance, pasos, última actualización, próximo paso, diagnóstico, fotos marcadas como visibles, actualizaciones y botón "Contactar a RAPIFIX". Sin cuenta y en tiempo real |
| Aprobación | Botones APROBAR, RECHAZAR y TENGO UNA PREGUNTA. Guarda nombre, fecha y hora del servidor, ID de aprobación, IP y navegador. Al aprobar, la orden pasa sola a "Aprobado"; al rechazar, vuelve a "Esperando cotización" |
| "Vista por el cliente" | Se marca automáticamente la primera vez que el cliente abre el link |
| Links | `/aprobar/{token}` y `/seguimiento/{token}` redirigen al mismo portal |
| Seguridad del portal | Token de 10 caracteres imposible de adivinar. El portal solo lee una copia sanitizada (sin teléfono, identidad, dirección, costos ni notas internas). No se pueden listar portales. Se cierra 30 días después de entregado |
| WhatsApp | Todas las plantillas ahora incluyen el link del portal |
| Documentos | Orden de trabajo y cotización imprimibles con branding (guardar como PDF desde el navegador), con línea de firma del cliente |
| Servicios / Repuestos | Muestran las líneas aprobadas de la cotización |
| Pantallas nuevas | Cotizaciones (lista con filtro por estado) y Portal del cliente (links de todos los vehículos en taller) |

## Cloud Functions nuevas

| Function | Qué hace |
|---|---|
| `saveQuote` | Crea o actualiza el borrador (numeración y totales en el servidor) |
| `sendQuote` | Envía, congela, actualiza la orden y el portal |
| `newQuoteVersion` | Nueva versión editable |
| `ensurePortal` | Devuelve el link del cliente (lo construye si falta) |
| `respondToQuote` | Pública: aprobar, rechazar o preguntar |
| `markQuoteViewed` | Pública: marca "Vista por el cliente" |
| `onOrderEventCreated`, `onOrderPhotoUpdated` | Mantienen el portal al día |

## Cómo probarlo

1. Abrir una orden → pestaña Cotización → Crear cotización → agregar líneas → Enviar al cliente.
2. Enviar el WhatsApp (o tocar "Ver" junto a "Copiar link del cliente").
3. Abrir el link en el celular y aprobar. La orden debe pasar sola a "Aprobado" y la cotización mostrar fecha, hora e IP.
4. Documentos → Imprimir / PDF.

## Pendiente

- App Check (protección extra de los botones públicos contra bots): Fase 7.
- Dominio propio (rapifix.com): cuando se compre, se conecta en Firebase Hosting.
