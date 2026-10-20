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
Caso de bajo impacto: un núcleo puro nuevo sin consumidores, efectos al cargar,
procesos, RNG ni cambios de estado/contenido se verifica con typecheck, lint y
tests del módulo y sus contratos existentes. La suite amplia corresponde al
lote que lo conecte o a cambios transversales; no repetirla solo por exportarlo.
Si una corrida amplia solo falla por un fixture y el arreglo posterior cambia
únicamente ese fixture, registrar ambos resultados y repetir los archivos
afectados y checks estáticos; no presentar la corrida original como aprobada.
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
**2026-10-20: #652 y #653 integrados por squash a develop, `ec05d59`.**
Git fetch, push, consulta y merge funcionan con permisos ampliados en esta sesión.
PR #651 de dependencias sigue fuera de alcance. Worktrees temáticos conservados;
sus cambios sociales ya entraron en #652, no volver a integrarlos por hash.

Lote anterior: entierro y crédito opt-in, sucesión de bandas, percepción NPC de
asaltos y deliberación del consejo, reservas de ofrendas, núcleo de productos de
culto, métricas de oscilación y método compartido Claude/Codex. Defaults y motor
sin cambios. [Evidencia y límites](history/handoff-social-continuity-2026-10-20.md):
check de producción `487abdd` con 3239 tests aprobados y dos fallos del fixture;
fixture reparado en `d4e5395`, 15 tests afectados aprobados, typecheck/lint exit 0.
No se repitió la suite amplia tras ese cambio exclusivo de pruebas.

Diseño de objetos con identidad integrado en #653 (`ec05d59`), sin código,
revisado independientemente y con diff/LF/enlaces comprobados. ROADMAP divide
contrato, núcleo puro, take con contienda, give y replay/perfil. Diseño en
property §12 y dueños en ARCHITECTURE §4.5.

Lote actual, base `ec05d59`, coordinador `feat/f3-item-claims-core`: agente en
`.worktrees/itemclaims`, rama `feat/f3-itemclaims-agent`, implementa solo núcleo
puro de posesión/donación y tests en sim/property; sin componentes activos ni
consumidores, defaults, motor o contenido. node_modules es junction, conservar.
Núcleo integrado localmente en `01c4f26`; corrección de titulares Party y dos
casos colectivos en `61091e3`. 40 tests de property aprobados, typecheck y lint
exit 0; logs `sim-reports/item-claims-core-{tests,typecheck,lint}.log` y tests.exit.
Sin suite amplia adicional: núcleo nuevo sin consumidores ni efectos al cargar.
El agente agotó su cuota después de dejar la corrección sin commit en su
worktree; coordinador incorporó y verificó ambos archivos. No reintegrarlos.

Inventario de ramas auditado por pedido del usuario (2026-10-20):
- Bandas y culto: commits/archivos incorporados a #652; worktrees limpios.
  Cult tiene patch-ids distintos en dos commits, pero archivos de núcleo/tests
  idénticos a la rama coordinadora integrada. No necesitan otro merge.
- Funerales: commits incorporados a #652, pero **cuatro archivos sin commit**
  permanecen en `.worktrees/funeral`: funerals.ts/test, loans.ts y world/space.ts.
  Son avance de tumba física/cadáver local, no integrado; ROADMAP `funeral-tomb-wip`.
  Respaldo sin alterar el worktree: `sim-reports/funeral-tomb-wip-before-integration.patch`.
- Remoto real (`git ls-remote --heads origin`): main, develop y dependabot #651.
  Las referencias origin/feat de #652/#653 están obsoletas, no son PR pendientes.
- Claims: rama coordinadora y worktree del agente activos. No borrar junctions,
  worktrees ni cambios sin commit como parte de limpiar nombres de ramas.

Siguiente: integrar el núcleo; retomar `funeral-tomb-wip` antes de abrir take.
