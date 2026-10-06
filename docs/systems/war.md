# Guerra

> Estado: **borrador de diseño**. La violencia organizada entre grupos: por qué empieza una guerra (decisiones con utilidad, no tiradas), cómo se arma una fuerza (levas, profesionales, mercenarios, discípulos de secta, bestias), logística con conservación (cada ración sale de un granero y cada carro de una ruta), moral como psicología agregada, mando con brecha de ejecución y niebla de información, marcha y campaña sobre el terreno real, resolución de batallas por escalas, la asimetría entre ejércitos mortales y cultivadores, formaciones defensivas y asedios, cautivos, rehenes, rescates y botín, treguas y tratados, costumbres y crímenes de guerra con su karma, y lo que la guerra deja en el mundo (devastación, refugiados, hambre, epidemias, veteranos, memoria).

Depende de: [organizations.md](organizations.md) (quién decide la guerra: asuntos, deliberación, órdenes con brecha, facciones, tesoro, relaciones entre organizaciones), [state.md](state.md) (ejércitos de estado, levas sobre registros, alcance, fiscalidad de guerra, señores de la guerra, rebelión), [economy.md](economy.md) (bienes como lotes, graneros, precios de guerra, crédito, botín como transferencia), [causality.md](causality.md) (presiones y descargas, conservación, nada sin causa), [npc-psychology.md](npc-psychology.md) (miedo, cara, lealtad, trauma, utilidad), [body-health.md](body-health.md) (heridas por parte, infección, epidemias de campamento, nutrición, cansancio), [cultivation.md](cultivation.md) (poder en combate, esencia disponible, umbrales), [elements.md](elements.md) (choques de técnicas, campos, ambiente de batalla), [crafts.md](crafts.md) (armas, artefactos, formaciones como grafos, talismanes), [perception.md](perception.md) (exploradores, sentidos de cultivador, ocultamiento), [information.md](information.md) (informes, rumores de batalla, propaganda, mapas como creencia), [planet-gen.md](planet-gen.md) (terreno, ríos, clima, estaciones), [living-world.md](living-world.md) (rutas, bestias, desastres), [social-structure.md](social-structure.md) (quién pelea, cautivos, esclavitud, ascenso por las armas), [law.md](law.md) (ley marcial, deserción, crímenes de guerra), [contracts.md](contracts.md) (treguas, tratados, rescates, rehenes, contratos de mercenarios, juramentos de soldado), [family-lineage.md](family-lineage.md) (rehenes de sangre, viudas y huérfanos, sucesión tras la muerte en batalla), [heaven-karma.md](heaven-karma.md) (deudas de sangre en masa, atención del Cielo), [spirits.md](spirits.md) (campos de batalla con espíritus anclados). Lo usan: [state.md](state.md) (fuerzas armadas, guerras exteriores, rebelión), [organizations.md](organizations.md) (guerras entre sectas, conflictos y su resolución), [social-structure.md](social-structure.md) (cautivos, levas, botín humano, ascenso militar), [law.md](law.md) (ley marcial, crímenes de guerra), [contracts.md](contracts.md) (treguas, rescates, rehenes), [crafts.md](crafts.md) (armas, formaciones de asedio), [cultivation.md](cultivation.md) (poder en combate), [technology.md](technology.md) (armas, fortificación, pólvora si el mundo la permite), y los futuros adivinación (presagios antes de la batalla, adivinos de campaña) y crónica (guerras como capítulos, versiones del vencedor).

## Principios
1. **La guerra es una decisión, no un evento.** Nadie "entra en guerra" por tirada. Una organización con un asunto (territorio, venganza, sucesión, recursos, cara, una profecía creída) delibera, compara utilidad esperada de pelear contra no pelear con lo que **cree** de su enemigo, y decide. Las guerras malas salen de creencias malas.
2. **Un ejército es gente que come.** Cada soldado, caballo y bestia de carga consume todos los días. La comida, el forraje, las flechas, las piedras espirituales y los talismanes salen de algún lugar y viajan por alguna ruta. Nada aparece en el campamento: la conservación manda más que la táctica.
3. **La moral es psicología, no un número mágico.** Cada soldado (o su distribución en agregado) tiene miedo, lealtad, paga, hambre, cansancio y lo que vio. Las unidades se rompen cuando suficientes personas deciden que huir tiene más utilidad que quedarse, y eso se contagia.
4. **Nadie ve la batalla entera.** El general sabe lo que le dicen los exploradores y los mensajeros, tarde y deformado; manda órdenes que llegan tarde y se cumplen a medias. La niebla de guerra es la misma separación entre verdad y creencia de todo el juego.
5. **El terreno y el tiempo son armas.** Ríos, pasos, pantanos, la estación, la lluvia, el campo de qi del lugar: todo sale del planeta real y pesa en la marcha, el suministro y el choque.
6. **Los cultivadores rompen la escala.** Un cultivador de reino alto vale más que mil soldados, pero no infinitos: se cansa, gasta esencia, puede ser engañado, envenenado, atrapado en una formación o superado por números con las armas adecuadas. La guerra de un mundo xianxia es la negociación constante entre masas mortales y pocos poderosos.
7. **La guerra no termina con la batalla.** Deja muertos, heridos, viudas, refugiados, campos quemados, epidemias, deudas, veteranos con trauma, odios heredados, espíritus anclados y deudas de sangre que el Cielo registra. Todo eso es estado del mundo y sigue actuando.
8. **Determinista.** `rng.fork("war", warId, eventId)` para decisiones de campaña; `rng.fork("battle", engagementId, tick)` para la resolución táctica; `rng.fork("camp", forceId, day)` para enfermedad, deserción y forrajeo en agregado.

## 1. Qué es una guerra

Una guerra es un **estado de conflicto armado entre partes** que nace de un evento (una declaración, un ataque, una rebelión, una invasión) y que existe mientras alguna de las partes siga usando la fuerza o creyendo que la otra lo hace.

```ts
interface War {
  id: WarId;
  sides: WarSide[];                          // dos o más bandos; las alianzas cambian durante la guerra
  kind: WarKind;                             // abierto: ver tabla abajo
  causes: EventId[];                         // los asuntos y eventos que la produjeron (causality)
  declared: boolean;                         // hay culturas que declaran, otras que atacan sin aviso
  theaters: TheaterId[];                     // regiones con operaciones propias
  engagements: EngagementId[];               // batallas, escaramuzas, asedios
  truces: CommitmentId[];                    // treguas y tratados en vigor (contracts)
  exhaustion: Map<SideId, number>;           // cansancio de guerra por bando (§11)
  originEventId: EventId;
  endEventId?: EventId;
}

interface WarSide {
  id: SideId;
  members: OrgId[];                          // estados, sectas, clanes, bandas, rebeldes
  leader: OrgId;                             // quién decide en última instancia (puede discutirse)
  aims: WarAim[];                            // lo que quiere conseguir, según su deliberación
  beliefs: BeliefSetId;                      // lo que cree del enemigo: fuerza, intenciones, aliados (information)
}

interface WarAim {
  kind: "territory" | "tribute" | "vassalage" | "resource" | "succession" | "revenge" | "punitive"
      | "religious" | "extermination" | "liberation" | "defense" | "plunder" | "custom";
  target: EntityRef;                         // la provincia, la mina de jade, el trono, el clan
  value: number;                             // cuánto le importa a quien decide (utilidad)
  minimal: boolean;                          // si alcanza con esto para aceptar la paz
}
```

### Tipos de guerra (abierto)
| Tipo | Entre quiénes | Rasgos |
|---|---|---|
| **Guerra de estados** | Reinos, imperios | Levas, ejércitos grandes, asedios de ciudades, tratados |
| **Guerra de sectas** | Sectas y sus aliados | Pocos combatientes muy fuertes, formaciones, robo de herencias, exterminio de linajes |
| **Guerra mixta** | Estado contra secta o con sectas aliadas | La más común en mundos xianxia: el estado pone masas y la secta pone poder |
| **Rebelión** | Súbditos contra su estado (state §13) | Al principio sin logística, con legitimidad en juego, se vuelve guerra de estados si gana territorio |
| **Guerra civil / de sucesión** | Facciones de una misma organización | Lealtades divididas, las dos partes reclaman la misma legitimidad |
| **Vendetta armada** | Clanes, familias (law §9) | Pequeña, larga, sin batallas campales, deudas de sangre que pasan de generación |
| **Incursión y saqueo** | Nómadas, piratas, bandas | Sin intención de conquistar: llegan, toman y se van |
| **Guerra contra bestias** | Un poblado o estado contra una marea de bestias (living-world) | El enemigo no negocia; su logística es el ecosistema |
| **Guerra santa** | Por una creencia sobre el Cielo o un dios | Aims de conversión o exterminio; la moral se apoya en la fe |

### Cómo empieza
- **Presiones:** territorio disputado, una mina de piedras espirituales, una sucesión con dos reclamantes, una ofensa a la cara de una secta, una deuda de sangre, hambre que empuja a los nómadas al sur, un estado vecino que se debilita y se ve débil.
- **Deliberación:** el asunto entra a la organización (organizations §4) y se decide con la utilidad que ven las personas que deciden: lo que esperan ganar, lo que creen que van a perder, su cara, su ambición, las facciones que empujan. Un general ambicioso puede querer la guerra que el tesoro no puede pagar.
- **Creencias equivocadas:** la mayoría de las guerras perdidas empiezan con una sobreestimación propia o una subestimación del enemigo, porque se decidieron con informes viejos, espías comprados o propaganda creída.
- **Casus belli:** las culturas que exigen justificación necesitan un pretexto que su gente y sus aliados crean (un tratado roto, un insulto, un presagio). Fabricar uno es una intriga (schemes) más.

## 2. Fuerzas armadas

```ts
interface ArmedForce {
  id: ForceId;
  owner: OrgId;                              // el estado, la secta, el señor, el capitán mercenario
  commander: PersonId;
  units: UnitId[];
  location: CellId;
  supply: SupplyState;                       // (§3)
  orders: OrderId[];                         // las órdenes que recibió y cómo las entendió (§5)
  beliefs: BeliefSetId;                      // lo que esta fuerza cree del entorno (diferente de lo que cree su dueño)
  originEventId: EventId;                    // la leva, la contratación, la orden de movilizar
}

interface Unit {
  id: UnitId;
  kind: UnitKindId;                          // contenido por cultura y era: infantería de levas, arqueros, caballería, carros, discípulos, bestias de guerra, constructos
  members: PersonId[] | MemberDistribution;  // personas concretas cerca del jugador, distribución en agregado
  officer?: PersonId;
  equipment: LotId[];                        // armas, armaduras, talismanes, monturas (economy, crafts)
  training: number;                          // 0..1, cuánto practicó maniobras y formación cerrada
  experience: number;                        // batallas vistas (sube la habilidad y también el trauma)
  cohesion: number;                          // cuánto se mantienen juntos bajo presión (§4)
  morale: MoraleState;                       // (§4)
  fatigue: number;
  health: UnitHealth;                        // heridos, enfermos, muertos, desaparecidos (body-health)
}
```

### Quién pelea
| Fuente | Cómo llega | Ventajas | Problemas |
|---|---|---|---|
| **Leva** | El estado recluta sobre sus registros (state §3) | Barata, numerosa | Poco entrenada, moral baja, deserta cuando llega la cosecha; vacía los campos |
| **Profesionales** | Soldados pagos de carrera, guarniciones | Entrenados, cohesionados | Caros; si no cobran, se amotinan o se vuelven bandidos |
| **Hereditarios** | Casas guerreras, servidores de un señor (social-structure) | Leales a su señor, bien equipados | Leales a su señor, no al trono |
| **Mercenarios** | Contrato (contracts) con una compañía | Disponibles ya, experimentados | Leales a la paga; cambian de bando si el otro paga mejor o si ven que pierden |
| **Discípulos de secta** | La secta los manda por un arreglo (state §10) o por guerra propia | Poder individual enorme | Pocos, obedecen a su secta antes que al general, sus maestros los cuidan |
| **Cultivadores sueltos** | Contratados, reclutados con promesas, obligados por deudas | Poder sin secta detrás | Caprichosos, imposibles de castigar |
| **Bestias** | Domadas, criadas o pactadas (living-world, contracts) | Monturas, fuerza, miedo | Comen mucho, se descontrolan, tienen su propia psicología |
| **Constructos y espíritus** | Artefactos (crafts), espíritus pactados (spirits) | No comen, no huyen | Gastan energía, fallan, se rompen; los pactos tienen cláusulas |
| **Milicia y defensa local** | Aldeanos que defienden su casa | Conocen el terreno, moral alta en defensa | Inútiles lejos de su casa |

- **Reclutar cuesta personas.** Cada hombre levado deja un campo sin trabajar, una familia con menos manos y un hogar que puede caer en deuda (economy, social-structure). Una leva grande en primavera es hambre en otoño.
- **Las levas leen el registro.** Se reclutan los que figuran: los que se escaparon del registro se escapan también de la leva, y el registro viejo pide hombres de aldeas que ya no los tienen.
- **Equipar es comprar o fabricar.** Las armas son lotes con origen (crafts §5): un ejército grande necesita herrerías, carbón, hierro y tiempo; las armas de cultivador, maestros forjadores y materiales raros. Un estado que arma de golpe vacía su tesoro y sube el precio del hierro.

## 3. Logística y suministro

La logística es el corazón de la guerra. Todo lo que consume una fuerza **existe como tenencia** y se mueve por rutas reales.

```ts
interface SupplyState {
  stocks: LotId[];                           // lo que lleva consigo: granos, forraje, agua, flechas, medicinas, piedras espirituales
  dailyNeed: Map<GoodKind, number>;          // calculado de miembros, animales y actividad (marchar, pelear, sitiar)
  lines: SupplyLine[];                       // de dónde le llega lo que no lleva
  forage: ForagePolicy;                      // cuánto toma del lugar (§3, abajo)
  daysOfSupply: number;                      // derivado; lo que el comandante cree puede diferir
}

interface SupplyLine {
  from: HoldingId;                           // un granero, un depósito, un mercado, una secta aliada
  route: RouteId;                            // camino, río, canal, mar (living-world)
  carriers: UnitId[] | CaravanId;            // carros, bestias de carga, barcos, porteadores (que también comen)
  escort?: UnitId[];
  throughput: number;                        // lo que llega por día después de pérdidas, robos y lo que comen los porteadores
  exposed: number;                           // qué tan fácil es cortarla
}

type ForagePolicy = "none" | "purchase" | "requisition" | "plunder" | "scorched_earth";
```

- **Consumo:** cada persona y animal necesita su ración (body-health: nutrición); marchar y pelear sube la necesidad. Una bestia de guerra grande puede comer como cien hombres. Los cultivadores comen poco o nada según su umbral, pero gastan piedras espirituales, píldoras y talismanes.
- **La regla del carro:** los animales de carga comen parte de lo que llevan; a cierta distancia de la base, un carro de grano llega vacío. Por eso los ríos, los canales y los mares deciden dónde se puede hacer la guerra, y por eso los anillos de almacenamiento (si el mundo los permite) cambian todo: un solo cultivador con un anillo grande es una línea de suministro.
- **Forrajear:** tomar del lugar es la otra fuente. Comprar sube los precios locales; requisar deja hogares sin comida; saquear los destruye; la tierra quemada se la niega al enemigo y también a los propios. El forraje **agota la celda**: un ejército que se queda quieto se come la región y después pasa hambre.
- **Estaciones:** sin pasto no hay caballería; con nieve los pasos se cierran; la cosecha es cuando hay comida para requisar y cuando las levas quieren volver a casa.
- **Agua y campamentos:** muchos hombres juntos sin agua limpia ni letrinas es disentería. Las epidemias de campamento (body-health: contagio) mataron más soldados que las batallas, y se llevan la enfermedad a las ciudades que tocan.
- **Cortar líneas:** atacar la logística en vez del ejército es casi siempre lo más eficaz. Una fuerza con hambre pierde moral, deserta, saquea y se desarma sola.
- **Dinero de guerra:** pagar soldados, comprar granos, contratar mercenarios y fabricar armas sale del tesoro (state §4). Cuando no alcanza: impuestos de guerra, préstamos, rebaja de moneda, confiscaciones, venta de cargos, pagar con botín futuro. Cada salida queda en la economía después de la paz.

## 4. Moral y cohesión

```ts
interface MoraleState {
  level: number;                             // disposición a seguir peleando
  drivers: MoraleDriver[];                   // por qué está como está, para que el narrador y el comandante puedan leerlo
  breakingPoint: number;                     // umbral de quiebre; sube con entrenamiento, cohesión y fe en el comandante
}

type MoraleDriver =
  | { kind: "pay"; arrears: number }         // paga atrasada
  | { kind: "hunger"; days: number }
  | { kind: "fatigue" }
  | { kind: "losses"; fraction: number }     // compañeros caídos, sobre todo los que vieron caer
  | { kind: "victory" | "defeat"; eventId: EventId }
  | { kind: "commander"; personId: PersonId; trust: number }
  | { kind: "cause"; belief: BeliefId }      // creer en la causa: defender la casa, la fe, la venganza
  | { kind: "fear"; source: EntityRef }      // un cultivador, una bestia, un presagio, una formación desconocida
  | { kind: "home"; pull: number }           // la cosecha, la familia, la distancia
  | { kind: "loot"; expected: number };      // esperanza de saqueo
```

- **Es la misma psicología de siempre** (npc-psychology): miedo, lealtad, cara, utilidad. En tier alto, cada soldado cercano al jugador decide; en agregado, la unidad tiene una distribución de disposición y el quiebre sucede cuando una fracción crítica decide irse.
- **El contagio:** ver huir al de al lado baja el umbral del resto. Las unidades rotas arrastran a las vecinas. Lo contrario también: un oficial que se queda, un cultivador que mata al monstruo, el estandarte que sigue en pie.
- **Cohesión:** cuánto se mantiene la unidad junta como cuerpo (entrenamiento, tiempo juntos, mismo origen, oficiales respetados). Una unidad cohesionada puede retroceder en orden; una sin cohesión que retrocede se desbanda.
- **El miedo a lo sobrenatural:** los mortales frente a un cultivador que vuela o mata con un gesto tienen un driver de miedo enorme, salvo que crean en una protección (talismanes, un cultivador propio, fe). Esto hace que **la percepción** del poder enemigo pese tanto como el poder real: un cultivador débil que parece fuerte rompe unidades.
- **Después:** la moral alta tras una victoria y el saqueo produce abusos; la derrota produce deserción, motín y bandas. Los sobrevivientes cargan trauma (npc-psychology: memoria y demonios internos) que sigue en la paz.
- **Deserción:** no es un evento aleatorio: es la decisión de una persona con hambre, sin paga, lejos de casa y con miedo, contra lo que cree del castigo (law: deserción). Los desertores son personas que existen y van a algún lado: a casa, a una banda, al enemigo.

## 5. Mando, órdenes e información

- **Cadena de mando:** la fuerza es una organización (organizations) con puestos: general, oficiales, mensajeros. Las órdenes son órdenes de organizations §5 con su **brecha de ejecución**: llegan tarde, se entienden mal, se cumplen según la utilidad del que las recibe (un oficial que no quiere atacar llega tarde a propósito).
- **Mensajeros:** a caballo, a pie, por pájaros, por talismanes de transmisión, por sentido espiritual de un cultivador. La velocidad del mensaje fija cuánto puede coordinar un ejército; los medios mágicos dan ventaja enorme y se pueden interceptar o falsificar.
- **Exploradores:** son percepción (perception): ven lo que ven, a la distancia que llegan, con errores. Un explorador muerto no informa; uno comprado informa mal. Los cultivadores con sentido espiritual amplio ven mucho más, salvo contra ocultamientos y formaciones de velo.
- **La imagen del general:** el comandante decide sobre su `beliefs`, que es la suma de informes viejos, rumores, mapas (que son creencias: information) y su propia psicología. Puede atacar un ejército que ya se movió o defender un paso que nadie va a usar.
- **Engaño:** fuegos de campamento falsos, retiradas fingidas, banderas cambiadas, ilusiones de formación, cultivadores que ocultan su reino, espías que llevan planes falsos. Son intrigas (schemes) dentro de la guerra; funcionan porque actúan sobre creencias.
- **Consejos de guerra:** la decisión de dar batalla se toma en deliberación (organizations §4): generales con facciones, cultivadores de secta que no obedecen, un príncipe que quiere gloria. Las peores batallas salen de compromisos entre facciones.

## 6. Marcha y campaña

- **Movimiento sobre la grilla:** la fuerza se mueve celda por celda (planet-gen) a la velocidad de su elemento más lento (los carros, la infantería, los heridos), modificada por terreno, caminos, clima, estación, cansancio y tamaño (un ejército grande es lento: tarda horas en salir de un campamento).
- **Pasos, ríos y fortalezas:** el terreno canaliza. Un paso de montaña o un vado son lugares donde pocos detienen a muchos; las fortalezas se construyen ahí por algo.
- **Campamento:** cada noche la fuerza ocupa espacio, consume, ensucia el agua y se defiende o no. Un campamento mal puesto es una invitación a una emboscada o a la epidemia.
- **El campo de qi:** marchar por una región de qi denso o envenenado afecta a los cultivadores (recuperan más rápido o se intoxican: cultivation, elements); las formaciones del enemigo pueden esperar en el camino.
- **Campañas:** una campaña es una secuencia de marchas, maniobras, asedios y batallas con un objetivo. En agregado, se resuelve como proceso sobre las presiones (suministro, moral, fuerza relativa, terreno) sin batalla a batalla.

## 7. Batalla

Una batalla (`Engagement`) es un encuentro armado con lugar, tiempo y participantes. Se resuelve a la escala que corresponda (§15), siempre con las mismas entradas.

```ts
interface Engagement {
  id: EngagementId;
  war?: WarId;                               // puede haber batallas sin guerra declarada
  kind: "pitched" | "skirmish" | "ambush" | "raid" | "assault" | "sortie" | "duel" | "naval";
  location: CellId[];                        // el terreno real, con su campo de qi y su clima en ese momento
  sides: EngagementSide[];
  phases: EngagementPhaseId[];               // despliegue, choque, persecución, en tier alto
  outcome?: EngagementOutcome;               // quién quedó con el campo, bajas, cautivos, botín, quién huyó adonde
  originEventId: EventId;                    // la orden de atacar, el encuentro casual, la emboscada
}

interface EngagementSide {
  forces: ForceId[];
  deployment: DeploymentId;                  // dónde puso cada unidad (o "sin despliegue" si lo sorprendieron)
  awareness: number;                         // cuánto sabía del enemigo antes de empezar
}
```

### Lo que entra
- **Números, equipo, entrenamiento, cohesión, moral, cansancio, salud** de cada unidad.
- **Terreno:** altura, cobertura, ríos, barro, espacio para maniobrar (la caballería no carga en un bosque).
- **Clima y hora:** lluvia que moja cuerdas de arco, viento para el humo y las flechas, niebla, noche.
- **Sorpresa:** `awareness` del lado sorprendido; una emboscada exitosa es casi siempre decisiva.
- **Mando:** la calidad del comandante (habilidad, información, autoridad) y la brecha de ejecución de sus órdenes durante la batalla.
- **Poder sobrenatural:** cultivadores, formaciones, talismanes, bestias, artefactos, con su física real (§8, elements).

### Cómo se resuelve
- **Las bajas son heridas.** No hay "puntos de vida de unidad": lo que sale de una batalla es gente herida por parte del cuerpo (body-health), muertos, cautivos y dispersos. En agregado, una distribución de heridas por tipo de arma; cerca del jugador, heridas concretas en personas concretas. Los heridos después se infectan, se curan o mueren según los médicos que haya.
- **La mayoría muere en la huida.** Las bajas grandes llegan cuando una unidad se rompe y la persiguen; mientras aguanta en formación, pierde poco. Por eso la moral (§4) decide más batallas que la fuerza bruta.
- **El ganador es quien se queda con el campo**, con lo que eso trae: los heridos del enemigo, el equipo abandonado, los muertos para enterrar o saquear. Una victoria puede ser tan cara que deja al vencedor sin capacidad de seguir.
- **Duelos:** en culturas que los tienen, campeones o cultivadores pelean antes o en lugar de la batalla; el resultado pesa en la moral de los dos lados (y a veces decide la guerra, si los dos lados lo creen así).

## 8. Mortales y cultivadores

La pregunta central de la guerra en un mundo xianxia: qué puede un ejército contra quien puede volar, ver a kilómetros y romper murallas.

### Lo que puede un cultivador
- **Poder en combate** (cultivation §11): umbral, esencia disponible, técnicas y dominio, cuerpo, equipo, estado. Contra mortales sin protección, un cultivador de reino medio es una catástrofe ambulante: mata decenas por técnica, rompe formaciones, aterroriza.
- **Pero gasta.** Cada técnica consume esencia, y la esencia se recupera con tiempo, meditación, píldoras o piedras (cultivation, economy). Un cultivador que mató doscientos soldados puede estar vacío al final del día. Las heridas también cuentan, y las de un cultivador no siempre se curan rápido.
- **Y es una persona.** Tiene miedo, cara, maestro, discípulos, una tribulación por delante, karma que no quiere acumular (heaven-karma). Puede negarse a masacrar mortales, retirarse para no arriesgar su camino, cambiar de bando.

### Lo que puede un ejército mortal contra un cultivador
- **Números y cansancio:** ningún cultivador de reino bajo o medio aguanta indefinidamente; olas de soldados que se sacrifican lo vacían. Es caro en vidas, y por eso funciona solo con moral muy alta o con soldados obligados.
- **Armas preparadas:** ballestas con flechas de talismán, redes con hilos de cobre espiritual, venenos que atacan meridianos (body-health), polvos que alteran el qi del aire, artefactos fabricados por cultivadores aliados (crafts).
- **Formaciones:** grafos sobre el campo (crafts §6) que concentran la fuerza de muchos mortales, atrapan, debilitan o sellan. Una formación de batalla bien hecha y alimentada es lo que deja a un estado mortal tener voz frente a cultivadores. Romper sus nodos es tarea de cultivadores.
- **Terreno y elementos:** un campo de qi adverso (elements) debilita técnicas; un lugar con ley de supresión (si el mundo lo tiene) iguala.
- **Otros cultivadores:** casi siempre, la respuesta a un cultivador es otro. Las guerras grandes se deciden por cuántos cultivadores trae cada lado y qué tan fuertes son; los mortales sostienen el territorio, la logística y el cerco.

### Guerra entre cultivadores
- **Pocos y decisivos:** un enfrentamiento de sectas puede ser una docena de personas en el aire. Los duelos de técnica se resuelven con la física de elements (cada choque es un `interact`) y el estado de cada uno.
- **Daño colateral:** dos cultivadores de reino alto peleando arrasan valles, cambian el curso de ríos, envenenan el campo de qi por años (living-world, elements). Eso tiene causa y queda en el mundo.
- **Se cuidan:** los poderosos rara vez se enfrentan a muerte si pueden negociar, porque morir termina el camino y matar a otro poderoso trae a su maestro, su secta y su karma. Muchas guerras de sectas se pelean con los discípulos mientras los ancianos miran y negocian.
- **Exterminio:** cuando sí pelean a muerte, apuntan a la raíz (el linaje, el maestro, los discípulos, la herencia) para que no haya venganza. El exterminio de una secta es el evento más grande de deuda de sangre que puede haber.

### Equilibrio por mundo
La relación entre mortales y cultivadores no es fija: depende del mundo (metaphysics: qué tan fuertes son los umbrales), de la era (heaven-karma: cuántos cultivadores hay) y de la tecnología (pólvora, si el mundo la permite). En algunos seeds los estados mortales son casi irrelevantes; en otros, una formación de diez mil soldados le gana a un núcleo dorado.

## 9. Fortificaciones, formaciones defensivas y asedios

### Defensas
- **Murallas, fosos, torres, puertas:** construcciones con material, mano de obra y tiempo (economy, crafts: oficios mortales). Se deterioran sin mantenimiento.
- **Formaciones defensivas:** grafos sobre el lugar (crafts §6) que protegen, alertan, desvían, confunden o atacan. Necesitan **fuente de energía** (vena de qi del lugar, piedras espirituales, el qi de los defensores) y **nodos** físicos que se pueden encontrar, robar o romper. Una ciudad con formación de protección y una vena debajo es mucho más dura que una que la alimenta con piedras compradas.
- **Las sectas son fortalezas:** su montaña tiene la vena, las formaciones de generaciones y los ancianos. Asaltar una secta sin entender su formación es suicidio; la mayoría caen por dentro (traición, un nodo saboteado, el tesoro de piedras robado).

### Asedio
```ts
interface Siege {
  engagement: EngagementId;                  // el asedio es un engagement largo con fases
  besiegers: ForceId[];
  defenders: ForceId[];
  target: SettlementId | SiteId;             // ciudad, fortaleza, montaña de secta
  method: SiegeMethod[];                     // pueden combinarse y cambiar
  insideStocks: LotId[];                     // lo que tiene la ciudad: graneros, agua, piedras para la formación
  insidePopulation: PopulationRef;           // civiles que comen y enferman
  formationState?: FormationInstanceId;      // energía, nodos intactos, grietas
}

type SiegeMethod = "blockade" | "assault" | "mining" | "engines" | "formation_breaking"
                 | "treachery" | "disease" | "water_diversion" | "negotiation";
```

- **Bloqueo:** cortar todo lo que entra y esperar. Se gana por hambre (las raciones adentro se cuentan), sed o por vaciar las piedras que alimentan la formación. El sitiador también come y también enferma, y tiene que sostener su línea de suministro durante meses.
- **Asalto:** escalas, torres, arietes, brechas; caro en vidas y decisivo. Contra una formación activa, primero hay que romperla.
- **Minas y máquinas:** cavar bajo las murallas, catapultas y trabuquetes (y lo que la tecnología del mundo permita). Fabricarlas es un oficio con materiales (crafts).
- **Romper formaciones:** encontrar los nodos (percepción, espías, planos robados), desbordar su capacidad con ataques sostenidos, cortar su fuente (desviar la vena, robar las piedras), o usar un maestro de formaciones que lea el grafo y encuentre su punto débil.
- **Traición:** casi siempre es más barato comprar una puerta que romperla. El defensor que no paga a su guarnición o tiene facciones adentro está en peligro.
- **Adentro:** la ciudad sitiada es una economía cerrada: los precios suben, el racionamiento genera conflicto, los ricos acaparan, aparecen enfermedades, la moral cae. Cada día es un tick de esa presión. Cuando se rinde, los términos (contratos) deciden si hay saqueo.
- **Saqueo de ciudades:** una ciudad tomada por asalto, en muchas culturas, se saquea. Es transferencia de bienes, muertes, violaciones, cautivos, incendios y deudas de sangre: todo eso queda registrado y pesa en la reputación, el karma y la memoria de la región por generaciones.

## 10. Cautivos, rehenes, rescates y botín

- **Cautivos:** los capturados en batalla son personas (social-structure: nunca bienes). Lo que se hace con ellos depende de la cultura, el valor que tienen y la utilidad de quien decide: liberarlos, pedir rescate, alistarlos, esclavizarlos (donde la norma existe: social-structure, law), venderlos, matarlos. Matar cautivos rendidos es un acto con karma y reputación propios.
- **Rescate:** un compromiso (contracts) entre captores y la familia o el señor del cautivo. Su precio sale de lo que se cree que vale (rango, linaje, cultivo) y de lo que la otra parte puede pagar; mientras se negocia, el cautivo vive, enferma, intenta escaparse o cambia de lealtad.
- **Rehenes:** personas entregadas como garantía de un tratado o una tregua (contracts: garantías). Hijos de señores criados en la corte enemiga: crecen con lealtades partidas, aprenden la cultura del otro, a veces vuelven como aliados y a veces como agentes.
- **Cultivadores cautivos:** contenerlos requiere sellos (contracts: sellos en el alma), cadenas especiales o formaciones; si no, se escapan. Son el botín más valioso y el más peligroso.
- **Botín:** todo lo que se toma (armas, monedas, granos, ganado, tesoros, manuales de técnica, píldoras) es **transferencia de tenencias con origen** (economy): no aparece riqueza nueva, cambia de manos, y lo robado lleva su historia (un tesoro de secta saqueado tiene dueños que lo reclaman). Cómo se reparte (el señor primero, los oficiales, la tropa) es fuente de motines.
- **Saqueo de herencias:** en guerras de sectas, la biblioteca de técnicas, la cámara de tesoros y las herencias de los ancianos son el premio real. Tomarlas te ata a su karma (heaven-karma §2).

## 11. Cómo termina una guerra

- **Cansancio de guerra:** `exhaustion` de cada bando sube con las bajas, el tesoro vacío, las levas que no vuelven, la hambruna, las derrotas y el descontento interno. Es una presión que empuja a quien decide a negociar, y en agregado entra al proceso de paz.
- **Treguas:** compromisos temporales (contracts) para enterrar muertos, pasar el invierno, negociar. Se rompen cuando a alguien le conviene y alguien puede hacerse cargo de la ruptura.
- **Tratados:** el fin formal: territorio cedido, tributo, vasallaje, matrimonios, rehenes, indemnizaciones, fronteras nuevas. Es un `Commitment` con garantías y ejecutores (contracts); vale lo que vale la fuerza o la creencia que lo sostiene, y las cláusulas humillantes son semilla de la próxima guerra.
- **Rendición, conquista y anexión:** un bando deja de existir como tal; su territorio pasa a otro (state: reclamo, alcance y registros nuevos), su élite se integra, huye o muere, y sus súbditos ahora tienen otro señor que no conocen.
- **Guerras que se apagan:** muchas no terminan con tratado: las partes simplemente dejan de pelear, y el estado de guerra sigue en los papeles y en las creencias durante décadas.
- **Paz con legados:** los odios (relaciones entre organizaciones), las deudas de sangre entre familias y clanes, las fronteras discutidas y los relatos del vencedor (information, crónica) quedan.

## 12. Costumbres de guerra, crímenes y karma

- **Costumbres por cultura:** cada cultura tiene normas sobre la guerra (law: código; social-structure: normas de estatus): declarar antes de atacar, respetar mensajeros, no matar rendidos, perdonar a los templos, pedir rescate a nobles, cómo se trata a mujeres y niños, si se puede envenenar pozos. Son normas, no leyes físicas: se rompen, y romperlas tiene costo en reputación, aliados y moral propia.
- **Ley marcial:** dentro de una fuerza o de una zona de guerra rigen procedimientos rápidos (law): deserción, cobardía, saqueo no autorizado, insubordinación. El castigo ejemplar es una herramienta de moral que funciona mientras la tropa crea que se aplica.
- **Crímenes de guerra:** masacres, matar emisarios, romper una tregua jurada, envenenar una ciudad, exterminar civiles. Su consecuencia legal depende de quién gana y quién juzga; su consecuencia social, de quién se entera y qué cree.
- **El karma sí ve la verdad.** Matar en batalla crea deudas de sangre (heaven-karma §2) como cualquier muerte, con peso según el contexto real: defender tu casa no pesa como masacrar rendidos. El general que ordena carga parte del karma de lo que ordena. Romper una tregua jurada ante el Cielo es romper un juramento (contracts §9). Los cultivadores que creen en el karma lo calculan antes de una masacre, y las tribulaciones de quien no lo hizo lo recuerdan.
- **Campos de batalla:** las muertes masivas violentas pueden dejar almas ancladas y espíritus de lugar (spirits): campos donde nadie quiere acampar, energía de resentimiento que contamina el qi (elements), recursos para cultivadores de caminos oscuros.

## 13. Lo que la guerra deja en el mundo

- **Devastación:** campos quemados o sin trabajar, ganado robado, aldeas vacías, canales sin mantener. La producción cae por años (economy) y el hambre sigue a la guerra aunque haya terminado.
- **Refugiados:** gente que huye y llega a otro lado con lo que puede cargar: presión sobre ciudades, precios, enfermedades, conflictos con los locales, mano de obra barata, nuevos barrios.
- **Epidemias:** ejércitos y refugiados llevan enfermedades (body-health: contagio) por las rutas.
- **Demografía:** hombres jóvenes muertos, viudas, huérfanos, familias que se rehacen (family-lineage); en agregado, cambia la pirámide de edad de una región por una generación.
- **Veteranos:** con heridas permanentes, trauma, habilidades militares, quizás sin tierra. Se vuelven guardias, bandidos, maestros de armas, señores locales o mendigos.
- **Ascenso y caída social:** la guerra mueve la estructura social (social-structure): plebeyos que ascienden por las armas, nobles arruinados, nuevos señores de la guerra (state §13), esclavizados.
- **Economía:** deudas del tesoro, moneda rebajada, precios del hierro y el grano, comercio cortado y rutas nuevas, botín que enriquece a unos pocos.
- **Memoria:** la guerra entra a las creencias como relato, con la versión de cada bando (information), y a la historia profunda como evento de alta relevancia (deep-history) que alimenta odios, mitos y la próxima guerra.

## 14. El jugador y el narrador
- **El jugador vive las guerras de su mundo** aunque no las quiera: lo levan, le requisan la cosecha, su ciudad es sitiada, huye como refugiado, su secta lo manda al frente, su familia pierde a alguien.
- **Puede elegir su lugar:** soldado raso, oficial, explorador, cirujano de campaña, proveedor que se enriquece, mercenario, desertor, cultivador contratado, general, estratega, espía, traidor que vende una puerta, comerciante de cautivos, señor de la guerra. O mantenerse lejos, si puede.
- **Ve la guerra desde su lugar:** en tier alto, la batalla alrededor del personaje se resuelve con detalle (las unidades cercanas, las personas concretas, sus heridas) y el resto a la escala que corresponde. Sabe lo que ve y lo que le dicen; el resultado general de la batalla puede enterarlo días después, o nunca bien.
- **Sus actos tienen el mismo peso que los de cualquiera:** si masacra rendidos, carga ese karma; si salva al hijo del general enemigo, eso crea una deuda de vida; si cobra un rescate, es parte de un compromiso.
- **El narrador** cuenta la guerra desde los sentidos del personaje: el ruido, el miedo, el barro, el compañero que cae, el rumor de que el flanco se rompió. Nunca narra el despliegue enemigo que el personaje no ve, ni el resultado de la batalla antes de que le llegue. La violencia se narra con el peso que tiene, sin regodeo.

## 15. Escala (LOD)
- **Tier 0 (historia agregada):** las guerras son procesos sobre presiones: fuerza relativa percibida, logística (distancia, rutas, graneros), cansancio, alianzas. Las campañas se resuelven como procesos de riesgo con resultados (territorio, bajas, botín, tratados) y dejan sus consecuencias (demografía, devastación, odios, deudas de sangre) en el estado agregado.
- **Tier 1 (región sin jugador):** campañas con fuerzas como agregados que se mueven por la grilla, consumen y se enferman; batallas resueltas en una sola tirada por engagement sobre sus entradas (§7), con bajas como distribuciones de heridas.
- **Tier 2 (cerca del jugador):** batallas por fases (despliegue, choque, persecución), unidades con moral y cohesión propias, oficiales concretos, cultivadores resueltos con elements en modo resumido.
- **Tier 3-4 (donde está el jugador):** el entorno inmediato con personas concretas, heridas por parte, técnicas tick a tick y percepción completa; el resto de la batalla sigue en tier 2 y entra por información.
- **Materialización:** un veterano que aparece trae de la distribución de su unidad la batalla en que estuvo, sus heridas, su trauma y lo que cree que pasó.

## Implementación
- **Fase 5:** bandas y milicias; escaramuzas y emboscadas resueltas con las entradas de §7; consumo diario de una fuerza pequeña; cautivos y rescates simples.
- **Fase 6:** fuerzas como organizaciones (mando, órdenes con brecha, deserción); logística con líneas de suministro y forrajeo que agota celdas; moral con drivers; guerras de sectas con cultivadores y formaciones.
- **Fase 7:** guerras en la historia agregada (procesos sobre presiones con consecuencias demográficas, económicas y kármicas); conquistas y anexiones con legados.
- **Fase 8:** batallas por fases con despliegue y terreno, asedios completos (economía interna, formaciones, minas, traición), epidemias de campamento, refugiados, treguas y tratados con garantías, costumbres de guerra por cultura, campos de batalla con espíritus.

## Tests
- **Conservación:** el grano que comió un ejército en una campaña es igual a lo que salió de graneros, compras, requisas y saqueos; el botín de un bando es pérdida de otro.
- **La regla del carro:** con todo igual, una fuerza a quince días de su base por tierra recibe menos que una a quince días por río.
- **Forrajeo:** una fuerza quieta en una celda agota su comida y su moral cae por hambre; las aldeas de la celda pasan hambre después.
- **Moral decide:** dos fuerzas iguales en número y equipo, una sin paga y con hambre: la hambrienta se rompe antes y sufre más bajas en la persecución.
- **Niebla:** un comandante con informes viejos ataca la posición donde el enemigo estaba, no donde está.
- **Cultivador vs ejército:** un cultivador de reino medio sin apoyo, contra olas suficientes de mortales con armas preparadas, se vacía de esencia y se retira o cae; sin armas preparadas, los mortales se rompen por miedo antes.
- **Asedio:** una ciudad bloqueada con la formación alimentada por piedras compradas cae antes que una igual con vena de qi propia, a igualdad de raciones.
- **Karma:** matar rendidos produce deudas de sangre de mayor peso que matar en combate; el general que ordenó una masacre recibe karma por ella.
- **Sin tablas:** ninguna guerra empieza sin un asunto deliberado en alguna organización con causas registradas.
- **Determinismo:** mismo seed, mismas acciones → mismas guerras, batallas, bajas, cautivos y tratados.

## Decisiones tomadas en este borrador (revisables)
- La guerra es una decisión de organizaciones con utilidad sobre creencias; no hay eventos de guerra aleatorios.
- La logística es tenencias que se mueven por rutas, con conservación estricta; no hay "suministro abstracto".
- La moral es psicología agregada con drivers legibles, y las bajas grandes llegan en la huida.
- Las bajas son heridas en el modelo de body-health, no puntos de vida de unidad.
- Los cultivadores son poderosos pero finitos (esencia, cansancio, karma, psicología); el equilibrio mortales–cultivadores es por mundo.
- El karma de la guerra lee la verdad (contexto real de cada muerte, responsabilidad de quien ordena).
- Los cautivos son siempre personas; esclavizarlos depende de las normas de cada cultura.

## Preguntas abiertas
- Calibración: consumo diario por persona, animal y bestia; pérdida por distancia en carros, porteadores y barcos.
- Calibración: umbrales de quiebre de moral y velocidad de contagio; bajas típicas en choque vs persecución.
- Calibración: cuántos mortales equivalen a un cultivador por umbral, con y sin armas preparadas y formaciones (que varíe por mundo).
- Calibración: duración típica de asedios según raciones, formación y fuente de energía; velocidad de las epidemias de campamento.
- Calibración: peso kármico de las muertes en guerra según contexto (defensa, batalla, rendidos, civiles) y fracción que carga quien ordena.
