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

## 2. Método (único vigente; Claude y Codex)
- **Lote:** alcance, resultado observable, criterios de cierre y base SHA. Priorizar cerrar conexiones viables de la fase antes de abrir otro sistema. Una cadena de ítems dependientes (p. ej. take-loss → state → act → audit) es un solo lote, un commit por ítem, un solo PR.
- **Una sesión coordina e implementa.** Agentes solo para trabajo independiente y barato (docs, auditorías, limpieza), con capacidad de revisión; nunca abrir frentes en paralelo sobre el mismo módulo ni usar el máximo de agentes como meta. Máximo un lote en integración y uno en preparación sobre base estable. Si hay fallos o conflictos, resolverlos antes de abrir más.
- **Worktrees:** `C:\dev\rpg-procedural-wt\<slot>` (`v`, `w`, `x`) solo si hay trabajo paralelo real; si no, rama normal en el repo principal. Los 17 worktrees detached existentes se conservan (no son líneas activas).
- **Cierre honesto:** distinguir núcleo puro, cableado opt-in y comportamiento observado en integración; pendientes con nombre y fase; no declarar terminado un sistema por tener funciones aisladas; no activar defaults como trámite.
- **Medición:** por lote, base/final SHA, resultado probado, retrabajo y duración real de verificación; no inventar tiempos ni medir por cantidad de commits o checkboxes.
- **Verbos nuevos:** agregar un verbo al catálogo (`content/actions`) es agregar su entrada en `content/llm/verb-words/` con formas, ejemplo y sinónimos; el test de contenido de `llm/verb-words.test.ts` falla si falta o si choca con otro verbo (actions §9).
- **Docs compartidos:** ROADMAP «Ahora» solo tiene prioridad y siguiente trabajo; §8 de este archivo solo el estado vigente (lo reemplazado se archiva en `history/`).

## 3. Ahorro de tokens
- Leer solo: «Ahora» del ROADMAP, el ítem, el doc de su sistema y los archivos que se tocan. Buscar con Grep/Glob y leer rangos; no leer ROADMAP, ARCHITECTURE ni docs de sistema enteros.
- Revisar con `git diff --stat` y tests acotados, no releyendo archivos. Sin polling: esperar notificaciones.
- Modelo: Sonnet para código de sim; Haiku para docs, ROADMAP y limpieza. Sin agentes Explore/Plan.
- Salida de comandos largos (`npm run check`, suites) a un log en `sim-reports/` y leer solo el final/fallos.
- Brief a agente (si se usa): tarea concreta con ítems, doc de sistema, qué no tocar (ROADMAP «Ahora», HANDOFF), reglas de §7, sin push/PR/merge, reporte final de máx. 10 líneas.

## 5. Verificación e integración
**Un solo trabajo pesado a la vez.**
- **Por commit:** typecheck, lint y tests del módulo tocado.
- **Por lote (coordinador):** además tests afectados sobre el código integrado; si cambia RNG/hashes o se agrega un proceso, sumar `src/game`, `src/sim/scheduler` y `src/persistence`.
- **La suite completa corre en el CI de GitHub** en cada PR a `develop` y a `main`, con los archivos en paralelo (`CI=true` en `vitest.config.ts`). En la PC local va de a uno (más de 1 h 45 desde #681), así que localmente no se corre entera: typecheck, lint y tests dirigidos (los del módulo y, si puede cambiar el comportamiento, los de hash fijo, `state-hash`, replay y `engine-compat`). El PR se mergea cuando el CI da verde.
- **Docs solos:** diff, enlaces y LF. **Núcleo puro nuevo sin consumidores** (sin efectos al cargar, procesos, RNG ni cambios de estado/contenido): typecheck, lint y tests del módulo.
- **LLM real** solo si el cambio toca parser, narración o sus contratos. Corridas largas (calibración, conservación, rendimiento) solo si el criterio de cierre las pide.
- Si una corrida amplia falla solo por un fixture y el arreglo toca solo ese fixture: registrar ambos resultados y repetir los archivos afectados y checks estáticos; no presentar la corrida original como aprobada.
- Registrar SHA de código, comando, resultado, log y exit nativo; un cambio posterior exige la verificación pertinente.

**Integrar, un comando por llamada de shell (sin `;`, `&&` ni pipes entre pasos):**
1. `git rebase origin/develop`.
2. `npm run typecheck` y `npm run lint` (warnings/infos se ignoran).
3. `npx vitest run <archivos o carpetas tocadas>` (más lo exigido arriba).
4. `git push -q -u origin HEAD`.
5. PR a `develop` con problema, resultado y validación real (incluidos límites); `--body-file` para multilínea; label `feature` o `bug`.
6. `gh pr merge <n> --squash` (sin `--delete-branch` si hay worktrees; el remoto borra la rama).
7. Commits Conventional Commits.

**Permisos:** `git rebase`, `git push` y `git push origin --delete` solo funcionan como comando suelto; encadenados, el clasificador los bloquea.


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
- **Un solo proceso pesado a la vez** (pedido del usuario, 2026-10-21): la PC se apagó sola con tres agentes corriendo `npm run check` en paralelo. Un agente/lote a la vez; no lanzar `check` ni vitest completo en simultáneo.

## 8. Estado de las líneas de trabajo

**clothing-wear-cloak (2026-10-24, rama `feat/clothing-wear-cloak`, encima de `feat/clothing-wear-feet`):** `wardrobeCloak`/`wardrobeCloakClo` en `game/life/wardrobe.ts`; `clothingOf` del viajero usa la capa del guardarropa con `wardrobe`; `onRoad.is` devuelve `{cloak}`; `cloakWearProcess` y `cloakMendProcess` solo sin `wardrobe`. Tests en `wardrobe.test.ts` y `npc-cloak.test.ts`.

**clothing-wear-feet (2026-10-24, rama `feat/clothing-wear-feet`, encima de `feat/clothing-wear`):** `chooseGarments` (sim/body/garments.ts) pone siempre un par de calzado además de la base; así las sandalias se gastan cada día. Test en `garments.test.ts`.

**clothing-wear (2026-10-24, rama `feat/clothing-wear`):** `GarmentDef.wearDays` (default 365; valores en `content/garments/core.json`), `wearDay`/`garmentDayWear` puros y `wardrobeWearProcess` en `game/life/wardrobe.ts` (fase settle, diario, con `wardrobe`, sin bump; lee `NPC_JOURNEY` solo con `npcJourneyDays`). El primer día escribe la fila de todos desde el juego básico. Tests en `wardrobe.test.ts`. Abiertos: `clothing-wear-cloak`, `clothing-wear-stagger`, `clothing-wear-feet`.

**hearth-npc (2026-10-24, rama `feat/hearth-npc`, encima de `feat/hearth-tend`):** `RoutineOptions.firewood {unit, lowG, perHourG}` (con `hearths` + `wildHarvest` + `wildFirewood`, sin bump): en la hora de campo, si la pila del hogar está bajo `lowG` y `me` es el adulto vivo de menor id de la casa, `woodHour` lo manda al monte más cercano y postea leña de la cuenta del monte a la del hogar (evento `routine.gathered_wood`; tope = stock del monte / filas `HEARTH`); esa hora no cosecha. `hearthProcess` ya no borra la fila sin leña: la deja con intensidad 0. Ojo: `BODY_STATE.death` puede venir `null`, chequear por verdad, no `=== undefined`. Tests en `hearth-npc.test.ts`. Sigue `hearth-enable`.

**hearth-tend (2026-10-24, rama `feat/hearth-tend`, encima de `feat/hearth-seed`):** verbos `kindle`/`douse` (resolvers en `sim/actions/resolve.ts`, `ResolveInput.hearthAt`; efectos `kindle {hearth, moved, fuelG}` y `douse {hearth}`). `ActOptions.hearthTend` (con `LifeOptions.hearths`, sin bump): `hearthAtOf` busca la casa en pie cuyo `graph.spaces[0]` es el espacio del actor (fila `HEARTH` por id del edificio; titular = hogar de la casa o el actor si está vacía); `kindle` pasa la leña que lleva a la pila y pone la fila con la intensidad del día que le da la leña, `douse` la borra; `life.act` lee/escribe `HEARTH` solo con la opción. Vista `kindle {lit, fed}`/`douse`, plantillas, gramática, verb-words, action-words y ejemplos del parser. Tests en `hearth-tend.test.ts`. Sin acción, el jugador muere de sed al 4.º día (los tests no esperan días largos). Sigue `hearth-npc`.

**hearth-seed (2026-10-24, rama `feat/hearth-seed`, encima de `feat/hearth-wood`):** `game/life/hearth.ts` `seedHearths` (una fila `HEARTH` por casa habitada en `graph.spaces[0]`, clave = id del edificio, titular = cuenta del hogar, 5 h/día; pila de 60 kg desde `seed`; evento `life.hearths-laid`). `LifeOptions.hearths` (opt-in, sin bump) registra `hearthProcess` (sumidero `burned` declarado en `ledgerConfigOf`/`withDeclaredExternals`) y `hearthEnv` como `refineEnv` de `life.thermal` (nuevo `ThermalOptions.refineReads`). Sin traer leña, a los ~8 días los fuegos se apagan. Tests en `hearths.test.ts`. Sigue `hearth-tend`.

**hearth-wood (2026-10-24, rama `feat/hearth-wood`):** primer sub-ítem de «Hogares encendidos» (Fase 3; bloqueaba `use-hearth-station`). `content/goods` `firewood`; `sim/living/wild.ts` `deadwoodFall`/`accrueDeadwood` (entra y se pudre, solución exacta)/`deadwoodReach` y `WildStock.deadwood`; `game/life/wild.ts` `topUp` para forraje y leña (`FIREWOOD_UNIT`, fuente `wild`, `data.firewood` en `wild.supplied`); `gather` con `yields[].words` y `gatherYield` (`ResolveInput.gatherByWords`). Opt-in `LifeOptions.wildFirewood` con `wildHarvest`, sin bump (hashes por defecto verificados iguales). La leña juntada no tiene `halfLifeDays`: `life.spoilage` y `life.hearth` corren en `physics` contra la misma foto del ledger y la podredumbre chocaba con lo quemado. Tests en `wild-firewood.test.ts`, `sim/living/wild.test.ts` y `resolve.test.ts`. Sigue `hearth-seed`.

**use-well (2026-10-24, rama `feat/use-well`, apilada sobre `feat/use-core`):** `well.draw_water` con `vessels` y `primary` en `well.drink` (`AffordanceDef`, `ActionCatalog.affordance(id)`); `CONTENTS` (property/item-state) y `WELL_DRAWN` (settlements/tables); resolver `use` con `ResolveInput.drawWater` y `WELL_WORN`; `act.ts` `drawWaterOf` y la aplicación (recipiente, lo sacado hoy, `WELL_WEAR`), con lecturas y escrituras declaradas en `life.act`; vista `EffectView.use` y plantillas `outcome.use.well.draw_water.*`. Motor `life-47` (`legacyNoDrawWater`), renumerado al rebasar sobre flee (`life-45`) e item-demand (`life-46`). Tests en `resolve.test.ts` y `known-things.test.ts`. Queda volcar o tomar del cántaro.

**play-refs-objects-fixtures-use-core (2026-10-24, rama `feat/use-core`, apilada sobre #716):** verbo `use(target: sight, how?: text)` en `content/actions/core.json`; `content/affordances/core.json` (`well.drink` → `drink`); `sim/actions/catalog.ts` `AffordanceDef`, `AFFORDANCES` (registrado en `sim/content.ts`) y `ActionCatalog.affordances(shape)`, con un tercer argumento del constructor (`create.ts`); `refs.ts` `KnownEntity.shape`; `draft.ts` `affordanceStep` y `unusableTarget`, y los `sight` opcionales desconocidos se descartan; la sesión avisa «No sabés qué hacer con X así.»; `llm/grammar.ts` regla de `use` y `look` con target; palabras, plantilla `percept.action.use` y el ejemplo `use-well`. Tests en `known-things.test.ts` y `llm/use-grammar.test.ts`. Con varias funciones se toma la primera (sin pregunta todavía). Sigue `use-well` (bump).

**perfil2-item-claims-item-demand-player (2026-10-24, rama `feat/item-demand-player`, apilada sobre #721):** `game/life/item-demand.test.ts` (vida con `itemClaims` + `householdTools`: «agarro la olla» en su casa la toma y «la suelto» la deja). `sim/actions/resolve.ts` `takeItem.loose` baja el umbral a `PARTIAL_MARGIN`; `act.ts` lo pone cuando la posesión no es un agente. Motor `life-46` (`legacyFullTakeItem`); use-well (#720, `life-45` en su rama) se renumera al rebasar. Sigue `-npc` con `use-tools`.

**play-refs-objects-source-enable (2026-10-24, rama `feat/source-enable`, apilada sobre flee #719):** `game/life/profile.ts` suma `itemClaims` y `householdTools` a `FULL_PROFILE`. Medición base contra objetos (2 seeds x 1 año): 0 problemas, mismo tiempo, `sim:diff` sin diferencias >5 %. Sin bump (las vidas guardadas conservan su `setup.life`). Queda que los NPC usen los objetos.

**play-refs-objects-source-flee (2026-10-24, rama `feat/play-refs-objects-flee`, apilada sobre `-drop`):** `sim/property/item-shed.ts` `shedCarried` (transferencia `give` al lugar más `LOCATION` del portador, solo `SHED_SIZES` mediano/grande, orden por id); `game/life/fight.ts` `StrikeFightInput.shed` aplica a cada peleador con final `fled`/`down`/`dead`, causa el golpe; `act.ts` lo enciende salvo `legacyNoFleeShed`. Motor `life-45`. Tests en `item-shed.test.ts` y `flee-shed.test.ts`. Sin modelo de manos: el tamaño decide qué se cae.

**play-refs-objects-source-drop (2026-10-24, rama `feat/play-refs-objects-drop`, apilada sobre `-tools`):** `sim/actions/resolve.ts` `ResolveInput.dropItem` y el efecto `drop` con `item`/`dropped`; `game/life/act.ts` `itemDropFor` (transferencia `give` al lugar más `LOCATION`, sin claim); `known.ts` `carriedThings` (relación `CARRIED` de `draft.ts`); `thingArg` filtra por verbo y acepta texto. Tests en `drop-item.test.ts` y `known-things.test.ts`.

**play-refs-objects-source-tools (2026-10-24, rama `feat/play-refs-objects-tools`):** `sim/property/household-tools.ts` (`HOUSEHOLD_TOOLS`, `seedHouseholdTools`; vive en property porque property ya importa settlements), `content/household-tools/core.json`, opción `LifeOptions.householdTools` (también en el esquema de tuning) llamada en `createLife` después de `seedSettlement`. Test en `household-tools.test.ts`. Quedan `-drop`, `-flee` y `-enable`.

**play-refs-objects-fixtures-look (2026-10-24, rama `feat/fixtures-look-use`):** `game/life/fixtures.ts` (`fixturesInSight`, `FIXTURE_WORDS`); `known.ts` suma lo fijo a `knownEntities`; `sim/actions/plan.ts` `sight` acepta `work:`/`building:`; `draft.ts` `thingArg` solo `item:`; `game/view/view.ts` `FixtureInput`, `ViewInput.fixtures`, `ThingView.state` (lo fijo entra solo si se miró); `game/life/view.ts` pasa `fixturesInSight(w)`; plantillas `thing.shape.well|granary`, `thing.state.*`. Tests en `known-things.test.ts` y `llm/things.test.ts`. Queda `play-refs-objects-fixtures-use` (bloqueado por el diseño de `use`).

**play-hud-clothing (2026-10-24, rama `feat/clothing-player-hud`):** `TopBar.tsx` `clothingChips`: 🧥 «poco abrigo» / «sin abrigo» por `Hud.clothing.short`, o «ropa gastada»; sin falta ni desgaste no ocupa lugar. El título lista lo puesto. Se ve recién con `wardrobe` (opt-in hasta `clothing-enable`).

**clothing-player-hud (2026-10-24, rama `feat/clothing-player-hud`):** `game/life/outfit.ts` `outfitOf` (prendas puestas con `frayed`, `short` 0-2 por `SHORT_CLO` contra `seasonalClothing` del aire de `ambientOf`), en archivo aparte para no cerrar un ciclo con `world.ts`; `Hud.clothing` y `InventoryPanel.worn` opcionales (solo con `wardrobe`); `renderInventory` dice «Tenés puesto: …» y avisa si no alcanza. **Arreglo:** la vida nueva no recibía `garments` (solo `resumeParts`), así que `wardrobe: true` no hacía nada en una vida recién creada; ahora `create.ts` las pasa. Tests en `hud.test.ts`, `wardrobe.test.ts` y `ui/render.test.ts`.

**play-refs-objects-host (2026-10-24, rama `feat/play-refs-objects-source`):** `sim/actions/resolve.ts` `ResolveInput.hostLarder` (al principio de `homeOrPlace`: solo lo nombrado y no suelto); `game/life/act.ts` `hostLarderOf` (espacio adentro de otro hogar; `legacyNoHostTake`); `goods-sight.ts` `where: "host"`. Motor `life-44`. Tests en `resolve.test.ts` y `host-take.test.ts`. Queda el consentimiento del dueño (property).

**clothing-garments (2026-10-24, rama `feat/clothing-garments`):** primer sub-ítem de «Ropa puesta como ítems» (Fase 3, bloqueaba `play-hud-clothing`). `sim/body/garments.ts`: `GARMENTS` (`content/garments/core.json`, juego básico de ~3 clo más una capa de piel no básica), `chooseGarments` (base siempre, capas por `layer`/id hasta el clo pedido) y `wornGarment` (el desgaste baja clo y cortaviento). `game/life/wardrobe.ts`: tabla `life.wardrobe` sin escritor todavía (sin fila: juego básico entero), `wardrobeOf`, `wardrobeClothing`. `LifeOptions.wardrobe` (opt-in, sin bump) hace que `clothingOf` de `life.thermal` use las prendas; el viajero NPC con `npcCloak` sigue con `roadClothing`. Lo que falta quedó partido en el ROADMAP: `clothing-player-hud`, `clothing-wear`, `clothing-trade`, `clothing-wet`, `clothing-enable`.

**play-hud-load (2026-10-24, rama `feat/play-hud-load`, encima de `feat/play-hud-danger`):** `Hud.load` desde `loadOf` (life/hud) con `unitGrams` (economy/goods) y `pieceGrams` en el cobre (3,7 g). Bandas `LOAD_BANDS` sobre `massKg` del cuerpo; chip en `TopBar.tsx`. Tests en `life/hud.test.ts`. La carga no afecta todavía al cansancio ni a la marcha.

**play-refs-objects-look (2026-10-24, rama `feat/play-refs-objects-look`, apilada sobre #708):** `content/actions/core.json` `look.args` = `target?: sight`; `sim/actions/catalog.ts` `ARG_KINDS` suma `sight` (draft: objeto o persona, reintenta sin la clase adivinada; plan: `agent:`/`item:`); `resolve.ts` `observe` lleva `target`; `game/view/view.ts` `ThingView` y `things` en `PlayerView`/`ViewInput`; `game/life/view.ts` `playerView` llama a `itemsSeen` y avisa por `onThings` (la sesión ya no lo calcula aparte); `llm/templates.ts` nombra las cosas, `llm/parser.ts` ayuda de `sight`, `narration.ts` pasa `things`. Tests: `known-things.test.ts` (mirar), `llm/things.test.ts`.

**play-refs-objects-goods (2026-10-24, rama `feat/play-refs-objects-loose`):** `game/life/goods-sight.ts` (`goodsInSight`, `missingGoodsNote`, palabras genéricas que no cortan); la sesión lo llama después de `planFromDraft` y antes de los avisos de factibilidad. Test en `goods-sight.test.ts`. Queda `play-refs-objects-larder` (con bump).

**play-refs-objects-loose (2026-10-24, rama `feat/play-refs-objects-loose`):** `sim/property/item-state.ts` `ITEM_LOOK`; `sim/perception/stimuli.ts` `thingStimulus` (clave `thing` al final de `PERCEPT_KEYS`, no corre tiradas de nadie); `game/life/view.ts` `itemsSeen` (fork `view-items`); `game/life/known.ts` `thingWords` y el tercer argumento `things` de `knownEntities` (la sesión lo guarda en `thingsNow`); `sim/actions/draft.ts` `thingArg` para `take`/`give`; `plan.ts` acepta un `item:` en un rol de texto; `resolve.ts` corta `take`/`give` de un ítem sin `itemClaims`. El `kind` es `object` (no `item`, que es el prefijo de id). Test en `known-things.test.ts`. Quedan `play-refs-objects-source` y `play-refs-objects-look`.

**play-refs-objects-fixtures-move:** Rama `feat/play-refs-fixtures-move`: `game/life/known.ts` `knownSpaces` suma «el granero» (edificio `granary` vivo, su primer espacio), «el fogón»/«la cocina» en los nombres de la casa propia y «el depósito»/«la despensa»/«el almacén» para el cuarto `<casa>/store` propio. Test en `site-move.test.ts`. Sin bump. `look`/`use` sobre lo fijo quedan en `play-refs-objects-fixtures-look-use` (faltan los modos en actions).

**play-refs-objects-larder (2026-10-24, rama `feat/play-refs-objects-larder`):** motor `life-43`; `act.ts` pasa `homeLarder` (el hogar) a `take` cuando el actor está en un espacio adentro de su casa (`atHome`), y `homeOrPlace` (resolve) elige la despensa si lo que nombra no está suelto en el lugar o el lugar está vacío. `legacyNoLarderTake` cablea el replay (create, world, life). Tests: `sim/actions/resolve.test.ts` («de la despensa en casa») y `life/larder-take.test.ts` (vida real, conservación).

**play-recognition-flicker:** Rama `feat/play-recognition-flicker`: quien se reconoció hace un momento y sigue a la vista no se vuelve «un viejo» en la mirada siguiente (`heldRecognition` en la vista, ventana `RECENT_SIGHT_TICKS` de 15 min sobre la creencia `at`). Sin bump de motor: no toca la verdad. Siguen los sub-ítems del HUD y la escena.

**play-hint-verbs (2026-10-23, rama `feat/play-verb-words`):** `ui/hints.ts` (`hintOf`, `suggestionPhrase`, `COMMANDS`) arma la línea y lo que se completa; `Session.hint()` lo expone, `Panels.hint` lo lleva a la web y la CLI imprime la línea antes de cada `>`. `ui/web/complete.ts` (sin imports, lo usa el cliente) completa la última palabra; `App.tsx` la muestra bajo el chat con Tab y flechas. `VerbWordBook.closest` da el «¿Quisiste decir…?». Tests en `ui/hints.test.ts` y `server.test.ts`. Siguen `play-refs-objects-loose` y `play-refs-objects-goods`.

**play-help-verbs (2026-10-23, rama `feat/play-verb-words`):** `VerbWordBook.help`/`helpOf` (`llm/verb-words.ts`) arman «!verbos» y «!verbos X» desde la tabla; `ui/session.ts` los despacha con los nombres del catálogo y `HELP` lo nombra. Tests en `verb-words.test.ts` y `ui/cli/loop.test.ts`.

**play-bang-commands (2026-10-23, rama `feat/play-verb-words`):** `llm/grammar.ts` cambia la regex `META` por `BANG` (solo una línea con `!` es `meta`, con el texto sin el `!`); `ui/session.ts` descarta un `meta` que venga del modelo, `HELP` y el placeholder de la web dicen `!ayuda`; las reglas del parser dicen que nunca conteste `meta` y salen los dos ejemplos `meta` de `parser-examples`. Tests en `site-move-grammar.test.ts` y `ui/cli/loop.test.ts`.

**play-verb-words + guard (2026-10-23, rama `feat/play-verb-words`):** `content/llm/verb-words/es.json` (schema `VERB_WORDS` en `game/view/content.ts`) con formas y sinónimos de los 27 verbos; `llm/verb-words.ts` `VerbWordBook` reescribe el comienzo de cada paso en `grammar.ts` y va como pista al prompt del parser (`parserSetup`); la gramática suma hunt, spare, consume, boil, filter, forge y hire. `verbWordProblems` es la guardia (mínimo 4 sinónimos, conflictos con el par, salida `shared`). Siguen `play-bang-commands`, `play-help-verbs`, `play-hint-verbs`.

**play-hud-danger (2026-10-23, rama `feat/play-hud-danger`, encima de `feat/play-hud-sky`):** `Hud.danger` (nivel 0-3 y de cuántos viene) desde `dangerOf` (life/hud): por percept, la apuesta del verbo leído (con pelear como amenaza, `COMBAT_SEEN_RISK`) y lo que teme del que reconoce (`otherBeliefFrom` con el miedo de la relación), por la confianza de cada lectura. Chip ⚠️ en `TopBar.tsx`. Tests en `hud.test.ts`. Sin bump de motor. Pendiente aparte: ningún verbo de `content/actions` declara `stakes`, así que `seenHarm` de decide queda en 0 (darle `harm` a `strike` cambia la sim: va con bump).

**play-hud-sky (2026-10-23, rama `feat/play-hud-sky`, encima de `feat/play-hud-more`):** `Hud.moon` y `Hud.stars` desde `nightSky` (life/hud), luna y estrellas en `TopBar.tsx` y `Scene.tsx`. Tests en `hud.test.ts`.

**play-scene-buildings (2026-10-23, rama `feat/play-scene-buildings`, encima de `feat/play-scene-more`):** `seenBuildings` y `buildingsOf` en life/hud (`BUILDING` de settlements, materiales por gramos, desgaste por `condition`), `boxesOf`, `Houses`, `LitWindows` y `Flames` en `Scene.tsx`, interior por `place.building`. Tests en `hud.test.ts`. Sin bump de motor.

**play-npc-settlement-walk (2026-10-23, rama `feat/play-npc-settlement-walk`):** motor `life-42`; `act.ts` toma la aldea como destino de cualquier `move` y `planFromDecision` acepta `settlement:` como parte de entidad (`legacyNoSettlementWalk` por `engineOptions`/LifeOptions/LifeWorld hasta `act` y `npcVerbsProcess`). Tests en `site-move.test.ts` y `npc-verbs.test.ts`. Sin efecto medido a 2 años: nadie decide ir a la aldea todavía.

**play-novel-entry-fallback (2026-10-23, rama `feat/play-novel-entry`):** `sim/family/village.ts` busca con `BIRTH_AGE_SLACKS` y explica el fallo (`NoSuchBirth` con el motivo de `playerFits`); `game/life/create.ts` `birthFilter` devuelve el motivo. Test en `family.test.ts`.

**play-scene-more (2026-10-23, rama `feat/play-scene-more`):** `game/life/hud.ts` suma `people.figures` (lo leído de cada percept: edad, sexo, ropa, reconocido) y `place.fire` (fuego encendido en el cuarto, `undefined` sin `HEARTH`); `Scene.tsx` dibuja las siluetas con eso y el hogar solo si arde. Test en `hud.test.ts`. Sin bump de motor. Quedan `play-scene-buildings` y `play-scene-animals`.

**play-hud-more (2026-10-23, rama `feat/play-hud-more`):** `game/life/hud.ts` suma `mood` (emociones propias decaídas + carga de `conscience`) y `warmth` (`warmthOf` sobre `THERMAL`); `ui/web/api.ts` y `TopBar.tsx` los pintan como chips. Tests en `hud.test.ts`. Sin bump de motor. Lo que falta de la barra quedó en `play-hud-load`, `-clothing`, `-sky`, `-danger` y `play-hud-qi` (Fase 4).

**play-stroll-duration:** Rama `feat/play-stroll-duration`: dar una vuelta por la aldea dura lo pedido o 15 min (`for` opcional de `move`, solo del parser del jugador; `siteWalk` toma el máximo). Sin bump: los NPC no lo usan. Siguen `play-refs-objects` y `play-npc-settlement-walk`.

**play-speak-duration (2026-10-23, rama `feat/play-speak-duration`):** motor `life-41`; `sim/actions/attempt.ts` `actionDuration(…, speech)` con `speechSeconds`; `catalog.ts` `SpeechDuration`; `fixedSpeech` en `ResolveInput` y `legacyFixedSpeech` por `engineOptions`/LifeOptions/LifeParts/ActOptions. Test en `actions.test.ts`.

**play-names (2026-10-23, rama `feat/play-names`):** motor `life-40`; `sim/language/names.ts` alarga los nombres cortos (`MIN_NAME_LETTERS`, `nameRules`, `legacyShortNames` por `engineOptions`/LifeOptions/LifeParts hasta `birthProcess`). Tests en `names.test.ts`; aserciones de `engineOptions` actualizadas.

**Lote play-web (2026-10-23, rama `feat/web-hud-ambient`):** primeros ítems de «Jugable primero» del ROADMAP: `play-quiet-presence` (la narración no repite a los presentes quietos) y `play-web-hud` (barra de arriba, fondo borroso del entorno, colores por la luz, paneles redimensionables). Después, en la misma rama: `play-site-move` (moverse entre espacios del sitio: afuera, plaza, casa, casa de X), `play-world-family` (`--world`, la familia se elige al empezar) más color en el fondo (`play-scene-more` parcial) y `play-people-addressable` (hablarle a quien se ve sin reconocerlo, personas presentes en color y con clic en la web, HUD que cuenta a la familia). Queda anotado `play-recognition-flicker`. Rama `feat/play-refs-figure` (encima de la anterior): `play-refs-figure` (referencias contra lo narrado, palabra exacta en `resolveRef`) y `play-llm-invented-acts` (el validador semántico rechaza actos propios que no pasaron). Rama `feat/play-arrivals`: `play-arrivals` (quién aparece y quién se deja de ver entre dos escenas del mismo lugar, solo vista). Rama `feat/play-world-choice`: `play-world-choice-screen` (pantalla de inicio en la web cuando el guardado está vacío); queda `play-novel-entry-fallback`. Rama `feat/play-refs-more`: `play-refs-more` (pozo/centro/por ahí como la plaza, espacios por varias palabras, pasear sin destino); quedan `play-refs-objects` y `play-stroll-duration`. Siguen `play-speak-duration` y el resto de «Jugable primero».

**Estado (2026-10-21):** develop en `f363690` (#655), ramas de trabajo retiradas. Rama `chore/workflow-cleanup`: ROADMAP depurado (cerrados en `history/`) y método unificado. Rama `feat/item-claims-take`: cadena `perfil2-item-claims-take` completa (loss, state, act, audit, give, replay-profile). Donación normativa integrada después (c7982cb). Siguiente: `perfil2-item-claims-profile-measure` y `perfil2-directed-coverage`. Fase 3 abierta.

**Lote mortal-processes-wire (2026-10-21, rama `feat/mortal-processes-wire`):** `mortalTech` opt-in (siembra `tech.seeded`, enseñanza `life.tech-teach`, cosecha con `yieldFactor`); apagado conserva el hash. Ver ROADMAP `mortal-processes-wire`; pendientes `-profile`, `-act`, `-world`.

**Lote mortal-processes-profile (2026-10-22, rama `feat/mortal-processes-profile`):** `--tech` (CLI/web) y escenario `mortal-tech`; `sim:batch` 3 seeds x 2 años sin deriva en población/cosecha. No entra en `FULL_PROFILE`: queda `mortal-processes-profile-full`. Pendientes `-act`, `-world`.

**Lote psy-conditions-culture (2026-10-21, rama `feat/psy-conditions-culture`):** primer sub-ítem `psy-conditions-labels-core`: núcleo puro `sim/mind/condition-labels.ts`, rasgo `mind.theory` y `content/mental-labels/`; sin cablear, hashes intactos. Segundo sub-ítem `psy-conditions-kinds` (rama `feat/psy-conditions-kinds`): `grief`/`depression`/`addiction` en `ConditionKind` y `sim/mind/condition-onset.ts` (núcleo puro, sin cablear, hashes intactos). Tercer sub-ítem `psy-conditions-wire` (rama `feat/psy-conditions-wire`): `conditionLabels` opt-in, duelo al `body.died` en `life.appraise` y trato cultural en la cura de `life.consolidate`; apagado conserva BASE_HASH. Cuarto sub-ítem `psy-conditions-beliefs` (rama `feat/psy-conditions-beliefs`): atributo `condition` en `BELIEFS` y proceso opt-in `life.condition_beliefs` (el afectado y su hogar creen el mal con la etiqueta de su teoría); apagado conserva BASE_HASH. Pendientes en ROADMAP: `psy-conditions-stigma` (estigma a la reputación, `hides`, depresión por estrés y trauma/culpa etiquetados), `psy-addiction-mind`, `-profile`.
**Lote psy-tastes-demand (2026-10-21, rama `feat/psy-tastes-demand`):** `tasteDemand` opt-in: `tasteDemandFactor` (`sim/mind/taste-demand.ts`) corre lo máximo que paga quien compra en `trade` según sus gustos de comida/bebida (`demandGoods`); apagado conserva el hash. Pendientes en ROADMAP (`-seller`, `psy-tastes-gifts`, `-pastimes`, `-profile`).

**Lote psy-conditions-stigma (2026-10-21, rama `feat/psy-conditions-stigma`):** `conditionStigma` opt-in (requiere `conditionLabels`): `STIGMA` (`mind.stigma`) y `life.condition_beliefs` ampliado; los conocidos de afuera creen el mal y le ponen estigma salvo que la familia lo esconda (`hides`). Apagado conserva el hash. Pendientes en ROADMAP: `psy-conditions-stigma-effects`, `psy-conditions-onset-wire`.

**Lote psy-conditions-onset-wire (2026-10-21, rama `feat/psy-conditions-onset-wire`):** con `conditionLabels`, `life.sleep` abre depresión por estrés crónico (`openChronicDepression`) al despertar; apagado conserva BASE_HASH. Pendiente en ROADMAP: `psy-conditions-onset-pressures` (enfermedad y aislamiento en la presión).
**Lote psy-stages-rites (2026-10-21, rama `feat/psy-stages-rites`):** `stageRites` opt-in (requiere `lifeStages`): ritos de paso desde `rites.coming_of_age` (`life.rite-of-passage` con padrino adulto, o `riteMissed` + `life.rite-missed`); apagado conserva el hash. Ver ROADMAP `psy-stages-rites`; el déficit de `belonging` sigue en `psy-belonging`.
**Lote psy-dreams (2026-10-21, rama `feat/psy-dreams`):** `dreams` opt-in: `sim/mind/dreams.ts` (`composeDream`) y `life.consolidate` emite `mind.dreamt` con memorias como causas; apagado conserva el hash. Sub-ítems abiertos en ROADMAP (`psy-dreams-culture`, `-injected`, `-narrate`).

**Lote psy-attachment (2026-10-21, rama `feat/psy-attachment`):** `attachmentBias` opt-in (requiere `lifeStages`): el apego de `DEVELOPMENT` tiñe en `life.appraise` la confianza previa y la lectura de amenaza de cercanos; apagado conserva el hash. Pendiente: ROADMAP `psy-stages-attachment-closeness`.

**Lote psy-belonging (2026-10-21, rama `feat/psy-belonging`):** pertenencia opt-in `belonging` (`sim/mind/belonging.ts` núcleo puro + `src/game/life/belonging.ts`: `BELONGING` por persona, `life.belonging` con `-deficit`/`-restored` y causa); apagado conserva el hash. Ver ROADMAP `psy-belonging`; pendientes `psy-belonging-rite`, `-utility`, `-profile` y `psy-meaning-need`.

**Lote life-stages-wire (2026-10-21, rama `feat/life-stages-wire`):** `lifeStages` opt-in (`DEVELOPMENT` por persona al materializar, `life.stages` con `life.stage-entered`, audacia con `riskBias` de la etapa); apagado conserva el hash. Ver ROADMAP `psy-stages-wire`; pendientes `-rites`, `-attachment`, `-peers`, `-ancient`.

**Lote wild-forage (2026-10-21, rama `feat/harvest-stock`):** forraje silvestre opt-in `wildHarvest` (stock en pie `WILD` que rebrota, `life.wild` mina de la fuente `wild` a los lugares de monte lo que da `harvestStock`; `gather` lo toma); apagado conserva el hash. ROADMAP `wild-forage`; pendientes `wild-fields-water`, `wild-hunt`, `wild-wood`, `wild-belief`.

**Lote wild-hunt (2026-10-21, rama `feat/wild-hunt`):** caza opt-in `wildHunt` (`sim/living/hunt.ts`, cobro dentro de `life.ecology`: individuos enteros, evento `wild.hunted`, carne `good:venison` desde la fuente `hunt` a los montes); apagado conserva el hash. ROADMAP `wild-hunt-game`; pendiente `wild-hunt-verb` (verbo/rutina que recoja la carne; pesca).

**Lote wild-hunt-verb (2026-10-21, rama `feat/wild-hunt-verb`):** verbo `hunt` (resolver `gather`, carne `good:venison` de los montes a quien caza); apagado conserva el hash. ROADMAP `wild-hunt-verb`; pendientes `wild-hunt-effort`, `wild-hunt-skill`, `wild-hunt-npc`, `wild-fish`.

**Lote wild-gather (2026-10-21, rama `feat/wild-gather`):** test de punta a punta de un `gather` real con `wildHarvest` (`src/game/life/wild-gather.test.ts`): el rendimiento diario y el stock en pie bajan al recolectar varios días en un monte pobre (`wildCapacityScale`). Corregido: antes el stock solo bajaba por la ventana inicial; ahora la cuenta del lugar es la ventana diaria (lo tomado baja el stock al reponer, lo que sobra vuelve al monte; `wild.supplied` con `minted`/`returned`). Pendiente `wild-wood` (no hay verbo de tala ni vínculo con `PatchVegetation`: lote propio).

**Lote field-manure (2026-10-21, rama `feat/field-manure`):** abono opt-in `fieldManure` (excreted -> aldea -> field-manure -> `afterManure` en `life.soil`); apagado conserva el hash. Ver ROADMAP `field-manure`; pendientes `field-manure-diet` (hecho) y `field-manure-removed`.
**Lote field-manure-diet (2026-10-21, rama `feat/field-manure-diet`):** `fieldManureDiet` opt-in (calidad del abono desde la proteína de la dieta, `manureQualityOf`); apagado conserva el hash. Parte pendiente: ROADMAP `field-manure-household`.

**Lote life-stages (2026-10-21, `feat/life-stages`):** `sim/mind/development.ts` (núcleo puro, sin cablear: no cambia hashes; fuera de FULL_PROFILE): etapa por edad vivida con evento causa, apego derivado de esquemas, `riskBias`/`peerWeight` por etapa. Ítem de Fase 3 partido en `psy-*` en el ROADMAP; sigue `psy-stages-wire`. Check en `sim-reports/check-life-stages.log` (local).

**Lote coop-projects (2026-10-21, `feat/coop-projects`):** `sim/schemes/{project,pool,coop}.ts` (núcleo puro, sin cablear: no cambia hashes; fuera de FULL_PROFILE): `Project` cooperativo con `knownPlan`, pool entero con conservación, reparto como `Commitment`, free riders y salida. Pendientes en el ROADMAP: `coop-wire`, `coop-betrayal`, `coop-lod`. Check en `sim-reports/check-coop-projects.log` (local).

**Lote coop-wire (2026-10-21, `feat/coop-wire`):** cableado opt-in `LifeOptions.coop` (requiere `council`; `game/life/coop.ts`, proceso `life.coop`): canal de aldea con aportes de grano de los hogares por el ledger, free riders, salidas, reparto o reintegro; apagado = hash idéntico (`BASE_HASH`), fuera de FULL_PROFILE. Sigue `coop-wire-b` (caravana, `Commitment` ejecutado, decisión por `life.decide`, CLI), luego `coop-betrayal`, `coop-lod`. Check en `sim-reports/check-coop-wire.log` (local).

**Lote mortal-processes (2026-10-21, `feat/mortal-processes`):** `sim/technology` (núcleo puro) y `content/techprocesses/` (18 procesos): catálogo con `feasibility`, `ProcessKnowledge` por persona con `yieldFactor`/`storageFactor`, y `teachProcess`/`learnFromManual`. Sin cablear a la vida (no cambia hashes; el cableado opt-in `--tech`/`FULL_PROFILE` queda `[ ]` en el ROADMAP, después de «Abono de los campos»). `npm run check` sobre `855d0a6`: 482 archivos, 3336 tests, exit 0 (`sim-reports/check-mortal-processes.log`, local).

**Lote perfil3 (2026-10-21, #660 + este PR):** `life.gossip` memoizado y reloj por proceso; `npm run check` sobre `3cb88b6`: 478 archivos, 3307 tests, exit 0 (`sim-reports/check-perfil3.log`). Este PR es solo docs: cierra `perfil3`/`perfil5`, abre `perfil3b` (crear la `Life`). Lote epílogo corto (rama `feat/epilogue-short`): `epilogue.ts` + `--epilogue`; ver ROADMAP `epilogo-corto`.

Validación del lote `feat/item-claims-take`: `npm run check` sobre `4a83cd4` (cadena take+give+replay): 477 archivos, 3298 tests, exit 0 (`sim-reports/item-claims-check.*`). La donación (c7982cb) se verificó solo con typecheck, lint y 63 tests dirigidos (property, auditoría de ítems, replay); la suite completa no se repitió.

Lote #655: WIP funerario completado, cinco actualizaciones compatibles de #651
y arreglo de floorDiv. Código final `034b6d1`; producción `8d161d3`.
Tumba física opt-in `funerals.physicalGraves`, con PLACE/ENTITY y cuenta propia,
cadáver/proveedor/organizador en el mismo hex/space. Omitir la opción conserva
el modo previo. Sin activaciones de defaults ni cambios de hashes dorados.
Las ramas social, contrato y núcleo puro ya se integraron en #652/#653/#654.

Validación final:
- `npm run check` sobre `8d161d3`: typecheck/lint/capas aprobados; 3283 tests
  aprobados y uno fallido en una propiedad de precisión de council-testimony.
  Duración Vitest 1047,49 s, exit 1. Log/exit `sim-reports/branch-integration-check.*`.
- `034b6d1` modifica solo ese test: respeta el redondeo existente a seis
  decimales y agrega el contraejemplo fijo, sin cambiar pesos ni producción.
  32 tests finales de core/time, council-testimony y funerales aprobados, exit 0
  (`branch-integration-final-targeted.*`). Typecheck y lint repetidos, exit 0
  (`branch-integration-final-{typecheck,lint}.log`, `final-static.exit`).
- Evidencia combinada, sin repetir la suite completa por la corrección exclusiva
  de la prueba. No describir la corrida amplia original como verde. Las pruebas
  cubren también game, scheduler y persistence; el código de producción no
  cambió tras esa corrida. Diff, enlaces y LF comprobados para docs finales.

PR #651 sustituida por #655: se conservan TypeScript 6 y tipos Node 24 porque
dependency-cruiser 18.6 con TS7 omite fuentes (0 módulos, pese a exit 0).
Con TS6 analiza 1050 módulos/5054 dependencias. Bloqueo externo persistente en
`toolchain-typescript7`; no saltear ese control para integrar versiones nuevas.

[Inventario completo y respaldos](history/branch-audit-2026-10-20.md): 17
worktrees auditados; únicos WIP preservados en snapshots `54909ad` (funeral)
y `9a1068f` (claims), incorporados o completados en los lotes correspondientes.
Conservar todos los worktrees detached, carpetas y junctions; no son líneas
activas ni cambios sin guardar. Solo main/develop deben permanecer como ramas
locales/remotas después del cierre. No volver a integrar los snapshots antiguos.

Próxima tarea: `perfil2-item-claims-take-loss` (luego state, act, audit como un lote); simulation §3 describe el contrato, sin implementar.

**Lote coop-wire-b1 (2026-10-21, rama `feat/coop-wire-b`):** el reparto de `life.coop` vive como `Commitment` `project-share` en `contracts.commitment` (se escribe al fundar, se reescribe al cambiar el proyecto); apagado conserva el hash. `coop-wire-b` partido en b2-b6 (ROADMAP); sigue `coop-wire-b2`.
