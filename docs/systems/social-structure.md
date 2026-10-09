# Estratificación social

> Estado: **borrador de diseño**. Quién está arriba y quién abajo, por qué y para quién: estamentos y castas como normas culturales, clase como riqueza real, poder como cultivo real, prestigio como creencia; cómo se percibe la posición de alguien (marcas, habla, porte, presión del cultivo) y cómo se falsifica; deferencia y etiqueta; servidumbre, servidumbre por deudas y esclavitud como compromisos impuestos; el abismo entre mortales y cultivadores; movilidad hacia arriba y hacia abajo con causa; cómo se reproducen las élites; legitimidad de la jerarquía y revueltas; qué puede hacer cada uno, sin menús cerrados.

Depende de: [causality.md](causality.md) (procedencia, presiones y descargas, conservación), [npc-psychology.md](npc-psychology.md) (cara, identidad, sesgo de grupo, distancia de los longevos, esquemas, resentimiento, utilidad), [information.md](information.md) (reputación por comunidad, conocimiento colectivo, secretos, documentos, alfabetización), [perception.md](perception.md) (percepción social, identificar personas, leer el cultivo ajeno, disfraces), [contracts.md](contracts.md) (bases norma e imposición, capacidad para obligarse, sellos en el alma, servidumbre por deudas), [economy.md](economy.md) (tenencias, hogares, trabajo, renta, tributo, crédito y quiebra), [organizations.md](organizations.md) (rangos, puestos y legitimidad, ingreso, normas y penas, sectas por encima de la ley, cara colectiva), [family-lineage.md](family-lineage.md) (nacimiento, herencia, matrimonios dentro del estrato, hijos de concubinas y sirvientes, linajes de sangre), [cultivation.md](cultivation.md) (talento, reinos, longevidad, el cultivador en la sociedad), [heaven-karma.md](heaven-karma.md) (karma de esclavizar y oprimir; el Cielo lee la verdad, no el rango), [living-world.md](living-world.md) (la geografía hace a las culturas, lenguas, religiones), [metaphysics.md](metaphysics.md) (especies, otras familias de mundos), [deep-history.md](deep-history.md) (conquistas y castas que vienen de épocas pasadas). Lo usan: [contracts.md](contracts.md) (quién puede obligarse, servidumbre), [economy.md](economy.md) (formas de trabajo no libre), [family-lineage.md](family-lineage.md) (castas por nacimiento, hijos de concubinas, víctimas del cultivo dual parasitario), [organizations.md](organizations.md) (rangos de sirvientes, castas hereditarias), [law.md](law.md) (quién puede declarar, penas por estamento, delitos contra superiores), [state.md](state.md) (nobleza, exámenes imperiales, registros de población, tributo y corvea), [war.md](war.md) (cautivos, levas, botín humano), [divination.md](divination.md) (destinos "por encima de su estación"), y [chronicle.md](chronicle.md) (el ascenso o la caída como arco de vida).

## Principios
1. **No hay un número de "clase".** La posición de alguien es un **haz de dimensiones** que no siempre coinciden: estatus legal o ritual (lo que la norma dice que sos), riqueza (lo que tenés de verdad), poder (lo que podés hacer, sobre todo con el cultivo), prestigio (lo que los demás creen de vos), parentesco y linaje, oficio y puesto. El mercader rico de casta baja, el noble arruinado, el discípulo externo de una secta grande frente al anciano de una secta chica: la tensión entre dimensiones es el drama.
2. **El estatus es una norma cultural que se cumple mientras se crea.** "Siervo", "noble", "intocable", "ciudadano" son categorías en `content/` por cultura, con derechos, deberes y marcas. Que alguien **sea** siervo es un hecho social: un registro, un compromiso impuesto, una creencia compartida. El siervo fugado que llega a otra provincia es libre en la práctica mientras nadie lo reconozca, aunque en su aldea siga siéndolo.
3. **El poder es verdad.** La riqueza (tenencias) y el cultivo (reino real) existen en `WorldTruth`. La jerarquía de los mortales es convención; la distancia entre un mortal y un cultivador de núcleo dorado es física. Por eso el abismo mortal/cultivador no se borra con una revuelta, y las jerarquías mortales sí.
4. **Nada está bloqueado, todo tiene precio.** No hay menús de acciones por estamento. El jugador y los NPCs pueden intentar cualquier cosa; lo que cambia es qué **pueden** físicamente, qué **tienen** para hacerlo y qué **les dejan** los demás. Un campesino puede hablarle a un señor sin permiso; el señor decide qué hace con eso, y la aldea lo ve.
5. **Toda posición tiene causa.** Nadie es noble, esclavo o anciano "porque sí": hay un nacimiento, una venta, una conquista, una sentencia, un examen, una ruptura. Toda categoría de estatus tiene su propio `originEventId` (la conquista que creó la casta, el edicto, la costumbre que nació de una hambruna).
6. **Las jerarquías se justifican con creencias, y las creencias se gastan.** Mandato del Cielo, karma de vidas pasadas, sangre, talento "elegido por el Cielo": cada cultura tiene su ideología, sostenida por fracciones de la población. Los eventos la erosionan o la refuerzan; cuando cae, la presión se descarga en fugas, bandidaje, cultos y revueltas.
7. **Conservación.** Nadie se vuelve rico subiendo de estamento: la tierra del nuevo noble sale de alguien. El trabajo de un siervo produce bienes que se lleva el señor; el precio de un esclavo es plata que pasa de mano. Las personas **nunca son lotes**: la propiedad sobre alguien es un compromiso impuesto que se transfiere (§7).
8. **Determinista.** `rng.fork("status", agentId, eventId)` para tiradas de reconocimiento y movilidad; `rng.fork("unrest", communityId, period)` para la descarga de presiones de revuelta. Nada más es azar.

## 1. La posición: un haz de dimensiones

```ts
// Vista derivada. Casi nada de esto se guarda: se calcula de lo que ya existe.
interface SocialPosition {
  agent: AgentId;
  statuses: StatusHolding[];           // estatus legal o ritual reconocidos (§2), puede haber varios y contradictorios
  wealth: WealthView;                  // de las tenencias reales del agente y su hogar (economy §2b)
  power: PowerView;                    // reino real de cultivo, fuerza física, armas, seguidores (verdad)
  offices: PositionId[];               // puestos en organizaciones y en el estado (organizations §3)
  memberships: MembershipId[];         // rango en cada organización
  lineage: LineagePrestige;            // prestigio de clan y de sangre (family-lineage §9)
  occupation: OccupationId[];          // oficio con su prestigio cultural (crafts, economy §3)
  reputation: ReputationRef[];         // por comunidad (information §9)
  identity: { culture: CultureId; ethnicity?: EthnicityId; species: SpeciesId; gender: GenderId; age: number };
}

// Cómo pesa cada dimensión en el rango percibido: varía por cultura y por observador
interface StratificationWeights {
  culture: CultureId;
  weights: Record<"status" | "wealth" | "power" | "office" | "lineage" | "occupation" | "reputation" | "age" | "gender", number>;
  powerOverrides: number;              // cuánto pisa el cultivo a todo lo demás (casi todo en mundos xianxia)
}
```

- **Rango percibido** = lo que un observador cree de cada dimensión del otro (§3), pesado con los `StratificationWeights` de **su** cultura y ajustado por sus esquemas (un resentido descuenta la sangre; un ambicioso sobrevalora la riqueza). No hay rango objetivo: hay tantos como observadores.
- **Inconsistencia de estatus.** Cuando las dimensiones no coinciden (el rico de casta baja, el cultivador nacido esclavo), aparecen presiones: el rico compra un título, casa a la hija con un noble pobre, financia un templo; los de arriba lo desprecian como advenedizo. Es una fuente de arcos sin escribirlos.
- **Cada cultura ordena distinto.** Una puede poner el oficio de comerciante abajo de todo aunque sea rico (士农工商); otra lo pone arriba. Una secta ordena por reino y contribución; un clan, por generación y rama; una banda, por fuerza y botín.

## 2. Estatus como norma cultural

```ts
interface StatusDef {                      // en content/, por cultura
  id: StatusId;                            // "noble", "plebeyo", "siervo", "esclavo", "sirviente_de_secta", "paria"
  culture: CultureId;
  rank: number;                            // orden ritual dentro de la cultura (puede contradecir la riqueza)
  acquisition: AcquisitionRule[];          // nacimiento (sigue al padre, a la madre, al peor de los dos), compra, sentencia, captura, deuda, concesión, examen, matrimonio
  markers: MarkerDef[];                    // vestimenta, peinado, tatuaje, marca a fuego, collar, nombre, formas de hablar, lugares donde vivir
  rights: RightDef[];                      // tener tierra, portar armas, declarar en juicio, casarse libremente, presentarse a examen, montar a caballo, mirar a los ojos
  duties: DutyDef[];                       // corvea, tributo, servicio de armas, servicio doméstico, obediencia
  protections: ProtectionDef[];            // cuánto cuesta dañar a alguien de este estatus (multa, precio de sangre, pena)
  capacity: CapacityDef;                   // qué compromisos puede contraer por sí mismo (contracts §3)
  exits: ExitRule[];                       // manumisión, compra de libertad, años de servicio, examen, adopción, ennoblecimiento
  sumptuary?: SumptuaryRule[];             // qué bienes le están vedados (seda, oro, colores, palanquines)
  originEventId: EventId;                  // la conquista, el edicto, la costumbre que nació de algo
}

interface StatusHolding {
  agent: AgentId;
  status: StatusId;
  basis: CommitmentRef | "birth" | "custom";   // compromiso impuesto (siervo, esclavo), norma de nacimiento, concesión
  recognizedBy: Array<CommunityId | OrgId>;    // quién lo reconoce: fuera de eso, el estatus no actúa
  evidence: EvidenceRef[];                     // registro, carta de venta, marca a fuego, edicto, genealogía, testigos
  since: Time;
  originEventId: EventId;
}
```

- **La verdad guarda los hechos; el estatus es lo que los demás reconocen.** En `WorldTruth` está que hubo una venta, un registro, un nacimiento de madre esclava. Si eso hace "esclavo" a alguien depende de quién lo reconozca. Como en el parentesco (family-lineage §5), el estatus puede reclamarse, falsificarse, disputarse y olvidarse.
- **Varios estatus a la vez.** Un sirviente de secta es libre ante el estado y súbdito ante la secta; un noble de un reino conquistado es noble para los suyos y vencido para los conquistadores. Cuando chocan, decide quién tiene poder en ese lugar.
- **Las normas de adquisición importan mucho.** Si el estatus de esclavo sigue a la madre, los hijos de un señor con una esclava son esclavos; si sigue al padre, son libres e ilegítimos. Esas reglas (`content/`) deciden quién nace dónde y quién disputa qué.
- **Protecciones desiguales.** Matar a un noble y a un siervo no cuesta lo mismo ante la ley de la cultura ([law.md](law.md) §1, §8) ni ante la opinión de la aldea. **Ante el Cielo sí** (heaven-karma): el karma lee el daño real, no el rango de la víctima.
- **Leyes suntuarias.** Vestir seda o un color reservado es un delito o un escándalo según la cultura. Se aplican con el poder de quien mira: un cultivador viste lo que quiere.

## 3. Percibir la posición de alguien
La posición se **lee**, con errores (perception §6, §7):
- **Marcas visibles:** ropa y su calidad, joyas, peinado, uniforme de secta, ficha de jade, tatuaje o marca a fuego, collar, el palanquín y los sirvientes. Todo se puede imitar, robar o esconder.
- **Habla:** acento, registro, vocabulario, formas de tratamiento, si sabe leer (information §6). El campesino que se viste de señor se delata al hablar, salvo que haya aprendido.
- **Cuerpo y porte:** manos de trabajo, piel curtida, postura, dientes, cicatrices de látigo, la forma de comer. Un esclavo liberado conserva señales años.
- **Presión del cultivo:** el aura de un cultivador se siente (perception §8). Ocultarla es una técnica; exhibirla es un acto social (intimidar, reclamar respeto). Un mortal no puede distinguir reinos altos entre sí: todo lo de arriba "es un inmortal".
- **Contexto:** con quién anda, dónde vive (barrio, patio interior o exterior de la secta), quién le habla con respeto.
- **Errores con forma:** se sobrestima a quien muestra riqueza y se subestima al que viaja humilde. El clásico "joven maestro" que desprecia a un viejo de ropa gastada que resulta ser un ancestro sale de acá, sin escribirlo.
- **Impostores y disfraces:** fingir un estatus más alto (estafa, espionaje) o más bajo (esconderse, viajar sin llamar la atención) es una acción con riesgo de ser descubierta. Fingir uno más alto cuesta caro si te descubren: es una ofensa a la cara de los que engañaste.

## 4. Deferencia, etiqueta y cara
- **La etiqueta es una norma cultural** (`content/`): quién saluda primero, quién se arrodilla, quién se sienta dónde, quién habla, a quién se mira, qué tratamiento se usa. Cumplirla es la expectativa; romperla es una ofensa cuyo tamaño depende de la distancia de rango y de los testigos (npc-psychology: cara).
- **La deferencia entra en la utilidad.** Ser deferente cuesta cara propia y da seguridad; no serlo da cara y atrae castigo. El NPC lo decide con sus valores, su temperamento, su resentimiento y lo que cree que puede pasar.
- **La respuesta a una ofensa** la decide el ofendido con su poder y su cara en juego: ignorarla (el poderoso magnánimo, el que no quiere testigos), castigarla él mismo, mandar a castigarla, o llevarla a su organización (organizations §14). El castigo de un superior a un inferior puede ser legal, ilegal o tolerado según la cultura.
- **Conocer la etiqueta es saber.** Cada uno conoce bien la de su estrato y mal la de los otros. Un plebeyo en una corte o un mortal en una secta comete errores sin darse cuenta; aprender la etiqueta es una habilidad que se practica.
- **Registros del narrador.** El narrador usa los tratamientos que el personaje usaría y recibiría según lo que cree de cada uno ("joven señor", "mayor", "anciano"), y no nombra un rango que el personaje no percibió.

## 5. Qué puede hacer cada uno
No hay listas de acciones por estamento. Una acción es posible si se cumplen tres cosas, y cada una se resuelve en la simulación (como requisitos, en [actions.md](actions.md) §5):
1. **Capacidad:** el cuerpo, el cultivo y el saber lo permiten (no podés volar sin el reino, ni leer sin haber aprendido).
2. **Medios:** tenés lo que hace falta (plata para el soborno, tierra para sembrar, un arma, un caballo, tiempo libre que el siervo no tiene).
3. **Contrapartes:** las acciones que necesitan a otros (comprar, entrar, casarse, presentarse a examen, ser oído en juicio) dependen de que el otro acepte, y el otro decide con lo que cree de tu posición.

| Estrato (ejemplos) | Lo que tiene a mano | Lo que le cuesta o le cierran los demás |
|---|---|---|
| Esclavo | Trabajo, fuga, robo pequeño, súplica, sabotaje, alianza con otros esclavos, ganarse al amo | Tener bienes propios (si la cultura no reconoce peculio), casarse sin permiso, declarar, moverse sin ser buscado |
| Siervo de la tierra | Trabajo de su parcela, mercado local, fiestas, quejas al señor, fuga, bandidaje | Irse de la tierra, vender la tierra, presentarse a examen, portar armas |
| Campesino libre, artesano | Comerciar, endeudarse, mandar un hijo a la prueba de una secta, migrar | Plazas buenas en sectas (sin recomendación), audiencias con autoridades, crédito barato |
| Mercader | Plata, información de precios, sobornos, comprar títulos y plazas | Respeto de la nobleza, cargos en culturas que lo desprecian |
| Noble, funcionario, jefe de clan | Tierra, siervos, tribunales, soldados, matrimonios de alianza | Desafiar a una secta fuerte; nada de esto pesa frente a un cultivador alto |
| Sirviente o discípulo externo de secta | Trabajo de secta, puntos de contribución, ver técnicas básicas, acercarse a un anciano | Recursos de cultivo, técnicas reales, protección si ofende a un interno |
| Cultivador de reino alto | Casi todo lo físico: viajar, matar, tomar | El Cielo (karma, tribulaciones), otros cultivadores, su propia secta, sus anclas |

- **El jugador escribe cualquier cosa.** El intérprete traduce la intención y la simulación la resuelve con estas tres condiciones: nunca "no podés hacer eso porque sos siervo", sino un señor que se ríe, un guardia que no deja pasar, un examen que pide un registro que no tenés.
- **Las puertas tienen guardianes.** Las entradas a la movilidad (prueba de secta, examen, gremio, corte) tienen jueces concretos con sesgos y precio (organizations §2). Ahí se juega la estratificación de verdad.

## 6. El abismo mortal/cultivador
- **Es físico.** Un cultivador de reino medio mata a cien mortales armados; uno alto, a una ciudad. Vive siglos; no envejece como ellos; no lo enferma lo que los mata. Ninguna convención mortal lo ata si no quiere.
- **Distancia, no maldad** (npc-psychology): los cultivadores fuertes miran a los mortales desde lejos. El círculo moral se achica con la diferencia de reino y de vida: casi siempre indiferencia, a veces protección por costumbre o por vínculo, a veces desprecio. El karma (heaven-karma) frena la masacre.
- **Los mortales como recurso.** Tributo de grano y trabajo, sirvientes, reclutas de talento, a veces ingredientes (lo prohibido: sangre, almas, hornos del cultivo dual parasitario, family-lineage §10). Lo que una secta toma de las aldeas a su pie es economía real (economy §14) y depende de lo que las aldeas creen que pasa si no pagan.
- **Familias elevadas por un cultivador.** Un hijo que entra a una secta y sube cambia la posición de toda su familia mortal: protección, tierra, matrimonios mejores, enemigos nuevos. Si muere o los olvida, la caída es brusca. Es el ascenso más común y el más frágil.
- **Pactos de no injerencia.** En algunos mundos, las sectas tienen tratados o normas para no meterse en asuntos mortales (o para no matar reyes), porque el desorden les cuesta tributo o atrae al Cielo. Son compromisos con ejecutores (contracts), no leyes del mundo: se rompen.
- **Lo que tienen los mortales contra los cultivadores:** número, venenos, formaciones compradas, otros cultivadores pagados o aliados, el estado si tiene sus propios cultivadores ([state.md](state.md) §10), la deuda kármica que el cultivador no quiere cargar antes de su tribulación, y la información (saber cuándo está en reclusión).
- **Escalera interna.** Entre cultivadores el abismo se repite: cada umbral separa. Un discípulo externo es para un anciano lo que un mortal para el externo. Sirvientes de secta (杂役) sin talento son el escalón más bajo de adentro y el más alto de los mortales de afuera.

## 7. Trabajo no libre: servidumbre, deudas y esclavitud
Todas son compromisos con base `imposed` o `norm` (contracts §2), con ejecutores concretos. **Nunca se modela a una persona como un bien.**

```ts
interface Bondage {                          // vista sobre un Commitment con status de servidumbre
  commitment: CommitmentId;
  kind: "serfdom" | "debt_bondage" | "chattel" | "penal" | "temple" | "sect_servant" | "soul_bound";
  holder: AgentId | OrgId;                   // quién tiene el derecho; se transfiere vendiendo el compromiso
  bound: AgentId;
  scope: Array<"labor" | "residence" | "marriage" | "body" | "offspring" | "property">;
  term?: Time | "until_paid" | "life" | "hereditary";
  peculium?: HoldingId;                      // lo que el siervo o esclavo tiene, si la cultura lo reconoce
  enforcers: EnforcerRef[];                  // fuerza del dueño, cazadores de esclavos, tribunal, comunidad, sello en el alma
  origin: "captured" | "sold_by_kin" | "self_sold" | "debt" | "sentence" | "born" | "kidnapped" | "tribute";
  originEventId: EventId;
}
```

- **Servidumbre de la tierra:** el siervo está atado a una parcela y debe trabajo o parte de la cosecha al señor. Se vende con la tierra. Tiene hogar propio y algún derecho según la cultura.
- **Servidumbre por deudas:** el deudor (o su hijo) sirve hasta pagar; el interés y la comida descontada hacen que casi nunca termine (economy §8). Es la vía más común hacia abajo en mundos mortales.
- **Esclavitud plena:** cautivos de guerra ([war.md](war.md) §10), secuestrados por bandidos, hijos vendidos en una hambruna, condenados. La "venta" transfiere el compromiso: la plata pasa de mano (conservación), la persona no es un lote ni tiene precio fijo; su precio sale de las creencias del mercado (salud, oficio, edad, belleza, docilidad percibida) como cualquier otro precio.
- **Servidumbre de secta y de templo:** sirvientes que trabajan a cambio de techo, comida y la esperanza de aprender algo. Formalmente libres, de hecho atados por deuda, miedo o falta de salida.
- **Esclavos sellados:** en mundos con cultivo del alma, un sello de esclavo (contracts §8) castiga la desobediencia desde adentro. Es la forma más dura y la que más karma carga. Se rompe si el sellado se vuelve bastante más fuerte que el que selló, o si el que selló muere.
- **Lo que hacen los no libres** sale de su psicología, no de un guion: obediencia, resistencia pasiva, sabotaje, fuga, robo, suicidio, ganarse al amo, comprar la libertad con el peculio, revuelta con otros. La esclavitud larga forma esquemas (indefensión, desconfianza, rabia contenida) y deja trauma (npc-psychology).
- **Salidas:** manumisión (testamento, gratitud, fiesta religiosa, edicto), compra de la libertad, fuga a donde no se reconozca el estatus, rescate por la familia, revuelta, cultivo (un esclavo que despierta raíces y alguien lo ve). Ser liberado no borra las marcas ni la reputación: el liberto es su propio estatus en muchas culturas.
- **El Cielo lee la verdad.** Esclavizar, vender a alguien y sellar un alma crean vínculos kármicos con las víctimas, sin importar lo que la cultura diga que es legal. La cultura que lo ve normal no siente culpa; el karma cae igual.

## 8. Movilidad
Toda subida o bajada es un evento con causa. Las tasas no se fijan: salen de cuántas puertas hay, cuánto cuestan y quién las cuida.

| Hacia arriba | Requisito real | Barreras |
|---|---|---|
| Prueba de secta | Talento (genoma) y suerte en el instrumento | Viaje, recomendación, soborno, cupos, sesgos del juez |
| Ruptura de cultivo | Recursos, técnica, comprensión | Todo lo que cuesta cultivar (cultivation) |
| Examen imperial o de templo ([state.md](state.md) §6) | Saber leer y años de estudio | Tutor, libros, tiempo sin trabajar: casi solo para hogares con excedente |
| Comercio y riqueza | Capital, información, suerte | Desprecio de la nobleza, gremios cerrados, robo |
| Mérito en guerra | Sobrevivir y ser visto | La guerra misma ([war.md](war.md) §13) |
| Matrimonio hacia arriba | Belleza, talento, dote, alianza útil | La familia del otro, la cara, la ley de estatus |
| Adopción, patronazgo | Que un poderoso te elija | Envidia de los de adentro |
| Compra de título o de libertad | Plata | Que el vendedor quiera; el desprecio al advenedizo |

| Hacia abajo | Causa |
|---|---|
| Deuda | Mala cosecha, enfermedad, juego, usura (economy §8) |
| Crimen y sentencia | Ley, organización, venganza de un superior |
| Conquista | La casta del vencido baja de golpe ([war.md](war.md) §11) |
| Caída del patrón | Muere el cultivador de la familia, cae la facción, se rompe la alianza |
| Deshonra | Escándalo, adulterio descubierto, cobardía, expulsión de la secta |
| Abolición del cultivo | Pena de secta, herida, desviación de qi: el cultivador vuelve a ser mortal entre los que despreció |

- **Generaciones.** Un hogar que sube tarda en consolidarse (tierra, matrimonios, educación de los hijos); uno que baja pierde primero la plata, después las alianzas y al final el nombre. La crónica ([chronicle.md](chronicle.md)) cuenta estas curvas.
- **Movilidad percibida vs real.** La gente cree que se puede subir según las historias que circulan (el leñador que se volvió inmortal). Esa creencia sostiene la jerarquía (§10) aunque la tasa real sea mínima.

## 9. Cómo se reproducen las élites
Sin reglas especiales, solo con lo que ya existe:
- **Herencia** de tierra, puestos y técnicas (family-lineage §8).
- **Matrimonios dentro del estrato** (family-lineage §6): las familias evalúan con creencias de posición y casi nunca casan hacia abajo.
- **Acceso desigual a las puertas:** tutores, libros, píldoras de nacimiento, recomendaciones, sobornos. El talento heredado da algo de ventaja (family-lineage §4); los recursos, mucha más.
- **Redes (关系):** relaciones de confianza y gratitud entre familias poderosas (npc-psychology §6). Una recomendación es un favor que se cobra.
- **Cierre:** las élites endurecen las reglas cuando sienten presión de abajo (más requisitos, cupos, leyes suntuarias). Es una decisión de personas en sus organizaciones, con causa.

## 10. Legitimidad, resentimiento y revuelta
- **Ideologías de la jerarquía** como creencias colectivas (information §9) con su fracción de creyentes por comunidad: "el emperador tiene el mandato del Cielo", "naciste esclavo por tu karma", "la sangre noble es pura", "el Cielo elige a los talentosos", "los cultivadores protegen a los mortales". Las religiones y escuelas (living-world) las enseñan o las niegan.
- **Lo que las erosiona:** hambre mientras el señor come, impuestos que suben sin protección, un superior castigado por nada, un humilde que sube (prueba de que el orden no es natural) o un noble que cae, profetas, rumores. **Lo que las refuerza:** prosperidad, protección real contra bestias y bandidos, fiestas y generosidad del señor, milagros atribuidos.
- **Resentimiento de clase** es la suma de relaciones con superiores concretos y con la categoría (`to: OrgId` o estrato): se acumula como presión por comunidad (causality).
- **Descargas:** fugas en masa, bandidaje (organizations: bandas que nacen del hambre), cultos milenaristas, sabotaje, motines (multitudes con umbrales: [npc-psychology.md](npc-psychology.md) §14), asesinato del señor, revueltas que se vuelven ejércitos ([war.md](war.md) §13) o nuevas dinastías ([state.md](state.md) §9, §13). Cuál se dispara depende del estado: organización previa, líderes, armas, apoyo de algún cultivador o secta.
- **Represión** es también una decisión con costo: soldados, karma, cara, la próxima revuelta.

## 11. Género, edad, especie y etnia
- **Son normas culturales** (`content/`), no leyes del mundo: qué puede hacer una mujer, un menor, un anciano, un extranjero, un medio-bestia. Cada cultura las tiene distintas y algunas se contradicen con las de al lado.
- **El cultivo las pisa a medias.** Una cultivadora fuerte manda en una cultura que no deja mandar a las mujeres, porque nadie se atreve a decirle que no; pero los mortales a su alrededor siguen con su norma, y la tensión es real. Lo mismo con la edad: un cultivador de 300 años con cara de 20.
- **Especies y etnias:** conquistas, migraciones y diferencias de poder (bestias que toman forma humana, razas con linajes de sangre) crean castas étnicas con su historia (deep-history). El sesgo de grupo (npc-psychology) las sostiene.

## 12. De dónde salen las estructuras
- **Generación en la historia** (deep-history, modo agregado): el excedente agrícola crea quien vive de él; la conquista crea castas de vencidos; la escasez de tierra crea siervos; las deudas en hambrunas crean servidumbre; la aparición del cultivo crea una aristocracia de sectas. Cada `StatusDef` se crea con un evento.
- **Cambio:** edictos ([state.md](state.md) §11), revueltas exitosas, conquistas, nuevas religiones, cultivadores que fundan reinos, epidemias que vacían el campo y suben el valor del trabajo (siervos que se van sin que nadie los pueda parar).
- **Por mundo:** en familias de mundo distintas (metaphysics) el eje de poder cambia: magos de linaje, clérigos con dioses reales, pactos. El modelo es el mismo; cambia qué dimensión pesa más.

## 13. El jugador y el narrador
- **Nacés donde la sim te pone.** El estrato del personaje sale del hogar en que nace (family-lineage §13): puede ser hijo de siervos, de mercaderes, de un clan cultivador menor o de esclavos. La simulación no lo elige para que sea "jugable".
- **Sabés tu lugar como creencia.** El personaje conoce su estatus, la etiqueta de su estrato y lo que cree de los demás; puede equivocarse con desconocidos (§3). Lo que los NPCs creen de su posición cambia cómo le responden.
- **Sin menús ni bloqueos** (§5): cualquier intención se intenta; las consecuencias las ponen los demás y el mundo.
- **El narrador** usa los registros y tratamientos que el personaje percibe, muestra la posición con detalles concretos (la mirada del guardia, el lugar en la mesa, las manos) y nunca dice el rango real de alguien que el personaje no identificó.

## 14. Escala (LOD)
- **Tier 0-1:** por asentamiento y cultura, distribución de población por estatus × deciles de riqueza × oficio; stocks de siervos y esclavos por dueño agregado; flujos de movilidad como tasas que salen de las puertas disponibles (cupos de sectas, exámenes, deudas que vencen); fracción de creyentes de cada ideología y presión de resentimiento por comunidad.
- **Tier 2+:** `StatusHolding` y `Bondage` individuales, rango percibido calculado en el momento de una interacción, ofensas de etiqueta como eventos.
- **Materialización:** un NPC que aparece toma su estatus, riqueza y oficio de la distribución de su comunidad, con hogar y compromisos coherentes (no se materializa un esclavo sin dueño ni un noble sin tierra).

## Implementación
- **Fase 1:** estatus mínimo de aldea (campesinos libres, un terrateniente, sirvientes), marcas visibles y rango percibido simple en la interacción; deferencia como parte de la utilidad del diálogo.
  - *Hecho (2026-10-07):* `src/sim/social` y `content/statuses/`; estatus por costumbre de fundación con evento causal, ropa (`fine`/`plain`/`worn`) como único canal visible, posición percibida sin errores, deferencia en el regateo de `trade`. Falta la deferencia en el diálogo (ítem «Conversación mínima»).
- **Fase 2:** creencias sobre la posición de otros con errores, etiqueta como norma y ofensas que cuestan cara.
  - *Hecho (2026-10-08, parte pura):* `sim/social/belief.ts` (`STANDING_BELIEFS`, `readStanding`, `updateBeliefs`: conocido = verdad con confianza 1, ropa = rango del atuendo con confianza 0,55 escalada por claridad, error a escalón vecino con sesgo de exhibición) y `sim/social/etiquette.ts` (normas en `content/etiquette/`, `judgeBreach` sobre lo que el ofendido CREE, `FACE`, `faceLoss`, `respondToOffense`, `exposureOffense`). Falta cablearlo al juego (percepción → creencias, diálogo → actos de etiqueta, vista y regateo leyendo la creencia) y las señales de habla/porte.
- **Fase 3:** `StatusDef` en `content/` con derechos, deberes, protecciones y capacidad; servidumbre por deudas desde los préstamos; movilidad por matrimonio, deuda y riqueza; resentimiento por comunidad.
- **Fase 4:** abismo mortal/cultivador: presión del cultivo como señal social, sirvientes de secta, familias elevadas por un hijo cultivador, tributo de aldeas a sectas.
- **Fase 6:** rangos de secta y clan sobre este modelo, cierre de élites en organizaciones, sellos de esclavo.
- **Fase 7:** generación de estructuras en la historia (conquistas, castas, ideologías) en modo agregado.
- **Fase 8:** nobleza y estado, exámenes, esclavitud de guerra, revueltas que se vuelven ejércitos, edictos que cambian estatus.

## Tests
- **Sin rango objetivo:** dos observadores de culturas distintas ordenan distinto a las mismas tres personas.
- **Estatus como reconocimiento:** un esclavo fugado en una comunidad que no reconoce su `StatusHolding` actúa como libre; si alguien lo reconoce, el ejecutor actúa.
- **Conservación:** vender un compromiso de esclavitud mueve plata entre tenencias y no crea ni destruye bienes; ninguna persona aparece en un inventario.
- **Sin bloqueos:** toda intención del catálogo se puede intentar desde cualquier estrato; la diferencia está en la resolución.
- **Karma independiente del rango:** matar a un siervo y a un noble crean el mismo tipo de vínculo kármico con pesos según el daño real.
- **Movilidad con causa:** todo cambio de `StatusHolding` tiene `originEventId` con causas (venta, sentencia, manumisión, examen).
- **Revuelta con causa:** en una corrida headless, toda revuelta tiene presión acumulada medible antes de dispararse; con prosperidad y protección sostenidas, la tasa baja.
- **Determinismo:** mismo seed, mismas acciones → mismas posiciones, ventas, fugas y revueltas.

## Decisiones tomadas en este borrador (revisables)
- La posición es un haz de dimensiones; el rango percibido se calcula por observador con pesos de su cultura.
- Los estatus son normas culturales reconocidas por comunidades y organizaciones; la verdad guarda los hechos (ventas, registros, nacimientos), no "quién es esclavo".
- Las personas nunca son bienes: la servidumbre y la esclavitud son compromisos impuestos que se transfieren.
- No hay acciones bloqueadas por estamento: capacidad, medios y contrapartes resuelven.
- El karma ignora el rango: lee el daño real.
- El estrato del jugador sale de la sim sin sesgo para hacerlo "jugable".

## Preguntas abiertas
- Calibración: tasas de movilidad por puerta (prueba de secta, examen, matrimonio, deuda) para que subir sea raro pero visible en cada generación de una aldea.
- Calibración: proporción de población no libre por tipo de cultura y era.
- Calibración: umbrales de presión de resentimiento para fugas, bandidaje y revueltas (que haya revueltas cada pocas generaciones en regiones mal gobernadas, no todos los años).
- Calibración: cuánto pesa el cultivo sobre las demás dimensiones (`powerOverrides`) por cultura.
- Calibración: velocidad de erosión y refuerzo de las ideologías de la jerarquía.
