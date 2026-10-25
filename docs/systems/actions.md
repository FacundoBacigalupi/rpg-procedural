# Acciones e intenciones — de lo que el jugador quiere a lo que el mundo resuelve

> Principio: **el jugador puede intentar cualquier cosa, pero solo puede intentarla.** El texto libre expresa una intención; la intención se traduce a acciones de un catálogo cerrado; el mundo decide qué pasa. Ni el jugador ni el LLM escriben resultados.

> Estado: **borrador** (2026-10-06).

Depende de: [simulation.md](simulation.md) (scheduler, fases, contiendas, `advanceUntil`), [causality.md](causality.md) (procesos, causas), [information.md](information.md) (creencias: las referencias y la factibilidad se resuelven contra lo que el actor cree), [perception.md](perception.md) (el actor percibe su propio resultado), [body-health.md](body-health.md) §3 (capacidades), [social-structure.md](social-structure.md) §5 (capacidad, medios, contrapartes), [npc-psychology.md](npc-psychology.md) §7 (utilidad sobre el mismo catálogo), [heaven-karma.md](heaven-karma.md) §6 (inclinación de tiradas), [ARCHITECTURE.md](../ARCHITECTURE.md) (contratos `ActionPlan` y `Outcome`).
Lo usan: todos los sistemas que resuelven verbos (combat, dialogue, crafts, economy, law, cultivation, travel…), el parser de intención y el narrador ([narration.md](narration.md)), el bucle del jugador ([player-loop.md](player-loop.md)), la IA de NPCs y las órdenes de organizaciones (organizations §4).

---

## Principios

**Reservas económicas opt-in (2026-10-12):** `ActOptions.serialEconomicVerbs` permite incorporar `eat` y `cook`, además de `trade`/`give`, al grupo económico explícito. Con `economicBatch`, el plan lee la despensa actualizada compartida con la rutina de otros familiares y los talleres; un plan activo solo saltea la rutina de su propio actor. Los casos reales de comer o preparar pan mientras otro familiar come y el taller consume grano reproducían doble débito y eventos asentados sin sus bienes. El servicio canónico conserva las agendas y reduce o rechaza consumos según recursos reales; no modifica las reglas del resolver ni serializa combate. Omitir estos parámetros conserva el comportamiento anterior. Otros consumidores finitos todavía necesitan cobertura y adaptación específica.

**Stock fungible (2026-10-12, opt-in):** el mismo catálogo interno de servicio admite `gather` y `take`, tanto desde el lugar actual como desde una persona explícita. Ambos resolvers actuales transfieren `Holding[]` del ledger, sin mover objetos con identidad; las manos/ojos ocupados pertenecen al actor. `take` personal conserva su tirada de oposición, percepción de la víctima y captura dentro del resolver. Dos planes simultáneos sobre 100 g en un campo o un bolsillo reproducen doble débito sin servicio. En el dominio, cada actor según orden canónico intenta resolver con el saldo que dejaron los anteriores; ambos conservan agenda y terminan sus planes. Este orden expresa atención de lotes fungibles, no iniciativa física ni garantía de que el primero logre robar. Un `take` aislado exitoso o capturado produce exactamente la misma verdad, eventos, asientos y agenda con y sin servicio. `gather` agotado falla con `poor_yield`; `take` agotado falla con `no_means` y creencia de fallo mediante `ResolveInput.takeEmptyFailure`, derivado del opt-in `ActOptions.economicBatch`. Esa razón ya existe en el catálogo. Sin el flag, `take` mantiene el outcome anterior; con stock disponible el resultado es idéntico. Los objetos con identidad, resolución de derechos de propiedad, futura iniciativa física y combate siguen fuera de este contrato de saldos: requieren claims/contiendas propios.

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
| Social | `speak` (con acto de habla), `gesture`, `bow` y demás etiqueta, `offer`, `accept`, `refuse`, `bargain`, `command`, `request`, `threaten`, `embrace`, `touch` | [dialogue.md](dialogue.md), economy, social-structure |
| Combate | `strike`, `thrust`, `throw`, `shoot`, `parry`, `dodge`, `block`, `grapple`, `disarm`, `feint`, `disengage`, `yield`, `spare`, `finish` | [combat.md](combat.md), body-health, elements |
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
- **Profundidad acotada.** Un plan del jugador se ejecuta hasta su próxima interrupción; los planes largos de verdad (meses) son rutinas (simulation §12) y metas del jugador ([player-loop.md](player-loop.md)).

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
- **Cosas sueltas con identidad** (`play-refs-objects-loose`): un ítem con aspecto (`ITEM_LOOK`: forma, material, tamaño) que no lleva nadie se percibe como estímulo propio y entra a lo conocido como `kind: "object"`, nombrado por lo que se ve («el cuchillo de hierro del suelo»). El `what` de `take`/`give` es texto en el catálogo: primero se resuelve contra las cosas presentes (una sola → la entidad; varias → la pregunta de aclaración) y, si ninguna encaja, sigue como texto y elige un bien del ledger por nombre. `look` toma un `target` opcional de clase `sight` (una cosa o una persona a la vista: «miro la canasta», «miro a mi madre»); el efecto lo guarda y la vista marca lo mirado. Lo fijo del espacio donde está (el pozo de la plaza, el granero) también se mira: lo sabe por vivir ahí, se nombra sin percibirlo como cosa suelta, y al mirarlo se nota su estado a grandes rasgos; no se agarra ni se da.

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
- **Reflejos.** Algunas reacciones no esperan decisión: esquivar un golpe, soltar algo que quema, cubrirse los ojos. Salen de los hábitos y del entrenamiento del actor ([combat.md](combat.md)) y corren como plan con `source: "reflex"`, también para el jugador.

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
2. **Capacidad efectiva del actor:** habilidad ([skills.md](skills.md)) × capacidades (body-health §3) × herramienta × condiciones × estado mental (dolor, miedo, concentración) × cultivo.
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
- Los fracasos producen **experiencia y creencias** (el actor aprende que esa cerradura es difícil, que ese guardia es atento) y alimentan la habilidad ([skills.md](skills.md)) y el descubrimiento (discovery: errores con forma).

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
  speech?: SpeechDraft;                    // si hay diálogo: qué dice el personaje, textual ([dialogue.md](dialogue.md))
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
| Una meta grande ("quiero volverme inmortal") | `kind: "goal"`: entra a las metas del personaje ([player-loop.md](player-loop.md)), no es una acción |
| Algo fuera del catálogo | Se mapea a lo más cercano con aviso, o se rechaza con la razón; se registra en `tools/` como verbo faltante para contenido |
| Una pregunta al juego ("¿cuánto tiempo pasó?") | `question_ooc`: se responde con lo que el personaje sabe |
| Comandos (guardar, inspector) | `meta`: fuera del mundo |

**Palabras de cada verbo** (`play-verb-words`, `play-verb-words-guard`): `content/llm/verb-words/<lengua>.json` dice, por verbo del catálogo, sus formas y sus sinónimos con la forma como la que se leen («me dirijo a» → «voy a»). La gramática sin red reescribe el comienzo de cada paso con la tabla, el parser con LLM la recibe como pista y la ayuda la muestra. **Agregar un verbo es agregar sus sinónimos:** el test de contenido (`verbWordProblems` en `llm/verb-words.ts`) falla si un verbo del catálogo no tiene entrada o trae menos de `MIN_VERB_SYNONYMS`, si una entrada no es un verbo, si una palabra es sinónimo de dos verbos o si un sinónimo es la forma o el id de otro verbo; el mensaje nombra el par. Si el solapamiento es querido, la entrada que gana lo declara en `shared` y la gramática lee esa.

## 10. Acciones de NPCs y órdenes

- **Utilidad sobre el catálogo** (npc-psychology §7): los candidatos salen de los objetivos activos, las plantillas conocidas y lo que la escena permite según sus creencias. Se puntúa con utilidad y se elige con softmax.
- **Planes.** En Fase 3, encadenamiento simple hacia un objetivo con plantillas; HTN o GOAP más adelante si hace falta. Las intrigas (schemes) producen planes multi-paso con el mismo `ActionPlan`.
- **Órdenes.** Una orden de una organización (organizations §4) llega como `ActionPlan` con `source: "order"` y la brecha de ejecución: el subordinado la reinterpreta con sus creencias, su lealtad y su utilidad (puede cumplirla a medias, mal o no cumplirla).
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

## Implementación

**Revisión de integración (2026-10-11):** el esquema restringido del parser ahora
expone `repeat` con `times` obligatorio y cuerpo recursivo, y `if` con condición
normalizada `is`, rama `then` y `else` opcional. #475 había actualizado la
conversión lógica pero omitido estas variantes en `structuralDraftFor`; pruebas
de equivalencia y dos casos con Qwen3:14b verifican el contrato completo.

Las referencias plurales con parentesco estructurado también forman un conjunto;
el singular mantiene la aclaración. Al convertir acercarse a personas en mirar
o viajar se conservan los modos y se validan los roles; un modo incompatible con
el verbo resultante se rechaza. Los familiares reconocidos en percepts actuales
actualizan figura y presencia conservando nombres/relaciones; una fuente oculta
sin reconocimiento no actualiza la ubicación del familiar recordado.

**Hecho (Fase 1, Hito 1a, 2026-10-07) — `src/sim/actions/`:** el catálogo, el plan, las referencias, la tirada común y los resolvers.
- `content/actions/core.json`: 11 verbos (`move`, `look`, `search`, `gather`, `work`, `rest`, `wait`, `speak`, `strike`, `trade`, `take`) con argumentos tipados (`person`, `place`, `thing`, `duration`, `text`), modos (×duración, +facilidad, +sigilo, ×emisiones), requisitos (`capability`, `position` cerca de un rol o en un tipo de lugar, `means` propios o del otro), cuerpo ocupado, duración (`fixed`, `arg` con tope, `path`), emisiones, facilidad, factores, contienda y formas de fallar por factor. `content/plans/steal.json`: robar como plantilla (`look` → `wait` encubierto → `take` encubierto). `catalog.ts` valida con Zod que los roles existan, que no haya modos repetidos y que **todo lo que puede hacer fallar un paso** (cada requisito y cada factor con peso) tenga su forma; las plantillas que nombran un verbo inexistente no cargan.
- Historial de pasos (`PlanState.steps`, `act.ts`): desde el motor `life-4`, los fallos idénticos seguidos (mismo verbo, autopercepción y porqué) de un `until` que reintenta se juntan en un solo `StepRecord` con `times` y `lastAt`; antes eran un registro por intento (decenas de miles en una caminata imposible). Los éxitos y lo distinto siguen uno por registro.
- `plan.ts`: `ActionPlan` como JSON plano con `do`, `seq` y `until` (tope de vueltas obligatorio, `MAX_UNTIL`); condiciones `dark`, `light`, `elapsed`, `succeeded` (el último resultado **creído**) y `any`. `validatePlan` contra el catálogo; las plantillas se expanden al armar el plan (el plan guardado no las nombra). El cursor (`advance`) es puro: dice la próxima hoja y guarda vueltas y comienzo de cada `until` vivo.
- Plantillas de NPC (Fase 3, `npc-d1`/`npc-d2`, `src/game/life/npc-verbs.ts`, opt-in `LifeOptions.npcTemplates`): la decisión de un NPC se ejecuta como plantilla de `content/plans/` (`fieldwork`, `fetchwater`, `gatherwood`, `marketround`, `visit`) según su verbo o `verbo@clase` del objetivo (`move@water`, `speak@person`). Los parámetros se resuelven contra lo que el actor tiene a mano: un lugar es el más cercano de su clase (`PARAM_PLACE_KIND`); una persona, a quien apunta la decisión; el lugar de una persona (`friend_at`, `seller_at`), donde el actor **cree** que está (creencia `at`), aunque se equivoque: la factibilidad real se ve al ejecutar (`speak` exige estar cerca). El paso del verbo decidido conserva los argumentos de la decisión (qué comerciar, el acto de habla). Sin resolver, el verbo suelto. Una plantilla sobre `move` es una salida de ida y vuelta: no abre viaje ni se reabre al volver.
- `refs.ts`: `resolveRef` contra `KnownEntity` (lo que el actor conoce: nombres, rasgos percibidos, relaciones, si está presente, de qué creencias sale). Parecido por palabras normalizadas sin el LLM (sin tildes, plural ni vocal final, sin palabras vacías); la relación estructurada filtra ("mi padre"); lo presente suma `PRESENT_BONUS`; los que quedan a menos de `AMBIGUITY_GAP` del mejor son ambiguos y la aclaración lista lo que distingue a cada uno. Hasta que llegue `sim/knowledge`, lo conocido lo arma el juego.
- `draft.ts`: `planFromDraft` del `IntentDraft` al plan. El tipo del argumento del verbo manda sobre el que adivinó el parser; duraciones en segundos con el día y el año del planeta; **las condiciones solo se usan normalizadas** (`is` en el borrador: el parser la reconoce o el plan no se arma; la sim no adivina texto); hablar sin destinatario va a la única persona presente o pregunta; `repeat`, `if` y `onEvent` se rechazan hasta la Fase 3. Devuelve plan, aclaración, desconocido o problemas.
- `attempt.ts`: la tirada común. Requisito que falta → fracaso sin tirar con la forma de ese requisito (`too_weak`, `not_here`, `no_means`) y el actor se entera. Si no, todo en desvíos: facilidad del verbo y de los modos + habilidad (rasgos innatos estandarizados más `SKILL_SPAN`×el nivel entrenado que pasa el turno, ver [skills.md](skills.md) §Implementación) − luz − terreno + nervio (`boldness`) − capacidad + normal con clave `fork("action", actor, verb, tick)`. Contienda abierta: el otro tira con su propia clave (con su habilidad) y resta. `expected` es el margen sin ruido menos la oposición esperada, para el borde del aprendizaje. Contienda de sigilo: perderla no hace fallar, hace que el otro lo note (`discovered` si salió). Margen → `critical` (|m| ≥ 2,5), `success` (≥ 0,5), `partial` (≥ −0,5), `failure`. La forma del fracaso (y del parcial) es la del factor que más restó entre los que el verbo sabe cómo fallan. Autopercepción: los verbos de evidencia 1 siempre se notan; si no, la chance es la evidencia + percepción − oscuridad; un fracaso no notado es mitad `failure_suspected` (cree `unsure`) y mitad `failure_unnoticed` (cree `success`); un parcial no notado se cree éxito. `cues`: los factores que restaron al menos medio desvío, para lo que el narrador puede contar.
- `resolve.ts` (los resolvers, §7-§8): `resolve(input)` corre la tirada y le pasa el resultado al resolver del verbo. Devuelve el resultado final, el **grado** continuo, la duración real, el efecto del verbo, las emisiones, y para el scheduler los cambios, el evento `action.<verb>` (con las causas del plan, que son obligatorias) y los asientos. También devuelve lo que el actor cree (`self`).
  - **Grado:** `degreeOf(m) = logistic(1,5·m)`. Vale 0,5 en un margen de 0 y 0 si no se pudo empezar. Matiza todos los verbos: cuánto rinde recolectar o trabajar, la claridad al hablar, la fuerza de un golpe, la ventaja en un trato, la parte que se lleva un robo a medias y cuánto más tarda moverse con una tirada floja.
  - **Lo que el mundo corrige:** buscar a quien no está da `failure`/`not_here` sin importar la tirada. Un lugar que ya no tiene qué sacar da `poor_yield`.
  - **Forma del fracaso con efecto propio:**
    - `move` perdido: anda un tramo del camino y se desvía a un vecino (un crítico malo, tres pasos). Termina en otro hex y no sabe en cuál.
    - `move` con `slip`: se cae a mitad de camino y sabe dónde quedó. Un `slip` parcial es solo un tropezón que llega más lento; el cuerpo lo lee distinto (cae de verdad solo bajo el margen parcial; ver body-health §4 "Caídas").
    - `take` con `wrong_target`: se lleva la mitad de otra cosa.
    - `take` sin `from` en casa (motor `life-43`): si lo que nombra no está suelto en el lugar, sale de la despensa del hogar (`homeLarder`).
    - `take` sin `from` en casa ajena (motor `life-44`): solo lo que nombra y no está suelto sale de la despensa de ese hogar (`hostLarder`); el consentimiento del dueño queda para property.
    - `drop` de un objeto con identidad (con `itemClaims`): solo lo que el actor lleva; queda en el lugar con su `LOCATION` y conserva sus derechos. `take` no busca entre lo que uno lleva.
    - Huir o caer en una pelea (`life-45`, play-refs-objects-source-flee): quien termina huido, caído o muerto suelta donde pasó lo que lleva y abulta (mediano o grande), con los derechos intactos; lo chico sigue encima.
    - `take` torpe: hace ruido.
    - Un crítico malo con alguien al lado: el otro lo nota.
    - Un golpe crítico malo lo deja desequilibrado.
    - `hesitate`: ni dice ni suelta el golpe.
    - `clumsy` en un trato: el trato se cierra igual, pero mal.
  - **Conservación:** recolectar saca del stock del lugar (`yields` por tipo de lugar en el contenido, gramos por hora con un resultado medio, con tope en lo que el ledger dice que hay). Tomar pasa del titular (el otro o el lugar) al actor. Ningún asiento sale de una fuente externa.
  - **Pendiente de otros sistemas:** `work` no produce bienes (rinde segundos efectivos para la cosecha o el oficio), `trade` deja el trato y la ventaja sin mover nada hasta economy (1b), y el golpe deja la fuerza para body.
  - **Lo creído:** usa la misma forma del efecto. Un fracaso no notado, o un parcial creído éxito, cree el efecto de un éxito medio. Si se notó, ve la verdad, salvo dónde quedó si se perdió y que el buscado "no está". Lo recolectado siempre se ve.
  - **Ledger:** `holdings(cuenta)` y `isMoney` (la unidad `coin` o `coin:*`) responden qué hay para tomar y quién tiene con qué.
- Los lugares (`PLACE_KINDS`, `space.place`, `space.location`, mapa local) pasaron a `sim/world/space.ts`, donde ARCHITECTURE pone el espacio.

**Hecho (Fase 2, 2026-10-08) — factibilidad creída:** `feasibility.ts` (`assessPlan` contra un `BeliefView`: cuerpo sentido, autoimagen, posición y tenencia creídas; avisos con `blocks` para NPC), referencias fantasma (`KnownEntity.phantom` → estado `phantom`, se usa como única y queda en `DraftResult.phantoms`), acto de habla declarado en `speak.content` (`DraftAct` → `SpeakAct`) y `clarifyQuestion`. El juego avisa antes del primer intento y si el jugador repite lo mismo, lo intenta. Ítems abiertos en el ROADMAP.

**Hecho (2026-10-09) — fantasmas en el juego:** `knownEntities` (`game/life/known.ts`) marca `phantom` a padres y hermanos muertos que el personaje cree vivos (`believesAlive`) y a quien cree acá sin que esté. Falta que `not_here` le corrija la creencia (ROADMAP).

## Tests

- **Consulta y bolsillo (2026-10-13):** `consult` integra el servicio económico
  opt-in junto a trade/give/eat/cook/take/gather. Una toma previa de la última
  moneda hace fallar la consulta por `no_means`, manteniendo ambas agendas y
  el dinero conservado. Resolver y catálogo no cambian; consulta aislada
  conserva verdad, eventos, postings, RNG y cola del camino anterior.

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
- **Confirmar solo lo ambiguo, lo grave e irreversible y lo no mapeado**; el resto se ejecuta directo (aprobado 2026-10-06).
- **Fracasos elegidos por el factor más débil**, no al azar.
- **Reflejos como planes automáticos** que corren también para el jugador, según su entrenamiento, sin pausar para preguntar; el jugador puede dejar **posturas** propias ("si me atacan, huyo", "si alguien entra, me escondo") como reglas `onEvent` permanentes que se suman a los reflejos (aprobado 2026-10-06).
- **Fuera del catálogo:** se traduce a la acción más cercana con aviso y se registra el verbo faltante para agregarlo como contenido; solo se rechaza si no hay nada cercano (aprobado 2026-10-06).
- **Lo que el personaje cree imposible:** aviso desde lo que sabe; si el jugador insiste, se intenta, con riesgo y posibilidad de aprendizaje o descubrimiento (aprobado 2026-10-06).

## Preguntas abiertas

- Calibración: número final de verbos y de modos; granularidad de checkpoints por verbo; umbral de saliencia para interrumpir; curvas de margen a `Outcome`; cuánto pesan los modos en duración y emisiones; frecuencia de confirmaciones aceptable para el jugador.

## Ampliación (2026-10-08): la intención se percibe

La intención declarada del `ActionPlan` (por qué, para quién) no es un adorno: los demás pueden leerla, malinterpretarla o suponerla a partir de la acción y el contexto (perception, dialogue). Una misma acción con otra intención se juzga distinto (law, social-structure). El parser conserva la intención como dato del plan; el narrador no la inventa. Fase 2.

Implementado (núcleo puro, `sim/actions/purpose.ts`): `Purpose` es verdad del actor y los demás nunca la leen directo; ven el verbo, el contexto y, si lo dijo y lo oyeron, la declaración. `readPurpose` devuelve una `ReadPurpose` con confianza y `mistaken`; el sesgo del lector (sospecha, aprecio) infla los motivos hostiles o los benignos; `purposeWeight` es lo que juzgan law y social-structure, sobre la lectura y no sobre la verdad.

## Ampliación (2026-10-24): `use`, las cosas con función

«Saco agua del pozo», «me caliento en el fogón», «uso el hacha», «me siento en el banco»: el jugador nombra una cosa y lo que quiere de ella, y la cosa decide qué se puede. `use` no es un comodín que resuelve cualquier cosa: es un verbo de despacho sobre un catálogo cerrado de **funciones** que viven en el contenido, igual que los verbos.

- **Forma del verbo:** `use(target: sight, how?: text)`. El `target` es una cosa a la vista o lo fijo del espacio (play-refs-objects-fixtures-look: el pozo, el granero, más adelante el banco, el telar, el fogón); `how` es lo que quiere hacer con ella en sus palabras («sacar agua», «calentarme»).
- **Funciones como contenido** (`content/affordances/`, Zod): cada una tiene `id`, a qué se aplica (formas de ítem como `jar` o `axe`, tipos de fijo como `well` o `hearth`), sus palabras («sacar», «llenar», «calentarse»), lo que pide (manos, un recipiente que lleve, estar en el espacio de la cosa), duración, emisiones, modos de fracaso con factor (§8) y el **efecto**, que es uno de los de siempre (no hay efectos nuevos por función salvo los que la física pide). Ejemplos:
  - `draw_water` (pozo): llena un recipiente que lleva (el cántaro de la casa, `household-tools`). Pide el recipiente y las dos manos. Falla con `no_means` sin recipiente, con `slip` si se vuelca, y con `broken` si la soga o el brocal están muy gastados (la condición del `WORK`). Sin recipiente, «tomo agua del pozo» es `drink` en el lugar, no `use`.
  - `warm` (fogón encendido, `HEARTH`): baja el frío del cuerpo (body-health) mientras dure. No funciona con el fogón apagado, y eso se cree o no según lo que se vio.
  - `sit`/`rest_on` (banco, cuando exista): es `rest` con postura. No tiene efecto nuevo.
  - `operate` (telar, rueca, molino de mano): abre una sesión de oficio (crafts §2) con la cosa como estación. `use` solo la despacha; la resuelve crafts.
  - Herramientas (`axe`, `hoe`, `sickle`, `knife`): «uso el hacha» sin más se reescribe a su verbo principal (`fell`, `farm`, `gather`) con la herramienta como **instrumento**. El instrumento es un argumento opcional `with: thing` en esos verbos y cambia duración, dificultad y desgaste. «Corto leña con el hacha» va directo a `fell` con `with`, sin pasar por `use`.
- **Despacho:** se resuelve en el borrador (draft), no en el resolver. Con una sola función posible para la cosa, esa. Con varias, decide `how` por sus palabras, y si no alcanza, se pregunta como una referencia ambigua (§4). Si ninguna encaja, aviso desde lo que el personaje sabe («No sabés qué hacer con el granero así.») y no se juega el turno. El plan guardado lleva la función elegida (`use` con un modo, igual que `speak` lleva su acto): el replay no vuelve a despachar.
- **Factibilidad en dos pasos (§5):** al decidir, con lo que cree (cree que el pozo tiene agua, que el fogón está prendido); al ejecutar, con la verdad (el pozo seco por la sequía falla con `no_means` y él se entera).
- **Conservación:** lo que una función saca de una cosa sale de algún lado. El pozo tiene `capacity` en litros por día (`WORK`). `draw_water` descuenta de lo sacado ese día, que es estado del pozo y se compara con la capacidad; el recipiente guarda litros como estado del ítem (`CONTENTS`). El agua todavía no está en el ledger (igual que en `drink`); cuando weather §4 la cuente, el pozo pasa a ser una cuenta y el cántaro otra, y los litros se mueven con `transfer`. El desgaste sale del uso: cada `draw_water` gasta un poco la soga y el brocal (la condición del `WORK`), y eso lo arregla el mantenedor (settlements, infraestructura).
- **Normas y dueños:** usar lo de otro (el telar de una casa ajena, el pozo privado de un señor) se puede intentar siempre. Las normas no bloquean (§5): traen consecuencias por property (consentimiento, uso indebido) y por la opinión de quien lo ve. El pozo de la aldea es comunal y su uso es libre, salvo que la costumbre ponga turnos (cultura).
- **NPC:** el mismo verbo. Hoy las rutinas resuelven el agua y el fuego en agregado; `use` explícito corre solo en escena (tier alto), como `take` de la despensa.
- **Narración:** el efecto lleva la función y la cosa; plantillas `outcome.use.<función>.<resultado>` («Bajás el balde y subís el cántaro lleno.»). El narrador LLM recibe la función como clave y nunca inventa una que no se jugó.

Orden de implementación (un ítem cada uno, todos de la fase 3):

1. `use-core`: el verbo `use` en `content/actions/`, el contenido `affordances` con su esquema, el despacho en draft (una función, `how`, pregunta, aviso), el modo guardado en el plan y la plantilla genérica. Sin funciones con efecto propio salvo `sit` → `rest`. Sin bump si no cambia la verdad.
2. `use-well`: `draw_water` con `CONTENTS` en el recipiente, lo sacado por día en el pozo y el desgaste. Cambia la verdad, así que sube el motor.
   - **Hecho (use-core):** `AffordanceDef` (`id`, `name`, `on`, `words`, `as?`) en `content/affordances/`, y `ActionCatalog.affordances(shape)`. `KnownEntity.shape` sale del percept `thing` o del tipo de fijo. El despacho está en `affordanceStep` (draft.ts): una función con `as` reescribe el paso a ese verbo (`well.drink` → `drink`), y sin `as` queda `use` con `how` = id de la función. Si el target no tiene funciones, el `how` se descarta y `unusableTarget` hace que la sesión avise sin jugar el turno. **Simplificación:** cuando hay varias funciones y `how` no decide, se toma la primera en vez de preguntar. La pregunta llega cuando una cosa tenga más de una función (`use-hearth-station`). `sit` → `rest` no está: todavía no existe un banco que lo pida. En la gramática sin red entran «uso/utilizo/me sirvo de X» y «saco agua del pozo», y `look` toma el target («miro el pozo», «miro a Wu»).
3. `use-tools`: el argumento `with` en `fell`, `farm` y `gather`, y «uso el hacha» reescrito a su verbo. Depende de que existan las herramientas en la vida (`householdTools`, `play-refs-objects-source-enable`).
   - **Hecho (use-tools-arg):** `fell` y `farm` no existen, así que va en los verbos reales: `gather` (la leña con hacha, los hongos con cuchillo, las espigas con hoz) y `work` (azada u hoz en el campo). Cada verbo tiene una tabla `instruments` en el contenido: formas, salida opcional (el hacha solo vale para la leña), `rate` (multiplica el rinde o los segundos efectivos) y `ease` (suma a la facilidad de la tirada). `toolFor` (resolve.ts) elige el instrumento y el efecto guarda `tool`. En la vida, `instrumentOf` (act.ts) solo pasa una herramienta que esté entera y en la mano. **Simplificación:** si nombra una herramienta que no lleva («con el hacha» y no la tiene), el `with` se descarta y se trabaja a mano, sin preguntar ni avisar. Tampoco hay desgaste (`use-tools-wear`) ni reescritura de «uso el hacha» (`use-tools-rewrite`).
   - **Hecho (use-tools-wear):** cada instrumento tiene `hours`, las horas de uso que aguanta. `ITEM_WEAR` guarda el desgaste del ítem entre 0 y 1; cada paso que usa la herramienta suma segundos / (`hours`·3600). Lo que da de más (`rate - 1`, `ease`) se escala por `1 - wear`; gastada del todo no da nada y el narrador lo avisa (`outcome.tool.worn`). Motor `life-48` (`legacyNoToolWear`). **Simplificación:** no hay roturas de golpe (solo desgaste parejo) ni manera de afilar o reparar (`use-tools-mend`), y las `hours` no están calibradas.
   - **Hecho (use-tools-rewrite):** las herramientas tienen funciones en `content/affordances/` como cualquier cosa. Además de `as` (el verbo), una función puede decir `asRole`, el rol en que entra la herramienta (`with`), y `asWhat`, lo que se busca («leña»). Así «uso el hacha» queda como `gather` con `what` leña y `with` el hacha, y «uso la azada» queda como `work` con la azada. La hoz tiene dos funciones: sin cómo, siega (`primary`), y «para juntar espigas» la lleva a juntar. La gramática pone el «para …» de «uso X para …» como `how`. **Simplificación:** sin cómo, la elección no mira el lugar («uso el hacha» en el campo junta leña, y como no hay leña, sale con las manos vacías).
   - **Hecho (use-well):** `well.draw_water` en `content/affordances/core.json` con `vessels` (forma → litros: cántaro 12, olla 6, cuenco 0,5); `well.drink` lleva `primary` (la que vale en «uso el pozo» sin cómo, porque el contenido llega ordenado por id). `ItemContents`/`CONTENTS` (property) guarda los litros del recipiente y `WellDrawn`/`WELL_DRAWN` (settlements) lo sacado por día. `game/life/act.ts` `drawWaterOf` arma `ResolveInput.drawWater` (lo que le queda hoy al pozo, nada si no está en su hex; su condición; el primer recipiente que se lleva con lugar) y el resolver `use` llena `min(lugar, lo que queda)`. Sin recipiente, pozo seco o roto (`WELL_WORN`) falla con `no_means`; un fracaso de la tirada no saca nada. Cada vez que se saca agua el pozo se gasta `WELL_WEAR`. Plantillas `outcome.use.well.draw_water.done|none|no_vessel`. Motor `life-47` (`legacyNoDrawWater`). **Simplificación:** el agua no está en el ledger todavía (weather §4), ni se puede volcar o tomar del cántaro.
4. `use-hearth` y `use-station`: `warm` con `HEARTH` y `operate` con las estaciones de crafts, cuando esos sistemas las tengan como cosas.
