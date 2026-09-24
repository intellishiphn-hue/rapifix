# Fase 7: Plantillas, historial de WhatsApp, seguridad y publicación automática

Incluye lo de la Fase 6 que no necesita servidor. El envío 100% automático de WhatsApp queda pendiente, probablemente con un servidor pequeño en Google Cloud.

## Qué quedó implementado

| Área | Detalle |
|---|---|
| WhatsApp → Plantillas | Los mensajes del sistema se editan desde el panel (admin y gerencia), con variables `{{cliente}}`, `{{vehiculo}}`, `{{placa}}`, `{{orden}}`, `{{total}}`, `{{link}}`, `{{taller}}`, `{{servicio}}`, `{{ultimo}}`, vista previa estilo WhatsApp y botón "Restaurar original". Los cambios se usan de inmediato en todo el panel |
| WhatsApp → Mensajes enviados | Cada vez que alguien abre WhatsApp con un mensaje del sistema queda registrado: a quién, qué texto, de dónde salió (orden, cotización, mantenimiento, cobro, cita), quién lo mandó y cuándo. No se puede editar ni borrar |
| Límite de intentos | Los botones del link del cliente (aprobar, rechazar, pagar en línea) aceptan un número limitado de intentos por link y por conexión cada 10 minutos. Frena abusos y bots |
| App Check (opcional) | Listo en el código; se activa con los pasos de abajo |
| Reglas | Corrección: al editar una foto de orden ya no se puede poner una etapa inválida |
| Pruebas de reglas | 86 pruebas automáticas de permisos (Firestore y Storage) en `tests/rules`. Corren en GitHub Actions |
| Publicación automática | `.github/workflows/deploy.yml`: cada `git push` a main prueba, compila y publica. Se enciende al crear el secreto de GitHub (ver `docs/DEPLOY-AUTOMATICO.md`); mientras no exista, no hace nada |
| Crear usuarios | Mensajes de error claros y recuperación si un intento anterior quedó a medias |
| Rendimiento | El panel se divide en partes (Firebase, gráficos, React) que el navegador guarda en caché: las actualizaciones descargan menos |
| Dominio propio | Campo en Configuración; permite pagos en línea desde ese dominio |
| Dashboard personalizable | Botón "Personalizar": cada usuario sube, baja, oculta o muestra las secciones. Se guarda en su usuario (sirve en cualquier computadora o celular) |
| Productos desde Excel | Productos → "Subir desde Excel": plantilla descargable con ejemplos e instrucciones, o "Descargar mis productos" para editarlos y volver a subirlos. Antes de guardar muestra cuáles son nuevos, cuáles se actualizan y cuáles tienen errores. La existencia inicial queda como entrada de inventario; en productos existentes solo se ajusta si se marca (ajuste por conteo) |
| Citas | Al crear una cita se abre el WhatsApp de confirmación. En el Dashboard, "Citas de mañana" con recordatorios uno por uno. Plantillas de cita editables |

## Pasos manuales

### 1. Publicación automática (recomendado)
Seguir `docs/DEPLOY-AUTOMATICO.md`: crear la cuenta de servicio en Google Cloud, guardar su llave como secreto `FIREBASE_SERVICE_ACCOUNT` en GitHub y borrar el archivo de la computadora. Desde ahí, basta con `git push`.

### 2. Dominio propio (cuando lo compre)
1. Firebase Console → Hosting → **Agregar dominio personalizado** → por ejemplo `app.rapifix.hn`.
2. Poner los registros DNS que muestra Firebase en el panel del proveedor del dominio. El certificado HTTPS se crea solo (hasta 24 horas).
3. Firebase Console → Authentication → Configuración → **Dominios autorizados** → agregar el dominio.
4. RAPIFIX → Configuración → "Dominio propio del sistema" → guardar.

### 3. App Check (opcional, protección extra contra bots)
1. Google Cloud Console → reCAPTCHA → crear una clave de sitio web para `rapifix-prod-a1b2c.web.app` (y el dominio propio).
2. Firebase Console → App Check → registrar la app web con **reCAPTCHA Enterprise** y esa clave.
3. Agregar `VITE_RECAPTCHA_SITE_KEY=<clave del sitio>` a `apps/web/.env.production` (esta clave es pública) y publicar.
4. Revisar en App Check → Métricas que casi todas las solicitudes salgan verificadas (1 o 2 días).
5. Activar: agregar `APP_CHECK_ENFORCE=true` a `functions/.env.rapifix-prod-a1b2c` y, en Firebase Console → App Check, **Aplicar** para Firestore y Storage. Publicar.

### 4. Respaldos de la base de datos (recomendado)
Google Cloud Console → Firestore → **Copias de seguridad** → programación **diaria** con retención de 7 días. Tiene un costo pequeño según el tamaño de los datos.

### 5. Limpieza de los límites de intentos (opcional)
Google Cloud Console → Firestore → **TTL** → política para la colección `rateLimits` con el campo `expireAt`.
