# Acciones e intenciones — de lo que el jugador quiere a lo que el mundo resuelve

> Principio: **el jugador puede intentar cualquier cosa, pero solo puede intentarla.** El texto libre expresa una intención; la intención se traduce a acciones de un catálogo cerrado; el mundo decide qué pasa. Ni el jugador ni el LLM escriben resultados.

> Estado: **borrador** (2026-10-06).

Depende de: [simulation.md](simulation.md) (scheduler, fases, contiendas, `advanceUntil`), [causality.md](causality.md) (procesos, causas), [information.md](information.md) (creencias: las referencias y la factibilidad se resuelven contra lo que el actor cree), [perception.md](perception.md) (el actor percibe su propio resultado), [body-health.md](body-health.md) §3 (capacidades), [social-structure.md](social-structure.md) §5 (capacidad, medios, contrapartes), [npc-psychology.md](npc-psychology.md) §7 (utilidad sobre el mismo catálogo), [heaven-karma.md](heaven-karma.md) §6 (inclinación de tiradas), [ARCHITECTURE.md](../ARCHITECTURE.md) (contratos `ActionPlan` y `Outcome`).
Lo usan: todos los sistemas que resuelven verbos (combat, dialogue, crafts, economy, law, cultivation, travel…), el parser de intención y el narrador ([narration.md] futuro), el bucle del jugador ([player-loop.md] futuro), la IA de NPCs y las órdenes de organizaciones (organizations §5).

---

## Principios

1. **Catálogo cerrado de verbos, composición abierta.** Hay un conjunto finito de verbos primitivos en `content/`. La libertad del jugador está en combinarlos, en los modos (cómo), los objetivos (a quién, con qué) y las condiciones (hasta cuándo, si pasa tal cosa). Lo que no se puede expresar con el catálogo se registra como verbo faltante para agregarlo como contenido, nunca se improvisa.
2. **Un solo catálogo para todos.** El jugador, los NPCs, los espíritus y las bestias con mente usan los mismos verbos (npc-psychology §7). Una orden de una secta a un discípulo se vuelve un plan del mismo tipo.
3. **Intentar es del actor, resolver es del mundo.** El actor decide con lo que cree; la ejecución se resuelve contra la verdad. Una acción que el personaje cree posible y no lo es se intenta y falla con forma; una que cree imposible y es posible no se intenta salvo que el jugador insista.
4. **Las referencias son creencias.** "El viejo del puesto de té", "la cueva donde vi la hierba", "mi espada" se resuelven contra las creencias del actor, no contra la verdad. Se puede actuar sobre algo que no existe (una entidad fantasma, information §1) y descubrirlo al fallar.
5. **El texto no dicta resultados.** "Lo mato de un golpe" es la intención de matar de un golpe; "encuentro una espada" es buscar. El parser separa la intención de lo que el jugador desea que pase y descarta lo segundo.
6. **Toda acción ocupa cuerpo, tiempo y atención.** Tiene duración, usa recursos del cuerpo (manos, piernas, voz, vista, mente, esencia), emite señales (perception §2) y se puede interrumpir.
7. **Los fracasos tienen forma.** Fallar sale del factor más débil (la fatiga, la luz, la herramienta, el nervio) y deja consecuencias concretas: se resbala, hace ruido, rompe la herramienta, agarra lo que no era.

---

## 1. Anatomía de un verbo

```ts
interface ActionDef {
  verb: VerbId;                                   // "take", "strike", "speak", "hide", "cultivate"
  domain: ActionDomain;                           // movement | manipulation | perception | social | combat | work | body | mind | esoteric | time
  args: ArgSpec[];                                // qué objetivos acepta: entidad, lugar, lote, creencia, técnica, acto de habla
  manners: MannerKey[];                           // modos válidos: covert, careful, fast, forceful, polite, threatening, ritual…
  requires: Requirement[];                        // §5: capacidad, saber, medios, posición, estado
  occupies: ResourceUse;                          // §6: qué partes del cuerpo y de la mente usa
  duration: DurationModel;                        // base por condiciones, modificada por habilidad y modo
  checkpoints: CheckpointSpec;                    // dónde se puede interrumpir o re-decidir (§6)
  emissions: EmissionTemplate;                    // qué emite por canal según modo (perception §2)
  resolver: ResolverRef;                          // qué sistema lo resuelve (§7)
  contest?: ContestKind;                          // si se opone a otro actor (sigilo vs percepción, fuerza vs fuerza)
  failureModes: FailureMode[];                    // §8: formas de fallar con su factor
  originContent: ContentRef;                      // de qué archivo de content sale (para auditar)
}

type ResourceUse = Partial<Record<"legs" | "handL" | "handR" | "voice" | "eyes" | "mind" | "essence", "full" | "partial">>;
```

- **Los verbos viven en `content/actions/`**, validados con Zod. Los sistemas registran el resolver de los verbos que les tocan.
- **Los modos no son decoración:** cambian duración, emisiones, dificultad y riesgo. `take` con `covert` es más lento y emite menos; con `fast`, al revés; con `forceful` es arrebatar.

## 2. El catálogo primitivo

Orientativo, no exhaustivo (el número final sale del contenido, del orden de 80 a 120 verbos):

| Dominio | Verbos | Resuelve |
|---|---|---|
| Movimiento | `move`, `go_to` (con ruta), `follow`, `approach`, `withdraw`, `flee`, `climb`, `swim`, `jump`, `crawl`, `ride`, `fly`, `hide`, `sneak`, `enter`, `leave`, `block_way` | travel, body-health, perception |
| Manipulación | `take`, `drop`, `put`, `give`, `hand_over`, `open`, `close`, `lock`, `break`, `carry`, `wield`, `sheathe`, `wear`, `remove`, `eat`, `drink`, `apply` (vendaje, ungüento), `use` (objeto con función) | economy (tenencias), body-health, crafts |
| Percepción | `look`, `search`, `listen`, `smell`, `inspect`, `read`, `track`, `watch` (vigilar por un tiempo), `sense_essence`, `probe_cultivation` | perception, discovery |
| Social | `speak` (con acto de habla), `gesture`, `bow` y demás etiqueta, `offer`, `accept`, `refuse`, `bargain`, `command`, `request`, `threaten`, `embrace`, `touch` | [dialogue.md] futuro, economy, social-structure |
| Combate | `strike`, `thrust`, `throw`, `shoot`, `parry`, `dodge`, `block`, `grapple`, `disarm`, `feint`, `disengage`, `yield`, `spare`, `finish` | [combat.md] futuro, body-health, elements |
| Trabajo | `work_at` (oficio por sesión), `craft_step`, `farm`, `gather`, `hunt`, `fish`, `fell`, `mine`, `build`, `repair`, `cook`, `clean`, `tend` (animales, enfermos) | crafts, economy, living-world, technology |
| Cuerpo | `rest`, `sleep`, `train`, `treat` (curar a otro), `stretch`, `relieve`, `bathe` | body-health |
| Mente | `recall`, `think_over`, `hypothesize`, `experiment`, `study`, `memorize`, `write`, `copy`, `plan`, `pray`, `contemplate` | discovery, information, npc-psychology |
| Esotérico | `cultivate`, `circulate`, `use_technique`, `refine`, `lay_formation`, `activate`, `inscribe_talisman`, `divine`, `perform_rite`, `offer` (a un espíritu), `bind`, `swear_oath` | cultivation, crafts, divination, spirits, contracts |
| Tiempo | `wait`, `wait_until`, `routine` | simulation §12 |

- **Verbos compuestos frecuentes** (robar, emboscar, cortejar, pedir trabajo, comprar en el mercado) no son verbos: son **plantillas de plan** (§3) que el parser y los NPCs usan como atajo.
- **Contratos, juramentos, matrimonios y ventas** son verbos sociales (`offer`, `accept`, `swear_oath`) cuyo resultado crea un `Commitment` (contracts).

## 3. Planes: composición de verbos

Revisa el contrato `ActionPlan` de ARCHITECTURE:

```ts
interface ActionPlan {
  actor: AgentId;
  source: "player" | "utility" | "order" | "routine" | "reflex";
  goal?: GoalRef | string;                // para qué (alimenta la utilidad y la narración; no cambia la resolución)
  root: PlanNode;
  manner: MannerKey[];                    // modos generales ("con cuidado", "sin que me vean")
  constraints: Constraint[];              // "sin matar a nadie", "no gastar más de 10 taeles", "antes de que anochezca"
  risksAccepted: RiskKey[];               // "acepto pelear si me descubren"
  interrupts: InterruptRule[];            // cuándo parar y devolver el control (al jugador) o re-decidir (al NPC)
  causes: CauseRef[];                     // la intención del jugador, el objetivo del NPC, la orden recibida
}

type PlanNode =
  | { kind: "do"; verb: VerbId; args: ArgRef[]; manner?: MannerKey[] }
  | { kind: "seq"; steps: PlanNode[] }
  | { kind: "until"; body: PlanNode; cond: Condition }        // "busco hasta encontrar algo o hasta que anochezca"
  | { kind: "repeat"; body: PlanNode; times?: number; every?: Duration }
  | { kind: "if"; cond: Condition; then: PlanNode; else?: PlanNode }
  | { kind: "onEvent"; trigger: Condition; react: PlanNode }  // "si alguien viene, me escondo"
  | { kind: "template"; template: TemplateId; params: Record<string, ArgRef> };

type Condition = BeliefCondition | PerceptCondition | TimeCondition | StateOfSelfCondition;
```

- **Las condiciones se evalúan sobre lo que el actor percibe y cree**, nunca sobre la verdad: "si nadie mira" quiere decir "si no veo a nadie mirando".
- **Plantillas** (`content/plans/`): secuencias conocidas como robar en un mercado (observar, acercarse, esperar distracción, `take` encubierto, alejarse), emboscar, regatear, presentarse a un examen. Son **saber cultural**: un NPC solo usa las plantillas que conoce (un ladrón profesional conoce más y mejores). El jugador puede describir su propio plan paso a paso sin plantilla.
- **Profundidad acotada.** Un plan del jugador se ejecuta hasta su próxima interrupción; los planes largos de verdad (meses) son rutinas (simulation §12) y metas del jugador ([player-loop.md] futuro).

## 4. Referencias: a qué se refiere el actor

El parser no conoce entidades: produce **descripciones**. La simulación las resuelve contra las creencias del actor.

```ts
interface RefDescription {
  text: string;                            // "el viejo del puesto de té"
  kind?: EntityKind;                       // persona, objeto, lugar, lote, grupo
  features: FeatureClaim[];                // viejo, puesto de té, la espada con empuñadura roja
  relation?: { to: "self" | RefDescription; rel: string };   // "mi espada", "el hermano de Wu"
  quantity?: QuantitySpec;                 // "tres", "todo", "un poco"
}

interface ResolvedRef {
  desc: RefDescription;
  candidates: Array<{ ref: EntityRef | PhantomRef; score: number; via: BeliefId[] }>;
  chosen?: EntityRef | PhantomRef;
  status: "unique" | "ambiguous" | "unknown" | "phantom";
}
```

- **Único:** se usa.
- **Ambiguo:** si hay dos o más candidatos parecidos, la simulación arma una pregunta de aclaración **en términos del personaje** ("¿el viejo que vende té verde o el que estaba durmiendo detrás?"), con los rasgos que el personaje percibió. El LLM solo la redacta.
- **Desconocido:** el personaje no tiene creencias que encajen ("el maestro de la secta" sin saber quién es). La intención se reformula como buscar o preguntar, o se le dice al jugador lo que el personaje sabe.
- **Fantasma:** la creencia apunta a algo que no existe (el tesoro que te mintieron). La acción se intenta; el fracaso es la forma en que el personaje se entera.
- **Lo que percibe ahora pesa más** que lo que recuerda: "el guardia" en una escena es el guardia que ve.

## 5. Requisitos: qué hace falta para intentar y para lograr

Siguiendo social-structure §5 (capacidad, medios, contrapartes), con un paso más: la diferencia entre **intentar** y **lograr**.

```ts
type Requirement =
  | { kind: "capability"; cap: CapabilityKey; min: number }          // body-health §3: locomotion, manipulation, speech…
  | { kind: "knowledge"; of: SkillRef | TechniqueRef | ProcessRef | LanguageRef; min?: number }
  | { kind: "means"; item?: ItemSpec; money?: MoneySpec; site?: SiteSpec }
  | { kind: "position"; near?: ArgRef; inside?: ArgRef; posture?: Posture }
  | { kind: "state"; awake?: true; free?: ResourceUse; notBound?: true }
  | { kind: "threshold"; law: LawKey; min: number }                  // cultivo: volar exige un umbral real
  | { kind: "counterpart"; who: ArgRef; decides: "accept" | "resist" };
```

Se evalúan dos veces:
1. **Al decidir (creencias):** ¿el actor cree que cumple? Un NPC no elige acciones que cree imposibles. El jugador recibe un aviso **desde lo que su personaje sabe** ("nunca aprendiste a leer esa escritura"); si insiste, se intenta.
2. **Al ejecutar (verdad):** se evalúa contra el estado real. Si falta algo, la acción falla con la forma del requisito que faltó: intentar volar sin el umbral es saltar; leer sin saber es mirar signos; sobornar sin plata suficiente es una oferta insultante.

- **Las normas no son requisitos.** Que algo esté prohibido (por la ley, la etiqueta, la secta) no lo impide: crea consecuencias si alguien lo percibe (law, social-structure §4). El sistema nunca dice "no podés porque está prohibido".
- **Contrapartes.** Las acciones que necesitan a otro (comprar, entrar, casarse, enseñar) llaman a la decisión del otro con su utilidad y sus creencias sobre el actor. Lo que el otro decide es parte del resultado.
- **Saber hacer sin saber.** Se puede intentar algo que no se sabe (imitar una técnica vista, curar sin medicina): se resuelve con habilidad mínima y alto riesgo, y puede producir aprendizaje o descubrimiento (discovery, [skills.md] futuro).

## 6. Duración, recursos, concurrencia e interrupción

- **Duración** = base del verbo × condiciones (terreno, luz, peso, clima) × habilidad × modo, con ruido de la tirada. Un `search` cuidadoso de una habitación es más largo que uno rápido y encuentra más.
- **Recursos del cuerpo.** Dos acciones pueden correr juntas si no compiten por recursos llenos: caminar y hablar sí, escribir y pelear no. Los recursos parciales se suman hasta su capacidad (vigilar con el rabillo del ojo mientras se trabaja divide la atención; perception §4).
- **Checkpoints.** Las acciones largas se parten en tramos (cada minuto de un `search`, cada paso de una sesión de oficio, cada hora de un `go_to`). En cada uno el scheduler revisa interrupciones y el actor puede re-decidir.
- **Interrupciones.** Llegan por: (a) las reglas del plan (`interrupts`, `onEvent`); (b) percepts con saliencia mayor que el foco del actor (alguien grita su nombre, huele humo); (c) acciones de otros que lo afectan (lo agarran, le hablan, lo atacan); (d) su propio cuerpo (desmayo, dolor, un ataque de tos). El jugador recibe el control; un NPC re-decide con su utilidad.
- **Resultados parciales.** Lo hecho queda: el pozo a medio cavar, la mitad del camino, el lote a medio contar. No hay "acción cancelada sin efectos".
- **Reflejos.** Algunas reacciones no esperan decisión: esquivar un golpe, soltar algo que quema, cubrirse los ojos. Salen de los hábitos y del entrenamiento del actor ([combat.md] futuro) y corren como plan con `source: "reflex"`, también para el jugador.

## 7. Resolución

Cada verbo tiene un resolver en su sistema (crafts resuelve `craft_step`, economy resuelve `bargain`, combat resuelve `strike`). Todos devuelven la misma forma:

```ts
interface ActionResolution {
  plan: PlanRef;
  node: PlanNodeRef;
  margin: number;                          // continuo: cuánto sobró o faltó respecto de la dificultad
  outcome: Outcome;                        // categoría para la narración y la memoria
  factors: ResolutionFactor[];             // qué pesó y cuánto: habilidad, fatiga, luz, herramienta, inclinación del Cielo
  changes: StateChange[];
  events: Event[];                         // con causes (la intención, las presiones, las creencias) y emissions
  selfPercepts: Percept[];                 // lo que el actor percibe de su propio resultado
}

type Outcome =
  | "success" | "partial" | "failure"
  | "failure_unnoticed"      // falló y el actor no se dio cuenta (cree que salió bien)
  | "failure_suspected"      // falló y el actor sospecha
  | "discovered"             // salió, pero alguien lo vio
  | "critical";              // salió excepcionalmente bien o mal, con consecuencias grandes
```

**La forma común de un resolver:**
1. **Dificultad desde el estado:** lo que hay que vencer (la cerradura, la atención del guardia, la armadura, el precio que el otro cree justo).
2. **Capacidad efectiva del actor:** habilidad ([skills.md] futuro) × capacidades (body-health §3) × herramienta × condiciones × estado mental (dolor, miedo, concentración) × cultivo.
3. **Tirada** con clave `rng.fork("action", actorId, verb, tick)`, y la **inclinación del Cielo** si corresponde (heaven-karma §6: acotada, sobre la tirada, nunca sobre la realidad).
4. **Contienda** si hay oposición: la otra parte tira con su propia clave y su capacidad (sigilo contra percepción; fuerza contra fuerza). Si dos acciones compiten por lo mismo, es la contienda del scheduler (simulation §3).
5. **Margen → cambios y eventos**, con la forma de fracaso del factor más débil (§8).
6. **Autopercepción:** el actor percibe su resultado por los canales normales. `failure_unnoticed` y `failure_suspected` salen de ahí, no de una regla aparte: el alquimista que no vio la grieta cree que la píldora está bien.

## 8. Fracasos con forma

```ts
interface FailureMode {
  id: string;                              // "slip", "noise", "wrong_target", "tool_breaks", "overreach", "partial", "takes_longer", "self_injury"
  weakestFactor: FactorKey;                // qué factor lo produce: fatiga → resbalón; poca luz → objetivo equivocado
  severityByMargin: Curve;                 // cuánto peor según el margen
  effects: EffectTemplate[];               // cambios en el estado y emisiones extra (el ruido que despierta al perro)
}
```

- El fracaso se elige por el factor que más restó en esa tirada, no al azar: así es explicable ("te temblaba la mano del frío") y aprendible.
- Los fracasos producen **experiencia y creencias** (el actor aprende que esa cerradura es difícil, que ese guardia es atento) y alimentan la habilidad ([skills.md] futuro) y el descubrimiento (discovery: errores con forma).

## 9. El parser de intención

El parser (LLM) traduce texto a un borrador; la simulación hace todo lo demás.

```ts
interface IntentDraft {
  kind: "act" | "plan" | "goal" | "question_ooc" | "meta";
  plan?: DraftPlanNode;                    // como PlanNode pero con RefDescription en vez de refs
  manner?: MannerKey[];
  constraints?: string[];                  // normalizadas a Constraint por la sim
  risksAccepted?: RiskKey[];
  stripped?: string[];                     // lo que el jugador escribió como resultado deseado y se descartó
  unmapped?: string[];                     // partes que no encajan en ningún verbo
  speech?: SpeechDraft;                    // si hay diálogo: qué dice el personaje, textual ([dialogue.md] futuro)
}
```

**Pipeline:**
1. **Parsear** (LLM rápido, salida estructurada validada con Zod). El parser recibe el catálogo de verbos y modos, la escena **como la percibe el personaje** y las intenciones recientes; nunca la verdad.
2. **Validar el esquema.** Si no valida, se reintenta una vez; si sigue mal, se le pide al jugador que lo diga de otra forma.
3. **Resolver referencias** (§4) contra las creencias del personaje.
4. **Factibilidad creída** (§5, paso 1): avisos desde lo que el personaje sabe.
5. **Confirmar solo si hace falta:** ambigüedad real, una acción irreversible grave que el jugador quizás no quiso (matar, quemar, romper un juramento) o algo que quedó en `unmapped`. Lo demás se ejecuta directo.
6. **Ejecutar** como plan del agente del jugador en el scheduler.

**Casos especiales:**

| Lo que escribe el jugador | Qué se hace |
|---|---|
| Un resultado ("lo convenzo", "encuentro la hierba") | Se convierte en intento (persuadir, buscar); lo descartado va en `stripped` |
| Acciones de otros ("y él me da la plata") | Se descarta: los otros deciden solos. Se puede convertir en un pedido o una oferta |
| Hechos del mundo ("hay un río cerca, voy") | Se trata como creencia del jugador: si el personaje no lo cree, se le dice lo que sabe; si va igual, va a buscar un río |
| Una meta grande ("quiero volverme inmortal") | `kind: "goal"`: entra a las metas del personaje ([player-loop.md] futuro), no es una acción |
| Algo fuera del catálogo | Se mapea a lo más cercano con aviso, o se rechaza con la razón; se registra en `tools/` como verbo faltante para contenido |
| Una pregunta al juego ("¿cuánto tiempo pasó?") | `question_ooc`: se responde con lo que el personaje sabe |
| Comandos (guardar, inspector) | `meta`: fuera del mundo |

## 10. Acciones de NPCs y órdenes

- **Utilidad sobre el catálogo** (npc-psychology §7): los candidatos salen de los objetivos activos, las plantillas conocidas y lo que la escena permite según sus creencias. Se puntúa con utilidad y se elige con softmax.
- **Planes.** En Fase 3, encadenamiento simple hacia un objetivo con plantillas; HTN o GOAP más adelante si hace falta. Las intrigas (schemes) producen planes multi-paso con el mismo `ActionPlan`.
- **Órdenes.** Una orden de una organización (organizations §5) llega como `ActionPlan` con `source: "order"` y la brecha de ejecución: el subordinado la reinterpreta con sus creencias, su lealtad y su utilidad (puede cumplirla a medias, mal o no cumplirla).
- **Rutinas.** Planes `repeat` con interrupciones, para el día del campesino, la guardia del portón o la meditación del cultivador.

## 11. El jugador y el narrador

- **El narrador recibe el resultado tal como lo percibe el personaje** (`selfPercepts` más los percepts de la escena), nunca `margin` ni `factors` crudos. Un `failure_unnoticed` se narra como si hubiera salido bien.
- **Los factores se pueden contar si se perciben:** "te temblaba la mano por el frío" solo si el personaje lo notó.
- **Las aclaraciones y los avisos son del mundo del personaje:** nada de "acción inválida". El texto lo redacta el LLM a partir de lo que armó la simulación (candidatos con rasgos percibidos, requisito que el personaje sabe que le falta).
- **El jugador ve sus planes en curso** (qué está haciendo, hasta cuándo, qué lo interrumpiría) como parte del estado de su personaje.

## 12. Escala (LOD)

Con la resolución de zona de simulation §4:
- **scene:** cada verbo con su resolver completo, checkpoints finos, contiendas individuales, autopercepción.
- **local:** las acciones de NPCs de tier 2 se resuelven por tramo grande (una mañana de trabajo es un `work_at` con un resultado); las contiendas se resuelven con capacidades resumidas.
- **regional y world:** los NPCs no ejecutan verbos sino rutinas resumidas cuyo efecto son flujos (producción, comercio, crimen como tasas). Los tier 3 deciden por objetivo y los resultados se resuelven con un solo cálculo por período.
- **history:** no hay acciones; hay procesos de riesgo (simulation §9).

## 13. Implementación por fase

- **Fase 1:** ~10 verbos (moverse, buscar/recolectar, hablar, trabajar, descansar, robar como plantilla, pelear, comerciar, observar, esperar); `ActionPlan` lineal con `seq` y `until`; parser con salida validada; referencias únicas o ambiguas con aclaración; requisitos de capacidad y medios; `Outcome` con autopercepción; fracasos con forma por factor.
- **Fase 2:** factibilidad creída con avisos desde el conocimiento del personaje; actos de habla como argumento de `speak`; entidades fantasma como referencias.
- **Fase 3:** NPCs con el mismo catálogo por utilidad, plantillas de plan en `content/`, rutinas con interrupciones, recursos del cuerpo y concurrencia, resultados parciales.
- **Fase 4:** verbos esotéricos (cultivar, técnicas, talismanes, juramentos) con requisitos de umbral; reflejos.
- **Fase 5-6:** verbos de viaje y transporte; órdenes de organizaciones con brecha de ejecución; registro de verbos faltantes en `tools/`.

## Tests

- **Ningún resultado desde el texto:** para un corpus de frases con resultados ("lo mato", "encuentro", "me da"), el parser nunca produce cambios de estado y siempre llena `stripped`.
- **Referencias contra creencias:** un personaje que no vio algo no puede referirse a ello como "único"; una referencia a una entidad fantasma se ejecuta y falla con forma.
- **Mismo catálogo:** cualquier `ActionPlan` de NPC valida contra el mismo esquema que los del jugador.
- **Factibilidad en dos pasos:** una acción imposible en la verdad pero creída posible se intenta y falla con el requisito faltante; una creída imposible no la elige ningún NPC.
- **Fracaso con forma:** con todo igual salvo la luz, el modo de fracaso cambia a `wrong_target`; con todo igual salvo la fatiga, a `slip`.
- **Determinismo:** mismo plan, mismo estado y mismo tick → misma resolución; el orden en que se resuelven dos actores no cambia el resultado (contiendas).
- **Resultados parciales:** interrumpir una acción larga en un checkpoint deja el estado intermedio, nunca el inicial.
- **Autopercepción:** un `failure_unnoticed` deja en el actor una creencia de éxito y en la verdad el fracaso.

## Decisiones tomadas en este borrador (revisables)

- **Catálogo cerrado de verbos primitivos** (del orden de 80 a 120) en `content/actions/`, más plantillas de plan como saber cultural; nada de verbos improvisados.
- **`ActionPlan` como árbol** (`seq`, `until`, `repeat`, `if`, `onEvent`, `template`) con condiciones sobre percepciones y creencias del actor.
- **El parser produce descripciones, la simulación resuelve referencias** contra las creencias del actor; las aclaraciones las arma la simulación.
- **Factibilidad en dos pasos:** creída al decidir, real al ejecutar; las normas nunca bloquean, solo traen consecuencias.
- **Confirmar solo lo ambiguo, lo grave e irreversible y lo no mapeado**; el resto se ejecuta directo.
- **Fracasos elegidos por el factor más débil**, no al azar.
- **Reflejos como planes automáticos** que corren también para el jugador.

## Preguntas abiertas

- Calibración: número final de verbos y de modos; granularidad de checkpoints por verbo; umbral de saliencia para interrumpir; curvas de margen a `Outcome`; cuánto pesan los modos en duración y emisiones; frecuencia de confirmaciones aceptable para el jugador.
