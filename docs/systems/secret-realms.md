# Reinos secretos (秘境)

> Estado: **borrador de diseño**. Bolsillos de espacio y lugares sellados que alguien (o algo) hizo: quién los creó y para qué, qué física los sostiene (fuente de energía, barrera, formación que los mantiene), por qué se abren cuando se abren (mareas de qi, ciclos celestes, llaves, fuerza), qué hay adentro y por qué (solo lo que el creador puso, lo que creció y lo que dejaron los visitantes anteriores), cómo se degradan por dentro hasta colapsar, guardianes y pruebas, cómo se reparte el acceso entre sectas, qué pasa adentro donde no llega la ley, y cómo se cuentan y se venden mapas que ya no son ciertos.

Depende de: [metaphysics.md](metaphysics.md) (si el mundo permite manipular el espacio; sin eso no hay bolsillos, solo lugares sellados), [deep-history.md](deep-history.md) (los reinos son legados: los produce la historia, nunca la planet-gen), [causality.md](causality.md) (procedencia, conservación del qi y de los bienes, detalle diferido con restricciones), [crafts.md](crafts.md) (formaciones como grafos, fuentes de energía, artefactos y constructos guardianes), [elements.md](elements.md) (campo de qi interior, ambientes), [planet-gen.md](planet-gen.md) (venas, convergencias, ciclos celestes de la cosmología), [cultivation.md](cultivation.md) (umbrales, herencias de técnicas, rupturas), [spirits.md](spirits.md) (remanentes del creador, espíritus de lugar y resentidos adentro), [living-world.md](living-world.md) (ecología de bestias y plantas, el conocimiento es físico), [information.md](information.md) (rumores de aperturas, mapas como creencia, secretos), [organizations.md](organizations.md) (sectas que controlan entradas, cuotas, alianzas), [contracts.md](contracts.md) (acuerdos de acceso, pactos con guardianes), [law.md](law.md) (jurisdicción adentro), [heaven-karma.md](heaven-karma.md) (karma de herencias tomadas, la atención del Cielo adentro), [economy.md](economy.md) (botín, mercados de apertura, fichas de entrada), [discovery.md](discovery.md) (iluminación por obras con intención, leer las leyes del creador), [body-health.md](body-health.md) (ambientes interiores, heridas, hambre), [perception.md](perception.md) (lo que se ve adentro y de la barrera). Lo usan: [deep-history.md](deep-history.md) (legados de tipo reino), [planet-gen.md](planet-gen.md) (entrega a la historia), [body-health.md](body-health.md) (aire de un reino secreto), [divination.md](divination.md) (predecir aperturas), y [chronicle.md](chronicle.md) (expediciones como capítulos).

## Principios
1. **Todo reino tiene un creador o una causa.** Un bolsillo de espacio no aparece porque sí: lo hizo un cultivador de reino altísimo, una secta entera, un inmortal moribundo, o lo abrió un evento (dos poderosos que desgarraron el espacio peleando, una tribulación que falló, una formación enorme que colapsó). Su `originEventId` apunta ahí, y su forma, su contenido y sus reglas salen de esa causa.
2. **Un reino es una estructura que gasta energía.** La barrera y el espacio interior se sostienen con una fuente (una vena que drena desde afuera, un depósito interno, el alma del creador atada a su núcleo). La energía se conserva: lo que gasta el reino sale de algún lado, y cuando se acaba, el reino se degrada y colapsa.
3. **Se abre por física, no por calendario de guion.** Las aperturas ocurren cuando la barrera se debilita (mareas de qi, alineaciones de cuerpos celestes, pulsos de una vena), cuando alguien usa la llave, o cuando alguien la rompe. Son predecibles para quien entiende la física y sorpresivas para quien no.
4. **Adentro hay lo que tiene que haber.** Solo lo que el creador puso, lo que creció o se acumuló en el tiempo (hierbas de diez mil años, bestias que se reprodujeron) y lo que dejaron, perdieron o no se llevaron los visitantes anteriores. El detalle se puede fijar al mirar (causality §5.3), pero siempre dentro de esas restricciones.
5. **Casi nunca sos el primero.** La mayoría de los reinos conocidos ya fueron abiertos y saqueados. Lo que queda es lo que nadie pudo alcanzar, lo que se regeneró, lo que estaba escondido o lo que mató a los que lo intentaron. Los reinos vírgenes existen y son raros.
6. **Un reino se degrada por dentro.** Las formaciones se rompen, los guardianes se quedan sin energía, la ecología cerrada se desequilibra, las zonas del borde se pierden. Cada apertura puede acelerar el deterioro. Un mapa de hace cien años describe un lugar que ya no existe así.
7. **Adentro, las reglas de afuera llegan debilitadas.** Ningún magistrado entra a un reino; las sectas que reparten las fichas imponen sus acuerdos, pero adentro manda la fuerza, y lo que pasa se sabe solo por lo que cuentan los que salen. El karma sí lo registra (lee la verdad).
8. **Determinista.** `rng.fork("realm", realmId, openingId)` para lo que se fija al abrir; `rng.fork("realm-decay", realmId, period)` para el deterioro en agregado.

## 1. Qué es un reino secreto

```ts
interface SecretRealm {
  id: RealmId;
  kind: "pocket" | "sealed_site";           // bolsillo de espacio propio, o lugar sellado en el mundo (tumba, cueva de herencia, 洞府)
  creator?: AgentId;                         // quién lo hizo (persona, secta, ser antiguo); puede estar muerto, ser un espíritu o seguir vivo
  cause: EventId;                            // creación deliberada o evento que lo produjo (desgarro, colapso de formación)
  purpose: RealmPurpose[];                   // para qué lo hizo el creador (§2); un reino accidental no tiene
  anchors: RealmAnchor[];                    // dónde toca el mundo: entradas (§4)
  barrier: Barrier;                          // qué lo separa del mundo y cuánto aguanta
  energy: RealmEnergy;                       // de qué vive y cuánto le queda (§3)
  interior?: RealmInteriorId;                // para bolsillos: su propia grilla (§5)
  rules: RealmRule[];                        // límites de entrada y leyes internas (§6)
  ledger: RealmLedgerId;                     // lo que se puso, creció, entró y salió (§7)
  openings: OpeningId[];                     // historial de aperturas
  state: "sealed" | "open" | "degrading" | "collapsing" | "collapsed";
  originEventId: EventId;
}

type RealmPurpose =
  | "inheritance"                            // herencia: elegir un sucesor que reciba técnicas y tesoros
  | "trial"                                  // prueba: filtrar a quienes lo merecen según los valores del creador
  | "tomb"                                   // tumba: guardar el cuerpo y lo que el creador quiso llevarse
  | "refuge"                                 // refugio: esconder a una secta o un linaje de un enemigo
  | "garden" | "breeding"                    // cultivar hierbas o criar bestias con qi controlado
  | "vault" | "arsenal"                      // guardar tesoros o armas
  | "workshop"                               // laboratorio de alquimia o forja con condiciones únicas
  | "prison" | "seal"                        // encerrar a alguien o algo (una bestia, un demonio, un rival)
  | "retreat";                               // reclusión para cultivar sin interrupciones
```

- **Bolsillos de espacio** existen solo si la metafísica del mundo permite manipular el espacio (metaphysics: ley superior y techo de poder) y alguien llegó al umbral que lo permite. En mundos sin eso, la misma función la cumplen **lugares sellados**: tumbas, cuevas de herencia, montañas cerradas por formaciones, colinas de hadas. El modelo es el mismo sin la grilla interior propia.
- **Reinos accidentales:** un desgarro espacial por una pelea de inmortales o una tribulación fallida puede dejar un bolsillo sin diseño ni propósito: inestable, peligroso, con lo que estaba en ese lugar en ese momento (incluidos los muertos de la pelea).
- **Reinos de reinos:** un reino puede contener otro (la cámara interior del creador dentro de su jardín), con su propia barrera y su propia llave.

## 2. Quién los crea y para qué

El propósito sale del creador: su psicología (npc-psychology), sus valores, su situación al momento de hacerlo.
- **Herencias y pruebas:** un cultivador sin discípulos dignos, cerca de su muerte o de una tribulación que cree que no va a pasar, guarda su saber para alguien que lo merezca. Las pruebas miden **lo que él valoraba** (talento, coraje, compasión, astucia, afinidad con su elemento, linaje), y sus valores pueden ser raros o crueles: un creador que despreciaba la piedad pone pruebas que la castigan.
- **Tumbas:** el creador se lleva lo que quiso (armas, concubinas, sirvientes, en algunas culturas vivos) y se protege de los saqueadores. Las tumbas suelen tener más trampas que pruebas.
- **Refugios:** una secta perseguida se esconde con todo su tesoro. Si la secta se extinguió adentro (hambre, guerra interna, una plaga), el refugio es una ciudad muerta con sus espíritus.
- **Jardines y criaderos:** producción de recursos espirituales en condiciones controladas. Abandonados, se vuelven ecosistemas salvajes.
- **Prisiones y sellos:** lo encerrado puede seguir vivo, y debilitar el sello es soltarlo. Los que abren una prisión creyendo que es un tesoro son una historia que el sistema tiene que poder producir.
- **Cuesta muchísimo.** Crear un bolsillo consume una cantidad enorme de esencia, materiales y años, con formaciones y artefactos (crafts §5, §6). La energía que lo sostiene sale de una vena (que se debilita afuera) o de un depósito que el creador llenó (piedras, su propia esencia, a veces su vida). Esa conservación tiene que cerrar.

## 3. Energía y barrera

```ts
interface RealmEnergy {
  sources: EnergySource[];                   // vena drenada desde un ancla, depósito de piedras, núcleo con el alma del creador, ecosistema interior
  reserve: number;                           // esencia almacenada
  upkeep: number;                            // gasto por tick: barrera + espacio + formaciones + guardianes
  inflow: number;                            // lo que entra por tick (de la vena, de lo que muere adentro, de visitantes que cultivan)
}

interface Barrier {
  strength: number;                          // cuánto aguanta antes de ceder
  permeability: PermeabilityProfile;         // qué deja pasar y cuándo (por umbral de cultivo, por llave, por tamaño de alma)
  cycle?: BarrierCycle;                      // variación con mareas de qi o ciclos celestes (§4)
}
```

- **Gasto continuo.** Mantener un espacio aparte cuesta siempre; mantener guardianes y formaciones activas, más. Si `upkeep > inflow`, la reserva baja y el reino empieza a degradarse (§8).
- **Lo que drena afuera:** un reino que vive de una vena le roba qi a la región de su ancla. La zona alrededor tiene menos qi del que la geología haría esperar, y eso es una pista para quien sepa leerla (discovery). Un reino que colapsa devuelve qi de golpe.
- **Los visitantes también gastan y aportan:** cada persona adentro es masa y esencia que la barrera sostiene; los que mueren adentro devuelven su qi al reino (y quizás espíritus). Algunos creadores diseñaron reinos que se alimentan de sus visitantes.

## 4. Entradas y aperturas

```ts
interface RealmAnchor {
  cell: CellId;                              // dónde está en el mundo (una cueva, el fondo de un lago, el cielo sobre un pico)
  form: "gate" | "rift" | "object" | "formation" | "hidden";  // una puerta, una grieta, un objeto que se activa, una formación, nada visible
  key?: KeyRequirement;                      // fichas, sangre de un linaje, una técnica, un acertijo, una ofrenda
  maxThroughput?: number;                    // cuántas personas y de qué tamaño de alma pasan por apertura
}

interface Opening {
  id: OpeningId;
  realm: RealmId;
  cause: "tide" | "celestial" | "key" | "force" | "creator_design" | "decay" | "external_event";
  window: { start: Tick; end: Tick };        // cuánto dura abierta; los que no salen a tiempo quedan adentro hasta la próxima (o mueren)
  entrants: AgentId[] | EntrantDistribution;
  exits: ExitRecord[];                       // quién salió, cuándo, con qué (en verdad)
  originEventId: EventId;
}
```

- **Mareas y ciclos:** la barrera se debilita cuando el campo de qi exterior sube o baja de cierta forma (pulsos de la vena, estaciones de qi, alineaciones de lunas o estrellas según la cosmología). Como es física, se puede **predecir**: los que leyeron registros de aperturas anteriores o entienden el ciclo saben cuándo viene la próxima. Los que no, se enteran por rumor (y llegan tarde o a tiempo).
- **Diseño del creador:** algunos reinos se abren solos cada cierto tiempo a propósito, para que entren candidatos. El ritmo es parte de su diseño, y cambia cuando el reino se degrada.
- **Llaves:** fichas de jade, sangre de un linaje (family-lineage), conocer una técnica, resolver un acertijo, ofrendar algo. Las llaves son objetos o conocimientos que existen en el mundo, se heredan, se pierden, se roban y se falsifican.
- **Por la fuerza:** romper una barrera es posible con suficiente poder o una formación de ruptura (crafts §6). Cuesta, daña el reino (acelera su degradación, puede desatar su colapso) y a veces despierta sus defensas.
- **Límites de paso:** muchas barreras solo dejan pasar almas por debajo de cierto tamaño (el creador no quería que entraran sus pares, o la barrera no aguanta más). Por eso los reinos suelen ser **campos de juego de jóvenes**: los ancianos mandan a sus discípulos y esperan afuera.
- **Ventanas:** la apertura dura un tiempo. Los que no salen a tiempo quedan atrapados hasta la próxima (con lo que tengan para comer y la ecología del interior) o mueren si el reino los expulsa mal.

## 5. El interior

```ts
interface RealmInterior {
  realm: RealmId;
  grid: HexGrid;                             // su propia grilla, con su geografía (diseñada o accidental)
  qiField: FieldId;                          // campo propio: más denso, de un elemento, envenenado, degradado (elements)
  climate: ClimateProfile;                   // estable por diseño o raro (luz sin sol, estaciones detenidas)
  timeRatio?: number;                        // solo si la metafísica lo permite y el creador lo pagó (§6)
  zones: RealmZone[];                        // regiones con su función (jardín, cámara de pruebas, tumba, borde inestable)
  ecology: EcologyStateId;                   // poblaciones de plantas y bestias encerradas (living-world)
  guardians: AgentId[];                      // constructos, espíritus, bestias pactadas, el remanente del creador
}
```

- **Geografía propia:** diseñada (montañas que el creador quiso, un lago para su jardín) o heredada del lugar del que se arrancó el espacio. Se genera una vez a partir de la causa y el propósito, con la misma maquinaria de terreno, y queda fija.
- **Campo de qi propio:** un reino de jardín puede tener qi mucho más denso que afuera (por eso las hierbas valen tanto); uno degradado puede tener qi desordenado o venenoso. Cultivar adentro es más rápido o más peligroso según el campo.
- **Ecología cerrada:** las bestias que el creador encerró se reprodujeron, se comieron entre ellas, mutaron con el qi del lugar o se extinguieron. Las plantas crecieron sin cosechadores durante siglos: las hierbas de diez mil años existen porque hubo diez mil años de qi y nadie las tocó. La ecología sigue las reglas de living-world, cerrada.
- **Guardianes:** constructos con energía que se gasta, bestias pactadas (contracts) cuyo pacto puede haber vencido, espíritus de lugar que despertaron con los siglos, y a veces el **remanente del alma del creador** (spirits): conserva su saber y su psicología, juzga a los candidatos, puede enseñar, mentir o intentar poseer al heredero.
- **Obras con intención:** murales, inscripciones, la espada clavada del creador; pueden llevar su intención y disparar comprensión o iluminación (discovery §8, §9).

## 6. Reglas internas

```ts
type RealmRule =
  | { kind: "entry_limit"; maxThreshold: ThresholdId }       // nadie por encima de cierto umbral pasa
  | { kind: "suppression"; factor: number }                  // el poder de todos se reduce adentro
  | { kind: "element_bias"; element: ElementId; factor: number }
  | { kind: "time_ratio"; ratio: number }                    // el tiempo pasa distinto (solo si la metafísica lo permite)
  | { kind: "no_flight" | "no_storage" | "no_transmission" } // prohibiciones del creador (sin vuelo, sin anillos, sin mensajes afuera)
  | { kind: "trial_gate"; trial: TrialId }                   // pasar a la zona siguiente requiere una prueba
  | { kind: "custom"; id: string; params: unknown };
```

- **Las reglas son física del reino**, pagada con su energía: una supresión de poder cuesta mantenerla; cuando el reino se degrada, las reglas se debilitan o se rompen (y los fuertes que estaban limitados de golpe ya no lo están).
- **Tiempo distinto:** solo en mundos donde la ley lo permite, y caro. Para la simulación, el interior corre su propio reloj con una tasa fija respecto del mundo; lo que pasa adentro se resuelve en ese reloj y se sincroniza al salir. Un año adentro por un mes afuera es una ventaja de cultivo enorme, y por eso esos reinos son lo más disputado.
- **Pruebas:** obstáculos diseñados para medir algo (fuerza, comprensión, carácter, linaje). Las resuelve la misma simulación (combate, percepción, discovery, psicología): no hay minijuegos aparte. Una prueba de carácter observa lo que el candidato **hace** (si ayuda a otro, si traiciona), no lo que dice.

## 7. Lo que hay adentro y el libro del reino

```ts
interface RealmLedger {
  placed: LotId[];                           // lo que el creador puso (tesoros, técnicas en jade, píldoras, armas, su cuerpo)
  grown: GrowthRecord[];                     // lo que creció o se acumuló (hierbas, bestias, cristales de qi)
  entered: EntryRecord[];                    // quiénes entraron, cuándo, con qué
  removed: RemovalRecord[];                  // lo que salió y con quién
  remains: RemainsRecord[];                  // cadáveres y equipo de los que murieron adentro, objetos perdidos
  constraints: ContentConstraint[];          // lo que todavía no se fijó pero está restringido (detalle diferido)
}
```

- **Conservación estricta:** lo que hay adentro es lo puesto más lo crecido más lo dejado menos lo sacado. Nada se repone solo, salvo lo que crece con el qi del reino (y eso se descuenta de su energía).
- **Detalle diferido:** el contenido exacto de una cámara que nadie abrió puede quedar sin fijar, con restricciones (qué puso el creador según su propósito, su riqueza y su camino; qué pudo crecer en ese campo y ese tiempo). Se fija la primera vez que alguien la percibe, siempre dentro de las restricciones (causality §5.3).
- **Saqueos anteriores:** cada apertura histórica quedó registrada (en agregado si fue hace mucho): qué zonas se alcanzaron, cuánto se sacó, quién murió dónde. Los reinos famosos tienen las zonas cercanas a la entrada vacías y las lejanas o las más peligrosas con lo que queda.
- **Los muertos adentro** son contenido: su equipo, sus anillos de almacenamiento, sus manuales, su cuerpo y quizás su espíritu. Una expedición que murió entera hace trescientos años dejó un botín y una advertencia.
- **Herencias:** tomar la herencia de un creador te ata a su karma (heaven-karma §2), incluidos sus enemigos, que pueden seguir vivos o tener sucesores. Las sectas rivales del creador reconocen sus técnicas cuando las usás.

## 8. Degradación y colapso

- **Energía:** cuando la reserva baja, el reino reduce lo que sostiene: primero se apagan guardianes y formaciones secundarias, después se pierden zonas del borde (se vuelven niebla, espacio roto o vacío), después se debilitan las reglas, al final cae la barrera.
- **Ecología:** la población cerrada se desequilibra (las bestias que comen todo se quedan sin presas, las hierbas sin quien las polinice); las mutaciones por qi se acumulan.
- **Aperturas:** cada apertura gasta energía, deja entrar visitantes que pelean, rompen y saquean, y a veces daña la barrera. Las aperturas por fuerza aceleran todo.
- **Inestabilidad:** un reino degradado tiene zonas donde el espacio falla (grietas que cortan, áreas donde el qi enloquece, pasajes que llevan a otro lugar del interior o afuera). Es peligro con causa, no azar.
- **Colapso:** cuando la barrera cae del todo, el bolsillo deja de existir. Lo que había adentro tiene que ir a algún lado (conservación): el qi vuelve al campo del ancla (una explosión de qi en la región: living-world, elements), la materia se expulsa al mundo alrededor del ancla o se pierde en el vacío según la metafísica (con registro), y los que estaban adentro salen expulsados, heridos, o mueren. Un colapso es un desastre con causa que cambia la región.
- **Rescates:** se puede alimentar un reino que muere (con piedras, con una vena nueva) o repararlo con formaciones. Hacerlo es quedarse con él.

## 9. Acceso, poder y sociedad

- **Quién controla la entrada:** la secta en cuya montaña está el ancla, una alianza de sectas que se lo disputó, un estado, nadie (los reinos en tierra de nadie son carreras). El control se ejerce sobre el ancla (organizations, state §10), no sobre el interior.
- **Cuotas y fichas:** las sectas que comparten un reino reparten cupos por acuerdo (contracts): tantas plazas por secta, por fuerza relativa. Las fichas de entrada son bienes que se venden, se roban, se heredan y se falsifican (economy, law). Adentro de cada secta, quién recibe una ficha es política (organizations: puestos, facciones, favoritismo).
- **Adentro no hay juez:** los acuerdos entre sectas dicen qué está permitido (no matar, no robar herencias de otros), pero se cumplen solo si alguien ve y alguien castiga después. Matar a un rival adentro y decir que fue una bestia es la jugada clásica; los que vieron pueden contarlo o callar.
- **La salida es el momento peligroso:** afuera esperan maestros, rivales y bandidos que saben que los que salen traen tesoros y están cansados. Las emboscadas en la salida son parte de la historia de cada reino.
- **Mercados de apertura:** cada apertura atrae comerciantes, mercenarios, guías que dicen conocer el interior, vendedores de mapas (verdaderos, viejos o falsos), compradores de botín, prestamistas que financian expediciones contra parte de lo que salga (economy, contracts).
- **Información:** los relatos de los que salieron son la fuente principal sobre el interior (information): exagerados, interesados, con zonas inventadas y peligros escondidos para que otros mueran. Un mapa del interior es una creencia con fecha (information §5), y el reino cambió desde entonces.
- **El Cielo adentro:** la barrera debilita la percepción del Cielo hacia adentro ([heaven-karma.md](heaven-karma.md) §4: zonas ciegas); el karma se registra igual (lee la verdad), pero las tribulaciones no llegan hasta que el cultivador sale. Romper un umbral adentro no evita la tribulación: la posterga, y algunos creen que la agrava.

## 10. El jugador y el narrador
- **El jugador se entera de un reino** como de cualquier cosa: rumores de una apertura, un mapa viejo heredado, una ficha que le dio su secta, un jade de un muerto, una grieta que encuentra en una cueva. Puede llegar tarde, con información falsa, o ser el único que sabe.
- **Entrar es una decisión con costos:** conseguir acceso, prepararse (comida, píldoras, armas, aliados), arriesgar la vida y la salida.
- **Adentro juega igual que afuera:** explorar, pelear, negociar con guardianes y espíritus, pasar pruebas que observan lo que hace, cultivar en un campo denso, cosechar, traicionar o ayudar. Todo con la misma simulación.
- **Puede encontrar o crear:** con el tiempo y el poder suficiente, el personaje puede ser el creador de un reino propio (su refugio, su herencia), con todo su costo.
- **El narrador** describe el interior desde los sentidos del personaje: un cielo sin sol, un aire espeso de qi, ruinas de una expedición anterior, un mural que parece moverse. Nunca dice qué hay en la cámara siguiente, ni el propósito del creador, ni cuánto le queda al reino, si el personaje no lo sabe.

## 11. Escala (LOD)
- **Tier 0:** cada reino como agregado: energía (reserva, gasto, ingreso), estado de la barrera, ciclo de aperturas, resumen del libro (cuánto queda por zona en categorías), control del ancla. Las aperturas sin jugador cerca se resuelven como expediciones agregadas: entran N por secta, salen M con botín según peligro y contenido, mueren el resto, el libro se actualiza.
- **Tier 1-2:** la apertura cercana al jugador con sectas, cupos y personas concretas; el interior con zonas y su contenido restringido pero sin fijar.
- **Tier 3-4:** el interior que el personaje recorre, con la grilla, la ecología, los guardianes y el contenido que se fija al percibir.
- **Materialización:** un discípulo que salió de un reino hace años lleva lo que la expedición agregada le asignó: su botín, sus heridas, lo que vio y lo que cuenta.

## Implementación
- **Fase 4:** lugares sellados simples (cuevas de herencia, tumbas) con libro de contenido, detalle diferido con restricciones, llaves y trampas; remanentes de alma como guardianes.
- **Fase 6:** control del ancla por organizaciones, cupos y fichas como bienes, mercados de apertura, relatos y mapas como creencias.
- **Fase 7:** reinos creados por la historia profunda (creadores, propósitos, causas accidentales) con sus aperturas históricas, saqueos y degradación hasta el presente.
- **Fase 8:** bolsillos de espacio con grilla interior, campo de qi y ecología cerrada, reglas internas (supresión, límites, tiempo distinto), colapsos como desastres, crear un reino.

## Tests
- **Procedencia:** todo reino tiene creador o evento causante; la planet-gen no produce ninguno.
- **Conservación:** el contenido de un reino es lo puesto más lo crecido más lo dejado menos lo sacado; la energía gastada sale de sus fuentes.
- **Drenaje:** la región del ancla de un reino que vive de una vena tiene menos qi que una región geológicamente igual sin reino.
- **Aperturas predecibles:** un agente con el registro de aperturas anteriores y el modelo del ciclo predice la próxima mejor que uno sin él.
- **Saqueo previo:** en un reino abierto muchas veces, el valor por zona crece con la distancia a la entrada y con el peligro.
- **Degradación:** un reino con `upkeep > inflow` pierde guardianes, después zonas, después reglas, en ese orden.
- **Colapso:** al colapsar, el qi y la materia del interior vuelven al mundo (o quedan registrados como perdidos según la metafísica); nada desaparece sin registro.
- **Detalle diferido:** lo que se fija al mirar nunca contradice el libro ni las restricciones (no hay herencia donde nadie murió ni dejó nada).
- **Determinismo:** mismo seed, mismas acciones → mismas aperturas, mismo contenido fijado, mismos colapsos.

## Decisiones tomadas en este borrador (revisables)
- Un solo modelo para bolsillos de espacio y lugares sellados; la grilla interior es opcional y depende de la metafísica.
- Todo reino tiene creador o evento causante; no hay reinos "naturales" sin causa.
- La energía del reino se conserva; su agotamiento produce degradación por etapas y colapso con consecuencias en el mundo.
- Las aperturas salen de la física (mareas, ciclos, llaves, fuerza, diseño), y son predecibles con el saber adecuado.
- El contenido se puede fijar al mirar, siempre dentro de las restricciones del libro y del grafo causal.
- Adentro el Cielo ve menos: el karma se registra, pero las tribulaciones esperan a la salida.
- El tiempo distinto existe solo si la metafísica lo permite, con tasa fija y reloj propio del interior.

## Preguntas abiertas
- Calibración: costo de crear y mantener un bolsillo por tamaño y reglas; vida típica de un reino según su reserva.
- Calibración: frecuencia de aperturas y duración de las ventanas; límites de umbral típicos.
- Calibración: tasa de muerte de expediciones agregadas según peligro y preparación; cuánto botín sale por apertura.
- Calibración: cuántos reinos hay por región según la historia (que haya mundos con muchos y mundos casi sin ninguno).
- Calibración: efecto del colapso sobre la región del ancla (radio y magnitud de la liberación de qi).
