# Handoff: cómo se está trabajando

Para retomar con otra herramienta (Codex, Claude Code en la nube, otra sesión) sin depender de la conversación. **Fuente de "qué sigue": [ROADMAP.md](ROADMAP.md) «Ahora»**. Este archivo dice *cómo* se trabaja y *en qué está* cada línea de trabajo. Se actualiza en cada integración.

## Modo de trabajo (coordinador + hasta 3 agentes en paralelo)
- Un coordinador agrupa ítems del ROADMAP en **clusters temáticos** (de cualquier fase) y se los da a un agente por worktree. Un agente resuelve varios ítems seguidos, **un commit por ítem**, cada uno cerrado `[x]` en el ROADMAP (lo no hecho pasa a `[ ]` con nombre).
- Worktrees en `C:\dev\rpg-procedural-wt\<slot>` (slots `v`, `w`, `x`), cada uno con su rama. Reutilizar un slot: `git fetch -q` + `git checkout -q -B feat/<nombre> origin/develop`.
- **Los agentes NO corren la suite de tests** (el LLM local de 14B y la CPU pueden tirar la PC). Solo `npm run typecheck`, `npm run lint`, `npm run format` y 1-2 tests puros del módulo. La suite completa (`npm run check`) la corre una sola persona/sesión por vez, desde un worktree, cada ~2 clusters y al cerrar una fase.
- Los agentes **no tocan «Ahora»** ni mergean; entregan la rama con commits. El coordinador integra.
- Una sesión = un ítem si se trabaja a mano (ver «Cómo se trabaja» en ROADMAP).

## Integrar una rama (un comando por llamada, sin encadenar)
1. `git rebase origin/develop` en el worktree de la rama.
2. `npm run typecheck` (0 errores) y `npm run lint` (sin errores; warnings/infos se ignoran).
3. Tests puntuales: `npx vitest run <archivos>` desde el worktree (en Windows, ruta con unidad en mayúscula).
4. `git push -q -u origin HEAD`.
5. `gh pr create --base develop --head <rama> --label feature --title "..." --body "Ver ROADMAP."` (label `bug` para fixes; docs sin label). Cuerpo termina con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
6. `gh pr merge <n> --squash` (sin `--delete-branch` si hay worktrees; el remoto borra la rama solo).
7. Commits terminan con `Co-Authored-By: <modelo> <noreply@anthropic.com>`.

## Cerrar una fase
Cuando no quedan `[ ]` hechos posibles en la fase: lo bloqueado pasa a la fase siguiente prefijado `Heredado de Fase N:`; después PR `develop` → `main`, `gh pr merge <n> --merge --auto` (comando suelto) y tag `v0.<fase>.<n>` sobre el merge commit ([GIT_WORKFLOW.md](GIT_WORKFLOW.md)). Un comando por llamada de Bash.

## Reglas técnicas que muerden
- Editar con Edit/Write, no con Python en modo texto ni `sed` (LF siempre; `npm run format` arregla).
- `**` está prohibido en la sim: usar `pow` de `core/math`.
- Todo componente que un proceso escribe va en `writes`/`reads`; dos procesos en la misma fase no pueden escribir lo mismo (`SchedulerError`). Procesos `onEvent` solo disparan en `perceive`.
- `export *` duplicado rompe `tsc`; tipos de contenido en `CONTENT_KINDS`; verbo nuevo = actualizar listas en `skills.test.ts`/`actions.test.ts` y `percept.action.<verb>` en `content/llm/templates/es.json`.
- El `node_modules` de los worktrees `v`, `w`, `x` es un junction al del repo principal: **no** borrar un worktree sin quitar antes el junction (`cmd /c rmdir node_modules`), o se vacía el principal (arreglo: `npm ci` en `C:\dev\rpg-procedural`).
- Ramas: solo `develop` y `main` deben quedar sueltas; toda rama mergeada se borra (local y remota).

## Estado de las líneas de trabajo
Actualizado: 2026-10-09.

| Slot | Rama | Qué hace | Estado |
|---|---|---|---|
| v | (libre) | docs / integración | libre |
| w | (libre) | IA de utilidad: sub-ítems (c) → (d) → (e) | por despachar |
| x | (libre) | creencias/percepción de NPC (heredados de Fase 2: testigos con `clarity`, NPC sobre NPC) | por despachar |

Hecho recientemente: Fase 2 cerrada en el ROADMAP (#304); percepción de testigos NPC (#305); núcleo de utilidad (a)(b) (#306); lo visto queda en las creencias del jugador (#307).
Pendiente de cierre de fase: PR `develop` → `main` de la Fase 2 con tag `v0.2.x`.
