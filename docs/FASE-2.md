# Fase 2: Órdenes de trabajo

## Qué quedó implementado

| Área | Detalle |
|---|---|
| Orden de trabajo | Numeración correlativa en el servidor (OT-1001, OT-1002...), token único para el portal del cliente, un vehículo no puede tener dos órdenes abiertas |
| Estados | Los 13 estados de la especificación con máquina de estados: solo se permiten los pasos lógicos del flujo, y cada rol tiene sus pasos permitidos |
| Historial | Cada cambio de estado guarda usuario, fecha/hora, estado anterior y nuevo. El historial no se puede editar ni borrar |
| Kanban | 7 columnas (Recibido → Entregado). Arrastrar y soltar en computadora, botón "Mover a" en celular. Si una columna agrupa varios estados, pregunta a cuál |
| Lista | Búsqueda por OT, placa, cliente o marca, filtro por estado, días en taller |
| Nueva orden | Buscar vehículo por placa, crear cliente o vehículo en el mismo flujo, motivo, tipo, prioridad, técnicos, fecha prometida |
| Recepción | Kilometraje (actualiza el del vehículo), nivel de combustible, checklist (llaves, documentos, rueda de repuesto, gata, herramientas, triángulos, extintor), estado exterior e interior, accesorios, otros objetos |
| Fotos | 6 fotos guiadas de ingreso (frente, atrás, laterales, interior, tablero), más daños, diagnóstico, antes, durante y después. Comentario por foto y opción de ocultarla al cliente |
| Diagnóstico | Problema reportado, diagnóstico del técnico, pruebas, recomendaciones, observaciones, códigos OBD con descripción de los más comunes. Pensado para usar desde el celular |
| Control de calidad | Checklist de salida (prueba de ruta, fluidos, fugas, torque, tablero, limpieza, piezas viejas) |
| Entrega | Kilometraje de salida, aviso si falta control de calidad o hay saldo |
| Centro de comunicación | Una actualización se publica en el portal (se verá en la Fase 3), se prepara para WhatsApp, o ambas. Notas internas aparte |
| WhatsApp (manual) | Al cambiar de estado se prepara el mensaje de la plantilla correspondiente, editable, y abre WhatsApp listo para enviar. 14 plantillas precargadas |
| Técnicos | Asignación a órdenes. El técnico ve "Mis órdenes" y solo puede ver y trabajar las suyas (protegido en el servidor) |
| Vehículo y cliente | Línea de tiempo de órdenes en el vehículo, historial de órdenes en el cliente, aviso "En taller" |
| Dashboard | Vehículos en taller, en diagnóstico, esperando aprobación, listos, estado de las órdenes y alertas (listos para entregar, cotizaciones sin respuesta, más de 5 días en taller, sin técnico) |
| Búsqueda global | Ahora también encuentra órdenes por número |
| Datos demo | Botón "Cargar órdenes demo" en Configuración (5 órdenes en distintos estados) |

## Cloud Functions nuevas

| Function | Qué hace |
|---|---|
| `createWorkOrder` | Numeración, token de portal, recepción, historial, kilometraje |
| `changeWorkOrderStatus` | Valida transición y rol, historial, kilometraje de salida |
| `updateWorkOrder` | Motivo, tipo, prioridad, técnicos, fecha prometida |
| `saveWorkOrderSection` | Recepción, diagnóstico, control de calidad |
| `addOrderEvent` | Notas internas y actualizaciones al cliente |
| `seedDemoOrders` | Órdenes de demostración |
| `touchSession` | Último acceso del usuario |
| `onWorkOrderWritten` | Órdenes abiertas y última visita del cliente |
| `onOrderPhotoWritten` | Contador de fotos |
| `onUserWritten` | Directorio del personal (para asignar técnicos) |

## Cómo probarlo

1. Configuración → "Cargar órdenes demo".
2. Órdenes de trabajo → arrastrar una tarjeta a otra columna. Revisar que aparezca el mensaje de WhatsApp sugerido.
3. Nueva orden → buscar `HAB`, llenar la recepción, crear. Tomar las 6 fotos desde el celular.
4. Diagnóstico → agregar código `P0300` y marcar completado.
5. Crear un usuario Técnico, asignarlo a una orden y entrar con él: solo debe ver esa orden.

## Pendiente

- El link del portal en los mensajes se activa en la Fase 3 (junto con el portal).
- Servicios, repuestos, cotización, pagos y documentos: Fases 3 y 4.
- Arrastrar y soltar en celular usa el botón "Mover a" (más confiable en pantallas táctiles).
