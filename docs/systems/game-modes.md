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

- **`WorldConstraints`** (aprobado 2026-10-06): restricciones sobre el mundo y no sobre el personaje: la familia ([metaphysics.md](metaphysics.md)), la era ([technology.md](technology.md) §9b), y ejes sueltos de la ley del mundo. Lo que no se fija sale del seed con sus pesos. Fijar la era no garantiza llegar: la historia corre igual y puede quedar en la más cercana.
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
  effects: GoldenEffect[];                   // §5.1-§5.8: los efectos de uso común
  rules?: GoldenRule[];                      // §5.9: cualquier otra cosa, compuesta con piezas
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
- **"Sin explicación" no existe.** Si el usuario no quiere elegir origen, el mundo elige uno coherente y lo oculta (aprobado 2026-10-06): el personaje no sabe qué tiene y lo va descubriendo como cualquier secreto (pistas, el mentor que miente, un adivino), y la crónica revela la verdad al final.

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

### 5.9 Composición: disparador, condición, acción (aprobado 2026-10-06: "super variado, para imitar distintas novelas")

Los efectos de §5.1-§5.8 son los más comunes, pero un dedo de oro no está limitado a ellos. Cualquier dedo de oro es una **lista de reglas** armadas con piezas, y cada pieza es un punto de enganche con un proceso que ya existe. Así se puede imitar casi cualquier novela **agregando contenido** en `content/golden-fingers/`, sin tocar código; solo una pieza nueva requiere código.

```ts
interface GoldenRule {
  trigger: Trigger;                          // cuándo
  condition?: Condition;                     // si se cumple qué (sobre la verdad del portador o lo que percibe)
  action: EffectAction;                      // qué hace
  bounds?: Bounds;                           // topes por uso, por día, por vida
  cost?: GoldenCost[];                       // §6
  cooldown?: Duration;
  narration?: NarrationHint;                 // cómo se anuncia ("[Ding!]", una voz, nada)
}

type Trigger =
  | { kind: "passive" }                      // siempre activo (modificador)
  | { kind: "command" }                      // el personaje lo invoca (un verbo `use_golden_finger` con modos)
  | { kind: "interval"; every: Duration }    // cada día, cada luna
  | { kind: "event"; pattern: EventPattern } // al matar, comer, dormir, fabricar, romper un umbral, regalar, ser humillado, humillar, morir…
  | { kind: "place"; query: PlaceQuery }     // al llegar a un lugar ("firmar" en un sitio nuevo)
  | { kind: "percept"; pattern: PerceptPattern } // al ver una técnica, un tesoro, a alguien con destino fuerte
  | { kind: "threshold"; metric: MetricRef; crosses: number }; // al llegar a fama X, karma X, nivel X

type EffectAction =
  | { kind: "modify"; target: ProcessParamRef; op: "mul" | "add" | "floor" | "cap" | "set"; value: number } // cualquier parámetro declarado de un proceso
  | { kind: "perceive"; channel: ChannelSpec }               // un canal de percepción extra (§5.1, §5.7)
  | { kind: "tilt"; scope: TiltScope[]; magnitude: number }  // inclinar tiradas entre lo posible (§5.4)
  | { kind: "transfer"; from: LedgerAccountId; to: TargetRef; what: ResourceSpec }   // dar desde una reserva
  | { kind: "convert"; inputs: ResourceSpec[]; outputs: ResourceSpec[]; rate: number } // cambiar una cosa por otra, con conservación declarada
  | { kind: "absorb"; from: "victim" | "item" | "beast" | "place"; what: AbsorbSpec }  // quitarle algo a otro (qi, técnica, linaje, años)
  | { kind: "grant_knowledge"; from: KnowledgeReserveId; pick: PickRule }             // una biblioteca finita en la mente
  | { kind: "body"; change: BodyChange }                     // body-health
  | { kind: "soul"; change: SoulChange }                     // dividir, reforzar, sellar
  | { kind: "agent"; ref: AgentId; bind: BindSpec }          // un compañero que ya existe (espíritu, bestia, clon creado en el evento de origen)
  | { kind: "realm"; ref: RealmId; op: "enter" | "exit" | "grow" | "move_entrance" }
  | { kind: "project"; spec: ProjectionSpec }                // simular a futuro sobre una copia (abajo)
  | { kind: "rewind"; spec: RewindSpec }                     // volver a un punto anterior conservando memorias (abajo)
  | { kind: "teleport"; to: PlaceRef; cost: ResourceSpec[] }
  | { kind: "influence"; on: AttitudeRef; magnitude: number } // inclinar actitudes ajenas como un aura (con canal percibible)
  | { kind: "reveal_ui"; panel: PanelSpec };                 // un panel con datos de un canal (misiones, afinidad, mapa)
```

- **Todo pasa por un proceso real.** `modify` solo toca parámetros que los procesos declaran modificables (el ruido de control de una sesión, la velocidad de la curva, la tasa de absorción). `absorb` es una transferencia con conservación: lo que gana el portador lo pierde la víctima.
- **Las reglas se combinan.** "El arma que crece devorando" es `event: kill` + `absorb: victim.qi` + `modify: item.grade`, con crecimiento por alimentación.
- **Proyectar (el simulador):** `project` corre la sim sobre una **copia descartable** desde el estado actual, con la política del personaje o con el jugador jugando adentro ("una vida simulada en un sueño"). Se elige **en cada uso** (aprobado 2026-10-06): jugarla vos adentro, para lo importante, o dejar que la viva el personaje con su política y recibir un resumen (como el montaje de player-loop), para avanzar rápido. Lo que el personaje vivió en la copia vuelve como memorias con la fidelidad configurada. Es un pronóstico: el mundo real puede ir distinto, porque el personaje ya no es el mismo después de ver el futuro. Es determinista, y la copia nunca escribe en la verdad.
- **Volver (regresar al morir, bucles):** `rewind` restaura un snapshot anterior del mundo y le pone al personaje las memorias de lo vivido como creencias. La rama descartada queda en el archivo, y la crónica cuenta todas las vueltas. Tiene topes y costos configurables; por defecto **3 vueltas con costo creciente**, y se puede configurar como ilimitado (aprobado 2026-10-06).

### 5.10 Catálogo de tropos

Cada fila es un preset de reglas en `content/golden-fingers/`, editable. Los nombres son del tropo, no de una novela concreta.

**Información**

| Tropo | Reglas |
|---|---|
| Panel de estado | `reveal_ui` + `perceive` sobre uno mismo (§5.1) |
| Ojo que ve el qi o los defectos | `perceive` del campo de qi, de flujos en meridianos ajenos o de defectos de objetos y técnicas |
| Identificar tesoros | `percept` de un objeto → `perceive` de calidad, origen y uso |
| Radar de tesoros | `perceive` con alcance de varias celdas sobre recursos de alto valor |
| Ver hilos kármicos o el destino | `perceive` de vínculos kármicos y de la proyección de presiones sobre una persona (divination §3) |
| Premonición | `project` corto (segundos a horas) con fidelidad baja, disparado por peligro |
| Leer objetos (psicometría) | `perceive` de los eventos que tocaron un objeto (las huellas de perception) |
| Oír pensamientos superficiales | `perceive` de la emoción y la intención inmediata de quien está cerca |
| Detector de mentiras | `perceive` de la contradicción entre lo dicho y lo creído (dialogue) |
| Medidor de afinidad | `reveal_ui` de las relaciones de los demás con vos (npc-psychology) |
| Valor de las personas | `perceive` del talento ajeno, al ver |

**Progreso**

| Tropo | Reglas |
|---|---|
| Experiencia por matar | `event: kill` → `absorb` de qi o de esencia de la víctima |
| Firmar (签到) | `place` nuevo o `interval` → `transfer` desde la reserva, más en lugares más raros |
| Gacha o lotería | `command` + costo en puntos → `transfer` de un ítem de la reserva elegido con rng |
| Logros | `threshold` sobre métricas → `transfer` |
| Cultivo automático | `passive` → `modify` de la absorción durante el sueño o en toda actividad |
| Comprensión que fluye | `passive` → `modify` de la comprensión; `event: breakthrough` → un insight |
| Copiar con la mirada | `percept` de una técnica → `grant_knowledge` con la fidelidad de lo visto |
| Devorar técnicas | `event: defeat` → `absorb` de una técnica del vencido (la pierde él, o le queda dañada) |
| Fusión de técnicas | `command` → `convert` de dos técnicas en una nueva (discovery §10, con la ley decidiendo si funciona) |
| Sistema de vida cotidiana | experiencia por cocinar, cultivar la tierra o pescar → `transfer` y `modify` de habilidades de oficio |
| Tiempo comprimido | `command` → `realm` de sueño o espacio con `timeRatio` alto (§5.5) |
| Simulador de vidas | `command` → `project` de años con el jugador jugando adentro; vuelve con memorias |

**Recompensas e intercambio**

| Tropo | Reglas |
|---|---|
| Tienda del sistema | `command` → `convert` de puntos en ítems de la reserva (§5.6) |
| Devolución multiplicada | `event: gift` (regalarle a un discípulo o a alguien) → `transfer` de N veces el valor desde la reserva al portador |
| Sistema de maestro | `event` de progreso de tus discípulos → `transfer` al maestro |
| Préstamo de poder | `command` → poder ahora a cambio de un `Commitment` con interés (contracts); el impago tiene ejecutor |
| Sacrificio para mejorar | `convert` de objetos o qi en grados del artefacto |
| Sistema de villano | `event` al humillar a un "elegido" o arruinar su plan → `transfer` (necesita rivales, §8) |
| Fama que da poder | `passive` → `convert` de la devoción y la reputación en qi (como el culto, spirits §6) |
| Mérito como moneda | `threshold` de mérito (heaven-karma §7) → `transfer` |

**Tiempo y destino**

| Tropo | Reglas |
|---|---|
| Regresor | `pastLife` desde una vida archivada (§5.8) |
| Volver al morir | `event: death` → `rewind` al último punto fijado, con memorias; topes y costo |
| Rebobinar segundos | `command` → `rewind` corto (segundos), con costo alto de qi o alma |
| Sueños proféticos | `interval: noche` → `project` en símbolos (divination §4) |
| Fortuna del protagonista | `tilt` (§5.4) |
| Torcer el destino | `command` → `tilt` fuerte sobre una persona o un evento proyectado, con costo kármico |

**Compañeros**

| Tropo | Reglas |
|---|---|
| Abuelo en el anillo | `agent` remanente (§5.5) |
| Espíritu del arma | `agent` espíritu de objeto con la personalidad que le dejó su historia |
| Bestia contratada | `agent` bestia con vínculo (living-world: contratos con bestias) |
| Demonio sellado en el cuerpo | `agent` con objetivos propios y `soul` compartida; poder a cambio de control |
| Dios sellado | `agent` de un dios local caído que necesita culto para recuperarse (spirits §9) |
| Clon o avatar | `agent` creado en el evento de origen con parte de tu alma; lo controlás como un segundo personaje |
| Invocar héroes del pasado | `command` → `agent` temporal desde un espíritu o remanente real de la historia |
| Ejército de muertos | `event: kill` → `agent` sometido (espíritus fabricados, con karma) |

**Espacio y lugares**

| Tropo | Reglas |
|---|---|
| Mundo de bolsillo que crece | `realm` con `grow` al alimentarlo; hierbas que maduran con su tiempo propio |
| Granja espiritual | `realm` + `provision` de cultivos con `timeRatio` |
| Cueva portátil | `realm` con entrada que se mueve con el portador |
| Volver a casa | `teleport` con costo |
| Tienda de otra dimensión | `realm` con un comerciante (agente) que comercia con su propio stock |
| Puerta a otra era | `realm` congelado del pasado del mundo (secret-realms), con gente y objetos de esa época |

**Cuerpo y alma**

| Tropo | Reglas |
|---|---|
| Cuerpo inmortal | `body`: regeneración alta; solo muere por destrucción total o del alma |
| Adaptación | `event: injury` de un tipo → `modify` de la resistencia a ese tipo |
| Devorar linajes | `absorb` de sangre de bestias → cambios de linaje (family-lineage §9) |
| Varios dantianes | `body` y `soul` con capacidades extra de cultivo |
| Alma dividida | `soul`: partes del alma en otros objetos o cuerpos; morir no mata si queda una |
| Transformación en bestia | `command` → `body` temporal con otra forma |
| Cuerpo venenoso | `body`: produce veneno y es inmune a venenos |
| Juventud eterna | `body`: sin envejecimiento visible; la vida sigue contando o no, según la configuración |

**Social**

| Tropo | Reglas |
|---|---|
| Aura de carisma | `influence` sobre las actitudes de quienes te perciben (con canal percibible) |
| Imán de problemas | `tilt` de encuentros con conflicto: los arrogantes te provocan más seguido |
| Imán de amores | `tilt` de encuentros e `influence` de atracción (npc-psychology) |
| Rostro sin rastro | velo sobre la memoria ajena: la gente te recuerda mal |

**Saber de otro mundo**

| Tropo | Reglas |
|---|---|
| Transmigrador moderno | `grant_knowledge` de procesos (química, medicina, imprenta, pólvora) que **solo funcionan si la ley del mundo los permite** (technology); el resto es conocimiento falso |
| Biblioteca en la mente | `grant_knowledge` desde una reserva finita de textos con origen |
| Recuerdos de un juego | `perceive` de un mapa y de datos de "cómo era" el mundo, que pueden estar desactualizados |

**Con precio**

| Tropo | Reglas |
|---|---|
| Maldición que da poder | poder alto con `cost` grande (vida, cordura, karma) |
| Hambre | el poder exige comer cierto recurso, o se debilita |
| Pacto con un demonio | `Commitment` con una entidad (§4: pacto) que cobra |

- **Combinables:** un setup puede llevar varios dedos de oro, y cada uno varias reglas. El armador muestra choques ("dos efectos `rewind`: se aplica el más restrictivo") y lo que implica cada combinación.
- **Las mismas restricciones para todos:** conservación con reservas declaradas, `tilt` sin volver posible lo imposible, `project` y `rewind` sobre copias y snapshots, canales de percepción en vez de acceso a la verdad.
- **Agregar un tropo** es escribir un archivo de reglas. Si necesita un enganche que ningún proceso declara, se agrega el parámetro al proceso (con su test), y queda disponible para todos los tropos.

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
  count: number;                             // otros agentes con dedo de oro (0 por defecto en todos los presets; aprobado 2026-10-06)
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

- **Se elige al configurar; por defecto `one_life`** (aprobado 2026-10-06).
- **`one_life`:** como el modo realista (player-loop §12).
- **`checkpoints`:** guardados manuales con un límite (pocos por año de juego, o en lugares concretos). Cargar uno es volver a ese snapshot: la sim es determinista, así que es una rama nueva desde ahí. El archivo guarda cuántas veces se cargó y desde dónde, y la crónica cuenta la rama final.
- **`free`:** guardar y cargar sin límite, con la misma marca.
- **Ninguna opción cambia el mundo:** cargar no altera a nadie, solo elige una rama.
- **El modo no se cambia a mitad de una vida** (aprobado 2026-10-06): si se quieren ventajas, se arranca una vida nueva en modo novela, que puede ser en la misma seed.
- **Distinto de "volver al morir":** cargar es una opción del usuario; `rewind` (§5.9) es un dedo de oro dentro del mundo, que el personaje vive y recuerda.

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
| **Firmador** | Firmar en lugares nuevos da recompensas de una reserva; viajar es progresar |
| **Simulador** | Simula vidas en sueños y vuelve con memorias; el mundo real puede ir distinto |
| **Volver al morir** | Al morir vuelve al último punto fijado con memorias; pocas vueltas y caras |
| **Transmigrador** | Saber de procesos de otro mundo que funcionan solo si la ley lo permite |
| **Maestro de secta** | Recompensas cuando progresan sus discípulos; devolución multiplicada al regalarles |
| **Villano** | Recompensas por arruinar a los "elegidos" (con rivales activados) |
| **Arma que devora** | Espíritu del arma que crece absorbiendo lo que mata |
| **Granjero espiritual** | Mundo de bolsillo con tiempo propio que crece al alimentarlo |
| **Personalizado** | El armador paso a paso, con todo el catálogo de §5.10 |

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

- **Fase 0 (hecho):** `mode` en `NewGameSetup` y en `meta`; validador Zod de `NovelSetup` vacío (`src/game/setup/`). Del personaje solo se aceptan `species`, `sex`, `name` y `entryAge`; los demás campos y cualquier dedo de oro se rechazan hasta su fase, para que una configuración nunca pida algo que el mundo ignore en silencio. `narration: NarrationPrefs` y `llm: LlmConfig` son de la capa `llm`: no cambian el mundo, no van al replay y la UI los junta con el setup.
- **Fase 1:** elegir lugar, familia por posición, sexo, nombre y edad de entrada, con búsqueda de nacimiento y biografía sintetizada; marca de modo en la crónica.
- **Fase 2:** temperamento y gustos elegidos; `upbringing` como intenciones del hogar.
- **Fase 4:** talento elegido con genoma condicionado; marco `GoldenFinger` con `reveal`, `craft`, `learning`, `talent` y `body`; reglas compuestas (§5.9) con `passive`, `command`, `event`, `modify`, `perceive`, `transfer` y `absorb`, y los primeros tropos del catálogo; mentor como remanente (con spirits); firma y saliencia en el Cielo; presets Alquimista divino y Genio celestial.
- **Fase 5:** `space` con reinos secretos; `provision` con ledger; `fortune` con reserva.
- **Fase 6:** `missions` y tienda con reserva; preset Sistema; rivales con dedo de oro.
- **Fase 7:** `project` (simulador, premonición) y `rewind` (volver al morir) sobre copias y snapshots; el resto del catálogo de tropos; fijar hechos con origen en la historia (linajes, artefactos de reinos caídos); memorias de vidas pasadas y regresión; armador paso a paso en la CLI; `checkpoints` y `free`.
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
- **Copias sin escritura:** `project` no cambia el hash de la verdad; `rewind` restaura exactamente el snapshot más las memorias.
- **Tropos como contenido:** cada tropo de `content/golden-fingers/` valida con Zod y solo usa parámetros que los procesos declaran modificables.
- **Regresión:** una vida con `pastLife` de una vida archivada arranca con las mismas creencias verdaderas y diverge solo por las acciones.

## Decisiones (aprobado 2026-10-06)
- **Dedos de oro super variados** para imitar distintas novelas: reglas compuestas con piezas (§5.9) y un catálogo amplio de tropos como contenido (§5.10).
- **Guardados:** se eligen al configurar; `one_life` por defecto; cada carga queda en el archivo (§9).
- **Sin cambio de modo a mitad de una vida** (§9).
- **Rivales con dedo de oro:** 0 por defecto en todos los presets, configurable (§8).
- **Volver al morir:** 3 vueltas por defecto, con costo creciente; configurable hasta ilimitado (§5.9).
- **Simulador:** en cada uso se elige jugar la vida simulada o recibir un resumen (§5.9).
- **Dedo de oro sin origen elegido:** el mundo elige uno coherente y lo oculta; el personaje lo descubre y la crónica lo revela (§4).

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

## Ampliación (2026-10-08): presets de sabor de mundo

Presets del armador de modo novela que fijan los ejes de metaphysics (ampliación 2026-10-08): "domador de bestias" (bestias despiertas, vínculo como compañero, equipos), "aventurero" (gremio con rangos, bestias que amenazan, academias), "académico de la magia", "con sistema" (estatus visible desde cierta edad). Son combinaciones de parámetros y dedos de oro, no reglas aparte. Fase 9.
