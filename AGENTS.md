# Instrucciones de Codex para rpg-procedural

Conversación y documentación en español; código e identificadores en inglés.
Proyecto personal de un solo jugador. Priorizar profundidad, realismo y causalidad;
resolver la escala con LOD, sin recortar el diseño para hacer una demo.

## Inicio de cada sesión

1. Leer `CLAUDE.md`, `docs/HANDOFF.md` y «Ahora» / «Cómo se trabaja» de
   `docs/ROADMAP.md`. Leer `docs/CODEX_MEMORY.md` para el contexto y la adaptación
   del flujo de Claude Code. Esa memoria es una instantánea, no un backlog.
2. Consultar `git status`, `git worktree list`, `git branch -a` y, si está
   disponible, `gh pr list`. Verificar el estado real antes de actuar.
3. Leer `docs/ARCHITECTURE.md` y el doc del sistema antes de modificarlo.
   Antes de tocar sim/worldgen, leer también `docs/systems/causality.md`.
4. «Continuá» significa retomar trabajo incompleto y después el primer `[ ]`
   no bloqueado de la fase indicada en «Ahora». No elegir otra fase por comodidad.

## Fuentes y reglas

- ROADMAP decide qué hacer; HANDOFF decide cómo y registra el estado de las líneas.
  ARCHITECTURE manda sobre tipos compartidos y dueños; los docs de sistema definen
  el diseño. La sección fechada más reciente describe el método operativo actual.
- Método vigente por pedido del usuario (2026-10-10): la sesión principal es
  coordinadora continua. Los subagentes encadenan ítems del mismo tema/contexto;
  al terminar reciben nuevas tareas mientras el coordinador revisa, prueba e
  integra el lote. Reutilizar agentes en vez de recrear su contexto. No terminar
  el trabajo por cerrar un ítem: continuar hasta que el usuario pare o exista un
  bloqueo real. Si un ítem no entra, partirlo antes de implementar. Cada `[x]`
  explica lo terminado; cualquier
  parte pendiente debe ser otro `[ ]` con nombre y fase, nunca «queda X» suelto.
- Núcleo puro primero, cableado después; en Fase 3, nuevas funciones opt-in.
  No activar opciones por defecto ni cambiar hashes dorados como trámite.
- El LLM solo interpreta intenciones y verbaliza resultados. No crea entidades,
  resuelve acciones ni modifica estado. Narración y paneles usan `PlayerView` y
  creencias; la crónica final tiene la excepción documentada para leer la verdad.
- Mismo seed + mismos planes validados = mismo estado, también en Windows/Linux.
  Sim/worldgen sin IO, `Date`, `Math.random`, trascendentes de `Math` ni `**`.
  Usar `core/rng`, `core/math`, claves estables y orden canónico.
- Entidades con origen, eventos con causas, bienes/dinero/esencia/almas conservados.
  Azar solo entre posibilidades existentes; historia y juego son el mismo motor.
- Respetar capas y exports `index.ts`. Efectos cruzados por diffs/eventos del
  scheduler; declarar `reads`/`writes` sin segundos escritores de una misma fase.
  `onEvent` entrega eventos recientes en `perceive`; otras fases necesitan
  `withRecent` según su contrato. Ver HANDOFF para los dos cableados pendientes.
- Datos en `content/` con Zod, tipos en `CONTENT_KINDS`. Verbo nuevo exige revisar
  catálogo, listas de tests y `percept.action.<verb>` en las plantillas españolas.
- Editar con `apply_patch` o herramienta equivalente, UTF-8 y LF. Sin Python en
  modo texto ni sed para editar. Buscar con `rg`; leer por secciones para evitar
  truncar el ROADMAP y gastar contexto.

## Coordinación y verificación

- Si el usuario pide trabajar como Claude Code con agentes, delegar ítems
  independientes en worktrees: un coordinador y tantos agentes como permita la
  sesión. No asumir que cuatro agentes hijos caben en todos los clientes.
- Cada agente recibe alcance, worktree, doc, pruebas y criterios de cierre.
  Un commit por ítem; sin push/PR/merge, sin editar «Ahora» ni HANDOFF y sin suite
  amplia. Reporte máximo 10 líneas. Reutilizar agentes; esperar notificaciones.
- Mantener tareas de contexto similar en cada agente. Mientras se verifica un
  lote integrado, asignarles el siguiente trabajo sobre su base estable; integrar
  esos cambios después. Probar con el LLM del juego cuando cambien parser,
  narración o sus contratos; no gastar inferencias en cambios puramente de sim.
- El coordinador integra, resuelve docs compartidos, revisa y ejecuta una sola
  corrida amplia por vez. No correr suites pesadas simultáneas: compiten con el
  LLM local residente. Tests puntuales para agentes; typecheck/lint y suite amplia
  al integrar código; `npm run check` cada ~2 lotes y al cerrar una fase.
- Si cambia RNG, hashes o se agrega un proceso, cubrir game, scheduler y persistence.
  No afirmar que una prueba pasó si no se ejecutó. Docs sin código no requieren
  ejecutar la simulación completa; revisar diff, enlaces y finales de línea.
- Node 24 y npm: en PowerShell usar `npm.cmd`, `npx.cmd`, `codex.cmd` si los wrappers
  `.ps1` están bloqueados. Cwd con `C:` mayúscula para Vitest.
- Si se redirige la salida de npm/npx a un log en PowerShell, conservar y devolver
  `$LASTEXITCODE` explícitamente. Los notices por stderr pueden dejar `$?` en false
  aun con exit code nativo 0; verificar el reporte y el código nativo.

## Git y continuidad

- Autorización permanente del usuario (2026-10-10), limitada a
  `FacundoBacigalupi/rpg-procedural`: crear ramas, hacer commits y push, abrir y
  actualizar PRs, y mergearlas sin pedir confirmación por cada operación.
  A `develop`, squash después de las verificaciones correspondientes; a `main`,
  desde `develop` al cerrar fases o hitos según ROADMAP/HANDOFF, con merge commit,
  CI aprobado y tag. Incluye integrar #440 y #441. Esta autorización no elimina
  los límites técnicos del entorno ni autoriza saltarse checks o rulesets.
- Ramas de trabajo desde develop; nunca commits directos a main/develop.
  Conventional Commits. PR a develop con squash; cierre de fase a main con merge
  commit, CI y tag. Cada operación Git de integración en una llamada separada.
- El flujo escrito no extiende los permisos de la sesión. No publicar ni integrar
  cambios externos por una mera solicitud de lectura/memoria. Respetar el alcance
  del pedido actual y las autorizaciones que el usuario ya haya dado.
- Para Codex no copiar la firma de Claude ni atribución Anthropic. La descripción
  de PR debe explicar problema, resultado y validación real.
- No borrar worktrees/junctions automáticamente. Antes de limpieza, verificar
  rutas, cambios y commits; `node_modules` puede apuntar al repositorio principal.
  Las rutas `C:\dev\rpg-procedural-wt` pueden necesitar permisos de escritura
  adicionales; usar un worktree dentro del workspace si corresponde.
- Al cerrar implementación, actualizar ROADMAP, doc relevante y HANDOFF en el
  mismo PR. La memoria no reemplaza esas fuentes ni guarda progreso duplicado.
