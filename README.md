# Astro

Asistente de escritorio que flota sobre la pantalla (una gota 3D con personalidad) y habla con **Claude Code** usando tu instalación local de `claude`. Funciona en Windows y macOS.

## Requisitos

- Claude Code instalado y con la sesión iniciada (prueba `claude` en una terminal).
- Node.js 22 o superior y pnpm.

## Arrancar

```bash
pnpm install
pnpm start
```

Astro abre una sola vez: si ya está abierto y lo vuelves a lanzar (otra vez el ejecutable o `pnpm start`), la copia nueva se cierra al instante y la que ya estaba se muestra con la pregunta abierta.

- **Llamar a Astro:** `Ctrl+Shift+Espacio` (`⌘⇧Espacio` en Mac), clic sobre la gota o el icono de la bandeja. Con varias pantallas, Astro aparece en la que tiene el cursor.
- **Escribir:** Enter envía, Shift+Enter hace salto de línea, Esc cierra.
- **Detener:** el botón ■ de la nube de «pensando» o de la lista de ayudantes corta todo lo que esté haciendo la sesión.
- **Gestos:** arrastrar la gota la hace girar; mantener pulsado = mimos; varios clics seguidos la marean. Si pasa 1 minuto sin actividad, se duerme.
- **Minimizar:** botón de gota en la barra (al pasar el ratón) o menú de la bandeja. Clic en la gota para que vuelva.

Cada sesión reutiliza un mismo proceso de Claude Code en lugar de lanzar el CLI en cada pregunta. Como cada proceso ocupa unos 400 MB, Astro no deja ninguno esperando: lo arranca al abrir la pregunta (mientras escribes) y lo cierra tras unos minutos sin uso; la conversación se reanuda sola.

## Comandos /

Escribe `/` en la pregunta para ver los comandos de Claude Code: los de serie (`/context`, `/usage`, `/compact`, `/model`…), tus skills y los de tus plugins, con su descripción (la de cada skill se lee de su archivo). También busca por la descripción a partir de 3 letras. Flechas para elegir, Tab o Enter para completar, Esc para cerrar el menú.

- **`/clear`** lo hace Astro (también el botón ↻): pide confirmación antes de empezar de cero. La conversación no se borra: queda guardada y se puede retomar con `/resume`.
- **`/resume`** lo hace Astro (también el botón del reloj o «Retomar una conversación…» en la bandeja): lista las conversaciones guardadas de la carpeta de trabajo, de Astro y de la terminal, y retoma la que elijas en la sesión activa, mostrando tu última pregunta y la última respuesta.
- **Informes** como `/context` o `/usage`: resumen en la nube y el informe completo en las hojas.
- **`/model sonnet|opus|haiku`** cambia el modelo solo para esa sesión.
- **Skills y comandos de plugins** responden como una pregunta normal.

La lista sale de lo que anuncia Claude Code y se actualiza sola. Se ocultan los que solo tienen sentido en la terminal, los de pago (`/ultrareview`) y los que crean tareas recurrentes (`/loop`, `/schedule`).

## Compilar un ejecutable

```bash
pnpm dist        # Windows: dist/Astro-Setup-<versión>.exe
pnpm dist:mac    # macOS (hay que ejecutarlo en un Mac): dist/Astro-<versión>.dmg
```

El instalador de Windows se instala para el usuario actual en `%LOCALAPPDATA%\Programs\astro-bot`, sin pedir permisos de administrador, y crea accesos directos en el escritorio y en el menú Inicio. Pesa unos 100 MB porque lleva Electron (Chromium) dentro.

En la versión instalada:

- **Comando `astro`:** el instalador añade al PATH de tu usuario la carpeta `bin` de Astro (solo contiene `astro.cmd`), así que puedes abrirlo escribiendo `astro` en cualquier terminal nueva; si ya está abierto, se muestra. En los dos casos se coloca en la carpeta desde la que lo llamaste (ver [Carpeta de trabajo](#carpeta-de-trabajo)). El desinstalador quita esa entrada y deja el resto del PATH como estaba.
- **Configuración:** está en `%APPDATA%\Astro\astro.config.json` y se crea en el primer arranque. Se abre desde la bandeja con *Abrir configuración*.
- **Avisos:** el comando del hook se copia desde la bandeja con *Copiar comando de avisos (hooks)*; pégalo en `~/.claude/settings.json` como se explica en [Avisos de tareas terminadas](#avisos-de-tareas-terminadas).
- **Firma:** el instalador no está firmado, así que la primera vez Windows SmartScreen avisa de que es de un editor desconocido (*Más información → Ejecutar de todas formas*). Para quitar el aviso hace falta firmarlo con un certificado de firma de código.

Para publicar una versión nueva, sube el número de `version` en `package.json` y vuelve a compilar.

## Carpeta de trabajo

Cada sesión trabaja en una carpeta: ahí lee Claude el proyecto (su `CLAUDE.md`, skills y comandos) y ahí se guardan sus conversaciones, junto a las que abras con `claude` en esa misma carpeta. Si no eliges ninguna, es la de `workingDirectory` en la configuración (por defecto, tu carpeta de usuario), como siempre.

- **Desde la terminal:** escribe `astro` dentro de tu proyecto. Si una sesión ya trabaja en esa carpeta, Astro cambia a ella; si no, la sesión principal pasa a esa carpeta, siempre que no esté haciendo nada; si está ocupada, se abre una sesión nueva allí.
- **Desde Astro:** el botón «📁 carpeta ▾» encima de la pregunta muestra la carpeta de la sesión y deja volver a la de siempre, elegir una reciente u otra cualquiera.
- **Cambiar de carpeta empieza una conversación nueva.** La anterior queda guardada en su carpeta y se retoma desde allí con `/resume`. Si la sesión ya tiene conversación, Astro pide confirmación (salvo al llamarlo con `astro`, que ya es una petición explícita).
- Una sesión nueva empieza en la carpeta de la sesión activa. Al cerrar y volver a abrir Astro, empieza en la carpeta de siempre; solo se recuerdan las recientes.

## Permisos

Claude solo usa sin preguntar las herramientas de `allowedTools` (por defecto, leer, buscar y la web). Si para responder intenta otra, por ejemplo editar un archivo o ejecutar un comando, Astro muestra un aviso con lo que quiso hacer («✏️ Editar archivos `main.js`», «💻 Ejecutar comandos `pnpm test`»):

- **Permitir y seguir:** la herramienta se añade a `allowedTools` en tu configuración y Claude continúa donde se quedó, sin perder la conversación. Vale para todas las sesiones y carpetas. Si la herramienta puede cambiar cosas en tu equipo, el aviso lo dice y se marca en rojo.
- **No, gracias:** no cambia nada.
- **Quitar un permiso:** en Ajustes → *Claude puede usar sin preguntar*, pulsa la × de la herramienta.

## Sesiones

Cada sesión es una conversación independiente con Claude Code: tiene su color, sus nubes, sus ayudantes y su historial. Una sesión puede seguir trabajando mientras está detrás.

- **Crear:** botón `+` de la barra, `Alt+N` o el menú de la bandeja. La gota se estira y se divide; la nueva pasa al frente con la pregunta abierta. Máximo 6.
- **Cambiar:** clic en una gota pequeña de atrás, en su chip (al pasar el ratón sobre Astro) o `Alt+1…6`.
- **Avisos:** si una sesión de atrás termina, su gota salta y muestra un globo («Sesión · Listo / Error / Pregunta»). Clic en el globo para traerla al frente.
- **Nombre:** la primera pregunta de una sesión nueva le da nombre.
- **Reiniciar:** botón ↻ de la barra o menú de la bandeja; pide confirmación y empieza la conversación de cero.
- **Cerrar:** `×` en su chip; la gota vuelve y se funde con la principal.

## Ayudantes

Cuando Claude divide una tarea grande, cada ayudante sale de la gota como una mini-gota de color que orbita mientras trabaja. Astro pone cara concentrada y los va mirando. Si uno falla, su mini-gota se vuelve gris y Astro se preocupa. La lista con el estado de cada uno aparece en una nube; clic en un ayudante (en la lista o en su mini-gota) para ver lo que está haciendo.

## Capturas de pantalla

Cuando haces una captura (`Win+Shift+S`, `Impr Pant`, o `⌘⇧3/4/5` en Mac), Astro la ve y te la ofrece en una nube: **Preguntar sobre ella** abre la pregunta con la captura adjunta, y **Descartar** la olvida. La imagen solo sale de tu equipo si envías la pregunta; si cierras la pregunta, la descartas o no haces nada en 90 segundos, se borra de la memoria. Nunca se guarda en disco.

Astro detecta las capturas por dos vías: la carpeta donde el sistema las guarda (en Windows la lee del registro, aunque esté movida a otra unidad u OneDrive) y el portapapeles. Se puede apagar en *Ajustes* o en el menú de la bandeja.

## Ajustes

Botón ⚙ de la barra que aparece al pasar el ratón sobre Astro:

- **Color de esta sesión**, **posición** (izquierda o derecha) y **tema** (automático, claro u oscuro).
- **Accesorio:** gorro de Navidad, manta de fantasma, capa de vampiro, sombrero de bruja, de fiesta o de vaquero. Cada uno tiene su reacción; las puntas de los gorros se balancean al moverse.
- **Cajas:** *Glass* (por defecto) hace las nubes, la barra y el panel lateral translúcidos con reflejos en el borde; *Sólido* las deja opacas. La ventana de Astro es transparente, así que el vidrio no puede desenfocar el escritorio que hay detrás. El panel de Ajustes siempre es sólido.
- **Siempre encima de las ventanas:** por defecto Astro flota sobre todo. Si lo apagas, queda detrás de las ventanas que uses y vuelve al frente al llamarlo o al detectar una captura.
- **Detectar capturas de pantalla.**

Las dos últimas también están en el menú de la bandeja, y todos los ajustes se recuerdan entre arranques.

## Actitudes

| Situación | Reacción |
|---|---|
| 20 s sin actividad cerca | Se aburre: mira a los lados y dice «¿Hacemos algo?» |
| 5 s antes de dormirse | Bosteza |
| Ratón encima más de 3,5 s | Se pone tímido y aparta la mirada |
| Seleccionar texto en las nubes o en las hojas | Lo mira; si es en las hojas, lo comenta |
| Scroll | Sigue el desplazamiento con la mirada; si es muy rápido, se marea |
| Tres vueltas con el ratón alrededor | Se marea |
| Escribir muy rápido | Se emociona |
| Un cumplido corto («eres lindo», «te quiero») | Ojos de corazón; al tercero presume |
| Volver al computador tras 5 min sin usarlo | «¡Volviste! Te extrañé» |

## macOS

Funciona igual que en Windows (`pnpm install` y `pnpm start`), con estas diferencias:

- **Atajos:** `⌘⇧Espacio` para llamar a Astro; las sesiones usan `⌥N` y `⌥1…6`.
- **Barra de menús:** Astro vive en la barra de menús, sin icono en el Dock, y flota también sobre apps a pantalla completa y en todos los escritorios.
- **Capturas:** detecta las de `⌘⇧3`, `⌘⇧4` y `⌘⇧5` en la carpeta elegida en la app Captura de pantalla (por defecto, el Escritorio; ahí solo cuentan los archivos con nombre de captura) y las que van al portapapeles (`⌃⌘⇧4`). No hace falta el permiso de grabación de pantalla.
- **Claude Code:** si abres Astro desde el Finder, toma el PATH de tu shell de login y busca `claude` en `~/.local/bin`, Homebrew, etc. Si aun así no lo encuentra, pon la ruta en `claudePath`.

Para distribuirlo como `.app` hay que empaquetarlo en un Mac (por ejemplo con electron-builder) y firmarlo y notarizarlo con una cuenta de Apple Developer; si no, macOS lo bloquea al abrirlo.

## Configuración (`astro.config.json`)

| Campo | Qué hace |
|---|---|
| `shortcut` | Atajo global para llamar a Astro. |
| `workingDirectory` | Carpeta de siempre: la que usa cada sesión si no eliges otra. Vacío = tu carpeta de usuario. |
| `model` | Modelo para `claude --model` (`sonnet`, `opus`, `haiku`…). |
| `claudePath` | Comando o ruta de Claude Code (`claude`, `claude.exe`, un `claude.cmd` de npm o su `cli.js`). |
| `allowedTools` | Herramientas que Claude Code puede usar sin preguntar. Por defecto solo lectura y web. Astro las amplía cuando lo permites desde su aviso (ver [Permisos](#permisos)); también puedes editarlas aquí, por ejemplo `Edit`, `Write`, `Bash` o `Bash(pnpm test:*)`. |
| `permissionMode` | Modo de permisos de Claude Code (`default`, `acceptEdits`, `plan`…). |
| `notifyPort` | Puerto local donde Astro recibe avisos de otras sesiones. |
| `warmPool` | Arranca Claude Code al abrir la pregunta, mientras escribes, para que la respuesta no espere al CLI. |
| `idleMinutes` | Minutos sin uso tras los que se cierra el proceso de una sesión (por defecto 5; la conversación se reanuda sola después). Cada proceso ocupa unos 400 MB. |

En el ejecutable instalado, este archivo está en `%APPDATA%\Astro\astro.config.json` (bandeja → *Abrir configuración*). Reinicia Astro tras cambiar la configuración.

## Avisos de tareas terminadas

Para que Astro te avise cuando **cualquier** sesión de Claude Code termina o necesita tu atención, añade estos hooks a `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"<RUTA-DE-ASTRO>/hooks/astro-notify.js\"" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "node \"<RUTA-DE-ASTRO>/hooks/astro-notify.js\"" }] }
    ]
  }
}
```

Sustituye `<RUTA-DE-ASTRO>` por la carpeta de este proyecto (con `/`). Con Astro instalado, usa el menú de la bandeja *Copiar comando de avisos (hooks)*, que ya trae la ruta correcta. El hook no necesita más configuración: al arrancar, Astro guarda el puerto y un token que cambia en cada arranque en `~/.astro/notify.json`, y el hook los lee de ahí. Si Astro no está abierto, el hook no hace nada.

Las llamadas que hace el propio Astro no generan avisos (el hook las ignora).

## Desarrollo

| Comando | Qué hace |
|---|---|
| `pnpm test` | Pruebas con `node --test`. No llaman a Claude: usan un `claude` falso (`test/fixtures/fake-claude.js`). |
| `pnpm lint` / `pnpm lint:fix` | Revisa (y corrige lo automático) con ESLint. |
| `pnpm check` | Lint y pruebas, lo mismo que la CI de GitHub en Windows, macOS y Linux. |
| `pnpm dist` | Compila el instalador de Windows en `dist/` (ver [Compilar un ejecutable](#compilar-un-ejecutable)). |

**Modo de prueba:** `ASTRO_DEBUG=1 pnpm start` muestra los mensajes de la interfaz en la terminal y expone `astroDebug` en la consola de la ventana (`newSession()`, `fakeAgents(conError, indiceSesion)`, `say(texto)`, `thinking(estado)`) para ensayar animaciones sin gastar llamadas a Claude. `ASTRO_SCREENSHOTS_DIR=<carpeta>` cambia la carpeta de capturas vigilada.

## Estructura

- `main.js` — ventana transparente, instancia única, atajo, bandeja, puente con Claude Code.
- `preload.js` — API mínima y segura entre la ventana y el proceso principal.
- `src/claude.js` — mantiene un proceso `claude -p` vivo por sesión (entrada y salida en streaming), con reanudación automática y procesos precalentados.
- `src/claude-bin.js` — localiza el ejecutable de Claude Code (`.exe`, `.cmd` de npm, Homebrew, `~/.local/bin`…).
- `src/shell-path.js` — PATH del shell de login en macOS.
- `src/prompts.js` — personalidad de Astro y formato de respuesta.
- `src/commands.js` + `renderer/slash.js` — comandos / (qué se muestra, menú y respuestas).
- `src/captures.js` + `src/screenshot-dir.js` — detección de capturas de pantalla (carpeta del sistema y portapapeles).
- `src/prefs.js` — preferencias que se cambian desde la app (siempre encima, detectar capturas).
- `src/notify-server.js` + `src/runtime-info.js` + `hooks/astro-notify.js` — avisos de otras sesiones.
- `src/icon.js` — icono de la bandeja, generado sin archivos.
- `renderer/gota.js` — el personaje 3D.
- `renderer/app.js` — nubes, sesiones, hojas, ayudantes, capturas y ajustes.
- `renderer/markdown.js` — markdown simple y reparto en hojas.
- `renderer/keys.js` — atajos escritos como en cada sistema (Ctrl/⌘).
- `test/` — pruebas con `node --test`.
