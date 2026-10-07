# Astro

Asistente de escritorio que flota sobre la pantalla (una gota 3D con personalidad) y habla con **Claude Code** usando tu instalación local de `claude`.

## Arrancar

```bash
pnpm install
pnpm start
```

- **Llamar a Astro:** `Ctrl+Shift+Espacio`, clic sobre la gota o el icono de la bandeja.
- **Escribir:** Enter envía, Shift+Enter hace salto de línea, Esc cierra.
- **Gestos:** arrastrar la gota la hace girar; mantener pulsado = mimos; varios clics seguidos la marean. Si pasa 1 minuto sin actividad, se duerme.
- **Minimizar:** botón de gota en la barra (al pasar el ratón) o menú de la bandeja. Clic en la gota para que vuelva.

## Sesiones

Cada sesión es una conversación independiente con Claude Code: tiene su color, sus nubes, sus ayudantes y su historial. Una sesión puede seguir trabajando mientras está detrás.

- **Crear:** botón `+` de la barra o `Alt+N`. La gota se estira y se divide; la nueva pasa al frente con la pregunta abierta. Máximo 6.
- **Cambiar:** clic en una gota pequeña de atrás, en su chip (al pasar el ratón sobre Astro) o `Alt+1…6`.
- **Avisos:** si una sesión de atrás termina, su gota salta y muestra un globo («Sesión · Listo / Error / Pregunta»). Clic en el globo para traerla al frente.
- **Nombre:** la primera pregunta de una sesión nueva le da nombre.
- **Cerrar:** `×` en su chip; la gota vuelve y se funde con la principal.

## Ayudantes

Cuando Claude divide una tarea grande, cada ayudante sale de la gota como una mini-gota de color que orbita mientras trabaja. Astro pone cara concentrada y los va mirando. Si uno falla, su mini-gota se vuelve gris y Astro se preocupa. La lista con el estado de cada uno aparece en una nube; clic en un ayudante (en la lista o en su mini-gota) para ver lo que está haciendo.

## Modo de prueba

`ASTRO_DEBUG=1 pnpm start` muestra los mensajes de la interfaz en la terminal y expone `astroDebug` en la consola de la ventana (`newSession()`, `fakeAgents(conError, indiceSesion)`, `say(texto)`) para ensayar animaciones sin gastar llamadas a Claude.

## Configuración (`astro.config.json`)

| Campo | Qué hace |
|---|---|
| `shortcut` | Atajo global para llamar a Astro. |
| `workingDirectory` | Carpeta donde trabaja Claude Code. Vacío = tu carpeta de usuario. |
| `model` | Modelo para `claude --model` (`sonnet`, `opus`, `haiku`…). |
| `allowedTools` | Herramientas que Claude Code puede usar sin preguntar. Por defecto solo lectura y web. Añade `Edit`, `Write` o `Bash` si quieres que Astro cambie archivos o ejecute comandos. |
| `permissionMode` | Modo de permisos de Claude Code (`default`, `acceptEdits`, `plan`…). |
| `notifyPort` | Puerto local donde Astro recibe avisos de otras sesiones. |

Reinicia Astro tras cambiar la configuración.

## Avisos de tareas terminadas

Para que Astro te avise cuando **cualquier** sesión de Claude Code termina o necesita tu atención, añade estos hooks a `~/.claude/settings.json` (ajusta la ruta):

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"C:/ruta/a/astro-bot/hooks/astro-notify.js\"" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "node \"C:/ruta/a/astro-bot/hooks/astro-notify.js\"" }] }
    ]
  }
}
```

Las llamadas que hace el propio Astro no generan avisos (el hook las ignora).

## Estructura

- `main.js` — ventana transparente, atajo, bandeja, puente con Claude Code.
- `src/claude.js` — ejecuta `claude -p` con salida en streaming y respuesta estructurada.
- `src/prompts.js` — personalidad de Astro y formato de respuesta.
- `src/notify-server.js` + `hooks/astro-notify.js` — avisos de otras sesiones.
- `renderer/gota.js` — el personaje 3D.
- `renderer/app.js` — nubes, hojas, ayudantes y ajustes.
