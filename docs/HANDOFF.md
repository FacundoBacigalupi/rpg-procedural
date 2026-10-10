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
Actualizado: 2026-10-10. **Fase 2 cerrada y en `main` (`v0.2.0`).** Fase en curso: **Fase 3** en `develop`, con PRs mergeados hasta **#409**. Tests: 1979 en 275 archivos (último `npm run check` completo verde en #409).

**Método de trabajo actual:** 4 agentes Sonnet en worktrees `C:\dev\rpg-procedural-wt\{g,h,i,j}`, cada uno con un ítem pure-first y opt-in (la parte pura primero, el cableado a la vida detrás de una opción), sin correr la suite completa. El líder integra por lotes: cherry-pick de las ramas en una sola, `typecheck` + `lint` + suite ancha una vez, y un PR squash por lote. `npm run check` completo cada ~2 lotes. Receta de la corrida ancha: `npx vitest run src/game src/sim src/persistence src/llm src/ui src/tools src/core`. Sigue igual en #390–#397: 4 agentes Sonnet por lote, el líder integra y corre la suite amplia. Al agotarse los ítems hacibles se pasa a `v0.3.0`.

Hecho en Fase 3: #331–#375 mergeados a `develop`. Implementado (todo puro y cableado donde corresponde): rumores (personaje oye, `HEARD`→`RUMORS`); ánimo en decisión y creencias de necesidad/peligro; derrumbe de edificios puro y cableado en `upkeep`; objetivos núcleo y venganza puros y cableados en `life.decide`; presupuesto del hogar puro y cableado en `life.trades`; descanso por decisión en la rutina; enfermedades con contagio puras y cableadas en `life.exposure`; oficios y jornales puros; mercado de la aldea puro. Desde #351: modificadores de la utilidad (#351); `life.trades`, oficios y jornales cableados (#352); el NPC come por decisión (e2b, #353); frío y calor puros y cableados (#354, #358); cinta de transacciones y testigos del mercado (#355); nutrición y agua con calidad, pura y cableada en su primera parte (#356, #362); sustancias, venenos y adicciones, pura y cableada en su primera parte (#357, #361); crédito de cosecha y usura, puro y cableado (#360, #363); térmico por masa, ropa y fuego, puro (#364).

Desde #365 hasta #375, una línea por PR:
- #365: docs, estado de Fase 3 tras #364.
- #366: médicos cableados a la vida (primera parte).
- #367: capas de objetivos (largo, mediano, corto).
- #368: cierre del día del vendedor.
- #369: reconstrucción efectiva tras derrumbe o fuego.
- #370: contagio por lugar y pozos por aldea.
- #371: hogares con oficio derivados de la población.
- #372: epidemias y evolución, parte pura.
- #373: sanción por identidad en la decisión.
- #374: tope y standing del otro en el trato del jugador.
- #375: fix de lint, dependencias de trades y market.

Desde #376 hasta #389, una línea por PR (títulos en `git log --oneline origin/develop`):
- #376: docs, handoff y ahora al día (#365–#375).
- #377: ingreso real del hogar y standing visible a vecinos.
- #378: efectos agudos de sustancias y ansia en la utilidad.
- #379: nutrición con lo comido y efectos de carencias (opt-in).
- #380: lote crédito (colateral), mercado (householdQuote), congelación.
- #381: inspector de rumor con árbol y deformación.
- #382: lote sanador por habilidad, esfuerzo y sudor, memoria told.
- #383: reconstrucción con ahorros del hogar.
- #384: lote puerta trabada, remedios con stock, núcleo de fiestas.
- #385: agua con calidad completa (parte pura y ganchos).
- #386: lote hogares encendidos, oficio por habilidad, hambruna con causa.
- #387: Commitment puro, cauce contaminado, reputación en el trato, test gossip.
- #388: Commitment en préstamos, desnutrición, agravios por rumor, reputación en panel.
- #389: oficio por habilidad, signos del sanador, moldes de rumor, hambruna en PRESSURE.

Desde #390 hasta #397, una línea por PR (títulos en `git log --oneline origin/develop`):
- #390: moldes en gossip, pricePush en el trato, immune en contagio, docs al día.
- #391: migración por hambruna (pura), altitud, prenda en lotes, aporte por persona.
- #392: decisión de migrar, mal de altura, renta en el presupuesto, secuelas de hambre.
- #393: altitud real, secuelas cableadas, arriendos, test de migración.
- #394: fuentes de agua, congelación cableada, señales de sustancias, test de rumor.
- #395: cognición/vigor por carencia, señales de sustancias al panel, congelación al médico, verbo consume.
- #396: molde attr, estafa pura, ansia por señales, semillas de patógeno.
- #397: opciones famine/migration/rumorGrievance, estafa en cotización, apodo con lugar, render de sustancias.

Desde #398 hasta #409:
- #398: política de estafa, signos y heridas por carencia, hervir agua.
- #399: estafa desde Life, etapas de carencia, señales en entorno, refugio.
- #400: estafa con descubrimiento (`scam.discovered`), signos de altitud al sanador, `rumor.told`, dosis de remedio.
- #401: congelación tratada (`FROSTBITE_CARE`), `coreEffects`, `moldHints`, `--famine`/`--nickname`, frase de `consume`.
- #402: renta como gasto fijo, órdenes de congelación del médico, desmayo por núcleo, precio creído en moldes.
- #403: crecimiento adulto, hervir en NPC, altitud por espacio, tasador de estafa.
- #404: moldes comprar/vender, estatus como rumor, sustancia al comer.
- #405: reclamo de mora por la comunidad, precio como rumor, crecimiento gradual.
- #406: amputación como Scar, reclamo del sobreprecio, mora de renta con desalojo, dealSwaps.
- #407: narración de amputación/desmayo, lluvia y boil, altitud de viaje, aparcería pura.
- #408: aparcería cableada, lluvia desde el clima, subrogación cobrable, estafa por tercero.
- #409: autocuidado de congelación, hexKinds, ejecutores de crédito, sitio visto como rumor.

Siguiente: más lotes de 4 agentes sobre los `[ ]` de Fase 3 (ver ROADMAP); cuando no quede nada hacible, pasar lo dependiente a su fase, `npm run check`, PR `develop`→`main` y tag `v0.3.0`. Quedan ramas remotas `origin/feat/f3-g|h|i|j` por borrar al final.

Estado: la mayoría de los `[ ]` restantes de Fase 3 son cableados o calibración para encender por defecto, o ítems que dependen de fases posteriores. Al agotarse los hacibles: mover los dependientes a su fase (prefijo `Heredado de Fase 3:`), PR `develop` → `main` y tag `v0.3.0`. Los «Heredado de Fase 2» van al final de la lista de pendientes.

Notas: el CI de `main` tarda ~25 min (ubuntu) y los tests lentos tienen timeouts de 600 s; los agentes no corren la suite completa, solo el coordinador (una corrida a la vez, ~5-9 min); si el límite de sesión de la API corta a los agentes, retomarlos con SendMessage.
