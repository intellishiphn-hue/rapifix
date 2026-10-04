# WhatsApp automático en RAPIFIX

Con esto los avisos a los clientes (orden recibida, cambio de estado, cotización, carro listo del
carwash, link de pago, recordatorios) salen solos por WhatsApp, sin que nadie tenga que tocar "enviar".

## Cómo funciona, en simple

1. En el panel de RAPIFIX alguien toca **Enviar**. El mensaje queda en una **cola**.
2. En **una computadora del taller** corren dos programas:
   - **OpenWA**: es un "WhatsApp Web" que se maneja solo. Queda vinculado al número de RAPIFIX igual que cuando usted abre WhatsApp Web.
   - **El programa de RAPIFIX** (`wa-worker`): cada 8 segundos pregunta a RAPIFIX si hay mensajes en cola, se los pasa a OpenWA y avisa que ya salieron.
3. Si la computadora está apagada o WhatsApp se desvinculó, el panel **vuelve solo al envío manual** de siempre (se abre WhatsApp con el texto listo).

La computadora del taller solo *sale* a internet. Nadie se conecta a ella desde afuera y no hay que abrir puertos en el router.

Reglas que el sistema aplica solo:

- Solo envía de **7:00 a.m. a 8:00 p.m.** Fuera de ese horario los mensajes esperan.
- Un aviso normal que no sale en 4 horas **se cancela** (no se mandan avisos viejos al día siguiente). Los recordatorios de cita y mantenimiento aguantan hasta el día siguiente.
- El mismo mensaje al mismo número no sale dos veces en un minuto.
- Máximo 200 mensajes por día (se puede cambiar en Configuración) y pausa de 3 a 8 segundos entre mensajes.
- Si un envío falla se reintenta hasta 3 veces; después queda en **WhatsApp → En cola / fallidos** con el motivo y los botones Reintentar y Cancelar.

## Antes de empezar: lea esto

- OpenWA **no es el servicio oficial de WhatsApp**. Funciona como un WhatsApp Web automatizado. Los mismos autores de OpenWA advierten que **siempre existe algún riesgo de que WhatsApp restrinja o bloquee el número**, y recomiendan usar un número dedicado y no el principal del negocio. RAPIFIX decidió usar su número principal: el riesgo es bajo si se usa como se describe aquí (pocos mensajes, solo a clientes que esperan el aviso), pero **no es cero**. Vea la sección "Cómo cuidar el número".
- **Tres cosas que nunca se pegan en un chat, correo, captura de pantalla ni se le dictan a nadie:**
  1. La **clave de conexión** de RAPIFIX (empieza con `rfw_`).
  2. La **API key** de OpenWA (empieza con `owa_`).
  3. El **código QR** de WhatsApp.
  
  Con cualquiera de ellas otra persona podría enviar mensajes como si fuera el taller. Si alguna se filtra, vea "Si se filtró una clave".

## Qué se necesita

- Una computadora del taller con Windows 10/11 o Mac, con al menos 8 GB de memoria, que esté encendida en horario de trabajo (8 a 5).
- Internet.
- El teléfono que tiene el WhatsApp del número de RAPIFIX (solo para escanear el QR una vez).
- Un usuario **administrador** de RAPIFIX.
- Unos 45 minutos la primera vez.

---

## Paso A. Instalar OpenWA en la computadora del taller

Hay dos formas según la guía de OpenWA: con Docker, o con Node.js directo. **Use Docker Desktop.** Por qué: es la forma que OpenWA recomienda y la única que documenta para uso diario; trae todo adentro (incluido el navegador que usa WhatsApp Web), se reinicia solo si falla y arranca solo al encender la computadora. La forma con Node.js directo está pensada para programadores (modo desarrollo).

### A1. Instalar Docker Desktop

1. Entre a https://www.docker.com/products/docker-desktop/ y descargue Docker Desktop para su sistema.
2. Instálelo con las opciones que trae marcadas.
   - **Windows:** si pide instalar o actualizar "WSL 2", acepte. Puede pedir reiniciar.
   - **Mac:** elija la versión de su chip (Apple Silicon o Intel) y arrastre Docker a Aplicaciones.
3. Abra Docker Desktop y espere a que diga que está corriendo ("Engine running").
4. En Docker Desktop → Settings (el engranaje) → General, marque **"Start Docker Desktop when you sign in to your computer"**. Así arranca solo al encender.

### A2. Descargar OpenWA

1. Entre a https://github.com/rmyndharis/OpenWA
2. Botón verde **Code → Download ZIP**.
3. Descomprima el ZIP en un lugar fijo, por ejemplo:
   - Windows: `C:\openwa`
   - Mac: carpeta `openwa` dentro de su carpeta de usuario

   Dentro debe quedar un archivo llamado `docker-compose.yml`.

### A3. Decirle que use la versión ya lista (más rápido)

En esa misma carpeta cree un archivo de texto llamado exactamente `docker-compose.override.yml` con este contenido (respete los espacios):

```yaml
services:
  openwa-api:
    image: ghcr.io/rmyndharis/openwa:latest
```

(En Windows use el Bloc de notas y, al guardar, elija "Todos los archivos" para que no le agregue `.txt`.)

### A4. Encender OpenWA

Abra una terminal **en esa carpeta**:

- **Windows:** abra la carpeta `C:\openwa`, escriba `powershell` en la barra de direcciones y presione Enter.
- **Mac:** abra la app Terminal, escriba `cd ` (con un espacio), arrastre la carpeta `openwa` a la ventana y presione Enter.

Escriba estos dos comandos, uno por uno:

```
docker compose pull openwa-api
docker compose up -d --no-build
```

La primera vez descarga bastante (puede tardar varios minutos). Cuando termine, OpenWA queda encendido y se volverá a encender solo cada vez que arranque Docker Desktop.

### A5. Ver la API key inicial de OpenWA

En la misma terminal:

```
docker exec openwa-api cat /app/data/.api-key
```

Aparece una clave larga que empieza con `owa_`. Es la **llave de administrador de OpenWA**. Cópiela solo para el siguiente paso. No la guarde en chats ni la mande a nadie.

## Paso B. Vincular el WhatsApp de RAPIFIX

1. En la computadora del taller abra el navegador en **http://localhost:2785**
2. Entre con la API key del paso A5.
3. Cree la **sesión**: en la sección de sesiones (Sessions) cree una nueva con el nombre `rapifix` y presione iniciar (Start). Deje el motor que viene por defecto (`whatsapp-web.js`): es el más pesado pero el que menos riesgo de bloqueo tiene, según OpenWA.
4. Aparece un **código QR**. En el teléfono de RAPIFIX: WhatsApp → menú (⋮ en Android, Configuración en iPhone) → **Dispositivos vinculados** → **Vincular un dispositivo** → escanee el QR de la pantalla.
5. Espere a que la sesión diga que está lista (`ready`).
6. Cree una **API key solo para RAPIFIX**: en la sección de API Keys cree una nueva con rol **operator** y marque solo la sesión `rapifix`. Copie esa clave: se muestra una sola vez. Es la que va en el archivo `.env` del paso D (no use la de administrador para eso).

> Los nombres exactos de los botones pueden cambiar un poco entre versiones de OpenWA. Lo que importa: una sesión llamada `rapifix` en estado `ready` y una API key de rol operator.

**Opcional y recomendado** (freno extra de OpenWA): en la carpeta de OpenWA cree un archivo `.env` con la línea `SEND_PACING_ENABLED=true` y repita `docker compose up -d --no-build`. Con eso OpenWA también limita por su cuenta cuántos mensajes salen por día. OpenWA ya simula el "escribiendo…" antes de cada mensaje sin configurar nada.

## Paso C. Generar la clave de conexión en RAPIFIX

1. Entre a RAPIFIX con un usuario **administrador**.
2. **Configuración → WhatsApp automático → Generar clave de conexión**.
3. Copie la clave (empieza con `rfw_`). **Se muestra una sola vez.** Si la pierde no pasa nada: genere otra (la anterior deja de servir).

## Paso D. Instalar el programa de RAPIFIX (wa-worker)

### D1. Instalar Node.js

Entre a https://nodejs.org , descargue la versión **LTS** (22 o más nueva) e instálela con las opciones por defecto.

### D2. Copiar la carpeta

Copie la carpeta `tools/wa-worker` del proyecto RAPIFIX a la computadora del taller (por memoria USB o descargándola). Póngala en un lugar fijo:

- Windows: `C:\rapifix-wa-worker`
- Mac: `rapifix-wa-worker` dentro de su carpeta de usuario

### D3. Crear el archivo `.env`

1. Dentro de la carpeta hay un archivo `.env.example`. Haga una copia y nómbrela `.env` (solo eso, sin `.txt`).
2. Ábralo con el Bloc de notas (Windows) o TextEdit (Mac) y llene:

```
RAPIFIX_WORKER_URL=https://us-central1-rapifix-prod-a1b2c.cloudfunctions.net/waWorker
RAPIFIX_WORKER_TOKEN=(la clave rfw_ del paso C)
OPENWA_URL=http://localhost:2785
OPENWA_API_KEY=(la API key operator del paso B6)
OPENWA_SESSION=rapifix
```

3. Guarde. Este archivo se queda **solo en esa computadora**.

### D4. Probar

Abra una terminal en la carpeta del programa (igual que en A4) y pruebe en este orden:

```
npm run check
```

Debe decir "WhatsApp conectado". Luego mande una prueba a su propio celular:

```
npm run test-send -- +50499998888 "Prueba de RAPIFIX"
```

(cambie el número por el suyo). Si llega, arranque el programa:

```
npm start
```

Debe decir "WhatsApp conectado." y quedarse esperando. **Esa ventana tiene que quedar abierta.**

### D5. Encender el envío en el panel

En RAPIFIX → Configuración → WhatsApp automático:

- El estado debe decir **Conectado** y mostrar el número del taller.
- Marque **Enviar mensajes automáticamente**.
- **Enviar sin preguntar** (opcional): al cambiar el estado de una orden el aviso sale directo y solo aparece "Mensaje enviado a Juan". Recomendación: déjelo apagado las primeras semanas, para revisar cada mensaje antes de que salga.

Pruebe con una orden de un cliente de confianza (o la suya): al abrir el mensaje, el botón verde ahora dice **Enviar** y debajo se ve *En cola → Enviado*.

## Paso E. Que arranque solo al encender la computadora

OpenWA ya arranca solo (paso A1, punto 4). Falta el programa de RAPIFIX:

### Windows (forma sencilla: carpeta Inicio)

1. En la carpeta `C:\rapifix-wa-worker` hay un archivo `iniciar-worker.bat`. Clic derecho → **Crear acceso directo**.
2. Presione las teclas **Windows + R**, escriba `shell:startup` y Enter. Se abre la carpeta Inicio.
3. Mueva el acceso directo a esa carpeta.

Al iniciar sesión se abrirá una ventana negra "RAPIFIX WhatsApp automatico". Puede minimizarla, pero **no la cierre**. Si el programa se cae, esa ventana lo vuelve a levantar sola.

Alternativa: **Programador de tareas** → Crear tarea básica → Desencadenador "Al iniciar sesión" → Acción "Iniciar un programa" → elegir `C:\rapifix-wa-worker\iniciar-worker.bat`.

Importante: la computadora debe **iniciar sesión** en Windows al encender (el programa no corre en la pantalla de contraseña), y conviene que no entre en suspensión en horario de trabajo: Configuración → Sistema → Energía → Suspender: Nunca (enchufada).

### Mac

1. Abra el archivo `com.rapifix.wa-worker.plist` de la carpeta con TextEdit y cambie las dos rutas: la de `node` (en Terminal escriba `which node` para verla) y la de su carpeta `rapifix-wa-worker`.
2. Cópielo a la carpeta `Library/LaunchAgents` de su usuario (en Finder: menú Ir → Ir a la carpeta → `~/Library/LaunchAgents`).
3. En Terminal: `launchctl load ~/Library/LaunchAgents/com.rapifix.wa-worker.plist`

En Mac corre sin ventana. Para ver qué está haciendo: `tail -f /tmp/rapifix-wa-worker.log`. Evite que la Mac se duerma: Ajustes del Sistema → Batería / Pantalla de bloqueo.

## Paso F. Qué hacer si se desconecta

Mire el estado en RAPIFIX → Configuración → WhatsApp automático. Mientras se arregla, **el taller sigue enviando a mano** como antes: no se pierde nada.

| Lo que dice el panel | Qué pasó | Qué hacer |
| --- | --- | --- |
| **Computadora apagada o sin conexión** | La computadora está apagada, dormida, sin internet o el programa está cerrado | Enciéndala, revise el internet y que la ventana "RAPIFIX WhatsApp automatico" esté abierta (o haga doble clic en `iniciar-worker.bat`) |
| **WhatsApp desvinculado: escanee el QR** | El teléfono cerró la sesión del dispositivo vinculado | En esa computadora abra http://localhost:2785, entre a la sesión `rapifix` y escanee el QR otra vez con el teléfono del taller (paso B4) |
| **OpenWA no responde** | Docker Desktop está cerrado u OpenWA apagado | Abra Docker Desktop y espere 1 minuto. Si sigue igual: terminal en la carpeta de OpenWA y `docker compose up -d --no-build` |
| **WhatsApp se está conectando** | Acaba de encender | Espere 1 o 2 minutos |
| La ventana dice "RAPIFIX rechazó la clave de conexión" | Se generó una clave nueva o se anuló | Genere una clave (paso C), póngala en `.env` y vuelva a arrancar el programa |
| La ventana dice "OpenWA rechazó la API key" | La API key de `.env` no es la correcta o se borró | Cree otra API key en OpenWA (paso B6) y póngala en `.env` |

Otras situaciones:

- **Un mensaje quedó en "Falló"**: RAPIFIX → WhatsApp → En cola / fallidos. Ahí está el motivo. *Reintentar* lo vuelve a mandar. Si dice "Número sin WhatsApp", corrija el teléfono del cliente. Si dice "No se pudo confirmar si el mensaje salió", revise primero en el WhatsApp del taller si ya le llegó al cliente, para no mandarlo doble.
- **El teléfono del taller debe conectarse a internet de vez en cuando.** WhatsApp cierra los dispositivos vinculados si el teléfono pasa unos 14 días sin conexión.
- **WhatsApp pide volver a escanear seguido** o aparece un aviso de cuenta restringida: apague "Enviar mensajes automáticamente" en Configuración y siga a mano unos días. No insista.
- **Cambió de computadora**: repita los pasos A a E en la nueva y, en la vieja, cierre el programa. No deje dos computadoras con el programa encendido al mismo tiempo.

## Paso G. Cómo cuidar el número

- **Solo avisos a clientes que los esperan**: su orden, su cotización, su carro listo, su link de pago, su recordatorio.
- **Nada de promociones masivas ni listas de difusión** con este sistema. Mandar el mismo texto a muchos números que no le han escrito es la forma más segura de que WhatsApp bloquee el número.
- **Pocos mensajes.** El límite de 200 al día es un tope de seguridad, no una meta. Un taller normal manda muchos menos.
- No mande a números que no conoce ni a listas compradas.
- Si un cliente pide que no le escriban, respételo (quite su número o no le envíe).
- Las primeras dos semanas vaya despacio: deje "Enviar sin preguntar" apagado y revise cada mensaje.
- Mantenga el WhatsApp del teléfono actualizado y siga usándolo normal (contestar clientes a mano es buena señal para WhatsApp).
- No instale otros programas de envío automático con el mismo número.
- Si WhatsApp llegara a restringir el número, OpenWA y RAPIFIX no pueden quitar la restricción: se apela desde la misma app de WhatsApp. Por eso el envío manual siempre queda disponible.

## Si se filtró una clave

- **Clave de conexión (`rfw_`)**: RAPIFIX → Configuración → WhatsApp automático → **Generar una clave nueva** (la anterior deja de servir en menos de un minuto). Póngala en `.env` y reinicie el programa.
- **API key de OpenWA (`owa_`)**: en http://localhost:2785 → API Keys, revoque esa clave y cree otra. Póngala en `.env`.
- **Alguien escaneó o fotografió el QR**: en el teléfono, WhatsApp → Dispositivos vinculados, cierre los dispositivos que no reconozca.

## Para quien da mantenimiento (técnico)

- Cola: `tenants/{tid}/waOutbox`. Estado del worker: `tenants/{tid}/waStatus/current`. Contador diario: `waStatus/counter`. Interruptores: `tenants/{tid}/settings/whatsapp` (`waAuto`, `waAutoSilent`, `dailyLimit`). Hash de la clave: `tenants/{tid}/private/whatsapp` y `waWorkerTokens/{hash}` (sin lectura desde el panel).
- Functions: `queueWhatsApp`, `retryWhatsApp`, `cancelWhatsApp`, `createWaWorkerToken`, `revokeWaWorkerToken` (callables) y `waWorker` (HTTP; **necesita acceso público en Cloud Run**, igual que `rokiWebhook`: la llama el worker sin sesión de Firebase y se protege con la clave).
- Rutas de OpenWA que usa el worker: `GET /api/sessions?name=`, `GET /api/sessions/{sessionId}`, `POST /api/sessions/{sessionId}/messages/send-text` con encabezado `X-API-Key`.
- Lógica pura y pruebas: `packages/shared/src/waAuto.ts`.
