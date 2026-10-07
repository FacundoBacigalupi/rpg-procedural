# Conversación e influencia: hablar como acción

> Principio: **la simulación decide qué se dice; el LLM decide cómo suena.** Cada cosa que alguien dice es un acto de habla con contenido concreto (una proposición, una pregunta, un pedido, una oferta), elegido por la utilidad del que habla con lo que cree. Convencer a alguien no es ganar una tirada de carisma: es cambiar lo que el otro cree, siente o quiere, y el otro decide igual con su propia cabeza.

> Estado: **borrador** (2026-10-06).

Depende de: [actions.md](actions.md) (`speak` y los verbos sociales; parser), [information.md](information.md) §1-§3, §7 (creencias, actos de habla con información, mentir, preguntar, secretos), [npc-psychology.md](npc-psychology.md) §7-§9c (utilidad, diálogo, máscara, teoría de la mente), [perception.md](perception.md) §6 (leer emociones y mentiras), [social-structure.md](social-structure.md) §4 (etiqueta y cara), [skills.md](skills.md) (habilidades sociales y lenguas), [contracts.md](contracts.md) (promesas y acuerdos), [economy.md](economy.md) §6 (regateo).
Lo usan: [narration.md](narration.md) (verbalización de actos de habla), [player-loop.md](player-loop.md), [schemes.md](schemes.md) (engaños y reclutamiento), [law.md](law.md) (interrogatorios, testimonios, juicios), [organizations.md](organizations.md) (deliberación), [state.md](state.md) (corte, audiencias), [divination.md](divination.md) (lecturas en frío).

---

## Principios

1. **Hablar es actuar.** Cada enunciado es un `speak` con un acto de habla: ocupa tiempo y voz, emite sonido (otros lo oyen), cambia creencias y relaciones, y puede crear compromisos.
2. **El contenido sale de creencias.** Un NPC solo puede contar lo que cree (verdadero o falso), preguntar por lo que le interesa y mentir con una creencia falsa concreta que la simulación elige. El LLM no agrega hechos, nombres, cifras ni promesas.
3. **Persuadir es cambiar los insumos de la decisión del otro:** sus creencias, lo que tiene presente, sus emociones, la relación, la cara en juego o lo que gana. La decisión final la toma su utilidad.
4. **Lo que se dice no es lo que se cree.** Cada NPC tiene creencias, una máscara y razones para callar, mentir, exagerar o adular. La conversación es el lugar donde la verdad y la creencia se separan más.
5. **Entender también es percibir.** Lo dicho llega por el oído, en una lengua, con ruido, y se interpreta con la cultura y la teoría de la mente del que escucha. Los malentendidos tienen causa.
6. **Toda conversación tiene público.** Quien la oye, quién está presente, si es en público o en privado: eso cambia la cara, lo que cada uno se anima a decir y por dónde viaja después.

---

## 1. La conversación como estructura

```ts
interface Conversation {
  id: ConversationId;
  scene: SceneRef;
  participants: AgentId[];                   // los que hablan
  audience: AgentId[];                       // los que oyen sin participar (percibido o no por los participantes)
  setting: "private" | "semi_public" | "public" | "formal";   // una casa de té, el patio de una secta, una audiencia
  register: RegisterKey;                     // nivel de etiqueta esperado según los rangos percibidos (social-structure §4)
  topics: TopicStack;                        // de qué se viene hablando: referencias activas, preguntas abiertas
  commonGround: Map<AgentId, BeliefRef[]>;   // lo que cada uno cree que ya quedó dicho y aceptado
  mood: Record<AgentId, EmotionState>;       // cambia con lo que se dice
  startedBy: EventId;
}
```

- **Una conversación vive en la escena.** Arranca con un `speak` dirigido a alguien (o un saludo), dura mientras haya intercambio y termina cuando alguien se va, la interrumpen o se agota.
- **Los turnos llevan tiempo:** un enunciado tarda segundos según su largo; una charla larga son minutos u horas de tiempo simulado, en los que el mundo sigue.
- **Las referencias activas** del `TopicStack` resuelven "él", "eso", "lo de ayer" (actions §4) para los dos lados, y cada lado puede entender una referencia distinta (malentendido con causa).

## 2. Actos de habla

```ts
type SpeechAct =
  | { kind: "greet" | "address" | "farewell" }                       // con el tratamiento que corresponda
  | { kind: "tell"; prop: Proposition; asTrue: boolean }             // asTrue=false: lo dice como duda o rumor
  | { kind: "lie"; prop: Proposition }                               // dice algo que no cree, para instalar esa creencia
  | { kind: "ask"; question: Question }
  | { kind: "request"; action: ActionPlanSketch; for?: AgentId }
  | { kind: "command"; action: ActionPlanSketch }                    // pedir con autoridad (creída)
  | { kind: "offer"; give: ExchangeTerm[]; want?: ExchangeTerm[] }   // incluye el regateo (economy §6)
  | { kind: "accept" | "refuse"; ref: UtteranceRef; reason?: Proposition }
  | { kind: "promise"; commitment: CommitmentSketch }                // crea un Commitment (contracts)
  | { kind: "threaten"; harm: ActionPlanSketch; unless?: ActionPlanSketch }
  | { kind: "warn"; danger: Proposition }
  | { kind: "argue"; argument: Argument }                            // §6
  | { kind: "flatter" | "insult" | "mock"; about: ArgRef }
  | { kind: "apologize" | "thank"; for: EventRef }
  | { kind: "boast"; prop: Proposition }                             // verdadera o no; busca estatus
  | { kind: "confess"; prop: Proposition }                           // una verdad propia que costaba decir
  | { kind: "deny"; prop: Proposition }
  | { kind: "console" | "encourage"; about?: ArgRef }
  | { kind: "joke"; target?: ArgRef }
  | { kind: "evade"; question: QuestionRef }                         // no contesta sin negarse
  | { kind: "change_topic"; to?: TopicRef }
  | { kind: "challenge"; terms?: DuelTerms }                         // combat §13
  | { kind: "silence" };                                             // callar también comunica

interface Utterance {
  speaker: AgentId;
  addressees: AgentId[];
  acts: SpeechAct[];                         // un enunciado puede llevar varios actos ("perdón, ¿me vende arroz?")
  manner: { tone: ToneKey; politeness: number; volume: number; sincerityShown: number };
  language: LanguageId;
  verbatim?: string;                         // solo si lo escribió el jugador (§14) o es una cita textual dentro del mundo
  duration: Duration;
}
```

- **Las proposiciones son las de information §1:** sujeto, predicado, objeto, tiempo, lugar, con referencias a entidades reales o fantasmas.
- **Las preguntas** tienen forma (sí o no, quién, dónde, cuándo, cuánto, por qué) sobre una proposición con un hueco.
- **Los bocetos de acción** (`ActionPlanSketch`) son planes de actions §3 con referencias sin resolver: "llevame a la ciudad", "dejá de seguirme".

## 3. Entender lo que se dice

Para cada oyente (incluidos los que escuchan de costado):
1. **Oír:** percepción auditiva con ruido, distancia y volumen (perception §3). Lo que no se oye bien llega incompleto.
2. **Entender la lengua:** según su habilidad en esa lengua (skills; [language.md](language.md) §12). Con poca habilidad, entiende palabras sueltas y pierde las proposiciones complejas; con dialecto distinto, se le escapan matices.
3. **Interpretar:** mapear lo oído a actos y proposiciones con su teoría de la mente (npc-psychology) y su cultura. Los pedidos indirectos ("qué frío hace acá…"), las ironías y las amenazas veladas se entienden o no según el nivel de teoría de la mente y la familiaridad con la cultura del que habla.
4. **Leer al que habla:** emociones, sinceridad, nervios (perception §6). Sale una creencia sobre la intención del hablante, que puede estar equivocada.

El resultado es una **interpretación** con confianza, no el acto real. Lo que el oyente hace después sale de lo que entendió.

## 4. Lo que el oyente hace con lo que le dicen

- **Con un `tell`:** revisión de creencias (information §1) según confianza en el hablante, plausibilidad contra lo que ya cree, evidencia que traiga y si confirma o contradice algo.
- **Con un `lie`:** lo mismo, más la chance de detectarla (perception §6): práctica y control del mentiroso contra percepción, familiaridad y lo que ya sabe el oyente. Detectar una mentira (o creer que se detectó) baja la confianza en el hablante y queda en la memoria.
- **Con un `request` o un `command`:** decide con su utilidad (§8).
- **Con un `offer`:** evalúa el intercambio (§8).
- **Con todo:** actualiza la relación (npc-psychology §6) y la emoción. Un insulto, un halago, una confesión o una amenaza mueven el afecto, el respeto, el miedo y la confianza.

## 5. Lo que dice un NPC: elegir el acto

Cada turno, el NPC elige su próximo acto por utilidad (npc-psychology §7) entre los que su estado permite:
- **Candidatos:** responder lo que le preguntaron (con verdad, mentira, evasión, negativa o "no sé"), seguir su propio objetivo en la charla (pedir, averiguar, convencer, vender), cuidar su cara y la del otro (etiqueta), irse.
- **Pesos:** sus objetivos activos, lo que cree del interlocutor (rango, poder, intención), la relación, sus secretos (information §7), su temperamento (sociabilidad, honestidad, agresividad) y su emoción.
- **Puede equivocarse con confianza:** contesta lo que cree, aunque sea falso. "No sé" solo sale si no tiene ninguna creencia útil o no quiere comprometerse.
- **Tiene estilo de conversación** (§16): habla mucho o poco, cambia de tema, cuenta anécdotas, pregunta por la familia. Eso también se decide en actos, no lo inventa el LLM.

## 6. Persuadir

```ts
interface Argument {
  claim: Proposition;                        // lo que se afirma ("si vas a la secta te van a matar")
  appealsTo: Appeal;                         // a qué apunta
  evidence?: EvidenceRef[];                  // algo que se muestra, se cita o se puede comprobar
}

type Appeal =
  | { kind: "goal"; goal: GoalRef }          // sus objetivos: "esto te sirve para…"
  | { kind: "value"; value: ValueKey }       // sus valores: lealtad, justicia, piedad filial
  | { kind: "relation"; with: AgentId }      // "hacelo por tu hermano", "me debés una"
  | { kind: "norm"; norm: NormRef }          // "es la costumbre", "lo manda la ley"
  | { kind: "fear"; danger: Proposition }
  | { kind: "face"; whose: AgentId }         // ofrecer una salida que no le haga perder cara
  | { kind: "authority"; source: AgentId | OrgId }   // "el maestro lo quiere así"
  | { kind: "reciprocity"; favor: EventRef };
```

**Cómo funciona:**
1. El argumento **cambia insumos de la utilidad del otro**: agrega o mueve creencias sobre consecuencias (`claim`), vuelve presente un valor, una relación o una norma (sube su peso por un rato), mueve una emoción, o cambia cuánta cara está en juego.
2. **Cuánto pega** depende de:
   - **relevancia** para lo que el otro quiere de verdad (lo que el hablante crea al respecto puede estar equivocado: apelar a la lealtad de alguien que no la valora no sirve);
   - **credibilidad** del `claim` (plausibilidad, evidencia) y del hablante (confianza, rango, reputación, relación);
   - **entrega**: la habilidad social del hablante (skills: `execution` es decirlo bien, `reading` es notar cómo cae, `judgment` es elegir el argumento) con su ruido;
   - **apertura** del oyente: temperamento, intelecto, terquedad, emoción (el enojado no escucha), y cuánto lo comprometió ya su posición en público.
3. **El oyente decide** con la utilidad ya cambiada. Si la decisión no cambia, el argumento igual dejó creencias y emociones (puede pesar más adelante).

**Límites y efectos de segundo orden:**
- **Presionar de más produce reacción:** insistir, amenazar o adular a alguien orgulloso o desconfiado baja la confianza y endurece su posición.
- **La cara pública pesa:** cambiar de opinión delante de otros cuesta; un buen persuasor ofrece la salida ("nadie va a pensar que te echaste atrás si…") o busca hablar en privado.
- **No hay frases mágicas.** El mismo argumento puede convencer a uno y ofender a otro.

## 7. Preguntar y contestar

- **Preguntar es revelar** (information §2): lo que preguntás le dice al otro qué te importa.
- **Contestar es una decisión:** verdad, verdad parcial, mentira, evasión, negativa, devolver la pregunta, o pedir algo a cambio (la información como bien, information §8).
- **Técnicas de sonsacar** (sin magia): hacer como que ya se sabe ("ya me contaron lo de tu primo…"), preguntar de costado, cansar, emborrachar, halagar, ofrecer un secreto propio a cambio. Cada una cambia el cálculo del que contesta o su control (§11).
- **Interrogatorios** (law): presión, amenaza, cansancio, tortura. La tortura produce información, pero con mucho error: el torturado dice lo que cree que el otro quiere oír.

## 8. Pedidos, órdenes, ofertas y regateo

- **Un pedido** se decide con: costo para el que lo recibe, la relación (afecto, deuda, obligación), las normas (deber filial, obediencia al maestro), la deferencia según rango creído, y qué gana o pierde.
- **Una orden** es un pedido que invoca autoridad. Funciona si el otro **cree** en esa autoridad y le teme o la respeta; si no, es una ofensa. Dentro de una organización, la orden pasa por la brecha de ejecución (organizations §4).
- **Una oferta** es un intercambio que el otro evalúa con sus reservas y sus creencias sobre el valor (economy). **El regateo** es una secuencia de ofertas y actos (economy §6): mostrar desinterés, mentir sobre otras ofertas, invocar la relación, irse.
- **Una promesa** aceptada crea un `Commitment` (contracts), con testigos si los hay.

## 9. Amenazas e intimidación

- **Credibilidad de una amenaza** = lo que el amenazado cree de la capacidad del que amenaza × lo que cree de su disposición a cumplir. Un cultivador que acaba de mostrar una técnica no necesita levantar la voz.
- **El amenazado decide:** ceder, desafiar, huir, pedir ayuda, denunciar o vengarse después. La amenaza deja miedo y rencor en la relación.
- **Amenazar en público** compromete la cara del que amenaza (si no cumple, la pierde) y la del amenazado (si cede, la pierde).

## 10. Etiqueta, halagos, insultos y cara

- **El registro** (social-structure §4) se espera según los rangos que cada uno percibe del otro. Usar un tratamiento equivocado es una ofensa con tamaño según la distancia de rango y los testigos. Conocer la etiqueta de otro estrato es un saber que se practica (skills).
- **Halagar** funciona con la vanidad del otro y si no se percibe como hueco; adular en exceso a alguien perspicaz baja la confianza.
- **Insultar** baja la cara del insultado delante de los testigos y le da un motivo. Lo que hace después es su decisión (social-structure §4).

## 11. Secretos que se escapan

Guardar un secreto es una decisión que se toma de nuevo en cada turno donde el tema aparece. La chance de soltarlo (o de que se note) sube con:
- **emoción fuerte** (ira, duelo, miedo, alegría), alcohol y sustancias, cansancio, dolor;
- **confianza y afecto** con el que pregunta (o la sensación de que ya lo sabe);
- **la técnica del que sonsaca** (§7);
- **técnicas y objetos** que leen el alma o la verdad, donde el mundo los tenga.

Además, el secreto **se filtra sin decirlo:** una reacción al oír un nombre, un silencio largo, una contradicción. El que mira con atención lo percibe (perception §6) y forma una sospecha, no una certeza.

## 12. Hablar en grupo y en público

- **Varios participantes:** cada uno elige cuándo hablar (quién tiene el turno sale de la etiqueta y del temperamento). Una charla de cuatro tiene coaliciones, apartes y gente que se calla.
- **Los que escuchan de costado** (un sirviente, un espía, el de la mesa de al lado) reciben lo que oyen y lo pueden contar. Hablar en voz baja reduce el alcance; elegir un lugar privado, también.
- **Discursos a una multitud:** un orador cambia creencias y emociones de muchos a la vez, con las reglas de multitudes por umbrales (npc-psychology). Así arrancan revueltas, cultos y linchamientos.

## 13. Lenguas, intérpretes y malentendidos

- **Sin lengua común** no hay proposiciones: solo gestos, tono y señalar (`gesture`), que transmiten pedidos simples, amenazas y emociones.
- **Con intérprete,** el mensaje pasa por otra cabeza: el intérprete entiende con su habilidad, traduce con sus errores y **puede mentir o suavizar** por su propia utilidad.
- **El dialecto y el acento** revelan origen y estrato (perception §7): sirven para identificar y para prejuzgar.

## 14. Lo que dice el jugador

1. **El jugador escribe libremente**, con diálogo entre comillas o en estilo indirecto ("le pregunto si vio a mi hermana").
2. **El parser** (actions §9) traduce a actos de habla con proposiciones y referencias; el texto literal queda en `verbatim` para que el narrador lo cite.
3. **El contenido de lo que dice el jugador cuenta; la elocuencia del usuario no.** Los argumentos que elige (a qué objetivo, valor o relación apela, qué evidencia muestra) son los del personaje. Cómo los entrega (claridad, convicción, tono justo) sale de la habilidad social del personaje. Una idea brillante dicha por un personaje torpe pierde fuerza; un argumento flojo no se vuelve bueno porque el texto sea lindo.
4. **El personaje solo afirma lo que cree.** Si el jugador hace decir al personaje algo que este no cree o no sabe, es una mentira o un farol del personaje, con todo lo que eso trae (riesgo de ser descubierto, `liesTold`). Si el jugador insiste en hechos que el personaje no conoce, el parser lo marca como farol (actions §9).
5. **Los nombres y títulos** que usa el personaje son los que conoce; si el jugador usa uno que el personaje no sabe, el parser lo trata como descripción ("el viejo") o pregunta.
6. **El diálogo literal se cita tal cual** (aprobado 2026-10-06): lo que el jugador escribe entre comillas es lo que dice el personaje. Si el personaje habla mal esa lengua, el narrador muestra cómo le salió de verdad (palabras que faltan, errores, acento), porque eso es lo que oyeron los demás.
7. **El jugador no ve los actos decididos de los NPCs** (aprobado 2026-10-06): no hay "te está mintiendo" ni "está nervioso" salvo que el personaje lo perciba (perception §6), y entonces se narra como sospecha con su confianza. Los actos reales solo los muestra el inspector.

## 15. Conversaciones fuera de escena

Entre NPCs lejos del jugador, la conversación se resuelve **solo como actos** sin verbalizar: quién contó qué a quién, qué se pidió y se decidió, qué cambió en las relaciones. Si el jugador la escucha (estaba ahí, la espió, se la cuentan), se verbaliza lo que oyó, como lo oyó.

**Escuchar una charla larga** (aprobado 2026-10-06): se narra como resumen de lo que el personaje oyó, con huecos donde no llegó a oír o no entendió. **Las frases clave las elige el personaje, no el usuario:** se destacan las que su atención captó y las que le parecieron importantes según sus creencias, objetivos y miedos. Si no sabe que un nombre importa, ese nombre no se destaca (puede quedar en el resumen o perderse). El jugador puede pedir la versión completa de **lo que oyó**, nunca de lo que se dijo de verdad; y lo que recuerde después pasa por la memoria (npc-psychology) y se degrada como cualquier otro recuerdo.

## 16. El contrato con el LLM

La verbalización (detalles de prompt y validación en [narration.md](narration.md)) recibe:

```ts
interface VerbalizationRequest {
  speaker: {
    style: SpeechStyle;                      // generado y persistente: largo de frases, formalidad, muletillas, refranes de su cultura, vocabulario por estrato y oficio
    temperament: TemperamentSummary;         // 2-3 rasgos fuertes
    emotionShown: EmotionState;              // lo que deja ver (la máscara), no lo que siente
  };
  acts: SpeechAct[];                         // con las proposiciones resueltas a los nombres y descripciones que usa el hablante
  addressee: { howSpeakerSeesThem: string; relation: RelationSummary; register: RegisterKey };
  context: { recentLines: string[]; setting: Conversation["setting"] };
  language: LanguageId;                      // si el jugador no la entiende, se narra como sonido o como lo que entiende
}
```

**Reglas:**
- Tiene que decir **todos** los actos y **nada más**: ningún hecho, nombre, número, lugar o compromiso que no esté en `acts`.
- Puede agregar estilo: muletillas, rodeos, refranes, cortesías del registro.
- **Validación posterior:** se buscan en el texto entidades, cifras y afirmaciones fuera de lo permitido (lista blanca por pedido). Si falla, se regenera una vez; si falla otra vez, se usa una plantilla simple del acto. La plantilla nunca rompe las reglas.
- **El estilo de habla de cada NPC** (`SpeechStyle`) se genera con el NPC (cultura, estrato, oficio, temperamento, región) y no cambia salvo por eventos (alguien que sube de estrato cambia su forma de hablar con el tiempo).

## 17. Escala (LOD)

- **Tier 3-4 en escena:** conversación completa por turnos, interpretación con errores, persuasión con todos sus factores, verbalización si el jugador la oye.
- **Tier 2:** conversaciones como intercambios de actos resumidos (un turno por tema), sin verbalización.
- **Tier 1 y agregados:** flujo de información y opinión entre grupos (rumores y reputación, information §11); los acuerdos importantes se registran como eventos.

## 18. Implementación por fase

- **Fase 1:** actos básicos (`greet`, `tell`, `ask`, `request`, `offer`, `accept`, `refuse`, `farewell`); NPC que contesta desde sus creencias con "no sé"; regateo simple; verbalización con validación y plantillas de respaldo; `SpeechStyle` mínimo.
- **Fase 2:** mentiras y su detección, `TopicStack` con referencias, persuasión con argumentos y apelaciones, amenazas, halagos e insultos con cara, secretos que se escapan, sonsacar, lo que el NPC dice vs lo que cree.
- **Fase 3:** conversaciones fuera de escena como actos, conversaciones de grupo y oyentes de costado, promesas que crean compromisos, interrogatorios.
- **Fase 5:** lenguas e intérpretes, dialectos que revelan origen, discursos a multitudes.
- **Fase 6:** deliberación de organizaciones y audiencias formales como conversaciones con registro alto.

## Tests

- **El LLM no agrega hechos:** para un corpus de pedidos de verbalización, ningún texto aceptado contiene entidades, cifras o compromisos fuera de los actos (validación).
- **Contenido desde creencias:** un NPC sin creencias sobre un tema contesta "no sé", evade o miente; nunca contesta la verdad que no conoce.
- **Persuasión por insumos:** el mismo argumento cambia la decisión de un NPC que tiene el objetivo apelado y no la de uno que no lo tiene.
- **Cara pública:** con todo igual, cambiar de opinión cuesta más con testigos.
- **Elocuencia vs habilidad:** con el mismo argumento, el personaje con más habilidad social logra más; con la misma habilidad, el argumento relevante logra más que el irrelevante.
- **Malentendidos con causa:** con poca habilidad en la lengua, las proposiciones complejas llegan incompletas; un pedido indirecto no lo entiende alguien con teoría de la mente baja.
- **Secretos:** la chance de soltar un secreto sube con alcohol y emoción; un secreto puede filtrarse por una reacción sin decirse.
- **Determinismo:** misma conversación, mismo seed → mismos actos y decisiones (la verbalización puede variar en palabras, no en contenido).

## Decisiones tomadas en este borrador (revisables)

- **Catálogo cerrado de actos de habla** con contenido estructurado (proposiciones, preguntas, bocetos de acción).
- **Persuasión como cambio de insumos** de la utilidad del otro, nunca como tirada que decide.
- **Interpretación con errores** por oído, lengua, cultura y teoría de la mente.
- **Para el jugador, cuenta el contenido y no la elocuencia;** la entrega es del personaje.
- **Verbalización con lista blanca y plantillas de respaldo.**
- **Estilo de habla generado y persistente por NPC.**

## Decisiones (aprobado 2026-10-06)
- **La elocuencia del usuario no cuenta:** solo el contenido (qué argumento, a qué apela, qué evidencia); la entrega sale de la habilidad del personaje.
- **Sin ver los actos decididos de los NPCs:** solo lo que el personaje percibe, las sospechas como sospechas; los actos reales, en el inspector.
- **Diálogo literal citado tal cual,** con los errores reales si el personaje habla mal la lengua.
- **Charlas largas oídas como resumen** con frases clave elegidas por la atención y los intereses del personaje, huecos donde no oyó, y versión completa de lo oído a pedido.

## Preguntas abiertas

- Calibración: duración de los turnos; pesos de relevancia, credibilidad, entrega y apertura; tamaño de la reacción por presionar; chance de soltar secretos por factor; tasa de detección de mentiras; costo de cara por cambiar de opinión en público; cuántos turnos tiene una charla resumida de tier 2.
