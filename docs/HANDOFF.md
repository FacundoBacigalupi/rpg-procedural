# Handoff: cómo se trabaja y cómo retomar

Pensado para que otra herramienta (Codex, Claude Code en la nube, otra sesión) retome **sin la conversación**. Dos fuentes, no más:

- **Qué hacer:** [ROADMAP.md](ROADMAP.md), sección «Ahora» y los `[ ]` de la fase actual.
- **Cómo hacerlo y en qué está cada línea:** este archivo. Se actualiza en cada integración (tabla de estado en §8).

## 1. Retomar en 5 pasos
1. `git fetch` y leer la tabla de estado (§8): qué ramas/PR hay abiertos y quién los tiene.
2. `git worktree list`, `git branch -a`, `gh pr list`: lo que no esté en la tabla es sospechoso (ramas sueltas = o se integran o se borran, §6).
3. Leer «Ahora» del ROADMAP y el doc de sistema del ítem ([CLAUDE.md](../CLAUDE.md) los lista).
4. Elegir el trabajo: terminar lo que está a medio camino (§8) y después el primer `[ ]` no bloqueado.
5. Trabajar según §2-§5. Al cerrar, actualizar ROADMAP y §8 en el mismo PR.

## 2. Roles
- **Coordinador** (una sesión): agrupa ítems en *clusters* temáticos (de cualquier fase), despacha agentes, integra ramas, corre la suite, mantiene «Ahora» y la tabla §7. Es el único que corre tests amplios y mergea.
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
**Tests:** los agentes no corren la suite (el LLM local de 14B y la CPU pueden tirar la PC). El coordinador corre una sola corrida por vez, desde un worktree (en Windows, ruta con unidad en mayúscula): tests puntuales por rama; `npm run check` completo cada ~2 clusters y al cerrar una fase (tarda 10+ min).

**Integrar una rama, un comando por llamada de shell (sin `;`, `&&` ni pipes entre pasos):**
1. `git rebase origin/develop` en el worktree.
2. `npm run typecheck` (0 errores) y `npm run lint` (sin errores; warnings/infos se ignoran).
3. `npx vitest run <archivos o carpetas tocadas>`; si la rama agrega un proceso al mundo o cambia RNG/hashes, sumar `src/game`, `src/sim/scheduler` y `src/persistence`.
4. `git push -q -u origin HEAD`.
5. `gh pr create --base develop --head <rama> --label feature --title "..." --body "Ver ROADMAP."` (label `bug` para fixes; docs sin label). El cuerpo termina con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
6. `gh pr merge <n> --squash` (sin `--delete-branch`: hay worktrees; el remoto borra la rama solo).
7. Commits terminan con `Co-Authored-By: <modelo> <noreply@anthropic.com>`.

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
Actualizado: 2026-10-09. **Fase 2 cerrada y en `main` (`v0.2.0`).** Fase en curso: **Fase 3** en `develop`. No hay agentes corriendo ni worktrees abiertos (solo existen `develop` y `main`).

Hecho en Fase 3: #331–#364 mergeados a `develop`. Implementado (todo puro y cableado donde corresponde): rumores (personaje oye, `HEARD`→`RUMORS`); ánimo en decisión y creencias de necesidad/peligro; derrumbe de edificios puro y cableado en `upkeep`; objetivos núcleo y venganza puros y cableados en `life.decide`; presupuesto del hogar puro y cableado en `life.trades`; descanso por decisión en la rutina; enfermedades con contagio puras y cableadas en `life.exposure`; oficios y jornales puros; mercado de la aldea puro. Desde #351: modificadores de la utilidad (#351); `life.trades`, oficios y jornales cableados (#352); el NPC come por decisión (e2b, #353); frío y calor puros y cableados (#354, #358); cinta de transacciones y testigos del mercado (#355); nutrición y agua con calidad, pura y cableada en su primera parte (#356, #362); sustancias, venenos y adicciones, pura y cableada en su primera parte (#357, #361); crédito de cosecha y usura, puro y cableado (#360, #363); térmico por masa, ropa y fuego, puro (#364).

Pendientes siguientes (primer `[ ]` de Fase 3, dentro de «IA de utilidad»): (f3) capas largo, mediano, corto e inmediato; después (g2) `sanction`, (g3) `prophecyPull`/`groupBias` y (h) encadenar acciones. Luego, en Fase 3: NPCs con el mismo catálogo, rutinas diarias, familias, hogares que construyen, enfermedades (epidemias), medicina, economía (presupuesto, mercado, crédito y hambruna), los `[ ]` de cuerpo que quedan (térmico cableado, nutrición y sustancias de la segunda parte, médicos cableados); y los «Heredado de Fase 2» al final.

Notas: el CI de `main` tarda ~25 min (ubuntu) y los tests lentos tienen timeouts de 600 s; los agentes no corren la suite completa, solo el coordinador (una corrida a la vez, ~5-9 min); si el límite de sesión de la API corta a los agentes, retomarlos con SendMessage.
