# Arquitectura

> Cómo se arma el código: capas, carpetas, reglas de dependencia, los tipos que comparten todos los sistemas y quién es dueño de cada uno, y en qué orden se implementa. Los docs de sistema (`docs/systems/*.md`) dicen **qué** hace cada sistema; este doc dice **dónde vive y con qué tipos habla con los demás**.

**Estado:** revisado el 2026-10-06 al cerrar el backlog de diseño 2 (#45), con los 46 docs de sistema escritos. Si un doc de sistema y este se contradicen en un tipo compartido, **manda este** y el doc de sistema se corrige en el mismo PR.

---

## 1. Las capas

```
Jugador (texto)
   │
   ▼
[LLM: intent parser] ── texto → ActionPlan (JSON validado con Zod) ─ narration §1, actions §3
   │
   ▼
[Juego: el turno] ── avanza el reloj, interrupciones, rutinas, guardado ─ player-loop
   │
   ▼
[Simulación] ── scheduler por fases con procesos puros ─ simulation
   │   acciones → resolución → Event[] con causes
   │   procesos de todos los sistemas (cuerpo, economía, clima, cultivo, Cielo...)
   │   percepción → Percept[] → creencias de cada agente
   ▼
[Persistencia] ── SQLite con la verdad completa, log de eventos, hashes ─ tooling
   │
   ▼
[buildPlayerView] ── el único muro entre la verdad y lo que el jugador sabe ─ narration §2
   │
   ▼
[LLM: narrador] ── PlayerView → prosa con referencias marcadas → validador con lista blanca
```

- **El LLM está solo en los bordes** (parser y narración, más la verbalización de diálogo y los textos dentro del mundo). Todo lo del medio es TypeScript puro y determinista.
- **La historia profunda es la misma simulación** corrida en resolución `history` (simulation §16): no hay un "generador de historia" aparte del scheduler.
- **Lo que el jugador ve sale de sus percepts y sus creencias**, nunca de eventos crudos.

## 2. Estructura de carpetas

```
src/
  core/                # sin dependencias
    rng/               # RNG por contador draw(seed, key, n), fork por tupla, sfc32 para flujos largos
    ids/               # Id<K>, contadores deterministas por tipo, EntityRef
    time/              # Tick, Duration, calendario base (los calendarios culturales son creencia: weather §6)
    types/             # Event, CauseRef, PlaceRef, HolderRef, Party, EntityBase
    ledger/            # conservación: bienes, dinero, esencia, almas (causality, cosmology §6)
    canon/             # serialización canónica y hash (tooling §2)
    schema/            # helpers de Zod y carga validada de content/
  worldgen/            # lo que existe antes de que corra el scheduler. Puro.
    law/               # tirada de la ley del mundo: familia, ejes, era objetivo (metaphysics, technology §9b)
    planet/            # grilla hex, tectónica, clima, biomas, esencia (planet-gen)
    cosmos/            # planos, cielo, astros (cosmology)
    elements/          # sistema elemental del mundo y su grafo (elements)
    seed-peoples/      # primeros pueblos, protolenguas, protoculturas (language, culture, deep-history)
  sim/                 # la simulación en curso. Puro: sin IO, sin Math.random, sin Date.
    scheduler/         # fases, procesos, cola, zonas y resoluciones, tiers, presupuesto (simulation)
    world/             # WorldTruth, celdas, lugares, grafo de espacios, materialización por ranuras
    causality/         # presiones, umbrales, descargas, consultas del grafo causal (causality)
    perception/        # canales, atención, percepts, huellas (perception)
    knowledge/         # creencias, rumores, medios, mapas, reputación, secretos (information)
    mind/              # temperamento, memoria, relaciones, utilidad, salud mental (npc-psychology)
    body/              # cuerpo por partes, heridas, enfermedad, nutrición, edad (body-health)
    skills/            # saber hacer, facetas, aprendizaje, oxidación (skills)
    actions/           # catálogo de verbos, ActionPlan, factibilidad, resolución, Outcome (actions)
    combat/            # pulsos, intercambio, heridas, moral (combat)
    dialogue/          # actos de habla, entender, persuasión (dialogue)
    elements/          # interact con conservación, campos (elements)
    crafts/            # sesiones por pasos, alquimia, forja, formaciones (crafts)
    economy/           # lotes, dinero, precios, mercados, crédito (economy)
    property/          # tenencia en tres capas, derechos, catastros (property)
    contracts/         # Commitment, ejecutores, juramentos (contracts)
    family/            # genoma, concepción, parentesco, hogares, herencia (family-lineage)
    social/            # posición, estatus, etiqueta, cara (social-structure)
    culture/           # rasgos, prevalencias, transmisión (culture)
    language/          # lenguas, cambio fonético, nombres, escrituras (language)
    religion/          # doctrinas, prácticas, clero, templos (religion)
    org/               # organizaciones, puestos, decisiones, maestro-discípulo (organizations)
    law/               # códigos, jurisdicciones, casos, castigos (law)
    state/             # estado, alcance, impuestos, burocracia, dinastías (state)
    war/               # fuerzas, logística, batallas, asedios (war)
    schemes/           # intrigas y proyectos cooperativos (schemes)
    settlements/       # anclas, edificios, deterioro, fuego (settlements)
    travel/            # Journey, rutas, mar, encuentros por cruce (travel)
    weather/           # sistemas de tiempo, balance de agua, estaciones (weather)
    ecology/           # poblaciones, redes tróficas, sucesión, bestias, domesticación (living-world)
    technology/        # procesos mortales, adopción, difusión (technology)
    discovery/         # hipótesis sobre la ley, experimentos, insights (discovery)
    divination/        # lecturas, profecías, presagios (divination)
    metaphysics/       # Law, Essence, Practice, Soul genéricos; interfaz que implementa cada familia
    families/          # una carpeta por familia de mundo; solo acá vive lo específico
      xianxia/         # cultivo, reinos, raíces, meridianos (cultivation)
      mysteries/       # caminos, secuencias, características, control (mysteries)
    heaven/            # el Cielo, atención, tribulaciones, karma, mérito (heaven-karma)
    spirits/           # almas ancladas, espíritus de lugar, ofrendas (spirits)
    cosmology/         # planos, barrera, ascensión, ledger de esencia y almas (cosmology)
    realms/            # reinos secretos y lugares sellados (secret-realms)
    history/           # embudo de épocas, olvido, estratos, arqueología (deep-history)
    chronicles/        # crónicas dentro del mundo como objetos con autor (chronicle §1, §2)
    modes/             # dedos de oro y reglas compuestas como entidades de la sim (game-modes)
  game/                # el turno, rutinas, interrupciones, metas, morir, espíritu (player-loop)
    setup/             # NewGameSetup, elección de nacimiento, modo novela
    view/              # buildPlayerView, etiquetas e ids locales (narration §2, §3)
    final-chronicle/   # crónica final desde la verdad, legado, epílogo (chronicle §3-§9)
  llm/                 # proveedores (plantillas, local, API), parser, narrador, verbalizador, validador, caché, MockLLM
  persistence/         # SQLite, guardado por turno, log de eventos, migraciones (tooling)
  ui/cli/              # terminal: chat, paneles, comandos fuera del personaje
  tools/               # inspector god-mode, sim headless, calibración, replay, paquetes de reproducción
content/               # datos validados con Zod, por familia de mundo donde corresponde
  actions/ plans/ events/ beliefs/ goods/ materials/ biomes/ species/ cultures/ languages/
  religions/ statuses/ law-codes/ tech/ crafts/ families/<familia>/ tropes/ tuning/
docs/systems/          # un doc de diseño por sistema
```

- **Un solo paquete al principio.** Si crece, se separa en workspaces (`packages/core`, `packages/sim`, `apps/cli`, `apps/web`) sin cambiar las reglas de dependencia.
- **Una carpeta por sistema dentro de `sim/`**, con su doc como fuente. Cada carpeta exporta sus tipos, sus `ProcessDef` y sus esquemas de `content/`; las demás importan solo desde su `index.ts`.
- **`families/`** es lo único que conoce la palabra "qi", "reino" o "secuencia". El resto del código habla de `Essence`, `Practice`, `Law` y `Soul` (metaphysics, principio). La familia se elige en worldgen y registra sus procesos en el scheduler.

## 3. Reglas de dependencia

```
core ← worldgen ← sim ← game ← llm / persistence ← ui / tools
```

- `sim` y `worldgen` nunca importan `game`, `llm`, `persistence`, `ui` ni `tools`, ni usan IO, `Math.random`, `Date` o el orden de iteración de objetos sin ordenar.
- `game` puede leer `llm` y `persistence` solo por interfaces inyectadas (el turno se testea con `MockLLM` y una base en memoria).
- **Entre carpetas de `sim/`** no hay ciclos: un sistema lee los tipos de otro desde su `index.ts`, pero **los efectos cruzados pasan por el scheduler** (diffs, eventos y presiones), no por llamadas directas que mutan estado ajeno.
- `families/*` depende de `metaphysics/`; nada fuera de `families/` importa una familia concreta.
- Se fuerza desde la Fase 0 (§7.10): dependency-cruiser para los imports (`.dependency-cruiser.cjs`) y Biome para los globales prohibidos (`biome.json`, `lint/determinism.grit`).

## 4. Tipos centrales (canónicos)

Viven en `core/types` y `core/ids`. Todos los docs de sistema los usan con estos nombres.

### 4.1 Ids y referencias

```ts
type Id<K extends EntityKind> = string & { readonly __kind: K };   // "agent:1042", asignado por contador determinista
type EntityKind =
  | "agent" | "org" | "household" | "item" | "lot" | "place" | "building" | "settlement"
  | "cell" | "zone" | "plane" | "realm" | "spirit" | "text" | "commitment" | "case"
  | "pressure" | "belief" | "memory" | "event" | "journey" | "force" | "scheme" | "lineage";

type AgentId = Id<"agent">;          // toda persona, también el jugador; bestias y espíritus que deciden
type OrgId = Id<"org">;              // familias extensas, clanes, sectas, gremios, estados, bandas
type HouseholdId = Id<"household">;
type ItemId = Id<"item">;            // objeto único con identidad
type LotId = Id<"lot">;              // bien a granel
type EventId = Id<"event">;
type CellId = Id<"cell">;            // celda hex de planet-gen
type PlaceId = Id<"place">;          // lugar con nombre: claro, cueva, cruce, tramo de camino
// ...uno por EntityKind

type EntityRef = Id<EntityKind>;     // cualquier entidad; el tipo se lee del prefijo

type Party = AgentId | OrgId | HouseholdId;            // quien puede tener, deber, prometer
type HolderRef = Party | PlaceRef;                     // lo que tiene un lote (un granero, una ruina)
type PlaceRef =
  | { kind: "cell"; cell: CellId }
  | { kind: "place"; place: PlaceId }
  | { kind: "building"; building: Id<"building">; space?: SpaceKey }
  | { kind: "settlement"; settlement: Id<"settlement"> }
  | { kind: "realm"; realm: Id<"realm">; at?: PlaceId }
  | { kind: "plane"; plane: Id<"plane"> }
  | { kind: "carried"; by: AgentId | Id<"journey"> };   // en la mano, en la carga de un viaje
```

- **`AgentId` es el único id de persona.** `PersonId` y `NpcId` (que aparecían en algunos docs) son `AgentId`. El jugador es un agente más con `tier: 4`.
- **Los ids no salen del RNG:** son contadores por tipo, en el orden en que el scheduler los crea. Así agregar un sistema no corre los ids de otro (el mismo motivo que `rng.fork`).
- **Las comunidades** (una aldea, un barrio) tienen derechos y deberes a través de una organización: el consejo de aldea u otra plantilla de organizations §13 es el titular de los comunales y de la reputación colectiva. Una comunidad sin ninguna organización es solo un `PlaceRef` de asentamiento.

### 4.2 Tiempo

```ts
type Tick = number;        // segundos absolutos desde el origen del mundo (simulation §1)
type Duration = number;    // segundos
type Time = Tick;          // alias: algunos docs dicen Time; es lo mismo
```

### 4.3 Eventos y causas

```ts
interface Event {
  id: EventId;
  tick: Tick;
  kind: EventKind;                   // catálogo en content/events, con un esquema de data por kind
  actors: EntityRef[];
  place: PlaceRef;
  outcome?: Outcome;                 // actions §7
  data: unknown;                     // validado por el esquema del kind
  emissions: EmissionProfile;        // qué emite por canal; los Percept se calculan (perception)
  causes: CauseRef[];                // grafo causal (causality §2)
  resolution: ZoneResolution;        // a qué resolución pasó: escena, local, regional, mundo, historia
}

type CauseRef =
  | { kind: "event"; event: EventId; weight?: number }
  | { kind: "pressure"; pressure: Id<"pressure">; weight?: number }
  | { kind: "belief"; belief: Id<"belief">; holder: AgentId | OrgId; weight?: number }
  | { kind: "state"; entity: EntityRef; key: string; weight?: number }   // "porque el granero estaba vacío"
  | { kind: "seed" };                                                   // condiciones iniciales del mundo
```

- **Toda entidad tiene `originEventId: EventId`** (o `{ kind: "seed" }` como causa del evento de origen).
- **Los eventos son inmutables.** Corregir algo es un evento nuevo con causa.
- **`Outcome`** es el de actions §7 (manda sobre la lista vieja `success | partial | ...`).
- **En el código `Event` es genérico** (`Event<TOutcome, TEmissions>`): `core` no puede importar `Outcome` (sim/actions) ni `EmissionProfile` (sim/perception), así que `sim` fija los tipos concretos con un alias.

### 4.4 La entidad base

```ts
interface EntityBase {
  id: EntityRef;
  originEventId: EventId;
  createdAt: Tick;
  endedAt?: Tick;                    // muerte, destrucción, disolución: la entidad queda para la historia
  endEventId?: EventId;
}
```

El modelo es un **ECS liviano**: cada sistema guarda sus componentes en su propia tabla por id (el `Body` de un agente, su `Mind`, sus `Skills`, su `PracticeState`), en lugar de un objeto gigante. Así cada sistema serializa, hashea y migra lo suyo (tooling §2).

### 4.5 Bienes: ítem o lote

- **`Lot`** (economy §1): lo fungible y a granel (arroz, cobre, hierbas, piedras espirituales de grado común). Se parte y se junta, conserva el origen.
- **`Item`**: lo que tiene identidad (una espada con nombre, un manual, una tablilla, un artefacto sellado, una característica de los misterios suelta). Es una entidad con `ItemId`, materiales con origen y su propia historia.
- **Pasar de uno a otro** es un evento: forjar una espada consume lotes y crea un ítem; fundir el ítem crea lotes. Los dos pasan por el ledger.

### 4.5b El ledger (`core/ledger`)

- **Doble entrada en enteros seguros.** Cada transferencia es `{unit, from, to, amount}` con `amount` entero positivo en la unidad mínima que elige el sistema (gramos, granos de cobre, micro-unidades de esencia). Nada de floats: la igualdad es exacta y un desborde es un error.
- **Asientos atómicos por evento** (`post({tick, eventId, transfers})`): entra todo o nada. Se valida el neto por cuenta, así que dentro de un asiento lo que entra puede volver a salir.
- **Cuentas:** las internas son las claves canónicas de un titular (`holderKey`: `agent:12`, `building:3/store`, `carried:journey:4`) y nunca quedan en negativo. Las externas (`ext:<nombre>`) son las fuentes y sumideros de economy y cosmology: se declaran al crear el ledger con las unidades que pueden mover, y una no declarada no existe. Por construcción, cada unidad suma 0 sobre todas las cuentas.
- **Diario** de solo agregado (`seq, tick, eventId, unit, from, to, amount`), que es la tabla `ledger` de tooling; `Ledger.fromJournal` reconstruye los saldos y `audit()` comprueba las invariantes en debug. `totalsBy(unit, grupo)` audita la conservación por región, plano o asentamiento.

### 4.6 Lo genérico de la metafísica

| En el código | Qué es | En xianxia | En misterios |
|---|---|---|---|
| `Essence` | la energía que se conserva en el ledger | qi | espiritualidad, características |
| `Practice` | el camino de poder de una persona | cultivo | camino y secuencia |
| `Law` | las reglas reales del mundo (umbrales) | la ley del cultivo | la ley de los caminos |
| `Soul` | lo que sobrevive o cruza | alma | alma y cuerpo espiritual |

- **Campos que en los docs se llaman `qi`** (`RegionCell.qi`, `Spirit.qi`, `Lot.essence`) son `essence` en el código. Los docs pueden seguir diciendo "qi" en la prosa de xianxia.
- **`CultivationState`** es la implementación xianxia de `PracticeState`; `Extraordinary` (mysteries §1) es la de los misterios.

## 5. Glosario: quién es dueño de cada tipo

El dueño define el tipo, sus invariantes y sus procesos; los demás lo leen y le escriben solo con diffs por el scheduler.

| Tipo | Dueño (carpeta) | Doc |
|---|---|---|
| `Rng`, `Id<K>`, `Tick`, `Event`, `CauseRef`, `PlaceRef`, `Ledger` | `core` | este doc |
| `ProcessDef`, `Phase`, `ScheduledItem`, `Zone`, `Tier`, `AggregateModel` | `sim/scheduler` | simulation |
| `WorldTruth`, `Space`, materialización por ranuras | `sim/world` | simulation §6, perception §3 |
| `Pressure` | `sim/causality` | causality §9 |
| `Percept`, `Trace` | `sim/perception` | perception |
| `Belief`, `Proposition`, `Rumor`, `Reputation` | `sim/knowledge` | information |
| `Memory`, `Relationship`, `Temperament`, `UtilityContext` | `sim/mind` | npc-psychology |
| `Body`, `Wound`, `Disease` | `sim/body` | body-health |
| `Skill`, `Facet`, `Repertoire` | `sim/skills` | skills |
| `ActionPlan`, `PlanNode`, `VerbDef`, `Outcome` | `sim/actions` | actions |
| `Bout`, `Exchange` | `sim/combat` | combat |
| `SpeechAct`, `TopicStack` | `sim/dialogue` | dialogue |
| `ElementVector`, `interact` | `sim/elements` | elements |
| `CraftSession`, `Recipe` | `sim/crafts` | crafts |
| `Lot`, `GoodId`, `Money`, `Market`, `Price` | `sim/economy` | economy |
| `Tenure`, `RightBundle`, `Deed` | `sim/property` | property |
| `Commitment`, `Oath` | `sim/contracts` | contracts |
| `Genome`, `Household`, `Kinship` | `sim/family` | family-lineage |
| `Position`, `StatusNorm`, `Face` | `sim/social` | social-structure |
| `CultureTrait`, `Prevalence` | `sim/culture` | culture |
| `Language`, `Lexicon`, `Script` | `sim/language` | language |
| `Doctrine`, `Practice` religiosa (`RitePractice`) | `sim/religion` | religion |
| `Organization`, `Office`, `Issue` | `sim/org` | organizations |
| `LawCode`, `Jurisdiction`, `Case` | `sim/law` | law |
| `StateClaim`, `Register` | `sim/state` | state |
| `Force`, `Campaign`, `Siege` | `sim/war` | war |
| `Scheme`, `SchemeStep`, `Project` | `sim/schemes` | schemes |
| `Settlement`, `Building` | `sim/settlements` | settlements |
| `Journey`, `Route` | `sim/travel` | travel |
| `WeatherSystem`, `WaterBalance` | `sim/weather` | weather |
| `Population`, `Species`, `Beast` | `sim/ecology` | living-world |
| `TechProcessDef`, `PopulationTech` | `sim/technology` | technology |
| `Hypothesis`, `Insight` | `sim/discovery` | discovery |
| `Reading`, `Prophecy` | `sim/divination` | divination |
| `Essence`, `Practice`, `Law`, `Soul`, `WorldLaw` | `sim/metaphysics` | metaphysics |
| `CultivationState`, `Realm` | `sim/families/xianxia` | cultivation |
| `Pathway`, `SequenceDef`, `Extraordinary`, `Characteristic`, `SealedArtifact` | `sim/families/mysteries` | mysteries |
| `HeavenState`, `Tribulation`, `Karma`, `Merit` | `sim/heaven` | heaven-karma |
| `Spirit`, `Shrine`, `Offering` | `sim/spirits` | spirits |
| `Plane`, `PlaneLink`, `Barrier` | `sim/cosmology` | cosmology |
| `SecretRealm` | `sim/realms` | secret-realms |
| `Epoch`, `Stratum`, `Assemblage` | `sim/history` | deep-history |
| `Chronicle` (dentro del mundo) | `sim/chronicles` | chronicle |
| `GoldenFinger`, `TropeRule` | `sim/modes` | game-modes |
| `RegionCell`, `Biome` | `worldgen/planet` | planet-gen |
| `Era`, `EraTarget`, `EraMarker` | `worldgen/law` (lee `sim/technology`) | technology §9b |
| `NewGameSetup`, `NovelSetup`, `EntryMode`, `Routine`, `PlayerGoal` | `game` | game-modes §1, player-loop |
| `PlayerView`, `LocalLabel` | `game/view` | narration §2 |
| `FinalChronicle`, `Legacy`, `Epilogue` | `game/final-chronicle` | chronicle §3-§9 |
| `NarrationPrefs`, `StyleSettings`, `LlmConfig`, `NarrationRequest` | `llm` | narration |
| `SaveMeta`, `ReplayLog` | `persistence` | tooling |

## 6. Contradicciones resueltas (2026-10-06)

| Contradicción | Resolución |
|---|---|
| `ProcessDef` en simulation (proceso del scheduler) y en technology (técnica mortal) | El del scheduler queda `ProcessDef`; el de technology pasa a **`TechProcessDef`**. |
| `PlanNode` en actions (árbol de plan) y en schemes (paso de intriga con `expects`/`branches`) | El de actions queda `PlanNode`; el de schemes pasa a **`SchemeStep`**, que envuelve un `PlanNode` y le agrega la predicción de la víctima. |
| `NewGameSetup` en player-loop y en game-modes, con campos distintos | Manda **game-modes §1** (`WorldConstraints`, `mode`, `novel`, `NarrationPrefs`); player-loop lo referencia. `StyleSettings` es lo que `NarrationPrefs` produce para cada pedido al narrador. |
| `AgentId`, `PersonId`, `NpcId` para lo mismo | **`AgentId`** en todos lados. |
| `Belief.holder: AgentId` pero las organizaciones también creen | **`AgentId \| OrgId`** (information §9). |
| `Time` y `Tick` | `Time` es alias de `Tick`. |
| `Event { time, type, location }` en este doc y en causality | `Event { tick, kind, place }` (§4.3). |
| `ActionPlan` de este doc (`steps: [{verb, target, manner}]`) | Manda actions §3 (`root: PlanNode`, `source`, `interrupts`, `causes`). |
| `Outcome` con lista fija en este doc | Manda actions §7. |
| Campos `qi` en tipos genéricos | `essence` en el código (§4.6). |
| Carpetas `sim/npc` y `sim/cultivation` | `sim/mind` y `sim/families/xianxia` (§2). |
| Dos tareas de "Loop CLI" casi iguales en la Fase 0 | Una sola: el stub del turno (player-loop §3). |

## 7. Decisiones técnicas (revisión del stack, 2026-10-06)

> **Estado: aprobado 2026-10-06 (#46 del ROADMAP).** Antes de la Fase 0 se revisó cada pieza contra lo que pide el diseño: una simulación determinista enorme (planeta de 2-4× la Tierra, historia de siglos en modo agregado, miles de agentes materializados), replay byte a byte, un LLM local en una RTX 4070 Super de 12 GB, Windows como plataforma principal, y un proyecto de años que escribe sobre todo Claude.

### 7.1 Lo que pide el diseño (los criterios)

1. **Determinismo fuerte:** el mismo seed y los mismos planes dan el mismo log, también después de actualizar Node y en otra máquina (replay de vidas viejas, tooling §3).
2. **Rendimiento en lo numérico:** worldgen (tectónica, clima, erosión, ~40.000 celdas de nivel 0 con detalle local), historia agregada de siglos, y sim por adelantado en workers (simulation §13).
3. **Un modelo de datos enorme y cambiante:** cientos de tipos, esquemas de `content/`, migraciones. Pesa más la velocidad de iteración y los tipos fuertes que el último 20% de rendimiento.
4. **El LLM local como cuello de botella de la latencia**, no la sim.
5. **Herramientas visuales** (mapas, inspector, paneles de creencias) que ayudan a depurar desde temprano.

### 7.2 Lenguaje: TypeScript se queda, con dos válvulas

| Opción | A favor | En contra |
|---|---|---|
| **TypeScript (Node)** | Iteración rápida; tipos estructurales ideales para un modelo de datos grande; Zod; el mismo lenguaje para la UI web; la sim pura puede correr en un Web Worker. | 2-5× más lento que Rust en numérico; objetos pesados en memoria; floats trascendentes sin garantía entre versiones del motor. |
| Rust | Rendimiento, memoria, determinismo fácil, ECS maduro. | Iteración mucho más lenta sobre un modelo de datos que va a cambiar cientos de veces; compilación lenta; la UI web igual necesita TS. |
| C# / .NET (o Godot) | Buen rendimiento, ecosistema de juegos. | Sin ventaja clara para un juego de texto con UI web; Zod y tipos estructurales no tienen equivalente igual de cómodo. |
| Python | Prototipado, ciencia de datos. | Lento sin NumPy; tipos débiles para este tamaño. |

**Decisión propuesta: TypeScript**, porque el criterio 3 domina y el 4 dice que la sim no es el cuello de botella del turno. Las dos válvulas para el criterio 2:
- **Datos en columnas** (`TypedArray`, structure-of-arrays) para lo masivo: celdas del planeta, poblaciones agregadas, campos de esencia y clima. Objetos solo para lo materializado.
- **Núcleos en Rust → WASM** si el perfil lo pide (erosión, clima, modelos agregados). WASM tiene floats IEEE deterministas y la libm va compilada adentro, así que además resuelve el determinismo de las trascendentes en esos núcleos. Criterio: un núcleo numérico que se lleve más del 30% del tiempo de worldgen o de la historia, medido en la sim headless.

### 7.3 Runtime: Node 24, sin `tsx`

- **Node 24 corre `.ts` directo** (type stripping nativo). Con `erasableSyntaxOnly` en el tsconfig (sin `enum`, `namespace` ni parameter properties: se usan uniones de literales, que el diseño ya usa) no hace falta ni `tsx` ni build: `node src/ui/cli/main.ts`. `tsc --noEmit` solo verifica tipos.
- **Bun y Deno** se descartan: Bun trae SQLite y test runner propios, pero cambia de motor (JavaScriptCore), con otro rendimiento y otras trascendentes; Deno no aporta nada que Node 24 no tenga. Una sola plataforma de referencia es parte del determinismo.
- **Versión fijada:** `.nvmrc` y `engines` en `package.json`; el guardado registra la versión de Node y del motor (tooling §4).

### 7.4 Determinismo: más estricto que el borrador

- **RNG por contador** (stateless): `draw(seed, key, n)` con un mezclador de 32 bits (estilo PCG-hash o *squares*) sobre el hash de la clave. Encaja con las claves por tupla que ya usa todo el diseño (`rng.fork("materialize", populationId, slot, epoch)`): no hay estado que guardar ni que pasar entre workers, y la misma clave da lo mismo en cualquier hilo. `sfc32` queda para flujos largos dentro de una clave (worldgen). Implementado (Fase 0): la clave es un hash de 64 bits de la tupla, independiente de la semilla (se guarda en `Deferred.rngKey`); cada primitiva (`float`, `int`, `chance`, `pick`, `weighted`, `shuffle`) consume una cantidad fija de sorteos, sin rechazo, para que inclinar pesos (heaven-karma §6) no corra las tiradas que siguen; los valores dorados de `rng.test.ts` no se cambian sin migración, porque rompen el replay.
- **`core/math` propio** para la sim: `exp`, `log`, `pow`, `sin`, `cos`, `atan2` con polinomios en suma, resta, multiplicación, división y `Math.sqrt` (que IEEE garantiza redondeadas igual en todos lados). `Math.exp` y compañía quedan prohibidas en `sim/` y `worldgen/` por lint. Así una actualización de V8 no rompe el replay de una vida vieja (el borrador aceptaba "lo mismo en el mismo Node").
- **CI con dos plataformas** (Windows y Linux) que comparan el hash del log de un escenario: el usuario juega en Windows.
- **Ids en paralelo:** si una fase corre en workers, las entidades nuevas reciben su id al asentar (fase *settle*), en orden de clave, nunca dentro del worker.

### 7.5 Persistencia

- **`node:sqlite`** se queda (sin dependencias nativas que compilar en Windows), detrás de una interfaz chica en `persistence/` para poder cambiar a `better-sqlite3` si aparece un problema: es todavía un módulo joven de Node.
- **Componentes como JSON canónico** con hash por componente (pregunta 3); **snapshots comprimidos con zstd** (`node:zlib`). MessagePack o CBOR solo si el tamaño medido en la Fase 5 lo pide: el JSON se lee a ojo en el inspector.
- **DuckDB, más adelante y opcional,** para analizar lotes grandes de la sim headless (calibración de la Fase 3 en adelante): lee SQLite y Parquet directo. No entra a la Fase 0.

### 7.6 Validación y contenido: Zod 4

- **Zod 4** (más rápido y liviano que el 3) y **`z.toJSONSchema()`**: el mismo esquema que valida el `IntentDraft` se manda como JSON Schema al servidor del LLM local para restringir la salida (Ollama, llama.cpp y LM Studio lo aceptan). Un esquema, tres usos: tipo, validación y gramática.
- **Contenido en JSON** (o TS cuando necesita lógica) validado al cargar; los tipos de lo que entra de afuera salen de `z.infer` (pregunta 2).

### 7.7 LLM local: un modelo residente

- **Una interfaz compatible con OpenAI** (`/v1/chat/completions` con `response_format`), que hablan Ollama, el servidor de llama.cpp y LM Studio; los extras de cada runtime (gramáticas GBNF, ranuras de caché de llama.cpp) van como opciones del proveedor. `fetch` directo, sin SDK.
- **Ollama para empezar** (instalación simple en Windows, cambio de modelo con un comando); **servidor de llama.cpp** cuando haga falta control fino: gramáticas propias, caché del prefijo por ranura, decodificación especulativa.
- **Revisión de narration §1:** 12 GB no entran un parser de 7-8B y un narrador de 12-14B cargados a la vez (unos 5 GB + 9 GB más la caché de contexto). Cambiar de modelo en cada turno cuesta segundos. **Propuesta: un solo modelo residente de 12-14B para los dos trabajos** (el parser con salida restringida por esquema) y medir en el banco de pruebas si un parser chico aparte vale el cambio. El fine-tune de la Fase 9 se hace sobre el modelo que gane.
- Los modelos concretos se eligen en el banco de pruebas de la Fase 1, no acá: cambian cada pocos meses.

### 7.8 Interfaz: la web antes

- **La CLI queda como herramienta** (pruebas, scripts, REPL del inspector) y para jugar en la Fase 1a.
- **Propuesta: una UI web local mínima desde el cierre de la Fase 1** (no en la Fase 9): servidor Node local + Vite + React con chat, panel del personaje, bitácora y un mapa. Los paneles de creencias, la crónica y sobre todo los mapas del inspector (presiones, LOD, tiers) se ven y se depuran mucho mejor en el navegador que en PNG sueltos. Sin Electron ni Tauri: el navegador alcanza para un juego personal.
- **Mapas:** canvas 2D al principio; deck.gl o PixiJS si hace falta (deck.gl dibuja hexágonos de H3 directo, ver §7.9).

### 7.9 La grilla del planeta: evaluar H3

- planet-gen pide una geodésica hexagonal de ~40.000 celdas de nivel 0 con subdivisión local. **H3** (`h3-js`) es exactamente eso ya hecho y probado: su resolución 3 tiene unas 41.000 celdas, con jerarquía de 16 niveles (que encaja con las resoluciones de zona del LOD), vecinos, distancias, anillos y rellenado de polígonos. El tamaño del planeta solo cambia la escala en metros.
- **Costo:** los hijos de una celda H3 no cubren exactamente al padre (la contención es aproximada), y la apertura es 7 (1 → 7 → 49 → 343 → 2.401 hijos) en lugar de un número libre.
- **Propuesta:** un spike de un día en la Fase 1 (tarea de planet-gen mínima) que compare H3 con una Goldberg propia. Si la contención aproximada no rompe la conservación por celda (el ledger se lleva por celda hija), se usa H3.

### 7.10 Calidad del código

- **Biome** (formato y lint en una sola herramienta rápida) en lugar de ESLint + Prettier.
- **dependency-cruiser** para las reglas de arquitectura: capas de §3, ciclos entre carpetas de `sim/`, `families/` aislado, `node:*` prohibido dentro de `core/`, `worldgen/` y `sim/`. Es más expresivo que `no-restricted-imports` y da un grafo para revisar.
- **Los globales prohibidos** (`Math.random`, `Math.exp` y compañía, `**`, `Date`, `performance`, `process`, temporizadores) no son imports, así que los ve Biome: un plugin GritQL para los miembros de `Math` y `**`, y `noRestrictedGlobals` para el resto (respeta el alcance: una variable local llamada igual no salta). Los tests quedan afuera: los de `core/math` comparan contra `Math.*`.
- **TypeScript 6, no 7** (implementado 2026-10-06): TS 7 (el compilador en Go) todavía no publica API de JavaScript, y dependency-cruiser la necesita para leer los imports de `.ts`. Se pasa a 7 cuando las herramientas lo soporten; el código no cambia.
- **Vitest** se queda; se suma **fast-check** para tests por propiedades: la conservación (ledgers), el determinismo (mismo seed, cualquier orden de inserción) y `interact` sin móvil perpetuo son propiedades, no ejemplos.
- **npm** se queda: pnpm solo aporta cuando haya workspaces.

### 7.11 Tabla final (aprobado 2026-10-06)

| Tema | Decisión | Cambio respecto del borrador |
|---|---|---|
| Lenguaje | TypeScript strict | — (con datos en columnas y válvula Rust → WASM) |
| Runtime | Node 24 con type stripping, versión fijada | sin `tsx` ni build |
| RNG | por contador con claves; `sfc32` para flujos | antes: solo `sfc32`/xoshiro con `fork` |
| Matemática | `core/math` determinista | antes: `Math.*` en el mismo Node |
| Ids | contadores por tipo, asignados al asentar | se aclara el caso con workers |
| Persistencia | `node:sqlite` tras interfaz, JSON canónico, zstd | — (DuckDB opcional más adelante) |
| Validación | Zod 4 + `z.toJSONSchema` para el LLM | Zod 3 → 4 |
| LLM | interfaz OpenAI-compatible; Ollama → llama.cpp; un modelo residente | antes: dos modelos (7-8B + 12-14B) |
| UI | CLI de herramienta; web local mínima al cierre de la Fase 1 | antes: web en la Fase 9 |
| Grilla | H3 si pasa el spike | antes: Goldberg propia |
| Lint | Biome + dependency-cruiser | antes: ESLint |
| Tests | Vitest + fast-check | se suma fast-check |
| CI | typecheck, lint, tests y hash de determinismo en Windows y Linux | se suma la segunda plataforma |

## 8. Orden de implementación revisado

Las fases del [ROADMAP](ROADMAP.md) se mantienen (0 a 9). Lo que cambia es **qué se arma primero dentro de cada una**, porque ahora todo está diseñado y hay dependencias claras:

```
Fase 0  core (rng, ids, time, Event, CauseRef, ledger, canon) → scheduler mínimo → SQLite → turno stub → MockLLM
Fase 1  planet mínimo → aldea (settlements, property) → cuerpo → percepción → acciones → economía/oficio
        → combate y diálogo mínimos → parser + PlayerView + narrador → crónica mínima → inspector
        cultura, lengua, religión, clima, cielo: en content/ desde el principio, profundidad mínima
Fase 2  mente (memoria, relaciones, creencias sobre otros) → discovery → diálogo completo → paneles
Fase 3  utilidad y rutinas → tier 1 y puesta al día → familias → economía de aldea → ley y contratos → primeros agregados
Fase 4  metaphysics genérica → families/xianxia → Cielo y karma → alquimia, sectas, espíritus
Fase 5  zonas y LOD completos → región: varios asentamientos, rutas, estado local, clima móvil
Fase 6  organizaciones completas → estado, clanes, sectas que nacen, diplomacia
Fase 7  worldgen completo + resolución history → historia que deja ruinas y lenguas → families/mysteries → era como eje
Fase 8  mundo completo: naciones, guerra, cosmología y ascensión
Fase 9  UI web completa, archivo de vidas, fine-tune, eras no típicas (la web mínima entra al cierre de la Fase 1: §7.8)
```

- **Regla para la Fase 1:** los sistemas "de fondo" (cultura, lengua, religión, clima, cielo) entran con su **forma real** (los tipos de este doc y sus esquemas en `content/`) aunque la profundidad sea mínima. Así las fases siguientes agregan procesos sin migrar datos.
- **La interfaz `metaphysics` se escribe en la Fase 4 pensando en dos familias**: xianxia la implementa ahí, y misterios en la Fase 7 tiene que entrar sin tocar código fuera de `families/` (test: compilar `sim/` sin `families/mysteries`).
- **Fase 1 es grande** (31 tareas): se propone partirla en hitos jugables (ver la pregunta abierta en el ROADMAP).

## 9. Herramientas de debug (prioridad alta desde el día 1)

- **Inspector god-mode**: ver la verdad del mundo, un agente completo, sus memorias y relaciones, por qué tomó una decisión.
- **Sim headless**: `--seed --years N` → reporte (población, muertes, guerras, quién se hizo poderoso). Base para calibrar.
- **`why <eventId>`**: recorre el grafo causal hacia atrás.
- **Replay**: re-ejecutar una partida desde seed + planes validados, con detector de divergencias.
- Diseño completo (guardado, hash, versiones, catálogo del inspector, calibración, invariantes): [systems/tooling.md](systems/tooling.md).

## Decisiones (aprobado 2026-10-06)

1. **Fase 1 en tres hitos jugables:** 1a "el turno" (jugar un día solo), 1b "la aldea vive" (20 agentes, economía, robo y reclamo), 1c "la aldea tiene mundo" (monte, clima, cielo, crónica al morir, web mínima). El reparto de tareas está en el ROADMAP.
2. **Zod 4 es la fuente de los tipos de lo que entra de afuera** (`content/`, parser, guardados) con `z.infer`; el estado de la sim usa interfaces escritas a mano.
3. **SQLite con una tabla por componente:** `id`, JSON canónico y hash, más columnas indexadas solo para lo que consulta el inspector.
4. **Node 24 corre los `.ts` directo** (type stripping con `erasableSyntaxOnly`), `tsc --noEmit` para el typecheck, sin `tsx` ni build hasta la web.
5. **El stack de §7.11 entero.**
