# Fase 1: Base, acceso, clientes y vehículos

## Qué quedó implementado

| Área | Detalle |
|---|---|
| Monorepo | `apps/web` (panel), `functions` (Cloud Functions), `packages/shared` (tipos, validaciones, roles, estados) |
| Autenticación | Login, recuperación de contraseña, sesión persistente, pantalla "cuenta sin permisos" |
| Roles | Custom claims `{ tid, role }` asignados solo por Cloud Functions. Primer admin con `bootstrapAdmin` (una sola vez, solo para el correo autorizado) |
| Usuarios | Crear usuarios con rol, cambiar rol, activar/desactivar (revoca la sesión al instante) |
| Layout | Sidebar oscuro colapsable (se recuerda), menú deslizable en celular, topbar, búsqueda global con atajo ⌘K o "/" |
| Dashboard | Clientes activos, vehículos, nuevos del mes, gráfico de clientes nuevos por mes, últimos clientes y vehículos |
| Clientes | Lista con búsqueda y filtros, paginación, crear/editar, activar/desactivar, aviso de teléfono duplicado, detalle con vehículos, llamar y WhatsApp |
| Vehículos | Lista con búsqueda (placa, VIN, marca, modelo, dueño), crear/editar, cambio de dueño, aviso de placa duplicada, archivar/restaurar |
| Fotos | Subida desde celular (cámara) o computadora, compresión automática, foto principal, visor, eliminar (admin/gerente) |
| Kilometraje | Historial que no se puede editar ni borrar, actualización con nota, aviso si el valor baja |
| Configuración | Datos del taller, contacto, ISV, moneda, prefijos OT/COT, logo, carga de datos demo |
| Auditoría | Toda creación o cambio de clientes, vehículos y configuración queda registrada por el servidor (quién, cuándo, qué campos). Visible en la pestaña "Cambios" |
| Seguridad | Reglas de Firestore y Storage por taller y rol, con validación de campos. Contadores y auditoría solo los escribe el servidor |

## Cloud Functions

| Function | Tipo | Qué hace |
|---|---|---|
| `bootstrapAdmin` | Callable | Primer administrador (una sola vez) |
| `createStaffUser` | Callable (admin) | Crea usuario con rol |
| `updateStaffUser` | Callable (admin) | Cambia rol, nombre o estado |
| `seedDemoData` | Callable (admin) | Datos de demostración (una sola vez) |
| `onVehicleWritten` | Trigger | Recalcula vehículos por cliente |
| `onCustomerWritten` | Trigger | Actualiza nombre/teléfono del dueño en sus vehículos |
| `onVehiclePhotoWritten` | Trigger | Contador de fotos |
| `auditWriter` | Trigger | Registro de auditoría |

## Cómo probarlo

1. Entrar con `scasalvarez@gmail.com` y tocar "Configuración inicial (primer administrador)".
2. Configuración → "Cargar datos demo".
3. Buscar `HAB` o `Juan` en la barra superior.
4. Crear un cliente, agregarle un vehículo y subir fotos desde el celular.
5. Usuarios → crear un usuario con rol Técnico, entrar con él en otra ventana y confirmar que no puede crear clientes.

## Pendiente / notas

- Los técnicos pueden leer todos los clientes y vehículos. En la Fase 2 se limita a los de sus órdenes asignadas.
- La placa duplicada se avisa en la interfaz. El bloqueo estricto en el servidor llega junto con la recepción de vehículos (Fase 2).
- Tests automáticos de reglas de seguridad con emuladores: Fase 7.
- Despliegue automático desde GitHub: pendiente de crear la cuenta de servicio (Fase 7). Por ahora se publica desde la Mac con `npm run deploy`.
