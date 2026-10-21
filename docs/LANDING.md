# Landing pública de RAPIFIX

Sitio público de RAPIFIX Centro Automotriz integrado en la misma app web (`apps/web`) que el panel. Rama de trabajo: `landing`.

## Rutas

| Ruta | Sin sesión | Con sesión |
|---|---|---|
| `/` | Landing pública | Panel (Dashboard o carwash, igual que antes) |
| `/inicio` | Landing pública | Landing pública (para que el equipo la vea) |
| `/lavado` | Página pública del carwash | Igual |
| `/agendar` (`?motivo=frenos`, `?motivo=carwash`, `?motivo=<categoría>`) | Formulario de cita | Igual |
| `/lavado/:token` | Link privado de cada lavado (sin cambios; distinto de `/lavado`) | Igual |
| `/login`, `/recuperar` | Login y recuperación (rediseñados, misma lógica) | Redirige al destino permitido |
| `/clientes`, `/ordenes`, ... (rutas hijas del panel) | Redirige a `/login` (como antes) | Panel con permisos por rol |
| `/orden/:token`, `/orden/:token/cotizacion`, `/lavado/:token`, `/aprobar/:token`, `/seguimiento/:token` | Sin cambios | Sin cambios |
| `/imprimir/...` | Requiere sesión (sin cambios) | Sin cambios |

Detalles:

- `RootRoute` en `apps/web/src/app/router.tsx` decide `/`: mientras carga la sesión (o hay usuario con claims aún sin leer, justo después de iniciar sesión) muestra el loader de siempre; así no parpadea la landing.
- Al cerrar sesión estando en `/`, ahora se ve la landing (tiene el enlace "Acceso"). En cualquier otra ruta del panel se sigue mandando a `/login`.
- El login solo acepta un destino interno (`safeRedirect` en `LoginPage.tsx`: debe empezar con `/`, no con `//` ni `/\`). Cualquier otro valor va a `/`.
- La landing se carga con `lazy()` en su propio chunk (`LandingPage-*.js`). No importa módulos del panel, Firestore ni datos privados: el catálogo y los datos del negocio son estáticos.

## Archivos

```
apps/web/src/features/landing/
  catalog.ts      Catálogo oficial: 13 categorías y 118 trabajos (única fuente de verdad)
  search.ts       Buscador: sin acentos/mayúsculas, plurales simples, sinónimos
  business.ts     Datos públicos del negocio (teléfono, dirección, horario, redes, logo, foto del hero)
  LandingPage.tsx Composición, navegación, hero, "Nosotros", SEO (title, description, canonical, JSON-LD)
  Services.tsx    Catálogo: mosaico, buscador, filtros y detalle (<dialog> accesible)
  Sections.tsx    Flotillas, Tecnología y seguimiento, Proceso, Contacto, Footer
  HeroScene.tsx   Ilustración del hero (SUV en un taller). ARCHIVO GENERADO: no editar a mano
  Art.tsx         Ilustraciones de apoyo en SVG (flotilla, motivos de las tarjetas)
  Brand.tsx       Logo oficial con respaldo (engrane del favicon + nombre)
  motion.ts       Revelado con IntersectionObserver, progreso de scroll con rAF, tilt de tarjetas
  landing.css     Estilos y animaciones bajo .lp (incluye prefers-reduced-motion)
packages/shared/src/__tests__/landingCatalog.test.ts   Pruebas del catálogo y del buscador
tools/hero-art/generate-suv.mjs   Generador de HeroScene.tsx (modelo 3D simple proyectado en perspectiva)
apps/web/public/robots.txt, apps/web/public/sitemap.xml
```

Modificados: `apps/web/src/app/router.tsx`, `apps/web/src/features/auth/{AuthLayout,LoginPage,ForgotPasswordPage}.tsx` (solo presentación + validación del destino), `apps/web/index.html` (title, description, og), `apps/web/package.json` (+ `@fontsource-variable/archivo`).

## Cómo editar

### Catálogo

Edite solo `apps/web/src/features/landing/catalog.ts`. Cada categoría tiene `name` (oficial), `short` (tarjetas y filtros), `blurb` (descripción corta), `keywords` (búsqueda) y `jobs` (trabajos tal cual el catálogo). Si cambia la cantidad de trabajos, actualice `EXPECTED` y el total en `packages/shared/src/__tests__/landingCatalog.test.ts`. La landing calcula los conteos sola.

Sinónimos del buscador: `SYNONYMS` en `search.ts` (ej. `clutch` y `embrague`, `balinera` y `rodamiento`, `aire` y `aire acondicionado`).

### Datos del negocio

Todo en `apps/web/src/features/landing/business.ts`. Los campos son opcionales: si un campo queda vacío, la web no lo muestra (no aparecen enlaces vacíos ni textos de relleno).

- Teléfono / WhatsApp, dirección, Google Maps, horario, Facebook e Instagram: ya configurados con los datos confirmados por el dueño.
- TikTok: está en la lista con `enabled: false`. Para mostrarlo, confirme el usuario y cambie a `true`.
- Correo: `email: undefined` (decisión del dueño, no se muestra todavía).
- Aviso de privacidad: `privacyUrl`. Al definirlo aparece el enlace en el pie.
- Foto real del hero: copie la imagen optimizada (WebP, ~1920px de ancho, menos de 250 KB) a `apps/web/public/img/` y ponga `heroImage: "/img/hero.webp"` y `heroImageAlt`. Con foto, el hero reemplaza la ilustración SVG por la imagen con un degradado para mantener el contraste del texto.
- Dominio: `siteUrl` usa `https://rapifix-prod-a1b2c.web.app` (Firebase Hosting, ver `firebase.json` y `.firebaserc`). Si se conecta un dominio propio, cambie `siteUrl` y las URLs de `public/robots.txt` y `public/sitemap.xml`.
- Logo: usa el mismo archivo oficial de Storage que el login, el portal y `og:image`. Si no carga, se muestra el engrane del favicon con el nombre.

Mensajes prellenados de WhatsApp: `WA_MESSAGES` en `business.ts` (servicios, flotillas, contacto, seguimiento) y `waCategory()` para cada categoría.

## Pendientes de información corporativa

- [ ] Correo electrónico público (el dueño decidió no mostrarlo todavía).
- [ ] Aviso de privacidad: debe redactarse o revisarse antes de publicar. No se inventó ninguno.
- [ ] Fotos reales del taller para el hero y secciones (hoy se usan ilustraciones SVG originales, sin presentarlas como fotos del taller).
- [ ] Opcional: confirmar si existe cuenta de TikTok.
- [ ] Opcional: dominio propio (hoy el canonical y el sitemap usan el dominio de Firebase Hosting).
- [ ] Publicar el menú del carwash tras el despliegue (servicios, planes y lealtad).

## Hero: ilustración del SUV

No hay fotos reales ni con licencia verificable, así que el hero usa arte original: un SUV moderno en vista de tres cuartos dentro de un taller (piso pulido con reflejo, luces lineales en el techo, muro con tira LED). No representa un modelo ni marca real y no se presenta como foto de las instalaciones (aria-label: "Ilustración de un vehículo en un taller automotriz").

- Se genera con `node tools/hero-art/generate-suv.mjs` (escribe `apps/web/src/features/landing/HeroScene.tsx`; con `--preview archivo.svg` deja también un SVG suelto para revisarlo). Para cambiar la forma, colores o encuadre, edite el generador y vuelva a ejecutarlo.
- Escritorio (1024 px o más): escena completa de fondo (`xMaxYMid slice`), texto a la izquierda con degradado para el contraste. Parallax por capas (fondo, vehículo, luces) solo con mouse; sin parallax en táctil ni con movimiento reducido.
- Móvil y tablet: recorte centrado en el vehículo debajo de los botones, con bordes difuminados.
- Foto real futura: `heroImage` en `business.ts` reemplaza la ilustración.

## Revisión multipuntos (debajo del hero)

- `TruckArt.tsx`: camioneta 4x4 original en perfil (diseño propio, sin rasgos de modelos ni marcas), con partes separadas: capó (gira en la bisagra y deja ver el motor), ruedas (el rin gira y el caliper se ilumina), faros (haz de luz), cabina (ondas de aire frío), escape (bruma) y bajos (tren motriz resaltado).
- `Multipoint.tsx`: al entrar la sección, el vehículo entra y una línea de escáner lo recorre una vez (IntersectionObserver); los puntos rojos aparecen detrás del escáner.
- Escritorio (1024 px o más): dos columnas. A la izquierda, el título y la lista de zonas (o la tarjeta de la zona activa); a la derecha, la camioneta. Nada tapa el vehículo. Los puntos son botones de 44 px con aria-label: hover o clic abre la tarjeta; teclado: Tab entre puntos, Enter o Espacio abre y lleva el foco a la tarjeta, Esc cierra y devuelve el foco.
- Móvil y tablet: la camioneta cabe completa dentro del margen; los puntos son solo indicadores y el menú táctil son los botones de zonas (44 px) debajo del vehículo; la tarjeta aparece debajo. Tocar fuera o "Cerrar" la cierra.
- La tarjeta lista las categorías de cada zona con el conteo real de `catalog.ts` y "Ver servicios" abre el mismo diálogo del catálogo (`CatalogDialogProvider` en `Services.tsx`, un solo diálogo para toda la landing). Pie de sección: diagnóstico completo.
- Movimiento reducido: sin escáner ni animaciones de partes; los puntos se ven y funcionan.

## Carwash

### En la landing
Banner "Carwash RAPIFIX" después de Flotillas que lleva a `/lavado`, y enlace "Carwash" en la navegación y el pie.

### Página `/lavado`
`CarwashPage.tsx` (lazy, sin módulos del panel). Secciones: hero, tipos de vehículo (los 4 de `VEHICLE_SIZES`, `VEHICLE_SIZE_LABELS` y `VEHICLE_SIZE_HINTS`), "Nuestros servicios" (con selector de tipo de vehículo), "Tu carro siempre limpio" (membresías), "Cada lavado cuenta" (lealtad) y "Consulta tu Carwash". Sin precios. Todo el contacto es por WhatsApp de RAPIFIX con mensajes prellenados ("Hola, RAPIFIX. ...").

### De dónde salen los datos (sin duplicar el módulo)
- Servicios, planes y lealtad viven en `carwashServices`, `carwashPlans` y `settings/carwash` (panel). El servidor publica una copia sin precios en **`publicCarwash/{tid}`** (mismo patrón que `publicBranding`): servicios activos (nombre, descripción, si es extra, tipos de vehículo con tarifa y cuáles son "a convenir" = "Requiere evaluación"), planes activos (nombre, tipo de vehículo, lavados al mes, servicios incluidos por nombre) y lealtad (cada cuántos lavados pagados se gana uno, sellos de regalo). Nada de precios, comisiones ni clientes. Lógica: `packages/shared/src/publicCarwash.ts` (con pruebas).
- Triggers `onCarwashServicePublic`, `onCarwashPlanPublic`, `onCarwashSettingsPublic` la regeneran al cambiar el menú, un plan o la configuración. Callable `rebuildPublicCarwash` (admin y gerencia) para publicarla la primera vez.
- **Después de desplegar:** guardar una vez cualquier servicio del menú del carwash (o llamar `rebuildPublicCarwash`). Mientras el documento no exista, la página muestra un estado vacío con WhatsApp (no inventa servicios).
- La página lee el documento con la API REST de Firestore (`fetch`), sin cargar el SDK de Firestore. Estados: cargando, con datos, vacío (404) y error. Si se activa App Check con enforcement en Firestore, esta lectura REST necesitaría token; hoy no está activado.
- Reglas: `publicCarwash/{tid}` permite `get` público; `list` y escritura cerrados. Probado en `tests/rules`.

### Consulta de lavados y pagos
No hay login de clientes (no se creó). Cada lavado tiene su link privado `/lavado/:token` (lo envía el taller por WhatsApp) donde el cliente ve su lavado, los sellos de su tarjeta, puede pagar con tarjeta (ROKI) o subir comprobante (queda pendiente hasta que caja lo valida) y puede incluir fotos. **Trabajo futuro:** portal de cliente con historial completo e inicio de sesión.

### Analítica
El proyecto no tiene Firebase Analytics ni gtag; no se agregó ninguna herramienta.

## Agendar cita (`/agendar`)

- Formulario público (`BookingPage.tsx`): motivo (Mantenimiento, Frenos, Diagnóstico, Aire acondicionado, Carwash, Otro; se preselecciona con `?motivo=`), día (desde mañana hasta 30 días), hora (bloques libres), nombre, teléfono (validación internacional existente, +504 por defecto), placa y marca/modelo opcionales, comentario (máx. 500). Pantalla de éxito con resumen opcional por WhatsApp. No se envía WhatsApp automático.
- Botones "Agendar": navegación (principal), hero, contacto, diálogo de cada categoría (`?motivo=<categoría>`), tarjetas de la revisión multipuntos, diagnóstico y `/lavado` ("Agendar lavado").
- Lógica pura y probada en `packages/shared/src/publicAppointment.ts`: horario (lun a vie 8:00 a 17:00, sáb 8:00 a 15:00, dom cerrado, hora de Honduras), bloques de 30 min (el último empieza 1 h antes del cierre), capacidad `SLOT_CAPACITY = 2` por bloque (citas no canceladas), `MAX_ACTIVE_PER_PHONE = 2`, schema estricto con campo trampa.
- Callables públicas (`functions/src/public/appointments.ts`): `publicAppointmentSlots({ date })` devuelve solo las horas libres; `requestAppointmentPublic` crea la cita en **la misma colección de la agenda** (`tenants/{tid}/appointments`) como "Agendada", `source: "web"`, `customerId` y `vehicleId` en null, contacto tal cual y "Cita web: motivo" en notas. Capacidad y límite por teléfono en transacción; límite por IP (5 por hora) con `rateLimits` existente.
- Panel: distintivo "Web" en la agenda y "Pedida en la web" en el detalle; recepción la vincula editando la cita (flujo existente) y la confirma como siempre.

## Despliegue (cuando se autorice)

1. `npm run deploy:rules` (reglas: `publicCarwash`).
2. `npm run deploy:functions` (triggers y callables nuevas).
3. `npm run deploy:hosting`.
4. Publicar el menú del carwash una vez (ver arriba).
5. Callables públicas: `publicAppointmentSlots` y `requestAppointmentPublic` (y `rebuildPublicCarwash`, que valida el rol adentro) deben aceptar llamadas sin cuenta de Google Cloud, igual que las demás callables. Firebase lo configura al desplegar; si la página muestra error al cargar horas (403 o CORS), ejecutar:
   ```
   gcloud run services add-iam-policy-binding publicappointmentslots --region=us-central1 --member=allUsers --role=roles/run.invoker --project=rapifix-prod-a1b2c
   gcloud run services add-iam-policy-binding requestappointmentpublic --region=us-central1 --member=allUsers --role=roles/run.invoker --project=rapifix-prod-a1b2c
   ```

## Checklist del catálogo (13 categorías)

Cada tarjeta muestra solo nombre, descripción corta (máximo 2 líneas), conteo real y "Explorar servicios"; los trabajos completos se ven al abrir la categoría. Todas las categorías están en `catalog.ts`, se muestran en el mosaico de `#servicios`, en los filtros, en el buscador y en su detalle (diálogo). La categoría 12 también tiene su sección propia `#flotillas`.

| # | Categoría | Trabajos | Ubicación en la web |
|---|---|---|---|
| 1 | Mantenimiento preventivo general | 11/11 | #servicios, tarjeta destacada grande + detalle |
| 2 | Sistema de frenos | 10/10 | #servicios, tarjeta destacada + detalle |
| 3 | Sistema de suspensión | 10/10 | #servicios, tarjeta + detalle |
| 4 | Sistema de dirección | 8/8 | #servicios, tarjeta + detalle |
| 5 | Sistema de transmisión y tren motriz | 9/9 | #servicios, tarjeta + detalle |
| 6 | Sistema de enfriamiento | 9/9 | #servicios, tarjeta + detalle ("ventiladora" corregido a "ventilador") |
| 7 | Sistema eléctrico y electrónico | 11/11 | #servicios, tarjeta + detalle |
| 8 | Sistema de combustible y admisión | 7/7 | #servicios, tarjeta + detalle |
| 9 | Sistema de escape | 6/6 | #servicios, tarjeta + detalle |
| 10 | Rodamientos, ruedas y componentes relacionados | 4/4 | #servicios, tarjeta + detalle |
| 11 | Inspección y diagnóstico automotriz | 10/10 | #servicios, tarjeta destacada + detalle |
| 12 | Mantenimiento de flotillas institucionales | 7/7 | #servicios, tarjeta destacada + detalle, y sección #flotillas |
| 13 | Aire acondicionado y climatización automotriz | 16/16 | #servicios, tarjeta destacada + detalle |

Total: 118 trabajos. Verificado por prueba unitaria y por prueba en navegador (cada detalle abre con el conteo exacto).

## Qué describe la landing (verificado en el código)

- Seguimiento: el portal `/orden/:token` muestra estado, porcentaje y pasos (`PORTAL_STEPS`), última actualización e historial, diagnóstico, cotización para aprobar / rechazar / preguntar (y actualizaciones de cotización), cupones, pago en línea con tarjeta (ROKI, cuando está habilitado), comprobante de transferencia, efectivo en caja, recepción (kilometraje, combustible, objetos) y fotos por etapa. El enlace lo envía el taller por WhatsApp desde el panel; la landing no promete envíos automáticos.
- Proceso: 6 etapas que agrupan los estados reales de `packages/shared/src/workOrderStatus.ts` (igual que las columnas del tablero) y muestran sus nombres reales.
- Mockup del teléfono: etiqueta visible "Representación visual" y datos ficticios (placa ABC 1234, orden OT-0000). No hay una página pública genérica de seguimiento (los enlaces son por token), así que la llamada a la acción es "Pregunta por tu vehículo" por WhatsApp.
- Datos estructurados: `AutoRepair` con nombre, nombre en Google, URL, logo, teléfono, dirección, horario, mapa y redes (solo datos confirmados). Se insertan mientras la landing está montada.

## Probar en local

```bash
npm install
npm run typecheck
npm test -w packages/shared        # incluye landingCatalog.test.ts
npm run build
npm run dev                        # http://localhost:5173 (sin sesión: landing en "/")
```

Para ver la landing con sesión iniciada: `/inicio`. Preferencia de movimiento reducido: actívela en el sistema operativo o en DevTools (Rendering, "prefers-reduced-motion").

## Despliegue

No se desplegó. Cuando el dueño lo autorice: `npm run deploy:hosting` (solo hosting; no cambia reglas, funciones ni datos).

## Riesgos y limitaciones

- `index.html` es único para toda la SPA: title, description y og ahora hablan del sitio público y también aplican al panel y a los enlaces del portal (los textos se eligieron para que sirvan en ambos casos). La landing ajusta title, description y canonical en tiempo de ejecución.
- Los buscadores que no ejecutan JavaScript solo ven el `index.html` base (sin SSR).
- El chunk `charts` (recharts) lo importa el bundle principal desde antes de este cambio, así que también se descarga en la landing y el login. No lo introdujo la landing; se puede mejorar ajustando `manualChunks` en `vite.config.ts`.
- La fuente Archivo se sirve desde el propio sitio (`@fontsource-variable/archivo`); Inter sigue cargando desde Google Fonts como antes.
- `robots.txt` lista las rutas del panel para que no se indexen (ya son visibles en el JS público; no contienen datos).
- Tras cerrar sesión en `/`, el usuario ve la landing en vez del login (tiene el enlace "Acceso").
