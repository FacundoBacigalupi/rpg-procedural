# Cosmología y ascensión

> Principio: **el cosmos existe aunque el jugador nunca lo vea.** Más allá del planeta hay lugares, seres y flujos con reglas propias, y todo lo que baja, sube o se filtra al mundo tiene que cerrar sus cuentas: esencia, almas y causas. La sim no los simula en detalle, pero los lleva como cuentas agregadas con hechos fijados, para que un visitante de arriba, una reliquia caída o una ascensión tengan origen y consecuencias, y nunca sean un decorado.

> Estado: **borrador** (2026-10-06).

Depende de: [metaphysics.md](metaphysics.md) (ejes de la ley: fuente, ley superior, almas, familias), [heaven-karma.md](heaven-karma.md) §1, §5 (el Cielo como agente-ley, tribulación, cobro en las Fuentes, ascensión), [spirits.md](spirits.md) §3b (el ciclo y las Fuentes Amarillas), [cultivation.md](cultivation.md) §1 (umbrales, techo del mundo), [planet-gen.md](planet-gen.md) §0, §10 (sistema estelar, lunas, mareas de qi, impactos), [secret-realms.md](secret-realms.md) §1, §3 (bolsillos de espacio, barreras, energía), [causality.md](causality.md) (conservación, procedencia, presiones), [simulation.md](simulation.md) (LOD, materialización con hechos fijados, modo agregado).
Lo usan: [religion.md](religion.md) §13 (qué hay de verdad detrás de las doctrinas), [divination.md](divination.md) (astros, presagios), [weather.md](weather.md) §4 (calendarios, astros), [travel.md](travel.md) (navegar por las estrellas), [deep-history.md](deep-history.md) (ascensiones y visitantes en la historia), [player-loop.md](player-loop.md) §13 (ascender como final), [chronicle.md](chronicle.md) (lo que nunca supiste), [game-modes.md](game-modes.md) (dedos de oro de origen exterior).

---

## Principios

- **Cuentas que cierran.** La esencia que sale del planeta por una ascensión deja el presupuesto del mundo y entra en el de otro plano; la que trae un visitante sale de algún lado. Las almas del ciclo están en el ledger (spirits §3b). Nada aparece ni se pierde entre planos.
- **Agregado, no decorado.** Cada plano que el jugador no puede visitar se lleva como un estado resumido (esencia, población por poder, facciones con intereses en este mundo) que cambia con reglas simples. Cuando algo de ahí toca el mundo, se materializa con hechos fijados (simulation: materialización) y desde ese momento es una entidad como cualquier otra.
- **Causas, no sorpresas.** Ningún visitante, reliquia o grieta aparece por tabla. Bajan porque algo los trae (una deuda, un objeto, un sello que se debilita, una oración, un desgarro físico) y el azar solo elige entre lo que el estado permite (causality).
- **El jugador vive en un planeta.** La partida sucede en el mundo de abajo. Lo que hay arriba y abajo se percibe por sus efectos, se cree por relatos y se descubre por evidencia. La verdad completa está solo en el inspector y la crónica.
- **Varía por familia.** La estructura del cosmos sale de los ejes de metaphysics. Este doc fija la forma de cada familia y la versión xianxia base en detalle.

---

## 1. El modelo

```ts
interface Cosmos {
  family: WorldFamily;                       // metaphysics
  planes: PlaneId[];
  links: CosmicLink[];
  ledger: CosmicLedger;                      // §11
  originEventId: EventId;                    // la generación del mundo
}

interface Plane {
  id: PlaneId;
  kind: 'mortal-world' | 'upper-realm' | 'cycle' | 'underworld' | 'demonic' | 'divine' | 'elemental' | 'spirit-layer' | 'void' | 'lesser-world' | 'outside';  // spirit-layer: capa superpuesta al mundo (familia de los misterios)
  simulated: 'full' | 'aggregate' | 'facts-only';   // el planeta del jugador es el único 'full'
  essence: { stock: number; density: number; kind: EssenceKind };   // cuánto hay y qué tan concentrado
  ceiling: Record<PathId, number>;           // hasta qué umbral se sostiene un ser en este plano
  inhabitants: AggregatePopulation[];        // por especie y nivel de poder, en agregado
  factions: AggregateFaction[];              // los que tienen intereses en otros planos (§8)
  law?: LawOverrides;                        // diferencias de ley respecto del mundo de abajo
  timeRate: number;                          // 1 = mismo ritmo; solo se usa para los que vuelven (§8)
  facts: FactId[];                           // hechos fijados al tocar el mundo (simulation)
}

interface CosmicLink {
  from: PlaneId;
  to: PlaneId;
  kind: 'ascension-gate' | 'cycle-crossing' | 'seep' | 'rift' | 'summoning' | 'descent' | 'sealed';
  barrier: { strength: number; regen: number; thinSpots: CellId[] };  // §5
  cost: CrossingCost;                        // qué paga quien cruza (esencia, cuerpo, tribulación, sello)
  allowed: CrossingRule[];                   // quién puede pasar y en qué estado
  state: 'open' | 'cyclic' | 'sealed' | 'torn';
  originEventId: EventId;
}
```

- **Planos y enlaces.** El cosmos es un grafo: los planos son nodos y los enlaces son las formas de pasar (subir por la puerta de la ascensión, cruzar las Fuentes, filtrarse por una grieta, ser invocado).
- **Cada plano tiene su techo.** Un ser más fuerte que el techo de un plano no puede estar ahí sin suprimirse o sin que el plano lo rechace (§5). Esa regla explica por qué los inmortales de arriba no bajan a arreglar cosas.

## 2. El cielo visible

El cielo que ve cualquiera es la parte del cosmos más cercana y la única que todos comparten. Sale de planet-gen §0 y se calcula con mecánica orbital simple y determinista.

- **Sol y lunas** (planet-gen §0): días, estaciones, mareas, eclipses y fases, todos calculables. Son fuentes celestes de qi con elemento propio.
- **Estrellas fijas:** un catálogo generado con posición, brillo y color. Cada cultura arma sus constelaciones con su lengua y sus mitos (culture, language §9), y las mismas estrellas tienen nombres y figuras distintos en cada pueblo.
- **Planetas errantes:** otros cuerpos del sistema con períodos propios. Sus conjunciones son eventos calculables que la astrología lee (divination) y que, si la ley del mundo lo dice, mueven un poco el qi (elements §6).
- **Cometas y lluvias de meteoros:** cometas con período (algunos vuelven cada siglos y quedan en las crónicas) y lluvias anuales. Un cometa es un presagio para todos los pueblos que lo ven, con lecturas distintas (state §8: legitimidad).
- **Precesión y largo plazo:** el polo celeste se corre con los milenios y las mareas de qi siguen ciclos astronómicos largos (planet-gen §0). Un calendario viejo se desfasa y un astrónomo puede datar un texto por las estrellas que describe (deep-history §3).
- **Lo que cae:** meteoritos con hierro de cielo (material escaso y valioso en un planeta pobre en metal), a veces con esencia de otro plano si pasaron cerca de una grieta (§9).
- **Navegar y medir:** las estrellas sirven para orientarse en el mar y en el desierto (travel) y para medir el año (weather §4). Saberlo es una habilidad.

## 3. Estructura por familia

| Familia | Planos | Enlaces típicos |
|---|---|---|
| Xianxia | Mundo mortal, mundo superior (上界), el ciclo con las Fuentes Amarillas, el vacío, mundos menores; opcional: reino demoníaco, algo afuera | Puerta de ascensión, cruce del ciclo, grietas, bolsillos (secret-realms) |
| Alta fantasía occidental | Mundo, cielos de los dioses, infiernos o más allás con juicio, planos elementales | Invocación, portales, muerte con juicio, intervención divina |
| Fantasía oscura | Mundo, algo afuera que filtra poder y corrupción, quizás un más allá vacío | Pactos, grietas, posesión |
| Mitológica | Mundo con la montaña o el cielo de los dioses al alcance, inframundo | Dioses que bajan caminando, héroes que suben, viajes al inframundo |
| Rúnica | Solo el mundo; el resto es física | Ninguno, o grietas que son fenómenos físicos |
| Misterios ([mysteries.md](mysteries.md)) | Mundo, mundo espiritual superpuesto con profundidades, astral, espacios sellados por encima (opcionales), un más allá según el camino de la muerte, lo de afuera tras la barrera | Proyección del espíritu, rituales y rezos con nombres honoríficos, sueños, filtraciones de lo de afuera, descensos de dioses con costo |

- **Variantes por seed:** dentro de cada familia, los ejes cambian la estructura (un inframundo con economía, un ciclo que rechaza a los cultivadores, un dios muerto con su cadáver en el vacío; metaphysics §5, §6).
- **Hasta la Fase 7 solo existe xianxia** (metaphysics: decisiones). El resto de la tabla queda como forma a respetar cuando se agreguen las otras familias.

## 4. El cosmos xianxia base

- **El mundo mortal (下界):** el planeta del jugador, simulado completo. Su techo es `worldCeiling` (cultivation §1): ningún ser pasa del último umbral que el planeta puede sostener.
- **El Cielo:** no es un lugar sino la ley del planeta como agente (heaven-karma §1). Administra el ciclo, cobra en las Fuentes y custodia la puerta de la ascensión. Es local a este mundo: otros mundos tienen el suyo.
- **El ciclo y las Fuentes Amarillas:** un plano de paso (`cycle`), no un lugar donde se vive. Las almas cruzan, se les cobra y renacen (spirits §3b). Su ledger de almas es parte de la conservación.
- **El mundo superior (上界):** el plano adonde llegan los que ascienden. Tiene más esencia y un techo más alto, y en él los ascendidos son, otra vez, de los más débiles. Se lleva en agregado: cuánta esencia hay, cuántos ascendidos de este mundo llegaron y cuántos sobreviven, qué facciones tienen interés en el mundo de abajo.
- **El vacío (虚空):** lo que hay entre mundos. Sin qi utilizable, frío y sin dirección. Solo lo cruzan seres muy por encima del techo del planeta, o restos: fragmentos de mundos rotos, cadáveres de seres antiguos, artefactos perdidos.
- **Mundos menores:** otros planetas mortales con su propio Cielo, de los que a veces se cae alguien o algo por una grieta (§10).
- **Los reinos secretos** son bolsillos dentro del mundo mortal, no planos aparte (secret-realms §1). Usan las mismas reglas de barrera y energía.
- **Opcionales por seed:** un reino demoníaco (seres que viven de esencia corrupta y presionan contra la barrera), algo afuera (metaphysics §5), un inframundo con economía (metaphysics §6).

## 5. La barrera del mundo

- **Es física:** la frontera del planeta como plano. Tiene una fuerza que depende de la fuerza del Cielo (heaven-karma: Cielo fuerte, debilitado, en recuperación) y se repone sola con el tiempo.
- **Pone el techo:** un ser por encima del techo del planeta es empujado hacia afuera. Quien llega al último umbral siente esa presión y tiene que ascender, suprimirse o pagar con su cuerpo y su vida para quedarse (§6).
- **Contiene a los de afuera:** un visitante tiene que suprimirse por debajo del techo para entrar, y la barrera lo sigue empujando mientras esté adentro (§8).
- **Tiene lugares delgados:** donde se rompió antes (una batalla de inmortales, un impacto, una formación prohibida), donde el qi es muy denso o donde una grieta se cerró mal. Ahí se filtran cosas y los cultivadores de afuera entran más fácil (§9).
- **Se puede dañar:** batallas por encima del techo, formaciones enormes, sacrificios masivos o un ser que la empuja desde afuera. Un daño grande es un evento de época: el techo sube un tiempo (más fácil cultivar alto), entran cosas y el Cielo responde con calamidades mientras la repara.

## 6. Qué hay después del último umbral

- **El último umbral del planeta no es el último del cosmos.** La escalera de cultivation §1 sigue arriba con umbrales que este mundo no puede sostener. Nadie de abajo sabe cuántos son; las escuelas tienen teorías (cultivation §2).
- **Quien llega al techo tiene tres caminos:**
  - **Ascender** (§7): cruzar la puerta, con su tribulación y su costo.
  - **Quedarse suprimido:** contener su poder por debajo del techo. Cuesta esfuerzo constante, dolor y años de vida, y su límite de vida no se estira más. Muchos patriarcas viejos están así, esperando, protegiendo una secta o con miedo.
  - **Romper la barrera para quedarse:** muy raro, daña el mundo y atrae al Cielo con todo lo que tiene.
- **El techo puede bajar** en una era de recuperación del Cielo o de marea baja de qi. Los que estaban justo arriba quedan empujados afuera sin estar listos.

## 7. La ascensión como evento físico

```ts
interface Ascension {
  id: AscensionId;
  ascender: AgentId;
  at: CellId;
  gate: CosmicLinkId;
  preparation: Array<{ kind: 'formation' | 'artifact' | 'pill' | 'helpers' | 'karma-settlement'; ref: EntityId }>;
  tribulation: TribulationId;                // heaven-karma §5: la tribulación de ascensión, la más grande
  carried: Array<{ entity: EntityId; kind: 'body' | 'artifact' | 'soul-bound' | 'companion' }>;
  left: Array<{ entity: EntityId; to?: AgentId | OrgId }>;   // lo que deja: herencia, secta, deudas
  essenceOut: number;                        // lo que sale del presupuesto del planeta (ledger)
  outcome: 'ascended' | 'died' | 'body-lost' | 'stranded-in-void' | 'aborted';
  witnesses: AgentId[];
  causes: EventId[];
}
```

- **Requisitos reales:** haber cruzado el último umbral del planeta, que la puerta esté abierta o en su ciclo (en algunos mundos se abre con las mareas de qi o con conjunciones calculables; en un Cielo fuerte, casi nunca) y sobrevivir a la tribulación de ascensión.
- **La tribulación de ascensión** es la más grande (heaven-karma §5): visible desde muy lejos, con nubes que se juntan durante días. Se puede preparar (formaciones, artefactos, aliados) y, como toda tribulación, se puede robar o sabotear.
- **Lo que se lleva:** su cuerpo (si sobrevive), lo que esté atado a su alma y lo que la puerta deje pasar. Casi todo lo demás queda: tesoros, cuevas, discípulos, deudas, enemigos.
- **Conservación:** la esencia del ascendido y de lo que lleva sale del planeta. Una era con muchas ascensiones empobrece el mundo de qi. La tribulación descarga esencia que vuelve al entorno (heaven-karma §5).
- **Karma** (aprobado 2026-10-06): el karma neto no se salda al ascender como al cruzar las Fuentes. En la familia xianxia **queda en este mundo**: el Cielo lo cobra en lo que el ascendido dejó (su linaje, su secta, sus obras), así que ascender no es escapar. Que viaje con el ascendido es una variante de otras leyes de mundo.
- **Fracasos:** morir en la tribulación (y quizás quedar como espíritu, spirits §0), perder el cuerpo y llegar solo como alma, quedar varado en el vacío o abortar a mitad de camino con el cultivo destrozado. Todos dejan huellas.
- **Consecuencias en el mundo:** una secta sin su patriarca (organizations §12: sucesión), herencias en disputa, enemigos que aprovechan, un vacío de poder en la región (state §10), un mito y a veces un culto (religion §12), un lugar marcado donde el cielo se abrió.
- **Ascensiones fingidas:** alguien puede simular una ascensión para desaparecer (deudas, enemigos, una tribulación que sabe que no pasa). Sin tribulación ni esencia que sale, quien sepa leerlo nota que no fue real.
- **Variante oscura por seed** (aprobado 2026-10-06): en algunos mundos la ascensión es una trampa (los de arriba cosechan a los que suben, o la puerta los disuelve). Existe también en xianxia, rara (alrededor del 5% de esos mundos), y queda en el ledger como cualquier otra regla. Nadie de abajo lo sabe y no hay pistas obvias; un visitante o una reliquia pueden ser la primera, y si nadie la encuentra, la crónica lo revela en "lo que nunca supiste".

## 8. Visitantes de arriba

- **Bajar cuesta:** el visitante tiene que suprimirse por debajo del techo del planeta, la barrera lo empuja mientras esté y el Cielo de este mundo lo mira con desconfianza (heaven-karma §3: saliencia alta). Por eso casi nunca bajan, y cuando bajan, por poco tiempo o con un cuerpo prestado.
- **Formas de bajar:** en persona suprimido, un avatar o clon con una fracción de su poder, un mensaje o una voz (sueños, jades que caen), un objeto enviado, o poseer a alguien de abajo (con el costo y el riesgo de spirits §3c).
- **Muy raros** (aprobado 2026-10-06): unos pocos por milenio en todo el planeta, casi siempre suprimidos o en cuerpos prestados. Son hechos de época, no recursos de trama.
- **Siempre por una causa:** la sim no manda visitantes por tabla. Vienen por algo que el ledger registra: un ascendido que busca a su linaje o a su enemigo, una facción de arriba que quiere un objeto o una persona de abajo (un cuerpo con una constitución rara, un tesoro que nació en el planeta), un sello que se debilita y que alguien de arriba custodia, una deuda vieja. Mientras la causa no existe, nadie baja.
- **Ritmo de tiempo:** si el plano superior tiene otro ritmo (`timeRate`), un ascendido que vuelve encuentra un mundo que avanzó más o menos de lo que esperaba. Es un dato que se fija al materializarlo.
- **Lo que dejan:** un visitante trae información que nadie de abajo tiene (con sus mentiras), objetos por encima del techo (que el mundo empuja a degradarse) y consecuencias. Puede ser el maestro misterioso de una novela o un depredador.

## 9. Lo que se filtra desde abajo y desde afuera

- **Reino demoníaco y algo afuera** (si el seed los tiene): presionan contra la barrera desde su lado. Se filtran por lugares delgados como esencia corrupta, seres chicos, susurros a quien escucha, o como un gran ser cuando la barrera se rompe.
- **Sellos:** muchos lugares sellados (secret-realms §2: prisiones y sellos) tienen del otro lado algo de otro plano. Sostener el sello cuesta; romperlo suelta lo que hay.
- **Almas que vuelven:** espíritus que no cruzaron (spirits) y, en mundos con inframundo, muertos que el más allá devuelve o deja escapar.
- **Grietas espaciales:** desgarros por batallas, formaciones, impactos o mareas de qi. Conectan con el vacío o con un mundo menor. Se cierran solas con el tiempo; mientras están abiertas, entran viento sin qi, restos y a veces alguien.

## 10. Otros mundos y el vacío

- **Mundos menores** con su propio Cielo y su propia historia, llevados como hechos fijados: especie dominante, nivel de poder, qué tan lejos están. Sirven de origen a lo que cae por una grieta (un náufrago de otro mundo, un artefacto con otra ley elemental).
- **Restos en el vacío:** fragmentos de mundos rotos y cadáveres de seres antiguos que flotan entre mundos. A veces uno se acerca y lo que cae (un meteorito con esencia ajena, un trozo de tierra con plantas que nadie conoce) es un hallazgo de época.
- **Viajar entre mundos** es algo que solo hacen seres muy por encima del techo del planeta, y no le pasa al jugador como mortal o cultivador del mundo de abajo. Existe para que lo que llega tenga origen.
- **Transmigrados y reencarnados de otro mundo** (game-modes: dedos de oro de origen exterior): un alma que llega de otro mundo entra al ledger de almas por un enlace registrado, con su causa.

## 11. El ledger cósmico

```ts
interface CosmicLedger {
  essence: Record<PlaneId, number>;          // esencia por plano; los flujos entre planos se registran
  souls: Record<PlaneId, number>;            // almas en el mundo, en el ciclo, ascendidas, disueltas
  flows: Array<{ from: PlaneId; to: PlaneId; amount: number; kind: 'ascension' | 'descent' | 'seep' | 'toll' | 'rift'; event: EventId }>;
  ascended: Array<{ agent: AgentId; ascension: AscensionId; status: 'alive' | 'dead' | 'unknown-to-world' }>;
}
```

- **Invariantes:** la suma de esencia de todos los planos cambia solo por las fuentes y sumideros que la ley define (el Cielo que recicla, algo afuera que consume); las almas se conservan (spirits §3b); cada flujo tiene evento.
- **Evolución agregada:** los planos que no se simulan avanzan por época con reglas simples (el mundo superior gana esencia de las ascensiones, sus facciones cambian de interés, los ascendidos de este mundo mueren o suben). Así una visita dentro de mil años encuentra un estado que tiene sentido.
- **Hechos fijados:** todo lo que se decide de un plano al tocar el mundo (cómo es el ascendido que bajó, qué facción lo manda, qué hay del otro lado de un sello) queda fijo para siempre (simulation: materialización).

## 12. Creencias y descubrimiento

- **Lo que la gente cree** del cosmos es religión y cosmovisión (religion, culture: cosmovisión): cielos en capas, palacios de inmortales, infiernos con jueces, un más allá donde se reúnen los ancestros. Algunas creencias aciertan en algo, otras no.
- **Evidencias posibles:** registros de ascensiones (crónicas, testigos, lugares marcados), reliquias que no deberían existir abajo, visitantes y lo que cuentan, meteoritos con esencia ajena, lo que un cultivador siente al llegar al techo, sellos y lo que se filtra por ellos.
- **Descubrir** es discovery: hipótesis con evidencia sobre cuántos umbrales hay arriba, si la ascensión es segura o qué hay detrás de un sello. Se puede estar muy equivocado.

## 13. El jugador y el narrador

- **El narrador solo cuenta lo que el personaje percibe y cree:** una tribulación de ascensión vista de lejos, la presión del techo en el propio cuerpo, un visitante que habla de "arriba". Nunca describe planos que el personaje no vio.
- **Libertad total:** el jugador puede investigar el cosmos, buscar reliquias, abrir un sello, cazar a un visitante, preparar su propia ascensión, robar la tribulación de otro, fingir una ascensión o quedarse suprimido protegiendo lo suyo.
- **Ascender termina la vida en este mundo** (aprobado 2026-10-06). La partida sucede en el planeta. Cuando el personaje asciende, la vida termina como cuando cruza las Fuentes: escena del cruce como la percibe, y después la crónica (chronicle) y el epílogo del mundo sin él.

## 14. Escala (LOD)

| Resolución | Qué se simula |
|---|---|
| Escena | Tribulación de ascensión, visitante suprimido, grieta abierta, sello que cede, presión del techo |
| Local | Lugares delgados, cometas y eclipses vistos, reliquias caídas |
| Regional | Efectos de una ascensión (vacío de poder, mito, qi), cultos a ascendidos |
| Mundo | Barrera y techo del planeta, ledger de esencia y almas, astros |
| Historia | Ascensiones y visitas por época, daños a la barrera, grietas, planos que evolucionan en agregado |

- Los planos que no son el planeta no tienen tiers de agente: son agregados hasta que algo toca el mundo.

## 15. Implementación por fase

- **Fase 1:** sol y luna con días, fases y estaciones calculables; estrellas como catálogo mínimo (weather, calendarios).
- **Fase 4:** techo del planeta y presión al llegar a él; supresión; tribulación de ascensión y ascender como final de la partida; ledger de esencia con la salida de las ascensiones.
- **Fase 7:** ascensiones y visitas en la historia profunda, daños a la barrera, grietas y sellos, cometas y conjunciones en las crónicas, mundo superior en agregado.
- **Fase 8:** cosmos completo de la familia xianxia con planos opcionales por seed (reino demoníaco, algo afuera, inframundo con economía); estructura de las demás familias cuando entren.

## Tests

- **Determinismo:** mismo seed, mismo cosmos, mismos astros y mismos visitantes.
- **Conservación:** la esencia total entre planos y las almas cuadran después de cualquier secuencia de ascensiones, visitas y filtraciones.
- **Causa de cada cruce:** todo visitante, reliquia, grieta y ascensión tiene un evento con causas en el ledger.
- **Techo:** ningún ser del planeta queda por encima del techo sin supresión ni costo.
- **Astros calculables:** los eclipses y cometas predichos por el modelo ocurren cuando dice.
- **Sin fuga:** el narrador no recibe nada de un plano que el personaje no percibió.

## Decisiones (aprobado 2026-10-06)
- **Ascender termina la partida** como cruzar las Fuentes (§13).
- **En xianxia el karma queda en este mundo** y el Cielo lo cobra en lo que el ascendido dejó; ascender no es escapar (§7).
- **La ascensión trampa existe en xianxia pero es rara** (~5% de esos mundos), sin pistas obvias, revelada en la crónica (§7).
- **Visitantes de arriba muy raros:** pocos por milenio, solo con causa, casi siempre suprimidos o en cuerpos prestados; hechos de época (§8).

## Decisiones tomadas en este borrador (revisables)

- **Un solo planeta simulado completo;** los demás planos en agregado con hechos fijados (§1, §11).
- **El Cielo es local al planeta,** no un plano (§4).
- **Visitantes solo con causa registrada** y con supresión por la barrera (§8).
- **Ascender termina la partida** como cruzar las Fuentes (§13).
- **Karma al ascender según la ley del mundo:** viaja con el ascendido o queda en lo que dejó (§7).

## Preguntas abiertas

- Calibración: fuerza y regeneración de la barrera; cada cuánto se abre la puerta según la fuerza del Cielo; esencia que sale por ascensión; frecuencia de visitas según las causas acumuladas; cuánto dura una grieta.
