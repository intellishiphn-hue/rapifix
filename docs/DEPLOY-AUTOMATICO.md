# Publicación automática (deploy) con GitHub

Desde que esto quede configurado, **publicar RAPIFIX es solo hacer `git push` a la rama `main`**.
GitHub revisa el código, corre las pruebas de seguridad y, si todo sale bien, publica en
Firebase (proyecto `rapifix-prod-a1b2c`): el panel, las Cloud Functions, las reglas y los índices.

Para eso GitHub necesita una "llave" de Google Cloud. Esa llave se crea **una sola vez** siguiendo
estos pasos. Toma unos 10 minutos.

> **MUY IMPORTANTE — la llave es como la contraseña maestra del sistema**
> - **Nunca** la mande por chat, correo ni WhatsApp (tampoco a Claude ni a un programador).
> - **Nunca** la suba al repositorio ni la guarde en una carpeta compartida.
> - Solo se pega en GitHub, en el lugar indicado en el paso 3, y luego se borra de la computadora.
> - Si cree que alguien la vio, bórrela en Google Cloud (paso 2, pestaña "Claves") y cree otra.

---

## Paso 1. Crear la cuenta de servicio

1. Entre a <https://console.cloud.google.com> con la cuenta de Google dueña de Firebase.
2. Arriba, en el selector de proyecto, elija **rapifix-prod-a1b2c**.
3. Menú (☰) → **IAM y administración** → **Cuentas de servicio**.
4. Botón **+ Crear cuenta de servicio**.
   - Nombre: `github-deploy`
   - Descripción: `Publica RAPIFIX desde GitHub Actions`
   - Toque **Crear y continuar**.
5. En **"Otorga a esta cuenta de servicio acceso al proyecto"** agregue estos roles, uno por uno
   (escriba el nombre en el buscador y selecciónelo; use **+ Agregar otro rol** para el siguiente):

   | Rol (nombre en la consola) | Para qué sirve |
   |---|---|
   | **Administrador de Firebase** (`Firebase Admin`) | Publicar el panel (Hosting), reglas de Firestore y Storage, e índices |
   | **Administrador de Cloud Functions** (`Cloud Functions Admin`) | Crear y actualizar las funciones |
   | **Administrador de Cloud Run** (`Cloud Run Admin`) | Las funciones v2 corren en Cloud Run; permite dejarlas accesibles para la app |
   | **Usuario de cuenta de servicio** (`Service Account User`) | Permite que las funciones se ejecuten con la cuenta del proyecto |
   | **Administrador de Cloud Scheduler** (`Cloud Scheduler Admin`) | Funciones que corren solas a cierta hora (tareas programadas) |
   | **Administrador de Eventarc** (`Eventarc Admin`) | Funciones que se activan cuando cambia algo en la base de datos |
   | **Administrador de Artifact Registry** (`Artifact Registry Administrator`) | Guardar y limpiar las versiones compiladas de las funciones |
   | **Visualizador de claves de API** (`API Keys Viewer`) | Leer la configuración web al publicar |
   | **Consumidor de Service Usage** (`Service Usage Consumer`) | Verificar que las APIs de Google necesarias estén activas |

6. Toque **Continuar** y luego **Listo** (el tercer apartado se deja vacío).

> No le dé el rol "Propietario" ni "Editor": con la lista de arriba basta, y así la llave
> no sirve para borrar el proyecto ni tocar la facturación.

## Paso 2. Descargar la llave (archivo JSON)

1. En la lista de **Cuentas de servicio**, toque `github-deploy@rapifix-prod-a1b2c.iam.gserviceaccount.com`.
2. Pestaña **Claves** → **Agregar clave** → **Crear clave nueva** → tipo **JSON** → **Crear**.
3. Se descarga un archivo parecido a `rapifix-prod-a1b2c-1234abcd.json`. **No lo mueva a la carpeta del proyecto.**

> Si la consola dice que la creación de claves está deshabilitada por una política de la
> organización, hay que desactivar la política `iam.disableServiceAccountKeyCreation`
> para este proyecto (IAM y administración → Políticas de la organización), o pedir ayuda.

## Paso 3. Guardar la llave en GitHub

1. Abra el repositorio de RAPIFIX en <https://github.com>.
2. **Settings** (Configuración) → en el menú izquierdo **Secrets and variables** → **Actions**.
3. Botón verde **New repository secret**.
   - **Name:** `FIREBASE_SERVICE_ACCOUNT` (exactamente así, en mayúsculas).
   - **Secret:** abra el archivo JSON con el Bloc de notas (o TextEdit), seleccione **todo**
     (Ctrl+A / Cmd+A), copie y pegue aquí. Debe empezar con `{` y terminar con `}`.
4. Toque **Add secret**.

GitHub guarda el secreto cifrado: nadie puede volver a verlo, ni usted. Si algún día hay que
cambiarlo, se crea una llave nueva y se reemplaza el secreto.

## Paso 4. Borrar el archivo de la computadora

1. Borre el archivo JSON descargado.
2. Vacíe la **Papelera de reciclaje** (o la Papelera en Mac).

Ya no se necesita: GitHub tiene su copia segura.

---

## ¿Cómo sé si la publicación salió bien?

1. En el repositorio de GitHub, abra la pestaña **Actions**.
2. Cada `git push` a `main` crea una ejecución llamada **Deploy**.
   - Círculo amarillo girando: todavía está trabajando (suele tardar de 5 a 15 minutos).
   - ✅ Verde: se publicó. Recargue el panel (`https://rapifix-prod-a1b2c.web.app`).
   - ❌ Rojo: **no se publicó nada** (o se publicó solo una parte). Toque la ejecución y luego el paso
     en rojo para ver el error. Lo más común:
     - *"Falta el secreto FIREBASE_SERVICE_ACCOUNT"*: repita el paso 3.
     - *"Permission denied"* o *"does not have permission"*: falta uno de los roles del paso 1.
       El mensaje suele decir qué permiso falta.
     - Falló una prueba: el código nuevo rompe una regla de seguridad; hay que corregirlo antes de publicar.
3. También se puede publicar a mano sin subir código: **Actions** → **Deploy** → **Run workflow** → **Run workflow**.

Además existe la revisión **CI**, que corre en cada pull request y en cada push: revisa tipos, compila
y prueba las reglas, pero **no publica**.

## Desde ahora

```bash
git push
```

Eso es todo. Si el push es a `main`, GitHub prueba y publica solo.
Nunca se publican dos versiones al mismo tiempo: si se hacen dos push seguidos, el segundo espera al primero.

## Notas técnicas (para quien mantenga el sistema)

- Flujo: `.github/workflows/deploy.yml` → `npm ci` → pruebas (`packages/shared` y reglas con emulador)
  → typecheck → build del panel y de Functions → `firebase deploy --project rapifix-prod-a1b2c --force --non-interactive`.
- `--force` borra de producción las Cloud Functions que ya no estén en el código.
- La config web (`apps/web/.env.production`) está en el repositorio a propósito: no es secreta, va dentro del JS público.
- Parámetros de Functions: `firebase deploy --non-interactive` exige un valor para cada parámetro en
  `functions/.env.rapifix-prod-a1b2c` aunque tenga valor por defecto en el código. Como ese archivo no está
  en el repo, el workflow lo crea con `TENANT_ID=rapifix` y `BOOTSTRAP_ADMIN_EMAIL` vacío. Vacío significa
  que el botón "Configuración inicial (primer administrador)" deja de funcionar, lo cual es lo correcto una
  vez creado el primer admin. Si todavía hace falta, cree en GitHub la **variable** (no secreto)
  `BOOTSTRAP_ADMIN_EMAIL` en *Settings → Secrets and variables → Actions → Variables*.
- Si en el futuro se agrega un tipo nuevo de disparador (por ejemplo, funciones de Storage o de Auth), Firebase
  puede necesitar otorgar permisos a cuentas internas de Google la primera vez. Si el deploy automático falla por
  eso, publique esa vez desde una computadora con `firebase deploy` (cuenta de dueño) y después el automático sigue funcionando.
