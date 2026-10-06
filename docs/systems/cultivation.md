# Cultivo

> Estado: **borrador de diseño**. Describe la `Practice` de la **familia xianxia** (cultivo interno con reinos y rupturas) sobre las interfaces genéricas de [metaphysics.md](metaphysics.md). Separa la **ley** (cómo funciona el cultivo de verdad en este mundo, generada por el seed) de las **escuelas** (cómo cada secta cree que funciona). Define talento, absorción, reinos, rupturas, técnicas como conocimiento, caminos, recursos, y cómo un espíritu cultiva o vuelve a tener cuerpo.

Depende de: [metaphysics.md](metaphysics.md) (ejes del mundo), [causality.md](causality.md) (el qi se conserva, se consume y se regenera), [planet-gen.md](planet-gen.md) (campo de qi, elementos, venas, tesoros), [heaven-karma.md](heaven-karma.md) (tribulaciones, límite de vida, karma), [body-health.md](body-health.md) (meridianos, dantian, daño, desviación, toxicidad de píldoras), [npc-psychology.md](npc-psychology.md) (corazón del Dao, demonios internos, el cultivo altera la psique), [perception.md](perception.md) (sentidos de Esencia y Alma, leer el cultivo ajeno), [information.md](information.md) (técnicas y manuales como información), [elements.md](elements.md) (relaciones entre elementos, tensión, raíces mutadas). Lo usan: [spirits.md](spirits.md), [living-world.md](living-world.md) (bestias que cultivan), [deep-history.md](deep-history.md), [discovery.md](discovery.md), [economy.md](economy.md), [organizations.md](organizations.md), y los futuros oficios y guerra.

## Principios
1. **El reino es cultura; el estado es física.** El mundo no tiene un campo `realm: "Foundation 3"`. Tiene un estado continuo del cuerpo y el alma (cuánta esencia, qué tan densa, qué estructuras se formaron). Los "reinos" con nombre son una clasificación que cada escuela hace encima, y puede estar equivocada.
2. **Todo el qi viene de algún lado.** Cultivar saca qi de una celda, de una piedra, de una píldora, de un tesoro o de otro ser. Nada se genera por subir de nivel (conservación, causality §3). Una secta grande agota su montaña.
3. **Saber cómo es poder.** Las técnicas son conocimiento con autor, copias, errores y secretos. Quien no tiene un método para cruzar un umbral no lo cruza, o lo cruza a ciegas y paga.
4. **El progreso es continuo y legible.** Sin disparadores secretos (VISION, principio 10): la velocidad sale de talento × técnica × entorno × recursos × mente × cuerpo, y entender esa física es habilidad legítima del jugador.
5. **Cada ruptura es una apuesta con causas.** La probabilidad de éxito y la forma del fracaso salen del estado (fundamento, preparación, karma, demonios internos, lugar, ayuda), no de una tabla.
6. **El poder no es un número.** Lo que alguien puede hacer depende de su estado, sus técnicas, su dominio, su comprensión, su cuerpo y su equipo. Dos cultivadores del "mismo reino" pueden ser muy distintos.
7. **Determinista.** `rng.fork("cultivation", entityId, eventId)`.

## 1. La ley del cultivo (verdad, generada por el seed)
El seed, dentro de la familia xianxia, genera una `CultivationLaw`: qué **umbrales físicos** existen, en qué orden, qué piden y qué cambian. Vive en `WorldTruth`; nadie la conoce entera.

```ts
interface CultivationLaw {
  paths: PathLaw[];                 // qi, cuerpo, alma, y los que el mundo tenga (sangre, espada, bestia...)
  elements: ElementSystem;          // cinco fases, ocho trigramas, yin/yang, o un sistema generado
  heavenStrength: number;           // del estado del Cielo (heaven-karma)
  worldCeiling: Record<PathId, number>; // umbral más alto alcanzable en este planeta y esta era
}

interface PathLaw {
  id: PathId;
  vessel: "meridians" | "body" | "soul" | "blood" | "weapon" | "core";   // dónde se acumula
  thresholds: Threshold[];          // la escalera real, de abajo hacia arriba
  compat: Record<PathId, number>;   // qué caminos se combinan bien, cuáles chocan
}

interface Threshold {
  id: ThresholdId;
  index: number;
  kind: "saturation" | "phaseChange" | "structure" | "comprehension" | "soulBirth";
  requires: Requirement[];          // saturación, pureza, comprensión mínima, cuerpo, alma
  effects: ThresholdEffects;        // vida, capacidades, sentidos, necesidades, nuevas técnicas posibles
  transgression: number;            // cuánto ofende al Cielo: dispara tribulación si supera el umbral del mundo
  bottleneck: number;               // dificultad intrínseca del salto
}
```

- **Tipos de umbral.** *Saturación* (el recipiente se llena y se abre el siguiente meridiano), *cambio de fase* (el qi pasa de gas a líquido, de líquido a sólido: el dantian líquido, el núcleo), *estructura* (se forma algo nuevo: un alma naciente, un dominio), *comprensión* (no se cruza con más qi sino entendiendo una ley), *nacimiento del alma* (el alma puede existir separada del cuerpo).
- **La escalera varía por mundo.** Un mundo tiene 9 umbrales reales en el camino del qi y otro 6; uno pide comprensión desde el tercero y otro recién en el séptimo. El seed los genera con correlaciones que mantienen la familia reconocible (saturación al principio, estructuras en el medio, comprensión arriba).
- **Techo del mundo.** `worldCeiling` sale del presupuesto de qi del planeta y de la fuerza del Cielo: en un mundo de recuperación espiritual nadie pasa del tercer umbral, no porque esté prohibido sino porque no hay qi suficiente para llenarlo o porque la tribulación es imposible de sobrevivir. Cambia con la era (mareas de qi, heridas del Cielo).
- **Elementos.** El sistema elemental es parte de la ley: qué elementos hay, cómo se generan y se destruyen entre sí (detalle en [elements.md](elements.md)). El qi de cada celda (planet-gen) tiene un vector elemental.

## 2. Las escuelas (conocimiento, cultura)
Cada civilización y cada secta tiene un `CultivationSystem`: su propia escalera de **reinos con nombre**, cada uno con subniveles, mapeada (bien o mal) sobre los umbrales reales.

```ts
interface CultivationSystem {
  id: SystemId;
  originEventId: EventId;           // quién lo sistematizó, a partir de qué
  culture: CultureId;
  realms: { name: string; subLevels: number; believedThreshold?: ThresholdId; believedRequirements: Requirement[] }[];
  dogmas: Belief[];                 // creencias de escuela sobre la ley: algunas verdaderas, otras no
  believedCeiling: number;          // "nadie puede pasar del Alma Naciente"
}
```

- **Los nombres salen del generador de lenguas** de cada cultura. "Recolección de Qi 1-9" es un caso, no la regla.
- **Mapeos equivocados.** Una escuela puede partir un umbral real en dos reinos (cree que hay una barrera donde no la hay y pierde años), juntar dos en uno (sus discípulos se estrellan contra un umbral que no saben que existe) o creer en un techo que no es real. Corregir eso es descubrimiento ([discovery.md](discovery.md) §6) y puede fundar una escuela nueva.
- **Subniveles** son marcas de progreso dentro de un tramo (cuánto falta para saturar), útiles para la sociedad (rangos, exámenes, salarios de secta) aunque la física sea continua.
- **Escuelas rivales** dentro de la misma familia: una cultiva cuerpo primero, otra alma primero; ambas pueden funcionar con distintos costos. Las disputas doctrinales son conflictos reales (organizaciones, guerra).

## 3. Talento
Generado por el genoma ([family-lineage.md](family-lineage.md) §4) y a veces por eventos. Casi todo está oculto hasta que se mide o se manifiesta (VISION, principio 9).

```ts
interface Aptitude {
  roots: { element: ElementId; affinity: number }[];  // raíces espirituales: cuántas, cuáles, qué tan puras
  rootQuality: number;          // pureza general: raíz celestial (una, pura) ... raíz basura (cinco, mezcladas)
  meridianBase: number;         // ancho y conductancia innatos (body-health §12)
  comprehension: number;        // facilidad para entender leyes y técnicas (se suma a intellect de npc-psychology)
  soulBase: number;             // fuerza del alma de nacimiento
  constitution?: ConstitutionId;// cuerpos especiales (body-health §12)
  latent?: LatentTrait[];       // linajes dormidos, sangre de bestia, un alma reencarnada fuerte
}
```

- **Sin raíz, sin camino del qi.** Alguien sin raíces no absorbe qi ambiental, pero puede cultivar cuerpo, alma o caminos que el mundo tenga (no es "inútil": es otro camino, más duro).
- **El talento no es destino.** Comprensión, técnica, recursos, maestro, mente y suerte de la situación (estar cerca de una vena) pesan tanto como las raíces. Un genio sin recursos se estanca; un mediocre con una secta rica llega lejos y con fundamento flojo.
- **Medición.** Las sectas miden con objetos (piedras de prueba, espejos) que son percepción con instrumento: tienen precisión y errores (perception §8). Un talento raro puede no leerse con un instrumento común, o leerse mal ("raíz mixta inútil" que en realidad es una constitución rara).
- **Talento que cambia.** Tesoros, sangre de bestia, técnicas prohibidas, renacer o un accidente pueden mejorar o arruinar raíces y meridianos, siempre con un evento y un costo.

## 4. Estado del cultivador
Lo que la física mira. Extiende el `EssenceBodyState` de [body-health.md](body-health.md) §12.

```ts
interface CultivationState {
  paths: Record<PathId, PathState>;
  soul: { strength: number; integrity: number; senseRadius: number };  // perception: canal Alma
  insights: Insight[];               // comprensión de leyes (§9)
  techniques: KnownTechnique[];      // §8
  foundation: number;                // calidad acumulada de las rupturas (§7)
  karmaPressure: number;             // lectura del grafo kármico (heaven-karma), no un stock propio
  seclusion?: { since: Time; site: SiteId; plan: CultivationPlan };   // 闭关
}

interface PathState {
  crossed: ThresholdId[];            // umbrales reales cruzados
  essence: number;                   // cuánto hay acumulado en el recipiente de este camino
  capacity: number;                  // cuánto entra antes de saturar
  purity: number;                    // impurezas acumuladas bajan la pureza
  density: number;                   // qué tan comprimido está (sube hacia un cambio de fase)
  elementMix: ElementVector;         // elementos absorbidos; un desequilibrio fuerte es riesgo
  bottleneck?: { threshold: ThresholdId; readiness: number };  // estar listo para intentar
}
```

## 5. Absorción y refinamiento
Cultivar es una acción larga (horas a años) que mueve esencia de una fuente al recipiente y la refina.

- **Tasa de absorción** = qi disponible en la fuente × coincidencia elemental (raíces vs elementos del qi) × eficiencia de la técnica × conductancia de meridianos × concentración (estado mental: calma, emociones, dolor; npc-psychology y body-health) × factores del lugar (formaciones de concentración, cueva sobre una vena).
- **El qi sale de la fuente.** El qi absorbido se resta de la celda (planet-gen) o del objeto. Diez discípulos en la misma cueva compiten por el mismo qi; la secta que crece agota la vena (causality §3). Las sectas ricas tienen **formaciones de concentración** que traen qi de celdas vecinas: también es mover, no crear.
- **Fuentes:**
  - **Ambiental:** la celda; qi de venas, cuevas, picos; qi celeste según hora y fase lunar (planet-gen).
  - **Piedras espirituales:** qi cristalizado; se consumen. Son moneda ([economy.md](economy.md) §12), así que cultivar quema dinero.
  - **Píldoras:** qi refinado, más rápido pero con toxicidad residual (body-health §9).
  - **Tesoros y frutos:** cantidades grandes y concentradas, a veces con efectos especiales; riesgo de sobrecarga.
  - **Otros seres:** devorar (técnicas demoníacas que absorben el qi o la sangre de otros: rápido, impuro, mucho karma), cultivo dual (§10), núcleos de bestia.
- **Refinamiento.** Lo absorbido entra con **impurezas** (elementos que no coinciden, residuos de píldoras, qi demoníaco). Refinar es tiempo de meditación que convierte esencia impura en pura, con pérdida (el resto vuelve al ambiente: conservación). Acumular sin refinar da volumen rápido y baja la pureza, lo que después cobra en las rupturas.
- **Desequilibrio elemental.** Absorber mucho de un elemento contrario a tus raíces daña meridianos o desestabiliza (body-health §12, desviación). Es la tensión del `elementMix` ([elements.md](elements.md) §4), y daña primero los órganos de los elementos en conflicto ([elements.md](elements.md) §7). Un buen maestro elige la cueva por su elemento.
- **Interrupciones.** Ser interrumpido en una fase sensible (un ataque durante la reclusión, un ruido en el momento de compresión) puede causar retroceso o desviación. Por eso los cultivadores protegen sus reclusiones y por eso emboscarlos ahí es una intriga clásica (schemes).

## 6. Rupturas
Cruzar un umbral real es un **evento** con preparación, intento y resultado.

```ts
interface BreakthroughAttempt {
  cultivator: EntityId;
  threshold: ThresholdId;
  site: SiteId;
  preparation: {
    readiness: number;          // saturación, densidad, pureza vs requisitos del umbral
    method: TechniqueId | null; // ¿tiene un método que cubra este umbral? (sin método: a ciegas)
    aids: ItemId[];             // píldoras de ruptura, tesoros, formaciones de protección
    guardians: EntityId[];      // quién lo protege (y comparte karma si hay tribulación)
    timing?: CelestialEvent;    // luna llena, conjunción: favorece ciertos elementos
  };
  mind: { daoHeart: number; demons: InnerDemonRef[] };  // npc-psychology §9
  body: { meridianDamage: number; residues: number; health: number };
  outcome?: BreakthroughOutcome;
}

type BreakthroughOutcome =
  | { kind: "success"; quality: number }      // la calidad suma al fundamento
  | { kind: "stalled" }                       // no pasó; se puede reintentar después
  | { kind: "backlash"; damage: Injury[] }    // retroceso: pierde esencia, daña meridianos
  | { kind: "deviation"; state: DeviationState }   // body-health §12
  | { kind: "crippled" }                      // pierde el camino (dantian roto)
  | { kind: "death" };
```

- **La probabilidad sale del estado:** preparación vs dificultad del umbral, más método, ayudas, mente (los demonios internos atacan en la ruptura, heaven-karma), cuerpo, lugar y protección. El azar decide dentro de esa distribución.
- **Calidad del éxito.** No todo éxito es igual: una ruptura forzada con píldoras pasa con calidad baja; una con preparación perfecta, en el lugar ideal, con la mente limpia, pasa con calidad alta. La calidad se acumula en el **fundamento** (§7).
- **Pruebas del corazón.** En los umbrales de tipo comprensión o estructura, la ruptura incluye una prueba mental: los demonios internos (npc-psychology §9) se manifiestan con las memorias y culpas reales del cultivador. Para el jugador es una escena narrada desde su propia historia; para un NPC, una resolución con su psicología.
- **Tribulaciones** ([heaven-karma.md](heaven-karma.md)). Si `transgression` del umbral supera el umbral del Cielo, el intento dispara una tribulación: un evento físico (rayos, fuego del corazón, viento que disuelve) cuya fuerza sale de tamaño del salto, karma, talento, atención del Cielo en la región ([heaven-karma.md](heaven-karma.md) §3, §5: atención finita, olas con energía del campo, interceptar el rayo). Es **visible desde lejos** (perception: un fenómeno enorme que todos ven), atrae curiosos, oportunistas y enemigos, y su resultado se suma al de la ruptura. Formaciones, tesoros y guardianes ayudan; quien ayuda comparte karma y riesgo.
- **Elegir cuándo y dónde** es estrategia: esperar a estar mejor preparado cuesta años de vida; romper en el propio territorio es seguro, pero la tribulación puede arrasar tu secta; romper lejos te expone.
- **Fenómenos.** Algunas rupturas de calidad muy alta producen fenómenos visibles (qi que se arremolina, aves que llegan, flores que abren): son consecuencias físicas del qi movido de golpe, percibibles por otros, y hacen correr rumores ("nació un genio en el valle").

## 7. Fundamento
- **Qué es:** la calidad acumulada de cada ruptura y de la pureza de lo cultivado. Es estado, no un adjetivo.
- **Qué hace:** sube la probabilidad y la calidad de rupturas futuras, el techo personal, la estabilidad ante desviaciones, la eficiencia de las técnicas.
- **Cómo se arruina:** apurar con píldoras, saltar sin método, acumular impurezas, rupturas fallidas, daño a meridianos.
- **Cómo se repara:** dispersar el cultivo y volver a empezar (散功, §13), tesoros raros, técnicas de purificación, años de reclusión. Siempre caro.
- La tensión central de todo cultivador: **rápido o sólido**. La vida es corta; el fundamento flojo se paga arriba.

## 8. Técnicas como conocimiento
Una técnica es una entidad de conocimiento con autor e historia; un manual es un **objeto** que la contiene (o contiene una versión de ella).

```ts
interface Technique {
  id: TechniqueId;
  originEventId: EventId;                // quién la creó y a partir de qué (descubrimiento, iluminación, otra técnica)
  author: EntityId;
  ancestor?: TechniqueId;                // variante, mejora o versión corrupta de otra
  kind: "method" | "combat" | "movement" | "sense" | "concealment" | "body" | "soul"
      | "craft" | "formation" | "secret";  // método de cultivo, arte marcial, oficio (alquimia, forja)...
  path: PathId;
  elements: ElementVector;
  coverage?: [ThresholdId, ThresholdId];  // un método de cultivo cubre un tramo de la escalera
  efficiency: number;
  requirements: Requirement[];           // raíces, umbral mínimo, constitución, otra técnica
  effects: TechniqueEffect[];            // qué permite hacer, cuánto cuesta, qué emite (perception: firma de técnica)
  psyche?: PsycheModifier[];             // npc-psychology §9b (supresión emocional, amplificación...)
  flaws: Flaw[];                         // errores reales del autor: riesgo oculto, techo, toxicidad
  complexity: number;                    // cuánto cuesta aprenderla
}

interface KnownTechnique {
  technique: TechniqueId;
  version: TechniqueCopyId;              // la versión que aprendió (puede tener errores)
  understanding: number;                 // qué tanto la entiende
  proficiency: number;                   // qué tanto la domina por práctica
  learnedAt: EventId;                    // de quién, cuándo
}
```

- **Aprender** es una acción larga: tiempo × complejidad / (comprensión × calidad de la enseñanza). Un maestro presente enseña mejor que un manual; un manual mal copiado enseña errores.
- **Copias y errores.** Cada copia de un manual puede perder, agregar o deformar partes (como los rumores en information.md, pero con texto). Una técnica aprendida de una copia defectuosa funciona hasta que el error importa (toxicidad, techo, desviación en un tramo).
- **Técnicas incompletas.** Un manual puede cubrir solo los primeros umbrales ("la primera mitad del Sutra del Río"), y la segunda parte es una búsqueda: está en otra secta, en una ruina, en la memoria de un remanente de alma (spirits).
- **Secretos.** Las técnicas núcleo de una secta son secretos (information: secretos, juramentos). Robarlas o filtrarlas crea karma, enemigos y persecuciones. Las sectas sellan manuales (cifrados, sellos de alma, restricciones que matan a quien lee sin permiso).
- **Firma.** Usar una técnica emite una firma reconocible (perception §7): sirve para identificar a alguien, para incriminar a otro usando su técnica, para rastrear un linaje de secta.
- **Dominio.** La práctica sube `proficiency`; a cierto dominio la técnica se usa más rápido, con menos costo, y puede **adaptarse**. Variaciones nuevas son descubrimiento ([discovery.md](discovery.md) §10), y una variante buena puede volverse técnica propia, con el practicante como autor.
- **Compatibilidad.** Practicar técnicas de elementos o caminos que chocan entre sí baja la eficiencia o daña (como el desequilibrio elemental). Un método de cultivo principal suele ser exclusivo.

## 9. Comprensión: insights y leyes
- **Qué son.** `Insight { law: LawAspectId; depth: number; originEventId }`: comprensión de un aspecto de la ley (el agua que fluye, el filo, la muerte, el espacio). Los umbrales altos piden comprensión además de esencia.
- **De dónde salen.** De la experiencia (pelear mil veces con espada, ver morir a alguien, vivir junto a una cascada), de contemplar obras con intención (pinturas, caligrafías, restos de batallas de grandes cultivadores), de la meditación y de la iluminación (悟), que es el umbral de un estado acumulado. El mecanismo (acumulación, integración, fidelidad, iluminación y contemplación de obras) está en [discovery.md](discovery.md) §7-9.
- **Qué dan.** Intención (剑意, la espada que corta más allá del filo), dominio en técnicas del mismo aspecto, rupturas de tipo comprensión, y a muy alto nivel la capacidad de crear técnicas o leyes locales (dominios).
- **No se transmiten como texto.** Se puede enseñar el camino hacia una comprensión, no la comprensión en sí. Por eso un maestro sabio vale más que un manual.

## 10. Caminos
Cada mundo xianxia tiene uno o más caminos de la lista (o generados); comparten las mecánicas de arriba con su propio recipiente.

- **Qi (meridianos y dantian).** El camino estándar: absorber, refinar, comprimir, formar núcleo, alma naciente…
- **Cuerpo.** Templar piel, carne, huesos, médula y sangre (body-health §12). Lento, doloroso, consume recursos de bestias y hierbas; da cuerpos casi indestructibles y longevidad menor que el qi. Sirve a quien no tiene raíces.
- **Alma.** Fortalecer el alma y el sentido espiritual (神识): percepción enorme, resistencia mental, ataques al alma, y un alma que sobrevive mejor a la muerte (spirits). Riesgo: dañar el alma es difícil de curar.
- **Demoníaco / de sangre.** Fuentes vitales ajenas: devorar qi, sangre o almas. Rápido, impuro, con amplificación de emociones (npc-psychology §9b), mucho karma y tribulaciones más fuertes. Las "sectas demoníacas" son las que lo practican; la sociedad las persigue y las desea.
- **Cultivo dual.** Técnicas para cultivar en pareja, compartiendo y refinando qi: puede ser simbiótico (los dos ganan, crea un vínculo kármico fuerte) o parasitario (uno drena al otro). Se modela como intercambio de esencia con conservación; sin detalle explícito en la narración.
- **Arma / intención.** Cultivar a través de un arma, que se vuelve parte del recipiente (espíritu de objeto, spirits.md). Perder el arma es una herida.
- **Bestias.** Las bestias cultivan por su propio camino: acumulan qi en un **núcleo** con instinto en lugar de técnica (living-world). El núcleo es lo que los humanos les arrancan.
- **Combinaciones.** Cultivar dos caminos es posible si su compatibilidad lo permite; cuesta más tiempo y recursos y da cultivadores raros y completos.

## 11. Lo que da el cultivo
Cada umbral cruzado aplica sus `effects`, siempre como cambios a sistemas existentes:

- **Vida:** extiende el límite de vida (heaven-karma) según el umbral.
- **Cuerpo:** capacidades (body-health §3), resistencia a enfermedades, menos necesidad de comida y sueño, curación más rápida.
- **Sentidos:** radios de Esencia y Alma (perception §1), sentir qi ambiental, leer el cultivo ajeno.
- **Técnicas posibles:** volar (en el umbral que el mundo defina), proyectar qi, guardar cosas en espacios (anillos de almacenamiento si el mundo lo permite), ataques del alma.
- **Psique:** la distancia de escala (npc-psychology: el círculo moral se achica), la paciencia de quien vive siglos, la soledad.
- **El poder en combate** ([war.md](war.md) §8) se calcula de todo eso junto: umbrales, esencia disponible, técnicas y dominio, comprensión, cuerpo, equipo, estado. Ganarle a alguien de un umbral más alto es posible con mejor técnica, emboscada o un tesoro; dos umbrales arriba casi nunca.

## 12. Recursos y lugares
- **Cuevas de cultivo (洞府):** lugares sobre venas o puntos de acumulación. Son escasas, se heredan, se compran, se pelean. Dónde vive un cultivador es una decisión de recursos.
- **Piedras espirituales, píldoras, hierbas, tesoros, núcleos:** cada uno tiene origen, cantidad y precio ([economy.md](economy.md), [crafts.md](crafts.md)). La economía del cultivo es la economía del mundo para la gente con poder.
- **Formaciones:** concentrar qi, proteger, ocultar. Son artificio ([crafts.md](crafts.md) §6), consumen piedras y se gastan.
- **El tiempo como recurso:** una reclusión de diez años es diez años en que el mundo sigue sin vos (tu familia envejece, tus enemigos crecen, tu secta cambia). El mundo no espera.

## 13. Perder, dispersar y transferir
- **Lisiado (废人):** dantian roto o meridianos destruidos (body-health §12). Se pierde el camino; queda el cuerpo de un mortal (más algo de longevidad ya ganada, que puede volverse una condena). Recuperarse es una búsqueda larga.
- **Dispersar el cultivo (散功):** decisión voluntaria de deshacer lo acumulado para reconstruir con mejor fundamento o cambiar de método. La esencia liberada vuelve al ambiente (conservación) o se le pasa a alguien.
- **Transferir (传功):** dar esencia a otro (maestro a discípulo, padre a hijo). Hay **pérdida** en la transferencia y el receptor recibe esencia impura para él (no coincide con sus raíces). Sube rápido y con fundamento flojo; el clásico regalo envenenado.
- **Sellar el cultivo:** técnicas o artefactos que bloquean meridianos (body-health: `blocked`). Prisiones de cultivadores, castigos de secta, maldiciones.

## 14. Espíritus: cultivar sin cuerpo y volver a tener uno
(Cierra la pregunta abierta de [spirits.md](spirits.md).)

### Cultivar como espíritu
- **Camino del alma sin recipiente corporal.** Un espíritu solo puede cultivar el camino del alma (y caminos que el mundo defina para seres sin cuerpo). Se alimenta de **qi yin** (zonas yin, cementerios, noche), de **emociones** o de **otras almas** (devorar: mucho karma).
- **Techo propio.** Sin cuerpo no cruza los umbrales que piden cuerpo; puede cruzar umbrales de alma y llegar a ser un espíritu muy poderoso (rey fantasma), pero siempre atado a su ancla o a un sustento.
- **El Cielo los ve peor:** un espíritu que cultiva desafía el ciclo dos veces. Sus tribulaciones son más duras.

### Volver a tener cuerpo
Todas las vías cuestan algo real y quedan registradas con sus causas:

| Vía | Cómo | Costo y riesgo |
|---|---|---|
| **Posesión** | Entrar en un cuerpo vivo y pelear con su alma (duelo de almas) | Karma enorme si se destruye al dueño; el cuerpo puede rechazarlo (incompatibilidad); el alma vencida puede quedar como demonio interno |
| **Cuerpo vacío** | Un cuerpo cuya alma ya salió: recién muerto, en coma de alma, nacido sin alma (si el mundo lo permite) | Hay que llegar a tiempo; el cuerpo trae sus heridas, su enfermedad y su vida (familia, enemigos, deudas) |
| **Cuerpo construido** | Reconstruir un cuerpo con tesoros (raíz de loto, madera milenaria, sangre de bestia) y una técnica | Carísimo; el cuerpo nuevo empieza con talento según los materiales; es la búsqueda de siglos de un remanente de alma |
| **Renacer a propósito** | Entrar en una concepción resistiendo las Fuentes (spirits: almas fuertes eligen) | Se renace bebé; los recuerdos quedan sellados y vuelven por disparadores; el karma se lava solo si se cruzan las Fuentes, no si se las evita |

- **El cuerpo nuevo no trae el cultivo viejo.** El alma conserva su fuerza y su comprensión; los meridianos, el dantian y el templado corporal se reconstruyen desde cero (spirits: saber no es poder hacer). Saber el camino acelera mucho.
- **Técnicas de reencarnación preparadas en vida:** sellos en el alma, jades de memoria, un ancla puesta en un linaje o en un lugar, un discípulo que custodia el renacer. Son los caminos para llegar a las vías de arriba sin perder el alma en el intento; se descubren, se aprenden y se pueden sabotear.
- **Por qué se buscan:** cruzar las Fuentes cobra lo que el alma le tomó al Cielo ([heaven-karma.md](heaven-karma.md), cobro en las Fuentes). Para un cultivador alto, cruzar es perder casi todo o disolverse; evadir es la única forma de seguir siendo él, a costa de que su karma siga abierto.
- **Para el jugador** estas vías son la única forma de seguir la partida después de morir: cruzar las Fuentes siempre la termina ([spirits.md](spirits.md) §3e). No hay "continuar" gratis.

## 15. El cultivador en la sociedad y en el tiempo
- **Reclusión (闭关)** es el estado normal de un cultivador fuerte: desaparece años. Su ausencia es un hecho social (su secta lo cubre, sus enemigos lo aprovechan, sus discípulos lo esperan).
- **Necesidad de cultivo** (`cultivation` en las necesidades de npc-psychology) compite con todo lo demás: un cultivador ambicioso sacrifica familia, amigos y moral por recursos.
- **Maestro y discípulo:** vínculo kármico (heaven-karma), transmisión de técnicas y comprensión, protección, obligación. Detalle en [organizations.md](organizations.md) §9.
- **Pruebas de ingreso de sectas, rangos, sueldos en piedras, misiones:** son organizaciones y economía usando los reinos culturales como escala.
- **La longevidad separa:** quien rompe un umbral que alarga la vida ve envejecer y morir a todos los que conocía (npc-psychology: distancia, anclas).

## 16. El jugador y el narrador
- **Sin números.** El jugador siente su estado: el dantian lleno, una presión que no termina de romper (el cuello de botella), qi que se resiste por ser de otro elemento, la sensación de que "falta algo" (un umbral de comprensión). El vocabulario de reinos que use el narrador es el de la **escuela que el personaje conoce**, no el de la ley.
- **El jugador puede descubrir que su escuela se equivoca** y aprovecharlo. Es el juego de entender la física del mundo.
- **Acciones de cultivo** ("me encierro tres meses en la cueva", "intento romper", "practico la espada todos los días") se resuelven en la sim; el LLM no decide si funcionan.
- **Inspector god-mode:** muestra la ley, los umbrales reales y el estado.

## 17. Escala (LOD)
- **Tier 4:** absorción por hora o día, rupturas completas con escena, pruebas del corazón narradas.
- **Tier 3:** cultivo por semana o mes con fórmulas cerradas; rupturas como eventos completos (sin escena).
- **Tier 2:** progreso por año: umbral cruzado y fundamento como resumen; rupturas resueltas con una tirada sobre el estado.
- **Tier 0-1 y simulación histórica:** pirámide de cultivadores por asentamiento, secta y región (cuántos en cada umbral), con tasas de ruptura, muerte y consumo de qi que salen del estado (qi disponible, técnicas que la población conoce, recursos). El consumo agregado de qi se descuenta de las celdas igual que el individual.
- **Materialización:** un cultivador generado desde la pirámide recibe un estado coherente (umbral, fundamento, técnicas de su escuela, historial de rupturas compatible).

## Implementación
- **Fase 4 (cultivo):** `CultivationLaw` con un camino (qi) y escalera generada; un `CultivationSystem` por cultura; raíces y talento; absorción con conservación desde la celda; refinamiento y pureza; rupturas con preparación, calidad y fundamento; técnicas y manuales con copias; tribulaciones básicas; percepción del cultivo ajeno.
- **Fase 4b:** caminos de cuerpo y alma, insights, pruebas del corazón con demonios internos, cultivo dual, demoníaco.
- **Fase 6 (organizaciones):** sectas con técnicas secretas, pruebas de ingreso, cuevas como recursos, maestros y discípulos.
- **Fase 7 (historia):** pirámides agregadas, escuelas que nacen y se equivocan, técnicas perdidas, sectas que agotan sus venas.
- **Más adelante:** espíritus que cultivan, volver a tener cuerpo, combinaciones de caminos.

## Tests
- Determinismo: mismo seed y mismas acciones dan las mismas rupturas y los mismos resultados.
- Conservación: el qi absorbido se resta de la fuente; la suma del ledger de qi no cambia salvo por regeneración de fuentes y retorno al Cielo.
- Toda técnica tiene `originEventId` y autor; toda copia apunta a su original.
- Ningún cultivador cruza un umbral real sin cumplir sus requisitos (las escuelas pueden creer otra cosa).
- Monotonía: más preparación nunca baja la probabilidad de éxito de una ruptura.
- Ninguna escuela conoce la ley entera por defecto; el narrador usa los nombres de la escuela del personaje.
- Agregado: la pirámide de una región en tier 0 coincide en promedio con la de simular sus individuos.

## Decisiones tomadas en este borrador (revisables)
- Los reinos son clasificación cultural sobre umbrales físicos continuos; la ley la genera el seed.
- Absorción con conservación desde fuentes concretas; las piedras espirituales se consumen.
- El fundamento como calidad acumulada de rupturas: tensión entre rápido y sólido.
- Técnicas como entidades de conocimiento con copias defectuosas, secretos y firma.
- Los insights (comprensión de leyes) son un requisito propio de los umbrales altos y no se transmiten como texto.
- Los espíritus cultivan solo el camino del alma; volver a tener cuerpo es posesión, cuerpo vacío, cuerpo construido o renacer a propósito, y el cultivo corporal se pierde.

## Preguntas abiertas
- Calibración de tasas de absorción, dificultad de rupturas y longevidad por umbral para que la pirámide de cultivadores tenga una forma creíble (muchos abajo, pocos arriba) en cada era.
