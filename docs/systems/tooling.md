# Persistencia, inspector y herramientas

> Principio: **un mundo que no se puede inspeccionar no se puede arreglar.** El guardado es el mundo entero (verdad, creencias, log causal); el replay prueba que la simulación es determinista; el inspector ve todo sin tocar nada; la sim headless mide antes de calibrar. Estas herramientas son prioridad desde el día 1 (ARCHITECTURE).

> Estado: **borrador** (2026-10-06).

Depende de: [simulation.md](simulation.md) §2, §13-§15, §18 (diffs, presupuesto, determinismo, snapshots, inspector del motor), [causality.md](causality.md) §8-§11 (compactación, presiones, inspector, contrafácticos), [player-loop.md](player-loop.md) §10-§12 (comandos, inspector con marca, guardado sin vuelta atrás), [narration.md](narration.md) §1, §9, §12 (proveedores LLM, validador, banco de pruebas).
Lo usan: todos los sistemas (cada uno agrega comandos del inspector y métricas), la CI, el proceso de calibración de todos los docs ("Preguntas abiertas: calibración").

---

## Principios

1. **Se guarda la verdad completa,** no un resumen: entidades, componentes, creencias, memorias, ledger, log de eventos con causas. Lo que no está en el guardado no existió.
2. **Replay = seed + planes validados + versiones.** Reproducir una partida desde ahí da el mismo estado byte a byte. Si no, es un bug.
3. **Las herramientas nunca escriben en la verdad.** Todo lo que resuelve, materializa o simula (inspector, contrafácticos, `--dry`) corre sobre una copia descartable.
4. **Medir antes de ajustar.** Cada número de calibración vive en `content/tuning/` con un objetivo, y la sim headless lo mide sobre muchas seeds.
5. **Versiones explícitas** del motor, del contenido y del formato de guardado.

---

## 1. El guardado

**SQLite** (`node:sqlite`), un archivo por vida, en modo WAL.

```
meta            (key, value)                                    -- seed, versiones, modo (realista/novela), marcas (inspector, restaurado)
entities        (id, kind, origin_event_id, created_tick, removed_tick)
components      (entity_id, kind, data)                         -- estado actual; data en serialización canónica
events          (id, tick, type, data, emissions)               -- append-only
causes          (event_id, cause_kind, cause_ref, weight)       -- el grafo causal, indexado en las dos direcciones
beliefs         (agent_id, belief_id, subject, data)            -- las creencias son muchas: tabla propia con índice por sujeto
memories        (agent_id, memory_id, event_id, data)
ledger          (account, unit, tick, delta, event_id)          -- conservación: bienes, dinero, qi, almas
player_plans    (seq, tick, plan, source_text_hash)             -- lo que entra al replay
snapshots       (tick, kind, blob)                              -- checkpoints completos comprimidos
diffs           (tick, step, process_id, blob)                  -- diffs por paso entre snapshots (para el inspector en el tiempo)
narration       (seq, tick, mode, text, request_hash)           -- bitácora y memoria de narración; nunca la lee la sim
```

- **Escritura por turno:** cada paso del scheduler produce diffs (simulation §2); se aplican en memoria y se escriben en una transacción al final de cada turno del jugador (o cada N pasos en saltos largos). Un corte de luz pierde a lo sumo el turno en curso.
- **Snapshots:** completos cada cierto tiempo de mundo, al cerrar una sesión y al cerrar una época. Entre snapshots quedan los diffs, que se borran (o se compactan) cuando ya no hacen falta para el inspector.
- **Compactación** (simulation §15, causality §8): los eventos viejos y livianos se resumen en eventos agregados; lo fijado por percepción del jugador se conserva mientras viva.
- **Tamaño objetivo:** una vida larga entra en unos cientos de MB; los snapshots van comprimidos y los diffs viejos se podan. Se mide en Fase 5.
- **Hecho en la Fase 0** (`src/persistence/`): el esquema sigue a ARCHITECTURE §7.5 donde difiere de la tabla de arriba. Cada tipo de componente tiene su tabla `"c:<nombre>"` (id, JSON canónico, SHA-256); la ficha `entities` es el componente `entity`, con índices por `originEventId`, `endEventId` y `createdAt`. Los índices del inspector son sobre expresiones (`json_extract(data, '$.campo')`), declarados al abrir el archivo: agregar uno no cambia el esquema ni pide migración. Los eventos guardan el JSON entero más `tick`, `kind` y `resolution` en columnas, con `event_actors` y `causes` (`cause_ref` = id del evento, presión o creencia, o `entidad#clave`) indexadas para `eventsOf` y `citing`. El `ledger` guarda transferencias (de, a, cantidad), que es lo que rehace `Ledger.fromJournal`, en vez de filas de débito y crédito. Contadores de ids, estado del scheduler y fuentes del ledger van en `meta`, junto a `format` (hoy 1). `save` es incremental (lo nuevo del registro y el diario, y los componentes cuyo hash cambió); un snapshot guarda la verdad, contadores y scheduler más la marca hasta dónde llegaban registro y diario, y se rehace leyendo esas tablas hasta la marca. Creencias, memorias, diffs y narración llegan con sus tareas.

## 2. Serialización canónica y hash del estado

- **Canónica:** claves ordenadas, ids ordenados, enteros para las cantidades conservadas, flotantes con representación que vuelve exacta (simulation §14).
- **Hash del estado:** SHA-256 por tipo de componente y uno total. Se calcula en cada snapshot y, en modo debug, en cada turno.
- **Sirve para:** el test de determinismo (comparar hashes, no archivos), el detector de divergencias del replay (§3) y comprobar que las herramientas no escriben (el hash no cambia después de usar el inspector).

## 3. Replay

```ts
interface ReplayInput {
  seed: Seed;
  versions: { engine: string; content: string; format: number };
  setup: NewGameSetup;                       // player-loop §1, sin la config del LLM (no afecta el mundo)
  plans: { seq: number; tick: Tick; plan: ActionPlan }[];
}
```

- **Usos:** depurar, test de determinismo en la CI, y **paquetes de reproducción** (§9): un bug se reproduce con un archivo chico, sin el guardado entero.
- **El texto no se reproduce:** la narración guardada se muestra tal cual; el LLM no participa del replay (narration §10).
- **Detector de divergencias:** el replay compara el hash en cada checkpoint con el guardado; ante la primera diferencia busca el paso y el proceso cuyo diff cambió (por bisección sobre los hashes de diffs) y lo reporta.
- **No es para jugar:** en modo juego no hay API para volver a un estado anterior (player-loop §12).

## 4. Versiones y migraciones

- **Tres versiones:** motor (semver), contenido (hash de `content/`) y formato de guardado (entero).
- **Formato:** cada cambio de esquema trae una migración pura con test (guardado de la versión N → N+1).
- **Motor o contenido nuevos con una vida en curso:** la vida sigue con el motor nuevo desde el estado guardado. El replay desde el seed deja de valer más allá de ese punto, así que se registra un **límite de replay** (tick y versiones) en `meta`; el replay posterior arranca desde el snapshot de ese límite.
- **Contenido que desaparece** (se borra una hierba de `content/`): la migración la mapea a un reemplazo o la marca como "contenido huérfano" que el inspector lista.

## 5. Inspector

Solo lectura, en `tools/`, sobre una copia descartable cuando hace falta resolver algo. Usarlo con una vida en curso marca la vida (player-loop §11), **en los dos modos**: en modo novela el personaje tiene ventajas, pero sigue sin saber la verdad ([game-modes.md](game-modes.md)). La marca se pone solo si se abre el inspector.

**Catálogo** (cada sistema agrega los suyos; los ya definidos se listan con su doc):

| Grupo | Comandos |
|---|---|
| Entidades | `entity <id>` (todos los componentes), `find <consulta>`, `origin <id>` |
| Mentes | `mind <agente>` (temperamento, esquemas, objetivos, emociones), `decision <agente> [evento]` (candidatos, utilidades y la tirada), `memories <agente>` (recuerdo vs evento real), `relations <agente>`, `believes <agente> <hecho>`, `wrong <agente>` (creencias falsas con su origen) |
| Causalidad | `why`, `effects`, `pressures`, `pressure`, `hazard`, `plans`, `whatif`, `timeline` (causality §10, §11) |
| Motor | `lod`, `lod --ahead`, `tier`, `budget`, `materialize --dry`, `catchup`, `schedule` (simulation §18) |
| Habilidades y cuerpo | `why skill <agente> <habilidad>` (skills), `body <agente>` (el cuerpo real) |
| Economía y ledger | `ledger <cuenta>`, `market <lugar>` (precios reales vs creídos), `flows <región>` |
| Cielo | `heaven` (atención por zona), `karma <agente>` |
| Percepción e información | `percepts <agente> [tick]` (con `mistaken`), `rumor <id>` (el linaje de un rumor) |
| Tiempo | `at <tick> <comando>`: cualquier comando en un tick pasado, desde el snapshot anterior más los diffs |
| Libre | `query`: un REPL de TypeScript de solo lectura sobre un estado congelado, para lo que no tenga comando |

- **Salida:** tablas en la CLI desde Fase 1; mapas como PNG (la grilla hex de planet-gen con capas de presiones, LOD, qi, población) desde Fase 5; paneles web en Fase 9.
- **Ver como el personaje:** `view <agente>` muestra el `PlayerView` que armaría `buildPlayerView` para ese agente (narration §2), para depurar fugas y la narración.

## 6. Sim headless

```
npm run sim -- --seed 123 --years 50 [--region <id>] [--scenario <nombre>] [--report html|json]
npm run sim:batch -- --seeds 1..100 --years 300 --metrics demography,economy,war
```

- **Escenarios** (`content/scenarios/`): condiciones iniciales forzadas para probar un sistema aislado (una aldea con hambruna, dos sectas en guerra, un mercado con un acaparador).
- **Métricas** (cada sistema declara las suyas): población y muertes por causa, precios y tasas de interés, guerras y bajas, cultivadores por umbral, tribulaciones, karma, presiones y descargas por tipo, exactitud media de las creencias, deformación de rumores, conservación, rendimiento.
- **Reportes:** JSON para comparar y un HTML con gráficos y mapas para leer.
- **Comparar corridas:** `sim:diff A B` muestra cómo cambian las métricas al tocar un parámetro (A/B con las mismas seeds).
- **Nunca llama al LLM** (narration §12).

## 7. Calibración

Cada "Preguntas abiertas: calibración" de los docs se vuelve parámetros con objetivos:

```ts
// content/tuning/perception.ts
export const tuning = {
  faceRecognitionLegibility: { value: 0.62, range: [0.4, 0.9] },
};
export const targets = [
  { id: "night_face_30_paces", feel: "de noche, sin luz, a 30 pasos casi nadie reconoce una cara",
    metric: "recognition_rate(scenario: night_30)", expect: { max: 0.1 } },
];
```

- **El objetivo se escribe como sensación** (lo que el usuario espera que pase) y se traduce a una métrica con tolerancia.
- **Suite de calibración:** corre los objetivos sobre lotes de seeds; es lenta, se corre a mano o de noche, no en cada PR.
- **Ajuste:** a mano con `sim:diff`, o con un barrido de parámetros que reporta qué combinaciones cumplen los objetivos.

## 8. Invariantes en tiempo de ejecución

En modo debug (siempre en la sim headless y en la CI), cada N pasos:
- conservación por ledger y región;
- sin huérfanos (`originEventId` y causas válidas);
- ninguna descarga sin su presión sobre el umbral;
- `buildPlayerView` sin campos de la verdad (comparación contra el estado);
- hash sin cambios después de correr herramientas.

Una violación detiene la corrida y genera un paquete de reproducción.

## 9. Paquetes de reproducción

`repro.json`: versiones, seed, setup, planes hasta el fallo, tick y descripción del problema. Se generan automáticamente al violar un invariante, al fallar el validador del narrador dos veces (narration §9) o a pedido (`meta reportar`). Con eso se reproduce cualquier bug sin el guardado.

## 10. Herramientas del LLM

- **Grabaciones:** las llamadas al LLM se pueden grabar y reproducir (fixtures) para tests sin red.
- **Registro del validador:** cada salida rechazada con el pedido y la razón, para mejorar prompts.
- **Costos y latencia** por trabajo y por proveedor (relevante si se usa API; con modelos locales, latencia y uso de GPU).
- **Banco de pruebas de modelos** (narration §1): corpus de escenas en `content/llm/bench/`; corre cada proveedor, mide tasa de aprobación y latencia, y arma una vista **lado a lado** para que el usuario lea y elija. La tasa de aprobación solo descarta los que fallan; la prosa la juzga el usuario.
- **Corpus para el fine-tune futuro:** se guardan pares pedido → texto aprobado por el validador, listos para la Fase 9. Con `meta me gustó` el usuario marca el último texto narrado (o `meta no me gustó`), y esos pares entran con prioridad (o como ejemplos negativos).

## 11. Contenido

- **Validación con Zod** de todo `content/` al compilar y al arrancar; referencias cruzadas (una receta que pide una hierba que no existe) son error.
- **Verbos faltantes** que registra el parser (actions §9) y nombres de contenido huérfano, en un reporte.
- **Lint de contenido:** valores fuera de rango, entradas sin uso.

## 12. Rendimiento

- **Perfil por fase y proceso** (simulation §13): el comando `budget` y un reporte en la sim headless.
- **Benchmarks** en la CI (no bloqueantes): un turno de escena, un día de aldea, un año regional, un siglo de historia.
- **Perfiles de CPU** con `node --cpu-prof` desde los scripts.
- **Objetivos iniciales** (a ajustar): turno de escena sin LLM < 200 ms; un año de una región < unos segundos; la historia completa de un mundo en minutos.

## 13. Respaldo

- **Copias automáticas** rotativas del guardado (las últimas N sesiones), solo para corrupción del archivo.
- **Restaurar una copia** se permite siempre, aunque el archivo no esté roto: es una acción `meta` explícita, con confirmación, y la vida queda marcada como "restaurada" (con cuántas veces y desde qué momento). No es un "cargar partida" encubierto: la marca queda en el archivo de vidas.

## 14. Implementación por fase

- **Fase 0:** esquema SQLite mínimo (meta, entities, components, events, causes, player_plans), serialización canónica y hash, test de determinismo por hash, replay básico, CI con typecheck y tests, validación de `content/`.
- **Fase 1:** inspector CLI con `entity`, `why`, `effects`, `mind`, `decision`, `believes`, `view`; sim headless con reporte JSON; invariantes en debug; guardado por turno; banco de pruebas de modelos.
- **Fase 2:** `memories`, `wrong`, `percepts`, `rumor`; métricas de exactitud de creencias.
- **Fase 3:** escenarios, `sim:batch`, `sim:diff`, reporte HTML, primeros objetivos de calibración, snapshots y diffs con `at <tick>`.
- **Fase 5:** mapas PNG, `lod`, `tier`, `budget`, perfiles de rendimiento, poda de diffs y compactación, tamaño del guardado medido.
- **Fase 7:** `whatif`, `timeline`, migraciones con límite de replay.
- **Fase 9:** inspector web con mapas interactivos; corpus para el fine-tune.

## Tests

- **Determinismo:** mismo seed + mismos planes → mismo hash, en cada checkpoint.
- **Replay:** reproducir un guardado completo da el mismo hash final.
- **Herramientas sin escritura:** correr todo el catálogo del inspector y la sim headless no cambia el hash.
- **Migraciones:** cada migración convierte un guardado de prueba de la versión anterior y el resultado pasa los invariantes.
- **Detector de divergencias:** un proceso con un error de orden inyectado se detecta en el paso y proceso correctos.
- **Contenido:** un `content/` con una referencia rota no arranca.

## Decisiones (aprobado 2026-10-06)
- **Restaurar copias de respaldo:** siempre permitido, con confirmación y la marca "restaurada" en el archivo de vidas.
- **Marca de inspector en los dos modos:** también en modo novela, porque las ventajas no son saber la verdad. Solo aparece si se abre el inspector.
- **Banco de pruebas lado a lado:** el usuario lee y elige el modelo de narración; la tasa de aprobación solo descarta.
- **`meta me gustó` / `meta no me gustó`:** marcan textos narrados para el corpus del fine-tune.

## Decisiones tomadas en este borrador (revisables)

- **Un archivo SQLite por vida,** con tablas por tipo de dato y snapshots más diffs.
- **Hash por componente** como prueba de determinismo y de herramientas sin escritura.
- **Replay con planes validados y límite de replay** ante cambios de versión.
- **Inspector de comandos más un REPL de solo lectura.**
- **Calibración con objetivos escritos como sensaciones** y medidos en lotes de seeds.
- **Copias de respaldo solo contra corrupción;** restaurar marca la vida.

## Preguntas abiertas

- Calibración: intervalo de snapshots; cada cuánto correr invariantes en debug; cuántas copias de respaldo; tamaño de lote de seeds para la suite de calibración; objetivos de rendimiento.
