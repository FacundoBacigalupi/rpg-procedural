# Bucle de simulación y LOD — un motor, muchas resoluciones

> Principio: **el mundo se simula una sola vez, con un solo motor, a la resolución que cada parte necesita.** La resolución cambia el costo, nunca las leyes: conservación, causalidad y determinismo valen igual en una escena de combate que en un milenio compactado.

> Estado: **borrador** (2026-10-06). Unifica las secciones "Escala (LOD)" de todos los docs de sistema.

Depende de: [causality.md](causality.md) (§5: la historia es la misma sim en modo agregado, materialización consistente, detalle diferido; §8: procesos; §9: presiones), [deep-history.md](deep-history.md) (embudo de épocas y olvido), [VISION.md](../VISION.md) (tiers 0-4), [ARCHITECTURE.md](../ARCHITECTURE.md) (`sim/scheduler`, `core/rng`, `core/time`).
Lo usan: todos los sistemas de simulación (cada uno declara sus procesos y su modelo agregado con los contratos de §2 y §9), [perception.md](perception.md) (testigos por zona), [npc-psychology.md](npc-psychology.md) §18 (psicología por tier), worldgen (la historia corre en este motor), `tools/` (inspector, sim headless).

---

## Principios

1. **Un motor.** No hay un "generador de historia", un "simulador offscreen" y un "motor de escena" separados. Hay un scheduler que corre procesos; lo que cambia es con qué cadencia y sobre qué representación (individuos o agregados).
2. **Dos ejes de resolución.** Una cosa es **cuánto detalle tiene una entidad** (el tier del agente, 0-4) y otra **cuánto detalle tiene un lugar** (la resolución de la zona: escena, local, regional, mundo, historia). Un cultivador de tier 3 que medita en una montaña lejana es una persona con todo su modelo, pero vive en una zona de resolución "mundo" y su cultivo avanza por mes. Los docs de sistema que dicen "tier 3-4" para un proceso se refieren a la zona (§4, tabla de equivalencias).
3. **Lo observado no se contradice.** Lo que el jugador (o cualquier agente de tier alto) percibió queda fijado como hecho. Los agregados se ajustan a los hechos fijados, nunca al revés (causality §5.2).
4. **La resolución es cómputo, no realidad.** Bajar la resolución de una zona no la vuelve más tranquila ni más violenta: las tasas agregadas están calibradas contra el modo individual. Lejos del jugador pasan las mismas cosas, contadas más grueso.
5. **Determinismo por clave, no por orden.** Cada tirada sale de un sub-stream identificado por (sistema, proceso, entidad, ventana de tiempo). Recorrer las entidades en otro orden, o agregar un sistema nuevo, no cambia las tiradas de los demás.
6. **El presupuesto degrada resolución, nunca corrección.** Si falta cómputo se espacian cadencias y se bajan zonas lejanas de resolución; jamás se salta la conservación, el registro de causas ni la coherencia de lo fijado.
7. **El jugador no tiene un motor propio.** Su personaje es un agente de tier 4 en una zona de escena, con el mismo pipeline que cualquier NPC (causality §6). Lo único especial es que sus decisiones vienen del parser de intención y no de la utilidad.

---

## 1. El tiempo

```ts
type Tick = number;                 // segundos absolutos desde el origen del mundo (entero; seguro hasta ~2.8e8 años)
type Duration = number;             // en segundos

type TimeScale =
  | "instant"   // segundos: intercambios de combate, una frase, un gesto
  | "scene"     // minutos: una conversación, una sesión de oficio paso a paso
  | "hour"
  | "day"
  | "season"
  | "year"
  | "decade"
  | "epoch";    // siglos a milenios, solo en historia (deep-history: embudo)
```

- **La verdad usa ticks absolutos.** Los calendarios son cultura (living-world §5): cada cultura cuenta años, meses y fiestas a su manera, y su calendario es una creencia con errores que hay que correlacionar (deep-history §3). `core/time` convierte ticks a cualquier calendario y al revés, y sabe la posición del sol, las lunas y las mareas de qi para cada tick (planet-gen).
- **Duraciones reales.** Toda acción y todo proceso tienen duración en ticks. Un viaje de tres días son tres días de mundo, aunque el jugador lo resuelva en una línea.
- **Nada ocurre "entre ticks".** Lo que dura (un embarazo, una caravana en ruta, una herida que cicatriza) se representa como un estado con fecha de inicio y una próxima revisión agendada (§3), no como un proceso que corre cada segundo.

## 2. Procesos: la unidad de simulación

Todo lo que cambia el mundo es un **proceso** (causality §8): lee el estado, calcula presiones, decide o tira, y devuelve cambios y eventos con causas.

```ts
interface ProcessDef {
  id: ProcessId;                          // "economy.market.clear", "body.wound.heal", "org.deliberate"
  system: SystemId;
  scope: ScopeKind;                       // "agent" | "household" | "settlement" | "org" | "cell" | "region" | "world" | "realm"
  cadence: Partial<Record<ZoneResolution, TimeScale | "onEvent">>;   // cada cuánto corre según la resolución de su zona
  representation: "individual" | "aggregate" | "both";               // sobre qué trabaja
  phase: Phase;                           // en qué fase del paso corre (§3)
  reads: StateKey[];                      // qué partes del estado lee
  writes: StateKey[];                     // qué partes escribe (para detectar conflictos y ordenar)
  run(ctx: ProcessContext): ProcessResult;
}

interface ProcessContext {
  now: Tick;
  window: Duration;                       // cuánto tiempo cubre esta corrida (un día, una estación)
  scope: ScopeRef;
  truth: ReadonlyWorldTruth;              // lectura de la verdad; para decidir, los agentes leen sus creencias
  rng: Rng;                               // ya forkeado: rng.fork(system, process, scope, windowIndex)
  pressures: PressureCache;
}

interface ProcessResult {
  changes: StateChange[];                 // diffs tipados; se aplican en el commit de la fase
  events: Event[];                        // con causes y emissions
  schedule?: ScheduledItem[];             // revisiones futuras (§3)
  materialize?: MaterializationRequest[]; // si el proceso necesita un individuo de un agregado (§6)
}
```

- **Puros.** `run` no escribe nada: devuelve diffs. El scheduler los aplica al final de la fase (§3). Esto hace posible el determinismo por clave, el inspector (que muestra qué proceso cambió qué) y los contrafácticos (causality §11).
- **Cada sistema declara sus procesos** con su cadencia por resolución. Ejemplo, `body.wound.heal`: `{ scene: "scene", local: "hour", regional: "day", world: "season" }`; en historia no existe (las heridas son tasas de mortalidad de body-health §16).
- **El mismo proceso en dos representaciones.** Un proceso `both` tiene una versión individual y una agregada con el contrato de §9 (por ejemplo, `economy.market.clear` con vendedores concretos o con la regla de precios del modo agregado).

## 3. El scheduler

Un scheduler híbrido: **ruedas de cadencia** para los procesos periódicos y una **cola de eventos con hora** para lo puntual.

```ts
type Phase =
  | "perceive"    // los eventos del paso anterior llegan a quienes los perciben (perception)
  | "decide"      // los agentes eligen acciones con sus creencias (utilidad, órdenes, intrigas)
  | "act"         // las acciones se resuelven: tiradas, conflictos, eventos
  | "physics"     // el mundo responde: qi, clima, cuerpo, ecología, fuego, elementos
  | "settle"      // contabilidad: ledgers, presiones, compromisos que vencen, compactación

interface ScheduledItem {
  at: Tick;
  phase: Phase;
  process: ProcessId;
  scope: ScopeRef;
  reason: CauseRef;               // por qué está agendado (la caravana salió, el embarazo empezó)
  seq: number;                    // desempate estable: orden de creación, que es determinista
}
```

- **Un paso** es el intervalo hasta el próximo ítem agendado o el próximo borde de cadencia de la zona más fina activa. Si el jugador está en una escena, el paso es de segundos; si está durmiendo en una aldea tranquila, el motor salta de revisión en revisión (de hora en hora, o al próximo evento con hora).
- **Fases en orden fijo.** Dentro de un paso: percibir → decidir → actuar → física → asentar. Dentro de una fase, los procesos corren en un orden canónico (por `ProcessId` y después por `ScopeRef` ordenado por id); como cada uno tira con su propio sub-stream y escribe diffs, el orden solo importa para los conflictos.
- **Conflictos de escritura.** Si dos diffs tocan lo mismo (dos agentes agarran el mismo lote, dos órdenes sobre la misma tropa), no gana el que se procesó primero: la fase `act` los detecta por `writes` y los resuelve como una **contienda** con iniciativa, que sale del estado (velocidad, distancia, atención, sorpresa) más una tirada con clave `(contest, objeto, tick)`. La contienda es un evento con causas, y el perdedor recibe un resultado ("llegaste tarde: ya lo tenía él").
- **Cadencias anidadas.** Los procesos de una zona de resolución "mundo" corren por estación, pero si un evento con hora cae adentro (una batalla agendada), el scheduler parte la ventana: corre la estación hasta la batalla, resuelve la batalla y sigue.
- **Interrupciones.** `advanceUntil(t, interrupts)` avanza hasta `t` o hasta que un predicado sobre los percepts del jugador se cumpla (una amenaza, un mensaje, alguien que le habla). Es lo que usa el bucle del jugador para los saltos de tiempo ([player-loop.md](player-loop.md)).

## 4. Las dos resoluciones

### 4.1 Resolución de zona

```ts
type ZoneResolution =
  | "scene"       // donde está el jugador: segundos y minutos; todo individual; percepción completa
  | "local"       // el asentamiento o área alrededor (≈ medio día de viaje): horas; individuos de tier 1-4
  | "regional"    // la región activa (≈ una o dos semanas de viaje): días; individuos importantes + agregados por asentamiento
  | "world"       // el resto del planeta: estaciones; agregados por asentamiento, organización y celda + agentes de tier 3
  | "history";    // antes del presente: años a milenios según el embudo (deep-history)

interface Zone {
  id: ZoneId;
  resolution: ZoneResolution;
  cells: CellId[];                 // celdas hex de planet-gen; las sub-celdas (sitios) se heredan
  sites?: SiteId[];                // lugares con grafo de espacios (perception) en scene/local
  lastAdvanced: Tick;              // hasta dónde está simulada
  reason: CauseRef[];              // por qué tiene esta resolución (el jugador, una batalla cercana, un tier 3 actuando)
}
```

- **Las zonas siguen al jugador**, pero no solo a él: una batalla grande, una tribulación o una apertura de reino secreto pueden pedir resolución "regional" en su lugar aunque el jugador esté lejos, si el presupuesto alcanza (§13). Lo que hacen ahí sigue siendo verdad aunque nadie mire.
- **Histéresis.** Una zona sube de resolución en cuanto el jugador entra, pero baja recién después de un tiempo sin que él esté (un día para "scene → local", una semana para "local → regional"). Así entrar y salir de una puerta no provoca ciclos de materialización.
- **Bordes.** Lo que cruza de una zona a otra (personas, lotes, noticias, qi, agua, fuego) pasa por un **flujo de borde** con conservación (§10).

### 4.2 Tier de agente

Los tiers de VISION, con su regla de asignación:

| Tier | Qué es | Dónde puede vivir | Cómo se simula |
|---|---|---|---|
| **0** | Miembro anónimo de una población (no existe como registro) | cualquier zona | Dentro de los agregados de su población |
| **1** | Individuo con registro, dormido | cualquier zona | Se pone al día al despertarse (§8); lo esencial de su estado se guarda |
| **2** | Individuo activo | zonas scene y local | Decisión diaria con utilidad, percepción resumida, memorias top-N (npc-psychology §18) |
| **3** | Importante | cualquier zona | Siempre simulado, con cadencia según la zona (por día cerca, por estación lejos) |
| **4** | Conectado al jugador (y el jugador) | cualquier zona | Máxima resolución; nunca baja |

**Asignación** (proceso `sim.tier.assign`, por estación en mundo y por día en local):
- **Tier 4:** el jugador y quienes tienen con él un vínculo significativo: familia cercana, maestro y discípulos, pareja, enemigos declarados, compromisos con peso kármico, o una relación cuya intensidad pasa un umbral (npc-psychology: relaciones). Conocer de pasada no alcanza (ver Decisiones).
- **Tier 3:** importancia por encima de un umbral, con un puntaje que combina poder (umbral de cultivo, fuerza militar, riqueza), puesto (líder, anciano, magistrado, cabeza de clan), longevidad, centralidad en el grafo de relaciones y compromisos, ser blanco o autor de intrigas activas, y ser portador único de algo (una técnica, un sello, una profecía). Con histéresis: se entra con un umbral y se sale con otro más bajo.
- **Tier 2:** cualquier individuo materializado presente en una zona scene o local que no sea 3 ni 4.
- **Tier 1:** individuos materializados fuera de esas zonas. Quien alguna vez fue tier 2 o más **nunca vuelve a tier 0**: queda como registro dormido (es barato y garantiza el Principio 3).
- **Cupos.** Hay un máximo de tier 3 por región y en el mundo (presupuesto); si se pasa, quedan los de mayor puntaje y el resto baja a 1 con cadencia de puesta al día más fina.

### 4.3 Equivalencias con los docs de sistema

Los docs de sistema usan "tier" de dos maneras. Para personas, es el tier de agente. Para procesos (mercados, batallas, oficios, contratos), es la resolución de zona:

| Lo que dicen los docs | Resolución de zona | Ejemplos |
|---|---|---|
| "Tier 4" / "donde está el jugador" / "cerca del jugador" | scene | economy §16 (regateo con actos de habla), war §15 (heridas por parte), elements §12 (`interact` tick a tick), crafts §12 (sesión paso a paso) |
| "Tier 3" / "escenas cercanas" | local | cultivation §17 (cultivo por semana), body-health §16 (fisiología por hora), discovery §15 |
| "Tier 2" / "región activa" | regional | economy §16 (precio de referencia con agentes nombrados), war §15 (batallas por fases), organizations §17 |
| "Tier 0-1" / "lejos" / "simulación histórica" | world e history | todos los modelos agregados: pirámides, tasas, procesos de riesgo |

Cuando un proceso toca a un agente de tier alto en una zona de baja resolución (el tier 3 lejano que cultiva), manda el tier del agente para su propio modelo y la zona para todo lo que lo rodea: su cultivo es individual por mes, el mercado donde compra píldoras es un precio de referencia.

## 5. Importancia y atención del motor

El puntaje de importancia (§4.2) también decide **qué tan seguido** se revisa a cada tier 3 lejano y qué pedidos de resolución se atienden primero cuando falta presupuesto.

```ts
interface ImportanceScore {
  entity: EntityId;
  power: number;          // cultivo, fuerza, riqueza
  office: number;         // puestos y legitimidad
  centrality: number;     // grado ponderado en relaciones, compromisos y organizaciones
  activity: number;       // intrigas, guerras, proyectos, rupturas en curso
  uniqueness: number;     // portador único de técnica, sello, linaje, profecía
  playerProximity: number;// distancia causal y espacial al jugador
  total: number;
}
```

No hay nada en este puntaje que el mundo pueda leer: es contabilidad del motor. Ningún NPC sabe que es "importante" para el scheduler, y el Cielo usa su propia saliencia (heaven-karma §3), no esta.

## 6. Materialización: de la estadística a la persona

Cuando algo necesita un individuo que hoy es parte de un agregado (el jugador entra a la aldea, un proceso de riesgo dispara un descubridor, una expedición agregada vuelve y el jugador habla con un sobreviviente), se **materializa**.

```ts
interface MaterializationRequest {
  population: PopulationId;               // de qué agregado sale
  role?: RoleConstraint;                  // "el herrero", "un sobreviviente de la expedición", "el descubridor"
  slot?: number;                          // qué miembro anónimo (§6.1)
  pinned: PinnedFactRef[];                // hechos ya fijados que tiene que respetar
  cause: CauseRef;                        // quién lo pidió
}

interface PinnedFact {
  id: PinnedFactId;
  about: EntityRef | PopulationRef;
  claim: StateKey;                        // "el hijo del molinero existe y tiene unos 12 años"
  fixedBy: EventId;                       // el percept o evento que lo fijó
}
```

**Algoritmo:**
1. **Muestrear de las distribuciones del agregado** (edad, sexo, estatus, riqueza, oficio, cultivo, temperamento, salud, prevalencias), condicionadas a los hechos fijados y al rol.
2. **Biografía sintetizada** (npc-psychology §18): se recorre la historia registrada del lugar y de la población (la hambruna, la guerra, la epidemia) y se decide, con su sub-stream, cómo la vivió esta persona. Esos eventos de vida se crean como eventos reales con `originEventId` apuntando al evento agregado que los contiene.
3. **Relaciones y compromisos** coherentes con los agregados (contracts §15: si el hogar debía 30 taeles, hay un `Commitment` concreto; family-lineage §14: los padres registrados o un genoma resumido de la población).
4. **Restar del agregado.** La persona, sus bienes, su dinero y su qi salen del agregado y pasan a ser individuales: conservación estricta. La población baja en uno; la riqueza agregada baja en lo que se le asignó.
5. **Commit.** Desde ese momento es un hecho (tier ≥ 1, nunca vuelve a 0).

### 6.1 Identidad estable por ranura

Cada población tiene **ranuras** anónimas numeradas. Materializar la ranura `k` usa `rng.fork("materialize", populationId, k, epochOfPopulation)`, así que si dos caminos distintos de la misma partida piden "un miembro" de esa población, el criterio de elección de ranura es determinista y el resultado también. Las ranuras se reciclan con los nacimientos y muertes agregados (la ranura de alguien que murió en el agregado no se vuelve a usar para un vivo de la misma cohorte).

### 6.2 Lo que no se puede materializar

- Nada que contradiga un hecho fijado (no aparece un hermano del jugador que el jugador no tenía).
- Nada que viole los agregados: no se materializan más herreros que los que la distribución sostiene, ni un esclavo sin dueño (social-structure §14), ni un cultivador sin técnica de su escuela (cultivation §17).
- Si el pedido no se puede cumplir sin contradicción, falla: el proceso que lo pidió recibe "no hay nadie así" y eso es un resultado válido (la expedición no tuvo sobrevivientes con ese perfil).

## 7. Desmaterialización: bajar de tier

- **De 2 a 1:** al salir de las zonas scene/local. Se comprimen las memorias a gist (npc-psychology), las creencias a top-N, el cuerpo a resumen por sistemas (body-health §16), las tenencias a lotes agregados por categoría salvo los únicos. Se guarda `lastAdvanced`.
- **De 3 a 1:** cuando el puntaje baja del umbral de salida.
- **Nunca de 4.** Y nunca a 0 para quien fue 2 o más.
- **El agregado lo sigue contando.** Los tier 1 dormidos son parte de la población a efectos de los procesos agregados (comen, pagan impuestos, pueden morir en una epidemia agregada). Cuando un proceso agregado afecta a "una fracción" de la población, se decide con el sub-stream de cada tier 1 si le tocó, y se le anota como **evento pendiente** para su puesta al día (§8).

## 8. Puesta al día perezosa (catch-up)

Un registro dormido o una zona que vuelve a subir de resolución se pone al día desde `lastAdvanced` hasta ahora.

```ts
interface CatchUp {
  entity: EntityRef | ZoneRef;
  from: Tick;
  to: Tick;
  pending: EventId[];                     // lo que los agregados ya le asignaron (la epidemia lo tocó, la leva lo llevó)
  mode: "closedForm" | "coarseSteps";     // fórmula cerrada (envejecer, cicatrizar) o pasos gruesos (estaciones)
}
```

- **Primero lo asignado, después lo propio.** Los eventos pendientes son hechos (si la leva lo llevó, se fue); entre ellos, la persona vive su vida a pasos gruesos con su propio modelo resumido: envejece, cultiva, se casa o no, se endeuda, muere de algo con causa.
- **El orden importa y es fijo:** los pasos de la puesta al día usan las mismas claves de rng que habría usado la simulación a esa cadencia, así que despertar a alguien antes o después da el mismo resultado si nada externo lo tocó.
- **Muertes en la puesta al día** son eventos reales con causa (la enfermedad de la prevalencia, el accidente del oficio, la vejez). Volver a la aldea después de diez años y que el viejo herrero haya muerto, y saber de qué, sale de acá.

## 9. El contrato del modo agregado

Todo sistema con representación agregada implementa:

```ts
interface AggregateModel<S, I> {
  system: SystemId;
  step(state: S, ctx: ProcessContext): ProcessResult;       // transición a cadencia gruesa
  materialize(state: S, req: MaterializationRequest, rng: Rng): { individual: I; residual: S };
  absorb(state: S, individual: I): S;                       // vuelve al agregado lo que se desmaterializa
  summarize(individuals: I[]): S;                           // para inicializar o recalibrar
  invariants(state: S): InvariantCheck[];                   // conservación, rangos, coherencia con lo fijado
}
```

- **Calibración** (causality §5.1): la sim headless corre el mismo escenario en modo individual y agregado y compara distribuciones (tasas de muerte, de crimen, de rupturas, precios). Cada sistema tiene un test de calibración con tolerancia; la tolerancia es una pregunta de calibración, no de diseño.
- **Ida y vuelta.** `absorb(materialize(S))` vuelve a un estado equivalente a `S` en todo lo que el agregado representa.
- **Cada doc de sistema ya describe su agregado** en su sección de escala: este contrato es la interfaz común que los vuelve intercambiables para el scheduler.

## 10. Bordes entre resoluciones

- **Personas que cruzan.** Un individuo que sale de una zona local hacia una mundo no desaparece: si es tier 1-2 queda como registro con un **trayecto** (origen, destino, ruta, partida, llegada estimada) que se resuelve en la puesta al día; si es tier 3-4, se lo sigue simulando en su propia zona móvil (una zona "regional" de una celda que viaja con él si el presupuesto alcanza, o una "world" si no).
- **Lotes y dinero que cruzan.** Las caravanas que salen de la zona local se convierten en flujo agregado de la ruta (economy §16) con sus lotes contados; al llegar a otra zona local se vuelven a materializar como caravana concreta, con los mismos lotes menos lo que el viaje consumió o perdió.
- **Información que cruza.** Los rumores y noticias pasan por los frentes agregados de information §11 y se vuelven creencias individuales al tocar a un agente materializado.
- **Física que cruza.** El qi, el agua, el fuego, el aire y las plagas fluyen entre celdas con las reglas de su sistema; una celda de zona fina y una gruesa intercambian flujos acumulados por la ventana de la más gruesa.

## 11. Detalle diferido

La forma general de causality §5.3, usada por secret-realms (contenido como libro), deep-history (`Assemblage`), perception (huellas viejas) y discovery (leyes que nadie mira):

```ts
interface Deferred<T> {
  id: DeferredId;
  constraints: Constraint[];              // lo que el grafo causal exige (quién murió ahí, qué se enterró, qué cultura)
  distribution: DistributionRef;          // de dónde se muestrea
  rngKey: RngKey;                         // fijo desde la creación: resolverlo antes o después da lo mismo
  resolvedBy?: EventId;                   // el percept o la acción que lo fijó
  value?: T;
}
```

- Se resuelve **solo** al observarlo o al necesitarlo un proceso, y queda fijado (Principio 3).
- La clave de rng se fija al crearlo, así el contenido no depende de cuándo se mira.
- **El inspector no resuelve.** Mirar con el inspector muestra la distribución y las restricciones, o resuelve en una copia descartable (§15); nunca fija nada en la verdad.

## 12. El jugador en el bucle

El motor ofrece al bucle del jugador tres modos de avance:
- **Acción:** el `ActionPlan` del jugador ([actions.md](actions.md)) se convierte en una acción de su agente con duración; el scheduler avanza hasta que termina o algo la interrumpe. El mundo avanza el mismo tiempo para todos.
- **Rutina:** el jugador declara qué hace por un período ("cultivo en la cueva hasta la primavera", "trabajo en la herrería todos los días"). La rutina es una política de su agente; el scheduler avanza con `advanceUntil` y las interrupciones que el jugador aceptó más las que nunca se pueden ignorar (lo atacan, lo llaman por su nombre, se le cae la casa).
- **Pausa:** nada avanza mientras el jugador piensa o escribe. El mundo no corre en tiempo real.

Cuánto de esto ve el jugador, cómo se resume un salto y qué interrupciones elige son tema de [player-loop.md](player-loop.md).

## 13. Presupuesto de cómputo

```ts
interface Budget {
  perActionMs: number;          // simulación de una acción del jugador, sin contar el LLM
  perSkippedDayMs: number;      // costo de un día en modo rutina
  perHistoryYearMs: number;     // costo de un año en worldgen
  maxTier2: number;             // por zona local
  maxTier3: { perRegion: number; world: number };
}
```

- **Degradación en orden fijo** cuando una medición pasa el presupuesto: (1) espaciar la cadencia de los tier 3 más lejanos y de menor puntaje; (2) bajar a "world" las zonas regionales pedidas por eventos lejanos; (3) bajar el cupo de tier 3; (4) achicar el radio de la zona local. La escena del jugador nunca se degrada.
- **La degradación es determinista.** Usa contadores de costo del propio motor (operaciones, entidades procesadas), no el reloj de la máquina: el mismo seed en otra computadora degrada igual. El tiempo real se mide solo en `tools/` para ajustar los presupuestos.
- **Lo que nunca se recorta:** conservación, causas, hechos fijados, la puesta al día de los pendientes, las tribulaciones y descargas que ya dispararon.

### 13.1 Perfiles de espera: el tiempo tiene que rendir calidad

El criterio general (aprobado 2026-10-06) es que **la calidad de la simulación se compare bien con el tiempo usado**. Por eso no hay un presupuesto único sino tres perfiles:

| Perfil | Cuándo | Objetivo | Qué se hace con el tiempo extra |
|---|---|---|---|
| **Acción** | El jugador hizo algo ahora | Rápido: menos de medio segundo de simulación por acción, sin contar el LLM | Nada: se cumple el presupuesto estricto y se usa la simulación por adelantado (§13.2) para que lo lejano ya esté hecho |
| **Salto** | Rutinas y saltos de tiempo | Puede tardar: se prioriza la calidad, con barra de progreso y resumen parcial | Más resolución: menos degradación, más tier 3 con cadencia fina, zonas regionales más grandes, puesta al día detallada de los conocidos |
| **Worldgen** | Generar un mundo nuevo | 10 a 15 minutos están bien si el resultado es bueno | Épocas más finas en el embudo, más culturas y lenguas, historia con individuos en más regiones, calibración más larga |

- El perfil cambia **cuánto se degrada**, no las leyes. Como la degradación es determinista (§13), el mismo seed con el mismo perfil da el mismo mundo; el perfil queda registrado en el log de la partida para que el replay sea exacto.
- El perfil de cada partida se fija al crearla (con valores por defecto), y el de salto se puede ajustar en la partida como opción del jugador ("saltos rápidos" o "saltos detallados"); el cambio es un evento fuera del mundo con su tick.

### 13.2 Simulación por adelantado (mientras el jugador piensa)

Se puede seguir simulando por detrás (aprobado 2026-10-06) sin romper el determinismo, de dos formas que se combinan:

**a) Por cono causal (sin riesgo).** Lo que el jugador haga ahora solo puede llegar lejos a la velocidad del canal más rápido que tiene a su alcance: caminar, un caballo, una espada voladora, un talismán de mensaje, un ave. Una zona a distancia `d` no puede ser afectada por el jugador antes de `ahora + d / v_max`. Entonces un hilo de fondo (`worker_threads` de Node) avanza esas zonas hasta ese horizonte mientras el jugador lee y escribe, y mientras el LLM narra.
- `v_max` se calcula con los medios **reales** del jugador y de quienes él puede mandar (verdad, no creencia), con margen. Si el jugador consigue una espada voladora, el cono se ensancha y lo especulado más allá del nuevo horizonte se descarta.
- **Acoplamientos globales.** Algunos procesos conectan todo el mundo de golpe (la atención del Cielo, heaven-karma §3; los frentes de precios agregados). Esos procesos definen **puntos de sincronización** (por ejemplo, cada estación): la especulación no pasa un punto de sincronización que el jugador podría afectar antes de llegar.
- Como las tiradas salen de claves (§14) y no del orden, el resultado es idéntico a haberlo simulado en el momento. El test de determinismo lo verifica: el log con simulación de fondo y sin ella es igual byte a byte.

**b) Optimista con descarte (para los saltos).** Cuando el jugador está en una rutina o va a saltar tiempo, el fondo simula por adelantado **suponiendo que la rutina sigue**. Si el jugador hace otra cosa, lo especulado que dependía de él se descarta y se recalcula; lo que no dependía (fuera del cono) se conserva. Así un salto de un año empieza con parte del año ya hecho.
- La especulación trabaja sobre una copia (copy-on-write, §15) y se integra en el commit solo cuando su supuesto se cumplió.
- El costo de descartar es solo tiempo de cómputo; nunca hay estados intermedios visibles.

**Lo que se ve:** nada. El jugador no nota la simulación de fondo salvo en que las acciones responden rápido y los saltos tardan menos. El inspector muestra el horizonte especulado por zona (`lod --ahead`).

## 14. Determinismo

- **Claves de rng:** `rng.fork(system, process, scopeId, windowIndex)` para procesos; `rng.fork("contest", objectId, tick)` para contiendas; `rng.fork("materialize", populationId, slot, epoch)` para materializar; `Deferred.rngKey` para lo diferido. Ninguna tirada depende del orden de iteración.
- **Iteración ordenada:** toda colección que se recorre en la sim se recorre por id ordenado (los `Map` de JS conservan el orden de inserción, pero el orden de inserción puede cambiar con el LOD; ordenar es más seguro).
- **Números:** las cantidades conservadas (bienes, dinero, qi, población) son **enteros** en su unidad mínima; las presiones, probabilidades y campos continuos son `number` de punto flotante. Las funciones trascendentes (`Math.exp`, `Math.sin`) dan lo mismo en el mismo Node; el test de determinismo compara el log de eventos byte a byte en la plataforma de CI.
- **El LOD es parte de la historia.** Mismo seed y mismas acciones dan la misma trayectoria del jugador, por lo tanto las mismas zonas, las mismas materializaciones y el mismo mundo. Un mundo jugado y uno corrido sin jugador no son el mismo (el jugador cambia la resolución y sus acciones cambian el mundo), pero cada uno es reproducible.
- **Herramientas que no tocan nada:** el inspector y la sim headless de calibración nunca materializan ni resuelven diferidos en la partida (ver §11 y §15).

## 15. Snapshots, log y compactación

- **Log de eventos** (append-only): cada evento con causas y emisiones; es la fuente para replay, crónica e inspector.
- **Snapshots** del estado completo cada cierto tiempo de mundo y al guardar; replay = último snapshot + acciones del jugador desde ahí ([tooling.md] futuro).
- **Compactación** (causality §8): los eventos viejos y de poco peso se resumen en eventos agregados que heredan sus enlaces. Es la misma operación que el olvido entre épocas de deep-history, corrida en tiempo de juego con ventanas más cortas. Lo fijado por percepción del jugador no se compacta mientras el jugador viva (la crónica lo necesita).
- **Copias descartables:** el inspector y los contrafácticos trabajan sobre un fork del estado (copy-on-write); al terminar se tira.

## 16. De la historia al presente

La generación del mundo y el juego son **la misma corrida**:
1. Worldgen fija las condiciones iniciales (cosmología, planeta, leyes) y siembra las primeras poblaciones.
2. El scheduler corre con todo el mundo en resolución "history", con pasos de época según el embudo (deep-history): milenios al principio, después siglos, décadas.
3. Al acercarse al presente, la región inicial sube de resolución: últimos siglos con organizaciones completas, últimas décadas con individuos (los recuerdos de los NPCs vivos salen de acá).
4. El jugador nace (o entra) y la zona alrededor pasa a "local" y "scene". No hay un corte: los procesos que venían corriendo siguen con otra cadencia.
5. Cada cierre de época compacta y olvida con el criterio de deep-history; los legados pasan.

Así las presiones que el jugador encuentra al nacer (la hambruna que viene, la secta en decadencia, el usurero que se quedó con la tierra del abuelo) tienen la misma naturaleza que las que va a generar él.

## 17. El jugador y el narrador

- **El jugador nunca ve tiers ni zonas.** No hay "cargando región" ni personajes que aparecen de la nada: la materialización ocurre antes de que el jugador pueda percibirlos, en el borde de la zona local.
- **Multitudes y lejanía.** Lo que se ve de lejos (una ciudad desde la colina, el ejército en el valle) se percibe en agregado (perception §12) y se materializa solo lo que entra al rango de detalle.
- **Los saltos de tiempo se cuentan desde la percepción.** El narrador resume un salto con lo que el personaje vivió, notó y le contaron, nunca con lo que el motor sabe (regla 4 de CLAUDE.md).
- **La puesta al día es invisible y coherente.** Volver al pueblo después de años muestra lo que pasó (casas nuevas, muertos, chismes), porque la puesta al día lo resolvió con causas.

## 18. Inspector

Comandos que agrega este sistema (en `tools/`, solo lectura; se suman a los de causality §10):
- `lod` — mapa de zonas con su resolución y el porqué; tiers por región.
- `tier <entidad>` — tier actual, puntaje de importancia por componente, historial de cambios.
- `budget` — costo por fase y proceso en el último paso, degradaciones activas.
- `materialize --dry <población>` — muestra quién saldría de una ranura, en una copia descartable.
- `catchup <entidad>` — los eventos pendientes y la última puesta al día.
- `schedule [--at <tick>]` — la cola de ítems agendados con sus razones.

## Implementación por fase

- **Fase 0:** `core/time` con ticks y conversión a calendario simple; `core/rng` con `fork` por clave; `ProcessDef`, cola de ítems agendados, fases y commit de diffs; contiendas; test de determinismo byte a byte con un proceso de juguete.
- **Fase 1:** una sola zona (la aldea) en resolución scene/local; todos los individuos tier 2-4; sin agregados; `advanceUntil` con interrupciones simples para el bucle CLI.
- **Fase 3:** cadencia diaria para la vida offscreen dentro de la región; tier 1 dormidos con puesta al día; primeros modelos agregados (demografía, mercado) con su contrato y test de calibración.
- **Fase 5:** simulación por adelantado por cono causal en un worker y perfiles de espera. Zonas con las cinco resoluciones y histéresis; asignación de tiers con importancia y cupos; materialización completa con ranuras, biografía sintetizada y hechos fijados; flujos de borde; presupuesto con degradación determinista; `Deferred` general.
- **Fase 7:** resolución "history" con el embudo de épocas, cierre de época con compactación y olvido, transición continua de la historia al presente.
- **Fase 8:** mundo completo: tier 3 en todos los continentes con cupos, zonas regionales pedidas por eventos lejanos, perfiles de rendimiento y ajuste de presupuestos.

## Tests

- **Determinismo:** mismo seed y mismas acciones → mismo log de eventos, byte a byte; recorrer las entidades en otro orden da lo mismo; agregar un proceso nuevo sin efectos no cambia las tiradas de los demás.
- **Conservación en los bordes:** la población, los bienes, el dinero y el qi totales son iguales antes y después de materializar, desmaterializar, cruzar una zona o hacer una puesta al día.
- **Hechos fijados:** ningún proceso agregado ni materialización contradice un `PinnedFact`; generar el contrafáctico de "materializar de nuevo" la misma ranura da la misma persona.
- **Ida y vuelta:** `absorb(materialize(S)) ≈ S` para cada modelo agregado.
- **Calibración:** para cada sistema con agregado, las tasas del modo agregado caen dentro de la tolerancia del modo individual en escenarios de referencia.
- **Puesta al día:** despertar a un tier 1 a los 5 años o a los 10 (sin nada externo entre medio) da el mismo estado a los 10.
- **Histéresis:** entrar y salir de una zona repetidamente no materializa personas nuevas cada vez.
- **Simulación de fondo:** el log de eventos con simulación por adelantado (cono y optimista) es idéntico al log sin ella; ninguna zona especulada pasa su horizonte ni un punto de sincronización.
- **Presupuesto:** la degradación es la misma en dos máquinas distintas con el mismo seed; la escena del jugador nunca se degrada.
- **El inspector no escribe:** correr todos los comandos del inspector y la sim headless de calibración no cambia el hash del estado.
- **Tier 4 no baja:** nadie con vínculo significativo con el jugador pierde resolución.

## Decisiones tomadas en este borrador (revisables)

- **Un solo motor con procesos puros** que devuelven diffs; el scheduler aplica en fases fijas (percibir → decidir → actuar → física → asentar).
- **Dos ejes de LOD:** tier de agente (0-4) y resolución de zona (scene, local, regional, world, history). Los "tier" de procesos en los docs de sistema se leen como resolución de zona (§4.3).
- **Tick = segundo absoluto**, entero; calendarios como cultura.
- **Quien fue tier 2 o más nunca vuelve a tier 0:** queda como registro dormido con puesta al día.
- **Tier 4 = vínculo significativo** (familia cercana, maestro, discípulos, pareja, enemigos declarados, compromisos con peso kármico, relación intensa), no cualquiera que el jugador conoció; los demás quedan como tier 1 con su memoria del jugador (aprobado 2026-10-06).
- **Tres perfiles de espera** (acción rápida, salto con calidad primero, worldgen de 10 a 15 minutos): el tiempo tiene que rendir calidad (§13.1, aprobado 2026-10-06).
- **Simulación por adelantado** por cono causal y optimista con descarte, en `worker_threads`, idéntica a la simulación en el momento (§13.2, aprobado 2026-10-06).
- **Conflictos de escritura como contiendas** con iniciativa que sale del estado, nunca por orden de procesamiento.
- **Identidad estable por ranura** en la materialización.
- **Cantidades conservadas en enteros**, el resto en punto flotante.
- **Presupuesto con contadores del motor**, no con el reloj, para que la degradación sea determinista.
- **La historia y el juego son una sola corrida** del scheduler.

## Preguntas abiertas

- Calibración: tamaño de la zona local y de la regional; tiempos de histéresis; umbrales de entrada y salida de tier 3 y pesos del puntaje de importancia; cupos de tier 2 y tier 3; cadencias por proceso y resolución; tolerancias de los tests de calibración agregado–individual; intervalo de snapshots; presupuestos por acción, por día saltado y por año de historia en cada perfil; margen de `v_max` y frecuencia de los puntos de sincronización.
