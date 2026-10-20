# Landing pública de RAPIFIX

Sitio público de RAPIFIX Centro Automotriz integrado en la misma app web (`apps/web`) que el panel. Rama de trabajo: `landing`.

## Rutas

| Ruta | Sin sesión | Con sesión |
|---|---|---|
| `/` | Landing pública | Panel (Dashboard o carwash, igual que antes) |
| `/inicio` | Landing pública | Landing pública (para que el equipo la vea) |
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
  Art.tsx         Ilustraciones originales en SVG (vehículo del hero, flotilla, motivos)
  Brand.tsx       Logo oficial con respaldo (engrane del favicon + nombre)
  motion.ts       Revelado con IntersectionObserver, progreso de scroll con rAF, tilt de tarjetas
  landing.css     Estilos y animaciones bajo .lp (incluye prefers-reduced-motion)
packages/shared/src/__tests__/landingCatalog.test.ts   Pruebas del catálogo y del buscador
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

## Checklist del catálogo (13 categorías)

Todas las categorías están en `catalog.ts`, se muestran en el mosaico de `#servicios`, en los filtros, en el buscador y en su detalle (diálogo). La categoría 12 también tiene su sección propia `#flotillas`.

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
- Mockup del teléfono: datos ficticios marcados como ejemplo (placa ABC 1234, orden OT-0000).
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
