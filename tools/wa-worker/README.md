# RAPIFIX wa-worker

Programa que corre en la computadora del taller, junto a OpenWA. Toma los mensajes de WhatsApp que
el panel de RAPIFIX pone en cola y los envía por OpenWA. Guía completa, paso a paso:
[docs/WHATSAPP-AUTOMATICO.md](../../docs/WHATSAPP-AUTOMATICO.md).

Necesita Node.js 22 o más nuevo. No tiene dependencias (no hace falta `npm install`).

## Uso

1. Copie `.env.example` como `.env` y llene los valores.
2. `npm run check` — revisa que OpenWA responda y que WhatsApp esté conectado.
3. `npm run test-send -- +504XXXXXXXX "texto"` — manda un mensaje de prueba directo por OpenWA.
4. `npm start` — arranca el programa. Deje la ventana abierta.

Arranque automático: `iniciar-worker.bat` (Windows, acceso directo en la carpeta Inicio o Programador
de tareas) y `com.rapifix.wa-worker.plist` (Mac, launchd).

## Qué hace cada 8 segundos

1. Pregunta a OpenWA el estado de la sesión (`GET /api/sessions?name=` y `GET /api/sessions/{id}`).
2. Se lo reporta a RAPIFIX (`heartbeat`). El panel muestra Conectado / desvinculado / apagado.
3. Solo si WhatsApp está conectado (`ready`) pide mensajes (`pull`, máximo 5).
4. Envía cada uno con `POST /api/sessions/{id}/messages/send-text` (`chatId` = dígitos + `@c.us`),
   con una pausa al azar de 3 a 8 segundos entre mensajes, y confirma (`ack`).

Si OpenWA o internet fallan no se cae: espera y vuelve a intentar. Si no logra confirmar un mensaje
que ya salió, lo recuerda en `.wa-worker-state.json` para no mandarlo dos veces.

## Seguridad

- `.env` tiene la clave de conexión de RAPIFIX y la API key de OpenWA. No se sube al repositorio
  (está en `.gitignore`) y no se pega en chats ni correos.
- El programa nunca imprime esas claves y muestra solo los últimos 4 dígitos de los teléfonos.
- Solo hace llamadas salientes; no abre ningún puerto.
