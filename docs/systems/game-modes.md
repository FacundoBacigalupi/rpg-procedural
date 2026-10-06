# Modos de juego: realista y novela

> Principio: **el modo novela cambia lo que el personaje trae, no cómo funciona el mundo.** Elegir la familia, el talento o un dedo de oro (金手指) es poner hechos en el mundo con su origen; desde ahí, la misma simulación los resuelve. El LLM sigue sin decidir nada, la verdad sigue separada de las creencias, y el mundo sigue sin saber que sos el protagonista.

> Estado: **borrador** (2026-10-06). Pedido del usuario el 2026-10-06: empezar todo realista y, más adelante, poder jugar "como una novela", eligiendo cosas del personaje y sumando dedos de oro muy configurables antes de empezar.

Depende de: [VISION.md](../VISION.md) (principio 11), [player-loop.md](player-loop.md) §1, §16 (`NewGameSetup`, nacimiento), [simulation.md](simulation.md) §5-§6 (tiers, materialización con hechos fijados y biografía sintetizada), [cultivation.md](cultivation.md) §3 (talento), [skills.md](skills.md) §4 (velocidad y techo), [heaven-karma.md](heaven-karma.md) §3-§6 (atención, velos, inclinación de tiradas), [spirits.md](spirits.md) §1, §3d-§3e (remanentes, memorias de vidas pasadas), [secret-realms.md](secret-realms.md) (bolsillos de espacio), [contracts.md](contracts.md) §8 (ataduras al alma), [perception.md](perception.md) (canales), [crafts.md](crafts.md) (sesiones de oficio), [chronicle.md](chronicle.md) §9 (archivo de vidas), [tooling.md](tooling.md) §3, §13 (replay, respaldo).
Lo usan: player-loop (arranque), narration (estilo y paneles revelados), chronicle (marcas del archivo), worldgen (nacimiento condicionado).

---

## Principios

1. **Realista por defecto.** Todo lo diseñado hasta ahora es el modo realista. El modo novela se elige **antes de empezar** y queda fijo para esa vida.
2. **Las reglas que no se rompen valen en los dos modos:** determinismo, causalidad (todo con origen), conservación, verdad vs creencia, el LLM sin decidir.
3. **Lo elegido entra por los mecanismos del mundo.** Un talento elegido es un genoma condicionado al concebirte; una familia elegida es un hogar real de la población; un dedo de oro es una entidad con un evento de origen. Nada se pega "por fuera".
4. **Un dedo de oro es física local, no un privilegio narrativo.** Sus efectos son modificadores acotados que aplica la sim sobre procesos concretos (una sesión de alquimia, tus tiradas, tu percepción), con reglas que se pueden leer.
5. **Configurable hasta lo absurdo, pero sin romper el motor.** El usuario puede pedir alquimia que nunca falla; no puede pedir píldoras sin ingredientes. El único techo duro es el de las reglas.
6. **El mundo reacciona a lo que percibe.** Un anillo con un viejo adentro se puede robar; la suerte desmedida se nota y genera rumores y envidia; lo que tuerce la ley puede atraer al Cielo. Cuánto de esto pasa depende del origen del dedo de oro, no de un modo "fácil".
7. **Honestidad en el archivo.** La vida queda marcada como novela, con lo elegido y los dedos de oro listados.

---

## 1. La configuración

```ts
type GameMode = "realistic" | "novel";

interface NewGameSetup {                     // player-loop §1, ampliado
  seed: Seed;
  worldConstraints?: WorldConstraints;       // en los dos modos: solo sobre el mundo
  mode: GameMode;
  novel?: NovelSetup;                        // solo si mode === "novel"
  entry: EntryMode;
  narration: NarrationPrefs;
  llm: LlmConfig;
}

interface NovelSetup {
  character: CharacterSpec;                  // §2
  goldenFingers: GoldenFingerSpec[];         // §3-§5, puede ser vacío
  rivals?: RivalSpec;                        // §8: otros "protagonistas" en el mundo
  life: LifeRules;                           // §9: una vida o con guardados
  narration: NovelNarration;                 // §10
  preset?: PresetId;                         // §11: de dónde salió la configuración
}
```

- **Validación con Zod** y un validador de coherencia contra el mundo (§2.4).
- **Se guarda como archivo** (`content/setups/` o donde el usuario quiera) para reusar configuraciones.
- **Forma parte del replay** (tooling §3): mismo seed + mismo setup + mismos planes = mismo mundo. El mundo de una vida en modo novela **no es** el mismo que el del modo realista con la misma seed: los hechos fijados de la configuración cambian lo que pasa desde el momento en que se fijan.

## 2. Elegir el personaje

### 2.1 Qué se puede elegir

```ts
interface CharacterSpec {
  species?: SpeciesId;
  sex?: Sex;
  name?: string;                             // si no, lo eligen los padres según su cultura
  birth?: {
    region?: RegionId | RegionQuery;         // "una ciudad costera", "cerca de una secta grande"
    settlement?: SettlementQuery;            // tipo y tamaño
    era?: EraQuery;                          // "en una era de oro", "durante una guerra"
  };
  family?: {
    position?: PositionQuery;                // campesinos, mercaderes, clan de cultivadores, nobleza, huérfano
    parents?: ParentSpec[];                  // vivos o muertos, cultivadores o no, temperamento, oficio
    siblings?: { count?: Range; order?: "first" | "middle" | "last" | "only" };
    lineage?: LineageQuery;                  // un linaje de sangre (family-lineage §9), una casa caída
    secrets?: FamilySecretSpec[];            // "soy hijo ilegítimo", "mi madre fue de una secta demoníaca"
  };
  talent?: Partial<AptitudeSpec>;            // raíces, pureza, meridianos, comprensión, alma, constitución, latentes
  body?: BodySpec;                           // salud, apariencia, rasgos heredables
  temperament?: Partial<TemperamentSpec>;    // npc-psychology: ejes, esquemas tempranos
  tastes?: TasteSpec[];
  entryAge?: number;                         // cuándo arranca el juego; antes, la vida corre sola
  upbringing?: UpbringingSpec[];             // lo que pasó en la infancia: "mi padre me enseñó la espada", "crecí en la calle"
  knowledge?: KnowledgeSpec[];               // técnicas o saberes que trae (con quién los aprendió)
  belongings?: ItemSpec[];                   // objetos que trae (con de dónde vienen)
  pastLife?: PastLifeSpec;                   // §5.8: memorias de una vida anterior
}
```

Todo es opcional: lo que no se elige sale del mundo como en el modo realista. Cada campo acepta un valor exacto o una consulta ("raíz de fuego de pureza alta", "familia pobre pero letrada").

### 2.2 Cómo se resuelve: buscar antes de fijar

1. **Buscar un nacimiento real.** La sim corre la historia hasta la ventana de nacimientos pedida y puntúa los nacimientos de la población contra la especificación. Si uno cumple las restricciones duras, el personaje es ese bebé. Es el mismo mecanismo que el modo realista (player-loop §1), con pesos en vez de azar puro.
2. **Condicionar la concepción.** Si nadie cumple, se elige el hogar que mejor cumple y se **condiciona** lo que falta en el momento en que el mundo lo decide: el genoma se tira condicionado al talento pedido (con su propio evento de concepción), el hogar se mueve al lugar pedido por una causa plausible (una migración que ya era posible), el padre es cultivador porque la sim elige ese candidato entre los que ya había.
3. **Fijar con origen.** Lo que ni así cabe se fija como hecho en la generación con un evento de origen explícito, marcado `cause: "novel_setup"`, y la sim sigue desde ahí. Por ejemplo, un linaje de sangre de fénix en un mundo donde ese linaje no existía se crea con su antepasado y su historia agregada.

Cada paso deja registro: la crónica distingue lo que salió del mundo, lo condicionado y lo fijado.

### 2.3 La infancia elegida

- **`upbringing`** no es un número de habilidad, sino lo que pasó. Se fija como intenciones de los adultos de tu hogar ("el padre quiere enseñarle la espada") y la infancia se simula con esa presión. Las habilidades salen con la historia tácita de cómo se aprendieron (skills §3), con los vicios del maestro incluidos.
- **Saltar la infancia:** si `entryAge` es alta y no se quiere esperar la simulación individual, se usa la **biografía sintetizada** de la materialización (simulation §6), condicionada a la especificación.
- **Conocimiento y objetos** traídos tienen origen: la técnica la enseñó alguien (que existe o existió), el objeto se heredó, se compró o se encontró.

### 2.4 Coherencia con el mundo

| Pedido | Respuesta |
|---|---|
| Imposible por la ley del mundo (raíz de qi en un mundo sin qi, una especie que no existe) | Rechazado, con la razón y sugerencias que el mundo sí permite |
| Muy improbable (raíz celestial en una aldea sin linaje) | Aceptado; se condiciona o se fija con origen, y la crónica lo cuenta |
| Contradictorio (huérfano con padres vivos que te crían) | Rechazado con la contradicción |
| Mundo sin elegir todavía | Los pedidos se guardan como consultas y se resuelven al generar |

## 3. Dedos de oro

```ts
interface GoldenFinger {
  id: GoldenFingerId;
  name: string;                              // como lo llama el personaje (o como se presenta)
  origin: GoldenFingerOrigin;                // §4: qué es en el mundo
  carrier: Carrier;                          // dónde vive
  effects: GoldenEffect[];                   // §5
  growth?: GrowthRule[];                     // §6: cómo se desbloquea o se fortalece
  costs?: GoldenCost[];                      // §6: lo que cobra (opcional, configurable)
  signature: Signature;                      // §7: qué puede percibir el mundo
  account?: LedgerAccountId;                 // reserva propia si da o crea algo (§5.4)
  originEventId: EventId;
}

type Carrier =
  | { kind: "soul"; soul: SoulId }           // atado al alma: no se roba, sigue al alma si renace
  | { kind: "body"; agent: AgentId; part?: BodyPartId }  // una marca, un ojo, la sangre
  | { kind: "item"; item: ItemId }           // un anillo, un colgante: se puede perder o robar
  | { kind: "place"; place: CellId | RealmId }; // un bolsillo de espacio con entrada
```

- **Es una entidad del mundo.** Existe en `WorldTruth`, tiene componentes, se guarda, se inspecciona y deja huella en la crónica.
- **Sus efectos los aplica la sim:** cada efecto es un modificador declarado que los procesos afectados leen, igual que leen un cuerpo herido o una formación. No hay procesos especiales "del protagonista"; hay procesos que consultan si el agente tiene efectos activos.
- **Si el portador cambia, el efecto sigue al portador.** Un anillo robado da sus efectos al ladrón, si sabe usarlo; un dedo de oro atado al alma sigue al alma, incluso como espíritu.

## 4. Orígenes

Cada dedo de oro tiene un origen que lo explica en el mundo. Lo elige el usuario, o lo elige el mundo entre los que su metafísica permite. El origen decide la firma, quién lo puede codiciar, cómo lo ve el Cielo y qué consecuencias trae.

| Origen | Qué es | Consecuencias típicas |
|---|---|---|
| **Remanente en un objeto** (spirits §1) | Un cultivador antiguo refugiado en un anillo o un jade, con memorias reales | Es un agente con psicología propia: puede enseñar, mentir, tener enemigos vivos, querer un cuerpo. Su lealtad se configura, pero sus objetivos son suyos |
| **Artefacto de un reino caído** | Un tesoro de una civilización o un inmortal muerto, con espíritu de objeto o sin él | Otros lo buscan (herederos, la secta que lo perdió); su historia está en la historia profunda |
| **Fragmento del Cielo** | Un pedazo del libro o de la ley del Cielo, caído en una herida (heaven-karma §4) | Lee la verdad porque es parte de ella; el Cielo no lo ve como ajeno, o quiere recuperarlo, según la configuración |
| **Semilla del Dao / ley** | Una comprensión cristalizada que se alojó en el alma | Mejora comprensión y rupturas; la atrae lo que resuena con su aspecto |
| **Alma reencarnada fuerte** (spirits §3d) | Tu alma vivió antes y trae memorias o poder | Memorias de un mundo y una época concretos, que pueden estar desactualizadas; viejos enemigos o deudas kármicas |
| **Despertar de sangre** (family-lineage §9) | Un linaje dormido en tu genoma | Hermanos y primos pueden tenerlo también; otros linajes lo reconocen |
| **Pacto** (contracts §8) | Un acuerdo con una entidad (espíritu de lugar, dios local, demonio, según el mundo) | Es un `Commitment` con su parte: la entidad cobra, y el incumplimiento tiene ejecutor |
| **Sistema** | Un espíritu de artefacto de una civilización perdida que se fusionó con tu alma y te habla en su idioma (paneles, misiones, tienda) | Tiene la reserva y los límites de lo que esa civilización guardó; sus misiones salen del mundo (§5.6) |

- **Mundos no xianxia:** el mismo catálogo se traduce con la metafísica del mundo (un familiar, una bendición de un dios con culto real, un grimorio con una mente adentro).
- **"Sin explicación" no existe.** Si el usuario no quiere elegir origen, el mundo elige uno coherente y lo oculta: el personaje no sabe qué tiene, y la crónica lo revela al final.

## 5. Efectos

```ts
type GoldenEffect =
  | RevealEffect | CraftEffect | LearningEffect | TalentEffect | FortuneEffect
  | MentorEffect | SpaceEffect | ProvisionEffect | MissionEffect | BodyEffect
  | VeilEffect | SenseEffect | PastLifeEffect;
```

Cada efecto tiene una **intensidad** configurable, de sutil a absurda, dentro de lo que el motor permite.

### 5.1 Revelar (el panel de stats)

```ts
interface RevealEffect {
  kind: "reveal";
  scope: RevealScope[];                      // "self.aptitude", "self.skills", "self.body", "others.realm", "items.quality", "herbs.identity", "karma.self"…
  precision: number;                         // 1 = exacto; menos = con ruido
  range: "self" | "touch" | "sight" | "sense";
  latency?: Duration;
}
```

- **Es un canal de percepción** (perception), no una ventana a la verdad: produce percepts exactos (o con el ruido configurado) sobre lo que su alcance cubre, y esos percepts se vuelven creencias como cualquier otro. Un nivel de habilidad que se revela es una creencia verdadera **en ese momento**, que se desactualiza si no se mira de nuevo.
- **Al narrador llega como percepts:** `buildPlayerView` incluye lo revelado, y nada fuera del alcance. Los paneles del sistema muestran solo eso (player-loop §16).
- **Configurable:** de "veo mi raíz y mi reino" a "veo las estadísticas de todo lo que miro". El techo es el alcance que se configure; ni siquiera "todo" incluye pensamientos o planes ajenos, salvo con `SenseEffect`.

### 5.2 Oficios (la alquimia que nunca falla)

```ts
interface CraftEffect {
  kind: "craft";
  crafts: CraftId[];                         // alquimia, forja, formaciones, talismanes, cocina…
  controlNoise?: number;                     // multiplica el ruido de control: 0 = mano perfecta
  failureFloor?: "none" | "no_catastrophe" | "always_succeeds";
  qualityBias?: number;                      // inclina la calidad dentro de lo que los materiales permiten
  insightOnCraft?: number;                   // aprende la receta real de lo que hace (crafts: recetas con defectos)
}
```

- **"Siempre sale" significa que la sesión no falla ni explota:** la píldora sale con la calidad que permiten los materiales, el fuego y la receta. Con malos materiales sale una píldora mala, no una celestial.
- **Conservación intacta:** consume los mismos ingredientes y el mismo qi. No hay píldoras de la nada.
- Se implementa sobre la sesión por pasos (crafts): el efecto cambia el ruido y los pisos de resultado que la ley calcula.

### 5.3 Aprendizaje, talento y comprensión

```ts
interface LearningEffect {
  kind: "learning";
  domains: SkillDomain[] | "all";
  rate: number;                              // multiplica la velocidad de la curva (skills §4.1)
  ceiling?: number;                          // multiplica o suma al techo (skills §4.2)
  noVices?: boolean;                         // no se fijan vicios (skills §5)
  noRust?: boolean;                          // no se oxida (skills §7)
  copyOnSight?: number;                      // aprende de mirar con la fidelidad indicada
}

interface TalentEffect {
  kind: "talent";
  aptitude: Partial<AptitudeSpec>;           // aplicado en el evento de origen; desde ahí es talento real
  comprehension?: number;
  breakthroughEase?: number;                 // baja la dificultad de las rupturas, no los umbrales de la ley
}
```

- **El talento se aplica una vez,** en el evento de origen: desde ahí es parte del cuerpo y del alma, y un instrumento de medición lo lee (con sus errores de siempre).
- **Las rupturas siguen siendo rupturas:** el umbral de la ley no se mueve (cultivation §1); cambia lo fácil que es llegar y sobrevivir. La tribulación sigue llegando.

### 5.4 Fortuna (suerte de protagonista)

```ts
interface FortuneEffect {
  kind: "fortune";
  scope: ("own_rolls" | "encounters" | "opponent_rolls" | "survival")[];
  magnitude: number;                         // acotada como la inclinación del Cielo (heaven-karma §6)
  rechargePerYear?: number;                  // si la configuración usa una "reserva de suerte"
}
```

- **Es la inclinación del Cielo al revés:** cambia los pesos entre lo que el estado ya permite, nunca agrega hechos. Un 0 sigue siendo 0: si no hay ninguna hierba en el valle, la suerte no la pone.
- **`encounters`** inclina los procesos que ya deciden qué encontrás (dónde está la hierba, quién pasa por el camino, qué cueva se derrumba): el maestro errante tiene que existir y estar en la región.
- **`survival`** inclina las tiradas que te matarían (el golpe que no toca el corazón, el rescate que ya venía en camino). Con la intensidad más alta y reserva, es la armadura del protagonista: cada uso gasta reserva y la reserva es finita.
- **Se nota:** la gente que te ve salir ileso una y otra vez forma creencias ("tiene la fortuna del Cielo") que se convierten en rumores, envidia, codicia o devoción (§7).

### 5.5 Mentor, espacio y provisiones

```ts
interface MentorEffect {
  kind: "mentor";
  spirit: AgentId;                           // un Spirit real (spirits §2), con memoria, objetivos y conocimiento
  loyalty: "devoted" | "self_interested" | "hidden_agenda";
  knowledge: KnowledgeSpec[];                // lo que sabe de verdad (técnicas, mapas viejos, secretos de su época)
}

interface SpaceEffect {
  kind: "space";
  realm: RealmId;                            // un bolsillo de espacio real (secret-realms)
  volume: number;
  timeRatio?: number;                        // tiempo adentro / tiempo afuera; con conservación de energía del reino
  qiReserve?: number;                        // el qi adentro es finito y se repone con lo que el reino tome de afuera
}

interface ProvisionEffect {
  kind: "provision";
  produces: ResourceSpec[];                  // agua espiritual, una hierba que vuelve a crecer…
  rate: number;
  source: "reserve" | "ambient" | "host";    // de dónde sale: reserva finita, qi del lugar o el propio portador
}
```

- **El mentor es un agente, no un menú.** Habla con el diálogo de siempre (dialogue), puede equivocarse con lo que sabe (es de otra época) y su `loyalty` decide su utilidad: el devoto te cuida, el interesado negocia y el de agenda oculta puede querer tu cuerpo.
- **El espacio con tiempo acelerado** es un reino secreto chico: su tiempo propio corre más rápido, pero la energía se conserva. Cultivar ahí agota su qi más rápido, y adentro no hay nadie más (lo que pasa afuera sigue pasando).
- **Las provisiones tienen fuente** en el ledger: una reserva con origen (lo que guardó la civilización caída), el qi del lugar (que se agota y puede crear una `QiDebt`) o el portador (que paga con su propio qi).

### 5.6 Misiones y tienda (el "sistema")

```ts
interface MissionEffect {
  kind: "missions";
  source: "pressures" | "opportunities";     // de qué arma las misiones
  rewards: { account: LedgerAccountId; kinds: RewardKind[] };  // puntos, objetos, técnicas: de la reserva
  shop?: { stock: LedgerAccountId; refresh?: "never" | "from_world" };
}
```

- **Las misiones salen del mundo.** El sistema mira las presiones y oportunidades que tiene cerca (causality §9: una aldea con hambruna, un bandido con recompensa, una vena sin dueño) y las ofrece como misiones. No hay tabla de misiones al azar.
- **Las recompensas salen de una reserva finita** con origen (lo que esa civilización guardó, armado en worldgen). Cuando se vacía, el sistema lo dice; con `refresh: "from_world"`, la reserva se repone con lo que el portador le "entrega" al sistema (ofrendas, botín absorbido), con conservación.
- **El texto del sistema** ("[Misión: ...]", "[Recompensa: ...]") lo verbaliza el narrador desde datos estructurados, con el estilo configurado (§10).

### 5.7 Cuerpo, velo y sentidos

- **`BodyEffect`:** regeneración más rápida, inmunidad a venenos o enfermedades, longevidad, constitución especial. Son modificadores de los procesos de body-health; curar sigue consumiendo nutrición y qi.
- **`VeilEffect`:** te oculta de la atención del Cielo (o de la adivinación, o de los sentidos ajenos) como una zona ciega personal (heaven-karma §4). La deuda kármica se sigue anotando: lo que no se atiende se cobra después (Principio de la memoria del Cielo).
- **`SenseEffect`:** canales de percepción extra, como sentir la intención hostil dirigida a vos, ver qi o leer mentiras. Son canales con alcance y precisión, que producen percepts. Leer intenciones es leer la verdad de un plan ajeno, así que se configura con cuidado y queda listado en el archivo.

### 5.8 Memorias de una vida anterior

```ts
interface PastLifeSpec {
  source: { kind: "archive"; lifeId: LifeId }    // una vida jugada antes en el mismo mundo (o seed)
        | { kind: "synthetic"; spec: PastLifeQuery }; // una vida que el mundo genera (un cultivador muerto hace 300 años)
  fidelity: number;                          // cuánto se recuerda y con qué errores (spirits §3d)
  carriesKarma?: boolean;
}
```

- **Regresión ("volví al pasado"):** se arranca una vida nueva con la **misma seed** que una vida archivada, con memorias de esa vida como creencias. Al principio son ciertas; en cuanto el personaje actúa distinto, el mundo diverge y las memorias se vuelven pronósticos que pueden fallar. Es determinista: el mismo setup produce el mismo mundo.
- **Reencarnación:** el alma de alguien de la historia del mundo renace en tu cuerpo, con memorias de su época (que pueden estar desactualizadas: la secta que conocías cayó).
- **Lo que sabe el usuario y lo que sabe el personaje** se separa como en spirits §3e: el usuario puede saber más; el personaje recuerda lo que su `fidelity` permite.

## 6. Crecimiento y costos

```ts
type GrowthRule =
  | { kind: "by_realm"; unlocks: GoldenEffect[]; atThreshold: ThresholdId }
  | { kind: "by_use"; effect: number; curve: CurveId }
  | { kind: "by_feeding"; resource: ResourceId; perUnit: number }   // el anillo come piedras espirituales
  | { kind: "by_mission"; account: LedgerAccountId };

type GoldenCost =
  | { kind: "qi_upkeep"; perDay: number }
  | { kind: "lifespan"; perUse: Duration }
  | { kind: "karma"; perUse: number }
  | { kind: "attention"; salience: number }  // atrae al Cielo o a otros
  | { kind: "dependency" };                   // el espíritu del sistema se vuelve parte de tu alma: sin él, una herida
```

- **Ambos opcionales.** Un dedo de oro sin costos y sin crecimiento es válido: es la versión "novela ligera". Los costos dan la versión "novela con precio".
- **El crecimiento tiene causa:** se desbloquea por umbrales reales del cultivo, por uso o por alimentarlo con recursos que salen del ledger.

## 7. Qué percibe el mundo

```ts
interface Signature {
  aura?: { channel: PerceptionChannel; strength: number };  // lo que un sentido de alma fuerte puede notar
  visible?: string[];                        // marcas, el anillo, un ojo distinto
  statistical?: boolean;                     // se nota por los resultados (suerte, alquimia perfecta)
  concealment: number;                       // cuánto lo esconde
  heaven: "native" | "foreign" | "stolen" | "invisible";    // cómo lo trata el Cielo (sale del origen)
}
```

- **Los demás forman creencias por los canales de siempre:** ven el anillo, sienten un aura, notan que tus píldoras son siempre perfectas. De ahí salen sospechas, rumores, codicia, ofertas, robos e intentos de examinarte.
- **El Cielo:** lo `native` (un fragmento del propio Cielo) no le llama la atención; lo `foreign` suma saliencia cuando tuerce la ley (fortuna, oficios perfectos, rupturas fáciles); lo `stolen` la suma siempre, y el Cielo quiere recuperarlo; lo `invisible` no se ve, pero el karma de lo que hacés se anota igual.
- **Los efectos no generan karma por existir;** las acciones del portador sí, como siempre.

## 8. Rivales con dedo de oro

```ts
interface RivalSpec {
  count: number;                             // otros agentes con dedo de oro (0 por defecto)
  placement: "anywhere" | "near" | "same_generation";
  power: "weaker" | "similar" | "stronger";
  knownToPlayer: false;                      // nunca: los descubrís como cualquier secreto
}
```

- Son agentes del mundo con sus propios dedos de oro, generados con las mismas reglas y origen. No están ahí "para vos": viven su vida, y quizás se cruzan con la tuya.
- Dan la sensación de novela con varios "elegidos del Cielo" sin que el mundo gire alrededor del jugador.

## 9. Reglas de la vida

```ts
interface LifeRules {
  saves: "one_life" | "checkpoints" | "free";
  deathOutcome?: "final" | "spirit_if_possible";   // lo de siempre; la "segunda oportunidad" es un dedo de oro con origen
}
```

- **`one_life`:** como el modo realista (player-loop §12).
- **`checkpoints`:** guardados manuales con un límite (pocos por año de juego, o en lugares concretos). Cargar uno es volver a ese snapshot: la sim es determinista, así que es una rama nueva desde ahí. El archivo guarda cuántas veces se cargó y desde dónde, y la crónica cuenta la rama final.
- **`free`:** guardar y cargar sin límite, con la misma marca.
- **Ninguna opción cambia el mundo:** cargar no altera a nadie, solo elige una rama.

## 10. Narración

```ts
interface NovelNarration {
  tone: "realistic" | "novel";               // novela: más dramática, títulos de capítulo, ritmo de folletín
  systemMessages?: "bracketed" | "voice" | "none"; // cómo se ve el "sistema": "[Misión cumplida]" o una voz
  chapterTitles?: boolean;
  revealPanels?: boolean;                    // mostrar los paneles del dedo de oro
}
```

- **Mismo validador, misma lista blanca** (narration §9). El tono no da permiso para inventar: un "[Ding! Alquimia perfecta]" solo aparece si la sesión realmente salió perfecta.
- **Los paneles del dedo de oro** muestran solo lo revelado (§5.1), con su antigüedad ("hace 3 días: Espada 41").
- **El mentor habla** con el pipeline de diálogo (dialogue §16): sus frases salen de lo que sabe y quiere.

## 11. Presets

`content/game-modes/presets/` trae configuraciones listas, editables antes de empezar:

| Preset | Qué trae |
|---|---|
| **Realista** | Nada (es el modo realista) |
| **Joven maestro caído** | Familia noble arruinada, talento sellado, abuelo en el anillo con agenda propia |
| **Sistema** | Espíritu de artefacto con panel de stats, misiones de presiones cercanas y tienda con reserva finita |
| **Alquimista divino** | Alquimia que nunca falla, sentido para reconocer hierbas, reserva de fuego espiritual |
| **Genio celestial** | Raíz celestial, comprensión alta, rupturas fáciles; el Cielo lo nota |
| **Regresor** | Memorias de una vida archivada en la misma seed |
| **Basura que despierta** | Raíz basura medida al nacer; un linaje dormido que despierta con una condición |
| **Personalizado** | El armador paso a paso |

- **Armador paso a paso** en la CLI (Fase 7) y en la web (Fase 9): elige origen, efectos, intensidades, costos y firma, y muestra qué implica cada opción ("esto atrae al Cielo", "esto se puede robar").
- **Archivo de configuración:** se puede escribir el `NovelSetup` a mano como JSON y validarlo.

## 12. Archivo de vidas

Cada vida guarda en `meta` y en el archivo (chronicle §9):
- **Modo** (realista o novela) y la configuración completa.
- **Qué se condicionó o se fijó** al crear el personaje (§2.2).
- **Dedos de oro** con su origen real (aunque el personaje nunca lo haya sabido).
- **Marcas:** inspector (en los dos modos, solo si se abrió; aprobado 2026-10-06), restaurada, cargas de guardados.
- **"Lo que nunca supiste"** (chronicle §5) incluye la verdad del dedo de oro: lo que el viejo del anillo planeaba, quién más lo buscaba, cuánta suerte te dio.

## 13. El jugador y el narrador

- El jugador vive lo mismo que en el modo realista, más lo que el dedo de oro hace explícitamente.
- Lo que el dedo de oro revela entra por percepción. El personaje puede malinterpretarlo: ve un número y no sabe qué significa hasta aprenderlo.
- El narrador no sabe que el personaje es "el protagonista"; narra percepts como siempre.

## 14. Escala (LOD)

- Los dedos de oro solo existen en el personaje y en los rivales configurados: son agentes tier 4 o 3 (simulation §5).
- Sus efectos se aplican en cualquier resolución: en modo agregado, la fortuna y el aprendizaje entran como modificadores de las distribuciones del agente.

## 15. Implementación por fase

- **Fase 0:** `mode` en `NewGameSetup` y en `meta`; validador Zod de `NovelSetup` vacío.
- **Fase 1:** elegir lugar, familia por posición, sexo, nombre y edad de entrada, con búsqueda de nacimiento y biografía sintetizada; marca de modo en la crónica.
- **Fase 2:** temperamento y gustos elegidos; `upbringing` como intenciones del hogar.
- **Fase 4:** talento elegido con genoma condicionado; marco `GoldenFinger` con `reveal`, `craft`, `learning`, `talent` y `body`; mentor como remanente (con spirits); firma y saliencia en el Cielo; presets Alquimista divino y Genio celestial.
- **Fase 5:** `space` con reinos secretos; `provision` con ledger; `fortune` con reserva.
- **Fase 6:** `missions` y tienda con reserva; preset Sistema; rivales con dedo de oro.
- **Fase 7:** fijar hechos con origen en la historia (linajes, artefactos de reinos caídos); memorias de vidas pasadas y regresión; armador paso a paso en la CLI; `checkpoints` y `free`.
- **Fase 9:** armador web; archivo con marcas y verdad del dedo de oro.

## Tests

- **Determinismo:** mismo seed + mismo `NovelSetup` + mismos planes → mismo hash (tooling §2).
- **Modo realista limpio:** sin `novel`, ningún proceso lee efectos de dedo de oro y el mundo es idéntico al de siempre.
- **Conservación:** con `craft: always_succeeds`, `provision` y `missions`, el ledger cierra; una alquimia sin ingredientes no produce nada.
- **Lo imposible sigue imposible:** con `fortune` al máximo, un encuentro sin candidatos en el estado no ocurre.
- **Revelar no filtra:** con `reveal` limitado a `self.skills`, `buildPlayerView` no contiene nada fuera de ese alcance.
- **Sigue al portador:** un anillo robado da sus efectos al ladrón; uno atado al alma sigue al alma tras la muerte.
- **Coherencia:** un pedido imposible por la ley del mundo se rechaza con la razón.
- **Origen:** todo lo fijado por la configuración tiene `originEventId` con `cause: "novel_setup"` o un evento del mundo.
- **Regresión:** una vida con `pastLife` de una vida archivada arranca con las mismas creencias verdaderas y diverge solo por las acciones.

## Decisiones tomadas en este borrador (revisables)

- **Buscar, condicionar y recién después fijar** lo elegido del personaje.
- **Dedo de oro como entidad con portador** (alma, cuerpo, objeto o lugar), con origen que decide firma y relación con el Cielo.
- **Efectos como modificadores acotados** de procesos existentes, con intensidad configurable hasta lo absurdo, sin romper conservación ni causalidad.
- **"Revelar" como canal de percepción,** no como acceso a la verdad.
- **Misiones desde presiones reales y recompensas desde una reserva finita.**
- **Rivales con dedo de oro** como opción, en 0 por defecto.
- **Guardados opcionales en modo novela** como ramas registradas en el archivo.

## Preguntas abiertas

- Calibración: intensidades por defecto de cada efecto en los presets; techo de la reserva de suerte; cuántos guardados da `checkpoints`; cuánta saliencia suma un dedo de oro `foreign`.
