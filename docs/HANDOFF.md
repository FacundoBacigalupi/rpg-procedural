# Handoff: cómo se trabaja y cómo retomar

Pensado para que otra herramienta (Codex, Claude Code en la nube, otra sesión) retome **sin la conversación**. Dos fuentes, no más:

- **Qué hacer:** [ROADMAP.md](ROADMAP.md), sección «Ahora» y los `[ ]` de la fase actual.
- **Cómo hacerlo y en qué está cada línea:** este archivo. Se actualiza en cada integración (tabla de estado en §8).

**Para Codex:** [AGENTS.md](../AGENTS.md) carga las instrucciones del repositorio;
[CODEX_MEMORY.md](CODEX_MEMORY.md) conserva el contexto, el mapa de los 46 sistemas
y la adaptación del flujo de Claude Code. No reemplaza ROADMAP ni el estado de
este handoff. Preparación del 2026-10-10: documentación, sin avance de Fase 3.

## 1. Retomar en 5 pasos
1. `git fetch` y leer la tabla de estado (§8): qué ramas/PR hay abiertos y quién los tiene.
2. `git worktree list`, `git branch -a`, `gh pr list`: lo que no esté en la tabla es sospechoso (ramas sueltas = o se integran o se borran, §6).
3. Leer «Ahora» del ROADMAP y el doc de sistema del ítem ([CLAUDE.md](../CLAUDE.md) los lista).
4. Elegir el trabajo: terminar lo que está a medio camino (§8) y después el primer `[ ]` no bloqueado.
5. Trabajar según §2-§5. Al cerrar, actualizar ROADMAP y §8 en el mismo PR.

## 2. Roles
**Método compartido vigente (Claude y Codex, pedido del usuario, 2026-10-20):**
estas reglas y §5 prevalecen sobre recetas históricas contradictorias.

- Cada lote tiene alcance, resultado observable, criterios de cierre y base SHA.
  Priorizar cerrar conexiones viables de la fase antes de abrir otro sistema.
- Límite: un lote en revisión/integración y, como máximo, un lote siguiente en
  preparación sobre base estable. Si se acumulan fallos, conflictos o revisión,
  los agentes ayudan a resolverlos y no abren más frentes. El máximo de agentes
  disponibles no es una meta de ocupación.
- Reutilizar agentes por tema cuando haya trabajo independiente y capacidad de
  revisión. El coordinador integra y mantiene docs compartidos. Un commit por
  ítem; no terminar la sesión solo por cerrar uno.
- Distinguir en cada cierre: núcleo puro, cableado opt-in y comportamiento
  observado en integración. Registrar pendientes con nombre y fase; no declarar
  terminado un sistema por disponer solo de funciones aisladas.
- Medir por lote base/final SHA, resultado probado, retrabajo y duración de
  verificación/integración cuando esté disponible; no inventar tiempos ni usar
  cantidad de commits o checkboxes como medida suficiente de avance.
- ROADMAP «Ahora» conserva solo prioridad y siguiente trabajo. §8 comienza con
  un único estado vigente: ramas, cambios, validación y bloqueo. Archivar los
  estados reemplazados; no copiarlos a la memoria ni releer todo el histórico.

### Receta anterior (contexto; aplicar las reglas vigentes superiores)
**Método vigente para Codex (pedido del usuario, 2026-10-10):** la sesión principal coordina continuamente. Los subagentes conservan su línea temática y reciben nuevas tareas al terminar, incluso mientras el coordinador verifica e integra el lote anterior. El cierre de un ítem no termina la sesión. Pruebas con LLM solo cuando el cambio toque parser, narración o sus contratos. Reemplaza la antigua regla de una sesión por ítem.

- **Coordinador** (una sesión): agrupa ítems de la fase vigente en lotes temáticos, despacha agentes, integra ramas, corre la suite y mantiene «Ahora» y §8. Es el único que corre tests amplios y mergea.
- **Agentes** (hasta 3, uno por worktree `C:\dev\rpg-procedural-wt\<slot>`, slots `v`, `w`, `x`): implementan un cluster, **un commit por ítem**, cada ítem cerrado `[x]` en el ROADMAP (lo no hecho pasa a `[ ]` con nombre). No tocan «Ahora» ni este archivo, no hacen push, PR ni merge.
- Sin Codex/Claude en paralelo, una sola sesión puede hacer los dos roles: elegir un cluster, hacerlo en un worktree e integrarlo.

## 3. Ahorro de tokens
- Modelo por tarea: **Sonnet** para código de sim; **Haiku** para docs, ROADMAP, limpieza de ramas y lo mecánico; el coordinador hace solo lo chico.
- Un agente toma varios ítems del mismo tema (mismo contexto). Reutilizarlo con `SendMessage` en vez de abrir otro.
- Brief corto (plantilla en §4), reporte de máximo 10 líneas. Sin agentes Explore/Plan.
- Sin polling: esperar las notificaciones. Revisar por `git diff --stat`, no leyendo archivos enteros.

## 4. Plantilla de brief para un agente
```
Proyecto rpg-procedural. Trabajá en C:\dev\rpg-procedural-wt\<slot>. Leé CLAUDE.md, docs/HANDOFF.md,
«Cómo se trabaja» del ROADMAP y el doc de sistema <doc>.
Arranque: git fetch -q y git checkout -q -B feat/<nombre> origin/develop. No toques node_modules.
TAREA: <ítems de la fase N del ROADMAP, en orden>. Partí en sub-ítems [ ] si no entra. Un commit por ítem,
cada uno [x] con una frase y lo no hecho como [ ] con nombre. No edites «Ahora» ni HANDOFF.md.
REGLAS: NO corras la suite (solo typecheck, lint, format y 1-2 tests puros del módulo). Solo Edit/Write
(sin Python ni sed), LF. Sim determinista. Commits Conventional con trailer Co-Authored-By. Sin push/PR/merge.
Reporte final corto (máx 10 líneas): commits, qué quedó [ ], qué tests corriste.
```

## 5. Tests e integración
**Verificación vigente (2026-10-20):** un solo trabajo pesado a la vez.
Agentes: pruebas puntuales del contrato modificado. Coordinador: typecheck,
lint y tests afectados sobre el código integrado; si cambia RNG/hashes o se
agrega un proceso, incluir game, scheduler y persistence. Ejecutar `npm run
check` al certificar un lote de integración, al cerrar una fase y tras cambios
transversales; no repetirlo por cada commit del mismo lote ya cubierto. Docs
solos: diff, enlaces y LF. Corridas largas para calibración, conservación o
rendimiento según el criterio de cierre, no por rutina. LLM real solo para
parser, narración o sus contratos. Registrar SHA de código, comando, resultado,
log y exit nativo; cambios posteriores requieren la verificación pertinente.
La receta histórica siguiente no exige duplicar checks ya cubiertos.

**Tests:** los agentes no corren la suite. El coordinador ejecuta una sola corrida por vez, desde un worktree (en Windows, unidad en mayúscula), según el criterio vigente anterior.

**Integrar una rama, un comando por llamada de shell (sin `;`, `&&` ni pipes entre pasos):**
1. `git rebase origin/develop` en el worktree.
2. `npm run typecheck` (0 errores) y `npm run lint` (sin errores; warnings/infos se ignoran).
3. `npx vitest run <archivos o carpetas tocadas>`; si la rama agrega un proceso al mundo o cambia RNG/hashes, sumar `src/game`, `src/sim/scheduler` y `src/persistence`.
4. `git push -q -u origin HEAD`.
5. Crear PR a `develop` con problema, resultado y validación real del lote, incluyendo límites. Usar `--body-file` para texto multilínea; label `feature` o `bug` según corresponda. No copiar firmas ni atribuciones de otra herramienta.
6. `gh pr merge <n> --squash` (sin `--delete-branch`: hay worktrees; el remoto borra la rama solo).
7. Commits Conventional Commits, sin atribuciones de otras herramientas.

**Permisos:** `git rebase`, `git push` y `git push origin --delete` están permitidos en los settings, pero solo funcionan como **un comando suelto por llamada**. Encadenar con `;`, `&&` o en lote hace que el clasificador los bloquee.

## 6. Ramas y cierre de fase
- Solo existen `develop` y `main` de forma permanente. Toda rama mergeada se borra (local con `git branch -D`; el remoto la borra solo al mergear). Las ramas de slot (`feat/...` en `v`, `w`, `x`) son temporales: al terminar el trabajo se integran o se borran.
- Para saber si una rama squash-mergeada está integrada: `gh pr list --state all --head <rama>` (con squash, `git branch --merged` no sirve).
- **Cerrar una fase:** cuando no quedan `[ ]` posibles, lo bloqueado pasa a la fase siguiente prefijado `Heredado de Fase N:`; después PR `develop` → `main`, `gh pr merge <n> --merge --auto` y tag `v0.<fase>.<n>` sobre el merge commit ([GIT_WORKFLOW.md](GIT_WORKFLOW.md)). Cada paso como comando suelto.

## 7. Reglas técnicas que muerden
- Editar con Edit/Write, no con Python en modo texto ni `sed` (LF siempre; `npm run format` arregla).
- `**` está prohibido en la sim: usar `pow` de `core/math`.
- Todo componente que un proceso escribe va en `writes`/`reads`; dos procesos en la misma fase no pueden escribir lo mismo (`SchedulerError`). Los procesos `onEvent` solo disparan en `perceive`.
- `export *` duplicado rompe `tsc`; tipos de contenido en `CONTENT_KINDS`; verbo nuevo = actualizar listas en `skills.test.ts`/`actions.test.ts` y `percept.action.<verb>` en `content/llm/templates/es.json`.
- El `node_modules` de los worktrees `v`, `w`, `x` es un junction al del repo principal: **no** borrar un worktree sin quitar antes el junction (`cmd /c rmdir node_modules`), o se vacía el principal (arreglo: `npm ci` en `C:\dev\rpg-procedural`).
- En la ruta de Windows usar `C:\dev\...` con unidad en mayúscula para Vitest.

## 8. Estado de las líneas de trabajo
**Estado vigente (2026-10-20, Claude/Codex; lote social y funerario en verificación):**
base `5f45bb6` (#650), rama coordinadora `feat/f3-social-continuity`.
Núcleos de gastos funerarios y productos de culto integrados, sucesión opt-in
`bandits.succession`, puente `council.issues.bandits` desde recuerdos conocidos,
y reserva de saldos entre prácticas diarias de ofrendas. Sin cambios de motor,
defaults ni contenido global. El taller de culto requiere paquete opcional y
registro persistido de lotes; diseño en crafts y pendientes 2a/2b del ROADMAP.
La defensa del consejo todavía no ejecuta guardias: agenda y deliberación no
equivalen a una orden materializada. Percepción de asaltos y defensa tienen
pendientes independientes.

Verificación intermedia `social-continuity-check-2` sobre código hasta `08de244`
(solo docs posteriores durante la corrida): typecheck y lint pasaron;
3223 tests aprobados, uno falló en `tools/sim/repro.test.ts` por fixture sin
`heardClaims`. Fix `8c26d18`, 25 tests puntuales de repro/narration aprobados.
Ese check no certifica el puente de consejo `3e32262` ni el cableado funerario
posterior. Logs/exit nativo en `sim-reports/social-continuity-*.log/.exit`.
Los reportes previos de `.claude/worktrees/` y nuevos worktrees en `.worktrees/`
se conservan; exclusión local en `.git/info/exclude` para que el lint no revise
reportes ni copias del código. No borrar directorios ni junctions.

[Estados anteriores y resultados históricos](history/handoff-through-2026-10-17.md).

Código actual: `c9976b8`, incluye cableado funerario `9272a50` y recuerdos de
asaltos para testigos NPC `c9976b8`, aún sin check final certificado.
Git fetch y consulta de PR exitosos con permisos ampliados el 2026-10-20;
único PR abierto observado: #651 (dependencias, fuera de este lote).
Siguiente: resolver fallos de tipos del check final y certificar el lote.
