# RAPIFIX

**Sistema de Gestión para Taller Automotriz**

React + TypeScript + Firebase (Auth, Firestore, Storage, Cloud Functions, Hosting).
Arquitectura completa en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md). Notas por fase en [`docs/FASE-1.md`](docs/FASE-1.md) , [`docs/FASE-2.md`](docs/FASE-2.md), [`docs/FASE-3.md`](docs/FASE-3.md) , [`docs/FASE-4.md`](docs/FASE-4.md), [`docs/FASE-5.md`](docs/FASE-5.md) y [`docs/PAGOS-EN-LINEA.md`](docs/PAGOS-EN-LINEA.md).

## Estructura

```
apps/web/          Panel interno (React + Vite + Tailwind)
functions/         Cloud Functions (TypeScript, empaquetadas con esbuild)
packages/shared/   Tipos, validaciones (Zod), roles y reglas de negocio compartidas
firestore.rules    Seguridad de la base de datos
storage.rules      Seguridad de archivos
docs/              Arquitectura y notas por fase
```

## Requisitos

- Node.js 20 o superior
- Firebase CLI: `npm install -g firebase-tools` y `firebase login`
- Proyecto Firebase en plan Blaze (Functions y Storage lo requieren)

## Instalación

```bash
npm install                 # panel + paquete compartido
npm run functions:install   # Cloud Functions
```

Variables de entorno (NO se suben a GitHub):

| Archivo | Contenido |
|---|---|
| `apps/web/.env.local` | Config web de Firebase para desarrollo (ver `.env.example`) |
| `apps/web/.env.production` | La misma config, usada al compilar para publicar |
| `functions/.env.<PROJECT_ID>` | `BOOTSTRAP_ADMIN_EMAIL` y `TENANT_ID` (ver `functions/.env.example`) |

La config web se obtiene con:

```bash
firebase apps:sdkconfig WEB <APP_ID> --project <PROJECT_ID>
```

## Desarrollo local

```bash
npm run dev          # http://localhost:5173 conectado al proyecto de Firebase
```

Para trabajar sin tocar datos reales: `VITE_USE_EMULATORS=true` en `.env.local` y `firebase emulators:start`.

Otros comandos:

```bash
npm run typecheck             # revisión de tipos de todo el proyecto
npm test -w packages/shared   # pruebas unitarias
```

## Publicar (deploy)

```bash
npm run deploy             # todo: panel, functions, reglas e índices
npm run deploy:hosting     # solo el panel
npm run deploy:rules       # solo reglas e índices
npm run deploy:functions   # solo Cloud Functions
```

URL: `https://<PROJECT_ID>.web.app`

## Primer uso

1. Crear el usuario del dueño en Firebase Console → Authentication.
2. Poner ese correo en `BOOTSTRAP_ADMIN_EMAIL` y desplegar functions.
3. Entrar al panel y tocar **"Configuración inicial (primer administrador)"**. Solo funciona una vez.
4. Crear el resto de usuarios desde **Usuarios y permisos**.

## Seguridad

- Nunca subir a GitHub: archivos `.env*`, llaves de cuenta de servicio (`*.json` de Firebase Admin), sesiones de WhatsApp.
- Los permisos se aplican en `firestore.rules`, `storage.rules` y en Cloud Functions. La interfaz solo oculta lo que el rol no puede usar.
- La apiKey web de Firebase no es secreta (identifica el proyecto); la protección real son las reglas.

## Fases

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Arquitectura, Firebase, Auth, layout, dashboard, clientes, vehículos | ✅ |
| 2 | Órdenes de trabajo, estados, Kanban, recepción, fotos, diagnóstico, historial | ✅ |
| 3 | Cotizaciones, aprobación por link, portal del cliente | ✅ |
| 4 | Inventario, productos, servicios, POS, pagos, pagos en línea (ROKI) | ✅ |
| 5 | Agenda, mantenimiento, técnicos, proveedores, compras, gastos, reportes | ✅ |
| 6 | WhatsApp Web, plantillas, eventos, automatizaciones | |
| 7 | Seguridad, auditoría, optimización, deployment automático | |
