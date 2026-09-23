# Pagos en línea con ROKI

El cliente abre el link de su orden (`/orden/{token}`), ve el saldo y toca **Pagar en línea**. Paga con tarjeta en la página segura de ROKI y regresa al link. El pago se registra solo en la orden.

## Cómo funciona

| Paso | Detalle |
|---|---|
| Botón | Aparece en el link del cliente cuando los pagos en línea están activos y la orden tiene saldo. Si ya está pagada, muestra "¡Orden pagada!" |
| Cobro | `createOnlinePayment` crea el cobro en ROKI por el saldo exacto (Lempiras), válido 60 minutos. Si el cliente toca dos veces, reutiliza el mismo link |
| Confirmación | Solo cuenta cuando ROKI lo confirma: por el webhook firmado (`rokiWebhook`) o consultando a ROKI (`checkOnlinePayment`). Regresar a la página de "éxito" no marca nada como pagado |
| Registro | Recibo REC-xxxx con método "En línea (ROKI)" y el número de transacción. Se actualiza pagado/saldo, y el cliente ve "Pago en línea recibido" en su link |
| Respaldo | `reconcileOnlinePayments` revisa cada 15 minutos los cobros pendientes, por si se pierde un webhook |
| Anulaciones | Si un pago se anula o reembolsa en el portal de ROKI, el recibo se anula en RAPIFIX y el saldo se recalcula |

## Seguridad

- La llave secreta y el secreto del webhook se guardan en `tenants/{tid}/private/roki`: las reglas no dejan leerlo desde el navegador. Solo el servidor lo usa. En el panel solo se ven los últimos 4 caracteres.
- El webhook verifica la firma HMAC-SHA256 (`ROKI-Signature`) sobre el cuerpo crudo, en tiempo constante, y descarta eventos repetidos (`ROKI-Webhook-Event-Id`).
- La llave nunca va en el código, en GitHub ni en el chat. Se cambia desde Configuración sin volver a publicar.

## Configuración (una vez por ambiente)

1. ROKI → Connect → Integración API: generar la llave `sk_test_…` (pruebas). Se muestra una sola vez.
2. ROKI → Connect → Webhooks: registrar `https://us-central1-rapifix-prod-a1b2c.cloudfunctions.net/rokiWebhook` en el ambiente de pruebas y copiar el secreto de firma.
3. RAPIFIX → Configuración → **Pagos en línea (ROKI)**: pegar la llave y el secreto, marcar "Mostrar Pagar en línea" y guardar.
4. Probar con la tarjeta de pruebas Visa `4012000000020071`.
5. Para cobrar de verdad: repetir 1 a 3 con la llave `sk_live_…` y el webhook del ambiente de producción.

## Cloud Functions nuevas

| Function | Qué hace |
|---|---|
| `getOnlinePayConfig` / `saveOnlinePayConfig` | Estado y guardado de la configuración (guardar: solo admin) |
| `createOnlinePayment` | Pública: crea el cobro y devuelve el link de pago |
| `checkOnlinePayment` | Pública: consulta a ROKI al regresar del pago |
| `rokiWebhook` | Confirmaciones de ROKI (HTTP) |
| `reconcileOnlinePayments` | Revisión programada cada 15 minutos |
