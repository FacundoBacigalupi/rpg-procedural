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
**Método vigente para Codex (pedido del usuario, 2026-10-10):** la sesión principal coordina continuamente. Los subagentes conservan su línea temática y reciben nuevas tareas al terminar, incluso mientras el coordinador verifica e integra el lote anterior. El cierre de un ítem no termina la sesión. Pruebas con LLM solo cuando el cambio toque parser, narración o sus contratos. Reemplaza la antigua regla de una sesión por ítem.

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
**Estado verificado más reciente (2026-10-12, noche):** rama
`feat/f3-full-profile-review`, PR #491 en borrador. Integrados dominio serial
entre procesos, validación causal previa, talleres/fiado/repago/rutina,
proyección única de FACE/HEARD, llegada física y pausa del viaje, snapshot de
cobertura y núcleo puro de liquidación. `npm run check` sobre `5387873` está
en curso (`sim-reports/full-profile-integrated-check.log`): typecheck/lint
pasaron; la suite terminó con 2554 aprobadas y dos fallos en mocks del worker,
que no incluían las nuevas lecturas de cobertura. Fix `aef8644` preparado con
18 pruebas puras, todavía sin integrar en esta observación. El intento anterior se frenó por un
import indebido de persistence en un test, corregido en `bc658d1`; no se cuenta
como suite aprobada. Antes del check: 66 tests puntuales y luego nueve de
conversación/fiado pasaron, además de los tests reportados por los agentes.

Batch terminado sobre `004d4de`: seed 1 detenida después de 270 días por FACE;
seeds 2 y 3 completas, dos años y 26 chequeos cada una. Seed 2: cuatro
concepciones, tres nacimientos, muertes por parto/deshidratación, 1302 s y
~2,45 GiB RSS; seed 3: dos concepciones, un nacimiento, muerte por deshidratación,
852 s y ~1,68 GiB RSS. Viaje/dormidos no se ejercitaron en ese batch. La nueva
corrección aún requiere repetir la medición; `perfil2b` sigue pendiente.

Qwen3:14b banco posterior al fix de perdonar: 54/54 válidos al primer intento,
39/54 semánticos; `spare-yielded` correcto, siete mejoras comunes frente a #489
y ninguna regresión común en esta corrida. Reporte
`sim-reports/cloud-review-bench-spare-fixed/bench-2026-10-12T22-19-16-592Z.json`.
No usar validez de esquema para certificar fidelidad; narración mantiene sus
ítems pendientes. No ejecutar inferencias mientras corre la suite amplia.

Siguiente lote: `profile_tools` resuelve economía conversacional en `act`
(dos diagnósticos reales de excedente y última moneda, adaptador en trabajo),
`profile_core` audita consumidores `eat/cook/take/gather`, `cloud_audit` agrega
slice dirigido de sueño/catch-up. Sus worktrees son internos a `sim-reports`;
el de cobertura es `codex-coverage-audit`, el antiguo audit conserva WIP de
speech/schema ya integrado. No borrar worktrees ni junctions automáticamente.
Los límites de uso de agentes se reintentaron y pudieron retomar; el coordinador
continúa revisando y corre una sola prueba amplia por vez.

**Estado verificado (2026-10-12, continuación):** PR #491 en borrador y rama
`feat/f3-full-profile-review`. `npm run check` anterior pasó: 2469 tests en 358
archivos, typecheck y lint, exit 0. Después se integraron lotes seriales,
aprendizaje de testigos, los dos reproches de fraude faltantes y la contienda
trade/give; 95 pruebas puntuales y typecheck latest pasaron. La verificación amplia
del código posterior sigue pendiente; no reutilizar el número anterior como prueba
de todos los cambios actuales.

Perfil completo: tres seeds × 30 días pasaron 21 chequeos; no ejercitaron partos,
préstamos ni catch-up. El intento de dos años se frenó por `greet.cold.fraud`, ya
corregido junto a `request.refuse.fraud`. Nueva corrida serial de dos años en
`sim-reports/full-profile-2y-fraud-fixed`, todavía en curso. No activar defaults
antes de terminar la medición y revisar cobertura/recursos entre procesos.
Código de esta corrida: `004d4de` (los commits posteriores del coordinador son
documentación); no integrar cambios de simulación durante el batch secuencial.
La seed 1 pasó diez chequeos hasta 270 días y después falló por doble escritura
de `social.face` en `life.converse/decide`; `perfil2-converse-face` cubre el nuevo
bloqueo. La seed 2 completó dos años y 26 chequeos limpios: cuatro concepciones,
tres nacimientos, dos muertes (parto y deshidratación), 1302 s de simulación y
RSS máximo 2627629056 bytes (~2,45 GiB). No hubo viajes ni dormidos; la seed 3
está en curso. Una seed completa no aprueba el lote. Reproducción pequeña también confirma compra y producción gastando el
mismo insumo doméstico: contrato `perfil2-economic-domain` y adaptadores
`perfil2-economic-adapters`, separados antes de implementar. Agentes reutilizados:
`profile_tools` conversación, `profile_core` dominio económico, `cloud_audit`
revisión del contrato; no ejecutan suites amplias ni inferencias en paralelo.
`perfil2-directed-coverage` separa snapshot de oportunidades y escenarios
dirigidos: el perfil configura viaje, pero no genera su candidata de movimiento
a lugar por la ruta normal. Los partos sí se ejercitaron en seed 2, sin acelerar
gestación ni tasas.

Qwen3:14b último banco: 54/54 borradores válidos, 38/54 semánticamente correctos;
mejora siete casos comunes frente a #489 y presenta una regresión en liberar al
rendido (`parser-spare-regression`). Repetición única se puntúa como su cuerpo,
habla/plan son excluyentes y los actos tienen esquema discriminado. Narración
semántica sigue pendiente. Los resultados locales de banco y simulación no se
confunden con aprobaciones del juego completo.

**Continuación autónoma (2026-10-12):** la corrida amplia anterior no conservó
resultado final y no se cuenta como aprobada. Nueva `npm run check` en curso,
log `sim-reports/cloud-review-check-2026-10-12.log`; typecheck y lint pasaron.
Integrados en la rama de trabajo: proyección de registros de trades, reserva de
nombres por hogar y política `sleepWorkPending` (cableada como `pending`).
También se corrigieron las descripciones obsoletas de `conc1`/`conc2` y el
alcance real de `off-3d`: la cola agendada no se descarta.

Qwen real, smoke de cuatro casos: `again`, `repeat` e `if` pasan; promesa vaga
todavía duplica `speech` y `plan`. Hay un fix de validación lógica preparado para
rechazar esa combinación y regenerar; mantener pendiente la comprobación real
posterior. El narrador preservó recoger en el último smoke, pero eso no demuestra
fidelidad semántica general. Batch de acciones: contrato opt-in con vista temporal
de verdad/ledger en revisión; grupos de trades y proyección de testigos continúan
en los ítems nombrados del ROADMAP. Los cambios no se activan por defecto.

**Retoma Codex después de #489 (2026-10-11):** checkout inicial limpio, refs
actualizadas y sin PRs abiertos. #488 cambió la prioridad a perfil completo antes
de agregar más sistemas opt-in; «Ahora» anterior no reflejaba ese cambio. Rama de
integración `feat/f3-full-profile-review`, agentes reutilizados en
`sim-reports/codex-profile-core`, `codex-profile-tools` y `codex-cloud-audit`.
No borrar worktrees automáticamente. `perfil1` y tooling `perfil2a` implementados;
`perfil2b` todavía exige medición larga y cobertura de configuraciones con semillas.

Auditoría: #475 aceptaba repeat/if en el motor pero los omitía del esquema del LLM;
corregido. #489 perdía modos al acercarse, rechazaba plurales con parentesco y no
actualizaba familiares reconocidos con los percepts actuales; corregido con tests.
Qwen real pasa los dos casos nuevos después del esquema; el banco de 52 casos
comunes mostró dos mejoras y dos regresiones antes de ajustar «otra vez». La
narración todavía agrega hechos a una acción `gather` aunque el validador la
acepte: `narr-action-grounding` y `narr-view-llm` continúan pendientes.

Medición: frecuencia 2 agotó Map en refinado local; frecuencia 8 creó en ~43 s y
~2,33 GB RSS. Frecuencia real crea en ~4,3 s y ~400 MB. Smoke de un día con
invariantes pasó tras corregir `TRADE_VIEW` y writes causal de `life.famine`.
Batch seeds 1..3 × 2 años falló temprano por cinta compartida en trades de NPC;
partido en `perfil2-trades-projection` y `perfil2-trades-resources`. No encender
el perfil por defecto mientras la medición larga siga sin pasar.

Actualizado: 2026-10-11. **Fase 2 cerrada y en `main` (`v0.2.0`).** Fase en curso: **Fase 3**; `develop` con PRs integradas hasta **#486**. Verificación por rama: typecheck, lint y la suite ancha (`src/game src/sim/scheduler src/persistence src/sim/mind src/sim/actions`) en una sola corrida, con las tareas pesadas sin otros agentes corriendo. `settlement.test.ts` y `language.test.ts` pasan solos pero fallan por timeout (360 s) o por SIGKILL de memoria si corren junto a otras suites: repetirlos solos antes de culpar a la rama.

**Sesión de Claude Code en la nube (2026-10-11), #444–#473 (y #474–#486 abajo):** señales de alegría, vergüenza, envidia y amor (f3c3c); vacío de sentido calibrado, cumplimiento por evidencia propia y metas de oficio con registro de práctica (f3d3c–f3d4e); medición de `LAYER_PULL` (f3e1); métricas de deuda rescatadas de `feat/f3-goal-debt` (#449); sustancias en la vida; hurto (g2b, g2b2); el NPC ejecuta `gather`/`trade`/`give`/`speak`/`take` desde su decisión (`npcVerbs`); `speakActs` calibrado (silencio 1 día, peso 0,4; arreglo del choque de `life.pending_speech` por iniciativa); viaje del NPC (`npcMove`, `move` con tiempo, `NPC_JOURNEY` con `npcJourneyDays`, tránsito `npcTransit`, provisiones `npcProvisions`, descanso `npcNightRest`, ritmo `npcPace`, cansancio con parada al agotarse, calzado `npcFootwear`); plantillas de plan de varios pasos (`npcTemplates`, `content/plans/fieldwork.json`); interrupción y reanudación de planes (`npcInterrupt`: signos graves del cuerpo, golpes y palabras de otros, `NPC_PAUSED`/`npc.resumed`); cadena «ir hacia el prestamista, llegar y pedir» en una vida (npc-f). **Lote de hashes aprobado por el usuario (#467):** motor `life-2`, capas de objetivos por defecto (f3e2) y vergüenza (f3c3c3); un guardado `life-1` se sigue con `life-2` y se registra `meta.replayLimits`; el replay arranca desde el snapshot del límite (f3e3, #469). Todo lo demás sale apagado por defecto.

**Después de #473 (#474–#486):** nodos `repeat`/`if` en los planes (npc-e4a, banco del parser con LLM real sin regresión, resultado del usuario); encuentros en el camino (`npcEncounters`); **NPC que actúan sin el jugador** (off-1…off-4a): `catchUpRoutine` pone al día a un dormido sin simular hora a hora (equivalente < 1e-9 relativo), registro `ASLEEP`, política `sleepWant`, y con la opción `sleepers` los dormidos dejan de correr cuerpo, rutina, decisión y procesos horarios y el scheduler no los invoca (llamadas por hora medidas en una Life corta de 25 dormidos: 156 → 32; trabajo efectivo 56 → 9,6), con hechos pendientes de los agregados (`PENDING_FACTS`); **familias**: concepción (`life.conception`), embarazo con causa, parto con partera y nacimiento como persona (`life.birth`), con nombre con significado, mente, relaciones, cultura y fe de sus padres, habilidades y gustos heredados y el afecto de la familia (`life.newborn_bonds`); todo opt-in (`conception`, `births`, `sleepers`). **Bug de narración corregido (#483):** los percepts traían `action.<verbo>` y la plantilla buscaba `percept.action.action.<verbo>`, así que lo que hacían los demás se narraba como «algo que no llegás a entender» (`perceivedAction`); toca el contrato de narración y queda pendiente de que el usuario lo pruebe con LLM real (`narr-view-llm`). ROADMAP reorganizado (#477): 10 ítems movidos a su fase como «Heredado de Fase 3» y la leyenda documenta `[>]` y los agrupadores.

**Qué falta de esas líneas (ver ROADMAP):** off-4b (epidemia y leva asignan hechos), off-5…off-8 (puesta al día no corporal, asignación de tier, contrato `AggregateModel`, rutina diaria no fija); lactancia (conc2d3, pide un verbo `nurse` con contienda), nutrición y hambre sobre la fecundidad (conc3), deseo, uniones, cultivadoras y anticoncepción (conc4); npc-e2b/e3b/e4b, npc-b2b3b2b/c/d, npc-b2b4b/c/d; npc-c5c2c y g2b3; lo de LLM real del usuario (`npc-e4-ejemplos`, `narr-view-llm`).

**Verificación (aprendido):** mirar el código de salida de `npm run lint` y la línea «no dependency violations» (dependency-cruiser), no solo los errores de Biome: #469 dejó 2 violaciones de capa que un filtro a medias no vio (arreglado en #471; un test de `game/` no puede importar `persistence` ni `tools`). Los agentes a veces reportan «lint pasa» sin haberlo corrido completo: repetirlo antes de mergear.

**Memoria y tests pesados:** una `Life` ocupa ~1 GB de heap y ~2,3 GB de RSS que el proceso no devuelve (no hay fuga entre vidas). Varios workers de vitest en paralelo o varias vidas en un proceso pueden morir por SIGKILL/137; las mediciones largas corren una variante por proceso. `scam-life`, `settlement` y `language` tardan 100-160 s solos y fallan por timeout si compiten con otra suite: repetirlos solos antes de culpar a la rama. Verificar una rama a la vez, sin otros agentes midiendo.

**Pendiente con razón (ver ROADMAP):** resto del ítem «NPCs con el mismo catálogo de verbos» (`[~]`): npc-d2 más plantillas y npc-d3 concurrencia, npc-e2b ver morir a un cercano, npc-e3b retomar con otra decisión de por medio, npc-e4 nodos `repeat`/`if`/`onEvent`, npc-b2b3b2b/c/d reponer calzado, abrigo del viajero y salud al forzar, npc-b2b4 paradas y encuentros, npc-c5c2c silencio de `speakActs`, g2b3 robo en `trade`. f3d3f espera religión y maestro-discípulo; f3d4f (ahorro) espera creencias de saldo propio con evento.




**Ramas viejas:** `feat/f3-goal-debt`, `feat/f3-goals-death` y `feat/f3-immediate-goals` están superadas (lo único útil, las métricas de deuda, entró en #449); borrarlas del remoto cuando se pueda (`git push origin --delete ...`; el modo automático de Claude lo bloquea). Últimos SHA: `f6e172f`, `c5c7c53`, `5a3be57`.

**Método con agentes:** dos agentes Sonnet reutilizables por `SendMessage`, uno por worktree (`/home/user/wt-emotions`, `/home/user/wt-completion`, `wt-take`, `wt-metrics`, con `node_modules` como symlink local ignorado; **nunca `git add -A`**, agregar archivos por nombre). El coordinador rebasa, verifica, hace push/PR y mergea con squash.




**f3a terminado:** `persistGoalLayers` llega por `LifeOptions`/`optInParts` a `life.decide` al crear/retomar; guarda largo/mediano/corto junto al núcleo, conserva origen/`since`, refresca pesos y registra nacimientos/fines sin duplicarlos ni sumar el empuje de las capas como núcleo. Apagado conserva el comportamiento. Pruebas de ciclo, causas y decisión on/off; próxima tarea **f3b, deuda creída desde Commitment**, seguida de emociones inmediatas, cumplimiento y calibración. La captura del check en PowerShell dejó `$?` en false por notices stderr aunque todos los tests pasaron; se reprodujo con el test puntual (exit nativo 0, `$?` false). Al capturar logs, devolver `$LASTEXITCODE` explícitamente.

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
- #411: relationDecay y hexKinds cableados, material distinto, compra por moldes, contagio por horas.
- #412: gatherings desde fiestas y mercado, insumos de congelación, siteOf real, material por parte.
- #413: mora de aparcería, verbo filtrar, gatherings de paso y templo, swapMaterials cableado.
- #414: moldHintsFromCatalog opt-in, agua tibia y mantas, mirada al explorar, handoff.
- #415: delito fraud, ansia en panel, oficio equivocado, matchRents.
- #416: mercado de arriendo, mezclar como estafa, aprendiz en la vista, dosis al beber.
- #417: canon por productividad, relleno de estafa, tradeView opt-in, ansia por creencia.
- #418: notar el relleno, ansia por creencia cableada, oficio oído, comprar lo que se consume.
- #419: marcas de lote, contagio de quiebras, candidatas de oficio oído, recolectar con ansia.
- #420: marcas al lote, servidumbre por deudas, tradeWant por necesidad, pedir prestada la sustancia.
- #421: servidumbre y contagio cableados, repaso de marcas, rumores has desde la despensa.
- #422: rescate y abuso de servidumbre, efectos del contagio de préstamos, pedir prestada ejecutado (lote 35, opt-in).
- #423: ir hacia el prestamista, garantías (restructure/seize puros), abuso por temperamento, devolver dosis (lote 36, opt-in).
- #424: proceso de garantías, servidumbre sin otro jornal (`onlyWithoutOtherWage`), `life.workout`, mirar un lote a pedido con repaso de marca (lote 37, opt-in).
- #425: fix de `life.trades` en headless (la podredumbre pasa a la fase physics; crash en la aldea por defecto), verbo forge sobre `life.marks`, `skillWage` desde habilidades de oficio, `ScenarioEntry.life` y escenario `loan-bondage`.
- #426: `life.workout` ejecuta parcelas en prenda, verbo hire, oficio oído llega a la vista como `heardTrades`, usura disfrazada (parte pura en `contracts/usury.ts`), fix de UTF-8 en `gathering-provider.ts`.
- #427: `life.hire` ejecutado, usura en préstamos (`LoansOptions.usury`), `heardTrades` en la sesión.
- #428: empeño (`contracts/pawn.ts`, `life.pawn`), marca falsa en el trato, `standingCaution` al prestar, señales de ansia por objeto.
- #429: apuro del vecino al fiar y contratar (`heedStanding`), `marksExpose` (marca falsa descubierta → `scam.discovered`), fama del sanador por rumor y `healerFee`, `body/residue.ts` (pureza, purga, sobrecarga de Essence).
- #430: empeño desde `give` modo `pawn`, residuo cableado (`life.residue`), rumor `fraud` y `MARK_CLEARED`, `objectCues` en decide y panel.
- #431: residuo con ledger de Essence y esencia/pureza por lote, fama del copiado y alcance del rumor, `TRAVEL_CELL` y altitud, NPC que empeña por decisión (`pawndecide.ts`).
- #432: fix del scheduler `ProcessDef.withRecent` (procesos `onEvent` fuera de `perceive`: `pawn_open`, `hire`; `life.accent` y `born_taboos_settle` tienen el mismo problema, pendiente por cambiar hashes), tests de Life de fiado y empeño, fraude a moldgossip, caso comunitario por usura, ambientes de qi.
- #433: la sesión y el web pasan `residue`/`objectCues` al panel (`panelOptionsOf`), `renown` con observador en marcas, diagnóstico como creencia y cuarentena por decisión del paciente, `consume` por unidad lee `LOT_ESSENCE`.
- #434: cuarentena con autoridad y segunda opinión (`patientDecides`), partera en los partos (`life.labor`, `body.labor`), costo del prestamista condenado (`life.usury_gossip`, `heedFraud`), absorción que debita la celda (`AMBIENT_TAKEN`, `body.ambient_taken`).
- #435: `lend`/`hire` leen `fraudCaution` (`heedFraud`), escritor `TRAVEL_CELL` (`life.travel_cell`), reparación de la fama del deudor (`life.debtor_repair`), `patientDecides.realBonds` (jefe del hogar y relación real).
- #436: reparación de fama por restitución (`debtorRepairRestitution`), `loanUsury`/`loanSeeds` desde `LifeOptions`, `puerperalSeed` (sin cablear), señales de objeto ajenas (`viewCues`, sin cablear).
- #437: `viewCues` en LifeOptions y panel, `puerperalSeed` como `arrivals` de `life.exposure`, `deriveUsury` (usuryderive.ts, sin cablear en Life.create), `patientDecides.cultureTraits`.
- #438: `norms.interest` + `interestNorm` (deriveUsury en Life.create), fiebre puerperal por madre (`PathogenSeed.perCarrier`), `healthCulture` (`village.health`: contagio y jefatura), `ViewCues.ground`. Se arreglaron bytes latin-1 sueltos en comentarios (scan UTF-8 de todo el repo limpio).
- #439: `interestNorm.communityCase` (bug del cableado) con test de vida completa y guarda de hash, `combineAuthorities` (autoridad de aldea, pura, sin cablear). **Parado acá:** develop limpio en #439; worktrees g/h/i/j en develop; siguiente paso = elegir entre más ítems opt-in chicos o cortar `v0.3.0` (ver ROADMAP "Dónde quedó").

Siguiente: más lotes de 4 agentes sobre los `[ ]` de Fase 3 (ver ROADMAP); cuando no quede nada hacible, pasar lo dependiente a su fase, `npm run check`, PR `develop`→`main` y tag `v0.3.0`. Quedan ramas remotas `origin/feat/f3-g|h|i|j` por borrar al final.

Estado: la mayoría de los `[ ]` restantes de Fase 3 son cableados o calibración para encender por defecto, o ítems que dependen de fases posteriores. Al agotarse los hacibles: mover los dependientes a su fase (prefijo `Heredado de Fase 3:`), PR `develop` → `main` y tag `v0.3.0`. Los «Heredado de Fase 2» van al final de la lista de pendientes.

Notas: el CI de `main` tarda ~25 min (ubuntu) y los tests lentos tienen timeouts de 600 s; los agentes no corren la suite completa, solo el coordinador (una corrida a la vez, ~5-9 min); si el límite de sesión de la API corta a los agentes, retomarlos con SendMessage.
