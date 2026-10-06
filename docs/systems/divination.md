# Adivinación y profecía

> Estado: **borrador de diseño**. Ver lo que no se ve: tres fuentes muy distintas que las culturas mezclan (pronóstico por conocimiento de las leyes, lectura metafísica real pero ruidosa del karma, del grafo causal y de las presiones, y ritual sin acceso a la verdad), qué puede leer cada mundo y a qué costo (reacción del Cielo, vida, karma), el futuro como proyección de las presiones actuales y no como destino escrito, lecturas que salen en símbolos y se interpretan con error, profecías que se vuelven creencias, viajan, se deforman y mueven a la gente hasta cumplirse solas o provocar lo que querían evitar, presagios naturales leídos como mensajes, adivinos como oficio y como poder (cortes, templos, sectas, charlatanes), y la lectura de karma como prueba.

Depende de: [heaven-karma.md](heaven-karma.md) (karma como enlaces que algunas técnicas leen; el Cielo oculta sus asuntos y castiga a quien espía), [causality.md](causality.md) (el grafo causal, las presiones y sus descargas, el modelo agregado de la historia, §7 karma como hilos perceptibles), [metaphysics.md](metaphysics.md) (qué permite leer cada mundo), [perception.md](perception.md) (la adivinación es un canal más, con errores y huellas), [information.md](information.md) (las profecías son creencias que se cuentan, se deforman y forman linajes de rumor), [discovery.md](discovery.md) (pronóstico por comprensión de las leyes, interpretar es formar hipótesis, dogmas de escuela), [npc-psychology.md](npc-psychology.md) (cómo una profecía cambia la utilidad y el miedo), [schemes.md](schemes.md) (profecías fabricadas e intrigas que las explotan), [cultivation.md](cultivation.md) (técnicas de adivinación, alma como instrumento, tamaño del alma frente al leído), [crafts.md](crafts.md) (instrumentos: discos, caparazones, formaciones de cálculo), [planet-gen.md](planet-gen.md) (ciclos celestes, clima, mareas de qi), [living-world.md](living-world.md) (calendarios y creencias sobre el Cielo, mitos), [state.md](state.md) (astrólogos de la corte, presagios y legitimidad), [law.md](law.md) (leer culpables), [contracts.md](contracts.md) (leer juramentos y deudas), [organizations.md](organizations.md) (oráculos y salones de adivinación como instituciones), [economy.md](economy.md) (el oficio de adivino, mercados de pronósticos). Lo usan: [perception.md](perception.md) (karma como canal), [law.md](law.md) (adivinación y lectura de karma como prueba), [contracts.md](contracts.md) (leer juramentos y deudas), [state.md](state.md) (astrólogos de la corte, presagios), [war.md](war.md) (presagios antes de la batalla, adivinos de campaña), [family-lineage.md](family-lineage.md) (leer el destino de un linaje), [social-structure.md](social-structure.md) (destinos "por encima de su estación"), [secret-realms.md](secret-realms.md) (predecir aperturas), [technology.md](technology.md) (calendarios, astronomía), [deep-history.md](deep-history.md) (profecías como legados), y el futuro crónica (profecías cumplidas e incumplidas en la historia).

## Principios
1. **El futuro no está escrito.** No hay destino guardado en ninguna parte. Lo que existe es el estado presente con sus presiones, y lo que un adivino real puede leer es hacia dónde **empuja** ese estado si nada cambia. Las acciones (incluidas las que provoca la profecía) cambian el resultado.
2. **Tres fuentes, una palabra.** Las culturas llaman "adivinación" a cosas que el motor separa: (a) **pronóstico por conocimiento** (predecir un eclipse, la crecida del río, la próxima marea de qi): real, sale de entender las leyes; (b) **lectura metafísica** (karma, hilos causales, presiones): real donde la metafísica la permite, ruidosa y cara; (c) **ritual** (huesos, entrañas, varillas, astrología sin base): no lee la verdad, pero mueve a la gente porque se cree. Un mismo adivino puede mezclar las tres sin saber cuál es cuál.
3. **Leer es percibir.** La adivinación es un canal de percepción (perception) con su alcance, su ruido y sus errores con forma. Lo que produce entra a las creencias del adivino, nunca directo a la verdad del que pregunta.
4. **La lectura sale en símbolos.** Lo que el adivino recibe no es una frase clara: es un patrón (un hexagrama, una grieta, una visión, un sueño) que hay que interpretar, y la interpretación es una hipótesis con los sesgos del intérprete y de su escuela.
5. **Una profecía dicha es un evento.** Una vez contada, es información que viaja, se deforma y cambia lo que la gente cree y hace. Las profecías se cumplen solas o se frustran solas por lo que provocan, y el motor no hace trampa para que se cumplan.
6. **El Cielo no quiere que lo espíen.** En la familia xianxia, leer asuntos grandes (el destino de un reino, la tribulación de un poderoso, el karma de alguien más fuerte) atrae la atención del Cielo y tiene **reacción** (反噬): heridas del alma, vida acortada, karma. Los asuntos del Cielo están velados (天机不可泄露).
7. **El LLM no adivina.** La lectura (qué proposiciones se leen, con qué ruido, en qué símbolos) la produce la simulación; el narrador solo describe los símbolos y la escena. Nunca agrega contenido profético propio.
8. **Determinista sin contaminar.** `rng.fork("divination", readerId, queryId, tick)` para la lectura y su ruido; la proyección del futuro usa su propio fork y **no consume** el RNG del mundo, así que adivinar no cambia lo que iba a pasar salvo por lo que la gente haga con la lectura.

## 1. Métodos

```ts
interface DivinationMethod {
  id: MethodId;
  culture?: CultureId;                       // a qué tradición pertenece
  source: "knowledge" | "metaphysical" | "ritual";  // (Principio 2) verdad del motor, no lo que cree la cultura
  reads: ReadTarget[];                       // qué puede leer de verdad (vacío para ritual puro)
  instrument?: ItemKind;                     // caparazones, varillas, disco de adivinación, espejo, estrellas, sangre
  symbols: SymbolSystemId;                   // en qué lenguaje simbólico sale (§4)
  requires: { threshold?: ThresholdId; aspects?: LawAspectId[]; skill: SkillId };
  cost: DivinationCost;                      // tiempo, materiales, esencia, vida, karma
  backlash: BacklashRule[];                  // reacción según qué y a quién se lee (§6)
  originEventId: EventId;                    // quién lo inventó o lo trajo
}

type ReadTarget =
  | { kind: "karma"; scope: "self" | "other" }          // enlaces kármicos (heaven-karma §2)
  | { kind: "causal_past"; depth: number }              // eventos y sus causas: quién mató, quién robó
  | { kind: "hidden_present"; radius: number }          // dónde está algo, qué hay detrás de la barrera
  | { kind: "pressure_future"; horizon: number }        // hacia dónde empujan las presiones (§3)
  | { kind: "natural_cycle"; cycle: CycleId };          // eclipses, mareas de qi, crecidas (pronóstico por conocimiento)
```

- **Pronóstico por conocimiento:** astronomía, calendario, meteorología popular, el ciclo de un reino secreto (secret-realms §4). Es discovery aplicado: quien tiene la hipótesis correcta y los registros predice bien; quien tiene la errónea, mal. No cuesta karma y no tiene reacción. Muchas culturas lo envuelven en ritual y no distinguen.
- **Lectura metafísica:** solo existe si la metafísica del mundo tiene algo que leer (karma real, hilos causales perceptibles, un alma capaz de sentirlos) y si el adivino tiene el umbral, los aspectos comprendidos y la técnica. Es real y es ruidosa.
- **Ritual:** caparazones, entrañas, varillas, la ceniza del incienso. En la familia xianxia, salvo que un método tenga una lectura metafísica real detrás, el resultado sale del azar del instrumento más lo que el adivino ya cree o quiere. Sigue siendo poderoso: decide guerras y casamientos porque la gente lo cree.
- **Lectura en frío:** muchos adivinos aciertan por otra vía: leen a la persona que tienen delante (percepción, psicología, rumores que ya escucharon). Es habilidad social real con un disfraz.

## 2. Qué se puede leer

### Karma
- Los enlaces kármicos (heaven-karma §2) de una persona: deudas de vida y de sangre, vínculos de maestro y discípulo, juramentos, parentesco. Se ven como hilos con peso y polaridad, con ruido proporcional a la distancia de poder entre lector y leído.
- **Usos:** saber si alguien mató (law: prueba), si un juramento existe y si se rompió (contracts §9), si un niño es de quien dicen (family-lineage), a quién le debés, quién te persigue. Las cortes y las sectas con lectores de karma tienen una herramienta de justicia temible.
- **No se falsifica, se oculta.** El karma es verdad: no se puede fabricar un hilo falso, pero un poderoso o un artefacto puede **velar** sus hilos, y un lector débil puede leer mal. Leer el karma de alguien mucho más fuerte es peligroso (§6).

### El pasado causal
- Remontar un evento hacia sus causas: quién estuvo, qué pasó, por qué. Es leer el grafo de eventos (causality §1, Ley 5) desde un ancla (un objeto, un lugar, un cadáver, una persona).
- La profundidad y la fidelidad dependen del método y del poder; cuanto más lejos en el tiempo y más gente involucrada, más ruido. Lo velado por el Cielo o por un poderoso aparece borroso o falta.

### El presente oculto
- Dónde está alguien o algo, qué hay detrás de una barrera, si alguien vive. Es un canal de percepción a distancia, con radio y ruido, que las formaciones de ocultamiento y las barreras de los reinos secretos bloquean.

### El futuro
Ver §3.

## 3. El futuro como proyección

El adivino que "ve el futuro" lee el **estado presente con sus presiones** y su tendencia.

```ts
interface FutureReading {
  query: DivinationQueryId;
  subject: EntityRef;                        // una persona, un linaje, una secta, un reino, una batalla
  horizon: number;                           // hasta dónde llega el método
  projection: ProjectedOutcome[];            // resultados de correr el modelo agregado desde el estado actual
  confidence: number;                        // cuánto convergen las proyecciones (presiones fuertes → futuro "claro")
  veiled: EntityRef[];                       // lo que no se pudo leer (el Cielo, poderosos ocultos)
}
```

- **Cómo se calcula:** desde la verdad presente, el motor corre el **modelo agregado** del mundo (el mismo de la historia: causality §5.1) sobre el sujeto y su entorno, varias veces con forks propios, hasta el horizonte del método. Lo que sale en casi todas las corridas es un futuro "claro" (presiones fuertes: un imperio con el tesoro vacío y la tierra concentrada); lo que varía mucho es un futuro "nublado".
- **No incluye la reacción a la profecía.** La proyección supone que nadie sabe nada de ella. Por eso las profecías se pueden frustrar: el que las escucha cambia lo que hace. Y se pueden cumplir por eso mismo.
- **Cuesta proporcional a lo que se lee:** el horizonte y el tamaño del sujeto (una persona, una secta, un reino) fijan el costo, el riesgo de reacción y el trabajo de cómputo (que se limita por tier: §10).
- **Errores con forma:** el adivino tiene creencias equivocadas sobre las leyes (discovery) y sus lecturas heredan esos errores; una escuela con un dogma lee el futuro a través del dogma.

## 4. Símbolos e interpretación

```ts
interface Reading {
  id: ReadingId;
  method: MethodId;
  reader: PersonId;
  propositions: ReadProposition[];           // lo que el motor efectivamente leyó (verdad + ruido + huecos); oculto al jugador
  omen: Omen;                                // cómo se manifestó (§4)
  backlash?: EventId;                        // reacción sufrida (§6)
  originEventId: EventId;
}

interface Omen {
  system: SymbolSystemId;                    // hexagramas, grietas, constelaciones, visión, sueño, vuelo de aves
  signs: SymbolId[];                         // los símbolos concretos que aparecieron (de un vocabulario en `content/`)
}

interface Interpretation {
  reading: ReadingId;
  interpreter: PersonId;                     // puede no ser quien leyó
  claims: Belief[];                          // lo que el intérprete concluye y dice (information)
  bias: InterpretationBias[];                // dogma de escuela, interés propio, lo que el cliente quiere oír, miedo
}
```

- **Codificar:** las proposiciones leídas (con su ruido) se traducen a los símbolos del sistema del método con tablas de `content/` por cultura: cada símbolo cubre un abanico de significados ("agua sobre fuego": conflicto, cambio, ruina de un orden). La traducción pierde precisión a propósito: el lenguaje simbólico es ambiguo.
- **Interpretar:** es una hipótesis (discovery §2): el intérprete elige un sentido entre los posibles según su conocimiento, su escuela, sus intereses y lo que el cliente parece querer. Dos adivinos con la misma lectura pueden decir cosas opuestas.
- **El ritual también produce símbolos:** el método ritual saca símbolos del azar del instrumento; se interpretan igual. Desde adentro, un oráculo ritual y uno real se ven parecidos; la diferencia está en las proposiciones que hay detrás (ninguna, en el ritual).
- **El narrador** recibe el `Omen` y, si corresponde, lo que el personaje interpreta o le dicen; nunca las `propositions`.

## 5. Profecías

Una profecía es una **interpretación dicha** que se vuelve creencia y viaja.

- **Nace con un linaje:** quién la dijo, a quién, en qué palabras (information §3: linaje del rumor). Se deforma al contarse: se vuelve más clara, más dramática, se adapta a quien la cuenta, se mezcla con otras.
- **Mueve utilidades:** "el hijo de esta casa derrocará al rey" cambia lo que el rey cree y hace (npc-psychology): mata niños, exilia familias, casa a su hija con el candidato, se prepara. Y cambia lo que hacen los demás: los rebeldes buscan al niño, los ambiciosos se hacen pasar por él.
- **Se cumple sola:** porque la gente actúa como si fuera cierta (el niño exiliado crece con odio, los rebeldes lo encuentran, el ejército lo sigue porque cree en la profecía). El motor no fuerza nada: salen de las acciones.
- **Provoca lo que quería evitar:** el intento de evitarla produce las condiciones que la cumplen. Son los casos más memorables y entran fuerte a la historia (deep-history).
- **Se frustra:** muchas no se cumplen. Las culturas tienen formas de explicarlo (se interpretó mal, se cumplió de otra forma, alguien la evitó con virtud), y la memoria colectiva recuerda los aciertos y olvida los fallos (information §9: sesgo de confirmación en reputación).
- **Fabricadas:** un intrigante puede inventar una profecía, comprar a un adivino o plantar un presagio (enterrar una piedra con una inscripción para que la "encuentren"). Son intrigas (schemes) que funcionan sobre creencias igual que las verdaderas.
- **Duran:** las profecías grandes se vuelven legados (deep-history: conocimiento) y mitos (living-world §4); pueden esperar siglos a que alguien encaje en ellas o decida encajar.

## 6. Costo, reacción y velos

```ts
interface BacklashRule {
  when: "read_stronger" | "read_heaven_matter" | "read_large_subject" | "read_veiled" | "custom";
  effect: "soul_injury" | "lifespan" | "karma" | "heaven_attention" | "madness" | "custom";
  magnitude: Fn;                             // según diferencia de poder, tamaño del sujeto y horizonte
}
```

- **Leer a alguien más fuerte** es tocarlo: puede sentirlo, devolver el golpe al alma del lector, o mostrarle algo falso a propósito.
- **Asuntos del Cielo:** el destino de un reino, la tribulación de un poderoso, la fecha de una calamidad grande. En la familia xianxia el Cielo vela esos asuntos y castiga al que insiste: heridas del alma, años de vida, atención que después pesa en su propia tribulación (heaven-karma). Por eso los grandes adivinos son raros, viejos antes de tiempo, o mueren de golpe.
- **Velos:** artefactos, formaciones y técnicas que ocultan hilos kármicos o la ubicación; barreras de reinos secretos (secret-realms §9); poderosos que borran sus rastros. Lo velado aparece como hueco o como ruido en la lectura.
- **Costo material:** caparazones, incienso, sangre, piedras espirituales, tiempo de meditación. El oficio tiene su economía.

## 7. Presagios naturales

- **Eventos físicos leídos como mensajes:** eclipses, cometas, terremotos, inundaciones, nacimientos raros, bestias que bajan de las montañas. Tienen causa física (planet-gen, living-world), y las culturas que creen en mensajes del Cielo los leen como juicio (state §8: legitimidad).
- **El Cielo real no manda presagios** en la familia xianxia (heaven-karma: no elige dinastías ni habla). Pero algunas de sus acciones **sí son visibles**: las nubes de tribulación, la calamidad que cae sobre un sobreexplotador. Son señales verdaderas de algo que está pasando, no del futuro, y se mezclan en la cultura con todo lo demás.
- **Presagios de batalla y de viaje:** aves, sueños, el estandarte que se cae. Pesan en la moral (war §4) por lo que la gente cree.
- **Plantar presagios** es una herramienta política conocida: una piedra inscripta, un "dragón" visto en el río, un cometa interpretado a favor.

## 8. Adivinos en la sociedad

- **Astrólogos de la corte:** calculan calendarios (pronóstico real), eligen fechas, interpretan presagios para el soberano (state §8). Están bajo presión política: decir lo que el poder quiere oír o arriesgar el puesto y la cabeza. Su interpretación es parte de la política de la corte.
- **Oráculos de templo:** instituciones con reputación de siglos (organizations), a veces sobre un espíritu real (spirits: un espíritu de lugar que sabe cosas de su región), a veces ritual puro. Venden consultas, reciben ofrendas, influyen en guerras y casamientos.
- **Salones de adivinación de secta:** lectura metafísica real, cara, reservada para la secta o para clientes importantes. Saben más de lo que dicen.
- **Adivinos de calle:** lectura en frío, ritual, un poco de suerte. Algunos estafan, algunos ayudan, algunos tienen un don real sin entrenar.
- **Reputación:** sube con los aciertos recordados y baja con los fallos que se notan (information §9). Como los aciertos se cuentan más que los fallos, los adivinos con buena reputación no son necesariamente buenos.
- **Ley:** hay culturas que prohíben la adivinación privada sobre el soberano (es traición), que castigan a los falsos profetas, o que aceptan la lectura de karma como prueba en un juicio (law). Lo que se acepta depende de la cultura, no de la verdad del método.

## 9. El jugador y el narrador
- **El jugador puede consultar:** a un adivino de calle, un oráculo, un salón de secta, un astrólogo. Recibe símbolos y una interpretación, nunca la verdad directa. Puede no saber si le leyeron algo real o un ritual.
- **Puede aprender a adivinar:** pronóstico por conocimiento (con discovery), técnicas metafísicas si el mundo las tiene y su camino lo permite, o el oficio de la lectura en frío. Sus lecturas pagan los mismos costos y reacciones.
- **Puede ser objeto de profecías:** contadas sobre él, verdaderas o fabricadas. Lo que haga con ellas es parte de su vida, y lo que otros hagan por ellas también.
- **Puede fabricar:** plantar presagios, comprar adivinos, inventar profecías para mover a la gente.
- **El narrador** describe la escena y los símbolos (el humo, las grietas, la cara del adivino, el sueño) y lo que el personaje entiende o le dicen. Nunca agrega significado, ni confirma que una profecía sea verdadera, ni insinúa lo que la lectura "realmente" quería decir.

## 10. Escala (LOD)
- **Tier 0:** profecías como legados y creencias agregadas por cultura (cuánto se cree en cada método, profecías vivas y a qué grupos afectan). Las consultas de los poderosos que deciden asuntos grandes se resuelven como modificadores de creencia en la deliberación (organizations §4).
- **Tier 1-2:** adivinos concretos con su método y su reputación; lecturas metafísicas resueltas con proyecciones cortas y baratas.
- **Tier 3-4:** lecturas del jugador o hechas cerca de él, con proyección completa hasta el horizonte del método.
- **Costo de cómputo:** las proyecciones del futuro corren el modelo agregado con horizonte y número de corridas limitados por tier; los resultados se guardan por (sujeto, horizonte, tick) para no recalcular.

## Implementación
- **Fase 2:** profecías como creencias con linaje (information) que cambian utilidades de NPCs; adivinos de calle (ritual, lectura en frío).
- **Fase 4:** lectura de karma como técnica (proposiciones con ruido, velos, reacción); símbolos e interpretación con vocabularios por cultura en `content/`.
- **Fase 6:** oráculos y salones de adivinación como instituciones; astrólogos de corte bajo presión política; lectura de karma como prueba (law).
- **Fase 7:** pronóstico por conocimiento (calendarios, ciclos) como discovery; presagios naturales en la legitimidad; profecías como legados en la historia agregada.
- **Fase 8:** proyección del futuro con el modelo agregado y forks propios; profecías fabricadas por intrigantes; reacción del Cielo sobre asuntos grandes.

## Tests
- **Sin destino:** dada una profecía leída, si los agentes involucrados actúan distinto, el resultado cambia; el motor no fuerza su cumplimiento.
- **No contamina:** correr una proyección del futuro no cambia el estado del mundo ni su RNG; dos corridas idénticas con y sin consulta (sin decirle nada a nadie) dan el mismo mundo.
- **Ritual sin verdad:** en la familia xianxia, los aciertos de un método puramente ritual no superan lo esperable por azar más lectura en frío.
- **Presiones claras:** la confianza de una proyección es mayor para sujetos con presiones fuertes y convergentes que para sujetos con presiones débiles.
- **Karma no se falsifica:** un hilo kármico leído existe en la verdad o es ruido marcado como incierto; nunca aparece un enlace fabricado.
- **Reacción:** leer a alguien dos umbrales más arriba produce daño al lector con probabilidad alta.
- **Autocumplimiento:** en corridas headless, una fracción de las profecías difundidas se cumple por las acciones que provocan (medible en el grafo causal).
- **Determinismo:** mismo seed, mismas acciones y mismas consultas → mismas lecturas, símbolos e interpretaciones.

## Decisiones tomadas en este borrador (revisables)
- El futuro no está escrito; la adivinación del futuro es una proyección de las presiones presentes, sin la reacción a la profecía.
- Tres fuentes distintas (conocimiento, metafísica, ritual) bajo una misma palabra cultural; solo las dos primeras leen la verdad.
- La lectura sale en símbolos de vocabularios por cultura; interpretar es formar hipótesis con sesgos.
- El karma se puede velar pero no falsificar.
- La proyección usa forks propios y no consume el RNG del mundo.
- El narrador solo describe símbolos y lo que el personaje entiende; nunca agrega significado.
- En la familia xianxia el Cielo vela sus asuntos y castiga a quien insiste; no manda presagios.

## Preguntas abiertas
- Calibración: ruido de la lectura según diferencia de poder, distancia temporal y tamaño del sujeto.
- Calibración: horizonte y número de corridas de la proyección por método y por tier (costo de cómputo).
- Calibración: magnitud de la reacción del Cielo por tipo de asunto.
- Calibración: ambigüedad de los vocabularios simbólicos (cuántos significados por símbolo).
- Calibración: fracción de profecías que se cumplen solas en corridas largas (que existan, sin que sean la norma).
