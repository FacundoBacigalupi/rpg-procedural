# Estado y política

> Estado: **borrador de diseño**. Reinos, imperios, ciudades-estado, señoríos y dominios de secta: qué hace a un estado distinto de otra organización (reclamar territorio, cobrar, juzgar y usar la fuerza), hasta dónde llega su mano, cómo ve a sus súbditos (registros, catastros y censos que no coinciden con la verdad), impuestos con fugas en cada escalón, burocracia con brecha de ejecución, exámenes imperiales, la corte y sus facciones, legitimidad y presagios, dinastías y crisis de sucesión, la relación trono–secta, obras públicas, rebeliones, señores de la guerra y colapso.

Depende de: [organizations.md](organizations.md) (el estado es una organización: puestos, órganos, legitimidad, decisión por asuntos, facciones, tesoro, sucesión, relaciones, plantillas), [causality.md](causality.md) (presiones y descargas, conservación, capas 5-6), [economy.md](economy.md) (tenencias, impuestos como flujo, monopolios, acuñación y rebaja de ley, crédito, crisis, graneros), [social-structure.md](social-structure.md) (nobleza, estatus como norma, exámenes como puerta, legitimidad de la jerarquía, revueltas), [law.md](law.md) (códigos, magistrados, jurisdicciones, por encima de la ley, edictos), [contracts.md](contracts.md) (vasallaje, tratados, impuestos como obligación, juramentos de lealtad), [family-lineage.md](family-lineage.md) (dinastías, sucesión hereditaria, matrimonios de alianza, harenes), [information.md](information.md) (informes que se deforman, edictos que viajan, propaganda, mapas como creencia, alfabetización), [perception.md](perception.md) (lo que un funcionario ve de su distrito), [cultivation.md](cultivation.md) (cultivadores de estado, longevidad del gobernante), [heaven-karma.md](heaven-karma.md) (el Cielo no elige dinastías; las culturas creen que sí), [planet-gen.md](planet-gen.md) (terreno, ríos, distancia), [living-world.md](living-world.md) (rutas, culturas, desastres con causa), [deep-history.md](deep-history.md) (estados como legados entre épocas), [npc-psychology.md](npc-psychology.md) (utilidad, cara, ambición). Lo usan: [organizations.md](organizations.md) (plantilla de estado, tensión secta–estado), [economy.md](economy.md) (impuestos, monedas de estado), [law.md](law.md) (tribunales, apelaciones, inspectores, edictos), [social-structure.md](social-structure.md) (nobleza, exámenes, registros de población, tributo y corvea), [contracts.md](contracts.md) (vasallaje), [family-lineage.md](family-lineage.md) (dinastías, crisis de sucesión), y los futuros guerra (levas, logística, ejércitos de estado), tecnología (obras públicas, difusión por edicto), adivinación (astrólogos de la corte, presagios) y crónica (crónicas oficiales sesgadas).

## Principios
1. **Un estado es una organización con un reclamo.** Usa el modelo de [organizations.md](organizations.md) completo; lo que lo distingue es que reclama mandar sobre **todos** los que viven en un territorio, cobrarles, juzgarlos y usar la fuerza sobre ellos. Ese reclamo es una creencia que se cumple donde llega su fuerza y donde lo creen.
2. **El poder se gasta con la distancia.** La mano del estado llega lejos solo con caminos, guarniciones, funcionarios y tiempo. En el fondo del valle manda el terrateniente, la banda o la secta, aunque el mapa de la capital pinte todo del mismo color.
3. **El estado ve con papeles.** Sabe de sus súbditos lo que dicen sus registros, censos y catastros, que son documentos con errores, atrasos y mentiras. Cobra, recluta y gobierna sobre esa imagen, no sobre la verdad, y la distancia entre las dos es una fuente enorme de historia.
4. **Todo lo que hace, lo hace alguien.** Un edicto es una decisión de personas en la corte; cobrarlo, una cadena de funcionarios con su propia utilidad. Cada escalón deforma lo que sube (informes) y lo que baja (órdenes).
5. **Conservación fiscal.** El tesoro es una tenencia: lo que entra sale de los hogares, y lo que gasta (soldados, sueldos, obras, regalos a sectas) tiene que existir. Un estado sin plata rebaja la moneda, vende cargos, pide prestado o sube impuestos, y cada salida tiene consecuencias.
6. **La legitimidad es creencia con historia.** Sangre, mandato del Cielo, aval de una secta, victorias, graneros llenos: cada cultura cree en distintas fuentes, y los eventos (hambrunas, derrotas, presagios) las gastan o las refuerzan.
7. **Los cultivadores rompen el monopolio de la fuerza.** Ningún ejército mortal obliga a un cultivador fuerte. Todo estado de un mundo xianxia vive negociando con poderes que no puede controlar, y esa negociación define qué tipo de estado es.
8. **Nada está escrito sobre ciclos.** No hay "ciclo dinástico" programado: las dinastías caen cuando las presiones (registros podridos, tierra concentrada, tesoro vacío, legitimidad gastada) se descargan, y la forma de la caída sale del estado del mundo.
9. **Determinista.** `rng.fork("polity", polityId, eventId)` para decisiones de corte y crisis; `rng.fork("fiscal", polityId, period)` para fugas y evasión en modo agregado.

## 1. Qué es un estado

```ts
interface Polity {
  org: OrgId;                               // la organización que lo encarna (corte, nobleza, burocracia como órganos y puestos)
  claims: TerritoryClaim[];                 // lo que dice gobernar (en sus mapas y en sus tratados)
  reach: ReachField;                        // dónde manda de verdad, por celda (§2): verdad, calculada
  capital: SettlementId;
  admin: AdminUnitId[];                     // provincias, condados, feudos, distritos: árbol de unidades con su titular
  registers: RegisterId[];                  // censos, catastros, registros de hogares (§3)
  fiscal: FiscalSystem;                     // (§4)
  regime: RegimeAxes;                       // (§1, abajo)
  legitimacy: LegitimacySources;            // en qué fuentes dice apoyarse (§8)
  dynasty?: LineageId;                      // si hay una casa reinante (family-lineage §9)
  code: CodeId;                             // su código (law §1)
  armedForces: OrgId[];                     // ejército, guardias, cultivadores de estado (war, futuro)
  sectRelations: SectArrangement[];         // (§10)
  originEventId: EventId;                   // la conquista, la unión de clanes, la secta que tomó un valle
}

interface RegimeAxes {                      // ejes continuos, no tipos cerrados (como organizations §3b)
  concentration: number;                    // un soberano que decide todo ↔ señores que deciden casi todo
  bureaucratization: number;                // funcionarios pagos y rotados ↔ señores hereditarios con feudos
  hereditary: number;                       // sucesión de sangre ↔ elección, aclamación, prueba
  cultivatorRole: number;                   // trono mortal ignorado por sectas ↔ cultivadores en el trono
  sacrality: number;                        // el gobernante es un hombre ↔ el gobernante es sagrado
  participation: number;                    // nadie más decide ↔ asambleas, consejos de nobles o de ciudades
}
```

- **Formas que salen de la historia:** jefatura de clanes, ciudad-estado de mercaderes, reino feudal, imperio burocrático, confederación nómada, dominio de una secta que cobra a las aldeas de su valle, teocracia de un templo, reino de un cultivador que se coronó. No son tipos: son puntos en los ejes, y se mueven con eventos.
- **Estados dentro de estados.** Un imperio tiene reinos vasallos, ducados, sectas con territorio propio y ciudades con fueros. `parent` y los tratados de vasallaje (contracts) registran lo formal; quién obedece a quién se ve en las decisiones.
- **Lo que no es estado:** una secta que solo cobra tributo de protección no reclama juzgar ni registrar a nadie; un señor de la guerra sí empieza a hacerlo cuando dura. El paso es un evento (proclamarse, levantar un registro, acuñar moneda).

## 2. Territorio y alcance

```
reach(celda) = f(distancia en tiempo de viaje a la sede más cercana con fuerza,
                 guarniciones y funcionarios presentes, caminos y ríos (planet-gen, living-world),
                 lealtad de los poderes locales, terreno (montañas, pantanos, bosques))
```

- **El alcance es verdad** (inspector): cuánto de lo que ordena el estado se cumple en una celda. Baja con la distancia y el terreno, sube con guarniciones, caminos, postas y aliados locales.
- **Donde el alcance es bajo** mandan otros: el terrateniente, el clan, la secta del monte, la banda. Pagan (o no) lo que les conviene. Son los lugares donde nacen bandidos, contrabandistas y rebeliones.
- **El reclamo es creencia:** el mapa de la corte (information §5) dice qué es del reino; los de al lado tienen otros mapas. Las fronteras en disputa son creencias en choque con fuerza detrás.
- **Proyectar poder cuesta:** cada guarnición come, cada posta necesita caballos y cada camino, mantenimiento. Cuando el tesoro se achica, el alcance se retrae desde los bordes hacia adentro.

## 3. Ver a los súbditos: registros, catastros y censos

```ts
interface Register {
  id: RegisterId;
  kind: "household" | "cadastre" | "census" | "military_roll" | "guild_roll" | "temple_roll";
  unit: AdminUnitId;
  entries: RegisterEntry[];                 // hogares, personas, parcelas con su clase de tierra, cabezas de ganado
  takenAt: Time;                            // cuándo se relevó de verdad (los registros envejecen)
  takenBy: AgentId[];                       // quiénes lo relevaron (con sus sobornos y descuidos)
  medium: DocumentId;                       // es un documento: se copia, se falsifica, se quema (information §4)
}
```

- **El registro no es la verdad.** Hogares que no se anotaron, tierra que figura como baldía, muertos que siguen pagando, vivos que no existen para el fisco, parcelas registradas a nombre de un noble exento para no pagar. La brecha crece con los años y con la corrupción de quien releva.
- **Todo se cobra y se recluta sobre el registro.** Si el registro dice que la aldea tiene 300 hogares y quedan 200 después de una plaga, los 200 pagan por 300 (y se van, y el registro empeora).
- **Relevar es una política cara y peligrosa:** un catastro nuevo encuentra tierra escondida por los poderosos, que se resisten. Muchas reformas mueren ahí.
- **Esconderse es una acción:** no registrar a un hijo, huir del registro, comprar la exención. Un fugado del registro no paga ni sirve, pero tampoco tiene derechos ante el tribunal (social-structure §2).

## 4. Impuestos y tesoro

```ts
interface FiscalSystem {
  levies: Levy[];                           // tierra en especie, capitación, corvea (trabajo), levas (hombres), aduanas, peajes,
                                            // monopolios (sal, hierro, licores, piedras espirituales con sello), venta de cargos y títulos,
                                            // tributo de vasallos y sectas, multas (law §8)
  collection: CollectionChain;              // funcionarios, recaudadores arrendados, señores locales, jefes de aldea
  treasury: HolderRef;                      // tenencias de la corte y de cada unidad (economy §2b)
  granaries?: HolderRef[];                  // reservas físicas de grano
  mint?: MintId;                            // si acuña (economy §2)
}
```

- **Cada escalón se queda con algo.** Del campesino al tesoro hay jefe de aldea, recaudador, escribano, magistrado y gobernador; cada uno decide cuánto quedarse con su utilidad (sueldo, deudas, riesgo de inspección, valores). Lo que llega a la capital es una fracción, y la presión sobre el campesino es mucho mayor que lo que el edicto dice.
- **Arrendar la recaudación** (el que adelanta la plata cobra lo que pueda) da ingreso rápido y exprime a los de abajo.
- **Exenciones** para nobles, templos, sectas, funcionarios y sus familias: la carga cae sobre los que no pueden evitarla. Con los años, la tierra exenta crece (los campesinos la "regalan" al noble a cambio de protección) y la base fiscal se achica.
- **Gastos:** ejército, sueldos, corte, obras, graneros, regalos y pagos a sectas, servicio de deudas. Todo sale de tenencias reales.
- **Cuando no alcanza:** rebajar la ley de la moneda (economy §2, §13: inflación con causa), vender cargos y títulos (llegan funcionarios que quieren recuperar lo invertido), pedir prestado a casas comerciales o a sectas (deuda con un poder que después cobra), confiscar a nobles o mercaderes (enemigos nuevos), subir impuestos (resentimiento, fuga del registro, revuelta). Ninguna es gratis.

## 5. Burocracia
- **Funcionarios** son miembros con puestos (organizations §3) con sueldo, rango y carrera. Responden hacia arriba con **informes** y ejecutan hacia abajo **órdenes**.
- **Los informes son creencias que viajan** (information §3): el gobernador informa la cosecha que le conviene, oculta la revuelta que no pudo parar, exagera los bandidos para pedir tropas. Cada escalón filtra. La corte decide sobre un mundo que no existe del todo.
- **Brecha de ejecución** (organizations §4): una orden se cumple según lo que el que la recibe cree que pasa si no la cumple, lo que le cuesta y lo que gana. Lejos de la capital, la brecha crece.
- **Escribanos y funcionarios permanentes:** locales, mal pagos, saben todo y nunca rotan; el magistrado rotado depende de ellos. Ahí está gran parte de la corrupción y del poder real.
- **Contrapesos:** reglas de rotación y de no servir en la provincia natal, censores e inspectores itinerantes, informantes, auditorías de libros. Funcionan según cuánto se los respete y cuánto se los pueda comprar.
- **Sellos y documentos:** el poder viaja en papeles con sello (information §4). Falsificar un sello o una orden es un crimen grave y una herramienta de intriga (schemes).

## 6. Exámenes
- **Exámenes de letras** (para funcionarios): niveles locales, provinciales y de la capital, en fechas fijas; textos canónicos, caligrafía, ensayo. Cupos por provincia. Pasar da estatus (social-structure §8) y derecho a cargos, aunque no garantiza uno.
- **Quién llega:** el que sabe leer y pudo pasar años estudiando sin trabajar, con tutor y libros: casi siempre hijos de hogares con excedente. Los pocos pobres que pasan se vuelven historias que sostienen la creencia en la movilidad (social-structure §8).
- **Trampas:** chuletas cosidas, sobornar al examinador, suplantación, filtrar el tema, favoritismo hacia familias conocidas. Son acciones con riesgo; los escándalos de examen son eventos que cambian reglas.
- **Exámenes de talento:** algunos estados prueban raíces espirituales en los niños para sus academias o para entregarlos a sectas aliadas. Compiten con las pruebas de las sectas por los mismos chicos.
- **Lo que mide el examen no es lo que hace falta:** produce funcionarios que saben los clásicos, no necesariamente administrar. La calidad real de la burocracia sale de quién pasa y de qué aprende después.

## 7. La corte y la política
- **La corte es una organización con facciones** (organizations §5): ministros, nobles, consortes y sus clanes, eunucos o chambelanes, generales, astrólogos, cultivadores de la corte, el heredero y sus rivales. Cada uno con objetivos propios (poder, riqueza, su rama, la sucesión, sus ideas).
- **El cuello de botella es el gobernante:** decide sobre lo que le llega, y lo que le llega lo filtran los que tiene cerca. Controlar el acceso (quién entra a la audiencia, qué memorial se lee) es poder.
- **Favoritos, regencias y harenes:** un gobernante joven, enfermo o en reclusión deja el poder real en un regente, una emperatriz viuda o un favorito. Las rivalidades entre consortes por la sucesión de sus hijos son facciones de corte (family-lineage §6).
- **Decidir una política** sigue el modelo de organizations §4: asunto, deliberación con influencias, orden, ejecución con brecha. Una guerra, una reforma fiscal o una amnistía tienen siempre quién las empujó y por qué.
- **Purgas y conspiraciones** son intrigas (schemes) a escala de corte: acusaciones de traición, golpes de palacio, envenenamientos. Dejan clanes enteros castigados (law §8: castigo a la familia) y deudas de sangre.

## 8. Legitimidad
- **Fuentes** (por cultura, `content/`): sangre de la casa reinante, mandato del Cielo, aval de una secta o de un templo, elección de nobles o de una asamblea, conquista, ritos cumplidos, y el desempeño: protección contra bestias y bandidos, graneros abiertos en la hambruna, justicia creíble, victorias.
- **Es una creencia por comunidad** (information §9), con fracciones que creen cada fuente. La de la capital no es la de la frontera.
- **Presagios:** inundaciones, terremotos, eclipses, sequías, cometas son eventos con causa física (planet-gen, living-world). Las culturas que creen en el mandato del Cielo los **leen** como juicio sobre el gobernante. En la familia xianxia, el Cielo real **no elige dinastías** (heaven-karma): el presagio es interpretación humana, y aun así tumba tronos.
- **Propaganda:** crónicas oficiales, edictos, ritos, monumentos, rumores pagados (information). Mueven creencias, con límite: un granero vacío pesa más que un edicto.
- **Cuando cae:** la obediencia baja (organizations §3: legitimidad pondera la obediencia), la recaudación cae, los poderes locales prueban, aparecen pretendientes. Es la presión que dispara rebeliones y crisis (§9, §13).

## 9. Dinastías y sucesión
- **Reglas de sucesión** del trono como puesto (organizations §12): primogenitura, designación, elección de nobles, el hijo de la consorte principal, el más fuerte. La ambigüedad es crisis.
- **Crisis:** herederos menores (regencia), varios hijos de consortes rivales, testamentos dudosos, gobernantes que no mueren (cultivadores longevos que bloquean a sus hijos durante siglos), gobernantes en reclusión que nadie sabe si viven. Las facciones de la corte se alinean con candidatos.
- **Usurpación:** un general, un ministro o un pariente toma el trono. Gobierna con miedo hasta que construye legitimidad (matrimonio con la casa vieja, presagios favorables, victorias), o no la construye.
- **Fundar una dinastía:** el rebelde que gana, el señor de la guerra que dura, el cultivador que se corona. La nueva casa reescribe la historia (crónica sesgada, futuro) y hereda los registros, las deudas y los enemigos del estado anterior.
- **Por qué decaen las dinastías** (sin ciclo escrito): los registros envejecen y la base fiscal se achica, la tierra se concentra en exentos, la corte crece, la moneda se rebaja, el ejército se paga mal, un desastre llega con los graneros vacíos. Cada una es una presión medible; la caída es su descarga.

## 10. El trono y las sectas

```ts
interface SectArrangement {
  sect: OrgId;
  kind: Array<"patronage" | "state_cultivators" | "non_interference" | "vassal_sect" | "sect_domain"
             | "protector_of_throne" | "rival" | "recruitment_pact" | "tax_exemption">;
  terms: CommitmentRef[];                   // tratados, juramentos, intercambios de rehenes o discípulos (contracts)
  believedBalance: BeliefRef;               // qué cree cada lado de la fuerza del otro
  originEventId: EventId;
}
```

- **El estado no puede obligar a un cultivador fuerte.** Puede pagarle, casarse con su familia, darle tierra o un título, ofrecerle lo que necesita para cultivar (venas, minas, archivos), prometerle no tocar a sus discípulos o pedirle a otro cultivador que lo enfrente.
- **Arreglos típicos:**
  - **Patronazgo:** el estado financia a una secta, que protege al trono o le manda cultivadores.
  - **Cultivadores de estado:** guardias imperiales, academias de cultivo propias, consejeros longevos. Tienen lealtades divididas (su maestro, su secta de origen).
  - **No injerencia:** las sectas no se meten en asuntos mortales (ni matan reyes) y el estado no cobra en sus montañas. Se rompe cuando conviene.
  - **Dominio de secta:** la secta es el estado en su valle; el reino mortal la reconoce o finge que no existe.
  - **Trono títere:** una secta pone y saca reyes por intermedio de su candidato.
- **Lo que se disputa:** chicos con talento (¿examen del estado o prueba de la secta?), tierra y venas, impuestos sobre las aldeas al pie de la montaña, jurisdicción sobre discípulos que delinquen (law §10), información, y la longevidad del gobernante (elixires, técnicas, que la secta da o niega).
- **El gobernante que quiere vivir para siempre** es un arco que emerge: busca elixires, se endeuda con alquimistas y sectas, envenena su cuerpo con píldoras mal hechas (crafts), o se vuelve cultivador y deja de gobernar.

## 11. Políticas y obras
- **Obras públicas:** canales, diques, caminos, murallas, postas, graneros. Cuestan trabajo (corvea) y plata; cambian de verdad el mundo (planet-gen, economy: rutas y rendimientos) y quedan como ruinas cuando el estado cae.
- **Socorro:** abrir graneros en la hambruna salva vidas reales si el grano existe y llega (los recaudadores también lo roban). Es la acción que más legitimidad da y la que más falla cuando el registro miente.
- **Moneda, pesos y medidas:** acuñar, unificar medidas y sellar piedras espirituales son políticas con efectos en los mercados (economy).
- **Edictos** (law §14): viajan como noticias, se aplican tarde y a medias, y se resisten donde tocan intereses.

## 12. Relaciones exteriores
- **Diplomacia por personas** (organizations §10): emisarios, regalos, matrimonios de alianza, rehenes, tratados (contracts).
- **Sistemas de tributo:** el estado fuerte recibe tributo y da títulos, comercio y protección; el vasallo obedece mientras lo cree más fuerte. Cuando el señor se debilita, los vasallos lo perciben (o no) y prueban.
- **Fronteras y nómadas:** comercio, incursiones, pagos para comprar paz, murallas. La guerra va en war.md (futuro).

## 13. Rebelión, señores de la guerra y colapso
- **Rebeliones** desde abajo (social-structure §10), desde los nobles (un duque que deja de pagar), desde el ejército (un general mal pagado) o desde una secta (que instala a su candidato). Siempre con presiones acumuladas y un disparador.
- **Secesión:** cuando el alcance (§2) cae, las provincias lejanas dejan de mandar impuestos y después de obedecer; el gobernador se vuelve señor.
- **Señores de la guerra:** organizaciones armadas que cobran y juzgan en su zona. Si duran, se vuelven estados (§1).
- **Colapso:** el estado deja de existir como reclamo creído. Quedan sus legados (organizations §11): ruinas, archivos, monedas viejas, registros que nadie lee, nobles sin rey, deudas, mitos del buen emperador, pretendientes que dicen tener su sangre.

## 14. El jugador y el narrador
- **El jugador vive bajo un estado** (o en sus bordes, donde no llega): paga, se esconde del registro, sirve en la corvea, lo recluta una leva, ve llegar un edicto tarde.
- **Puede entrar al estado:** estudiar y presentarse a examen, comprar un cargo, servir en el ejército, volverse cultivador de la corte, casarse con una casa noble. O ir en contra: rebelde, contrabandista, consejero de un señor de la guerra, fundador de un reino propio.
- **Conoce el estado como creencia:** quién gobierna, qué dice la ley, si el emperador vive, si la secta del monte manda más que el magistrado. Lo que no le llegó como noticia, no lo sabe.
- **El narrador** cuenta la política desde donde está el personaje: el pregón del edicto en la plaza, el recaudador en la puerta, el rumor de la corte. Nunca le da la verdad de la corte ni el estado del tesoro si el personaje no los conoce.

## 15. Escala (LOD)
- **Tier 0:** cada estado como agregado: alcance por celda, base fiscal registrada vs real, recaudación y fugas por escalón como tasas, tesoro, legitimidad por región, fuerza percibida por vecinos. Las crisis (sucesión, secesión, rebelión, colapso) son procesos de riesgo sobre esas presiones (causality).
- **Tier 1-2:** la corte y las facciones con personas concretas; gobernadores, magistrados y recaudadores cerca del jugador.
- **Materialización:** el funcionario que aparece toma su puesto, su carrera, sus deudas y su relación con el registro de la distribución de su unidad.

## Implementación
- **Fase 5:** alcance por celda con distancia y caminos; un magistrado de condado con registro de hogares y recaudación con fugas; edictos como noticias.
- **Fase 6:** estado sobre el modelo de organizaciones (plantilla, puestos, órganos, corte con facciones); arreglos trono–secta; dominio de secta.
- **Fase 7:** estados que nacen y caen en la historia agregada (conquistas, secesiones, dinastías) con legados; presagios leídos como juicio.
- **Fase 8:** fiscalidad completa (exenciones, arriendo de recaudación, rebaja de moneda, venta de cargos), burocracia con informes deformados e inspectores, exámenes, sucesiones de trono, rebeliones, señores de la guerra, sistemas de tributo.

## Tests
- **Alcance:** con todo lo demás igual, una aldea a tres semanas de la capital cumple menos órdenes y paga menos que una a un día.
- **Registro vs verdad:** después de una plaga sin nuevo relevamiento, la presión fiscal por hogar sube y la fuga del registro aumenta.
- **Conservación fiscal:** lo que llega al tesoro más lo que se quedan los escalones es igual a lo que salió de los hogares.
- **Sin ciclo escrito:** en corridas headless largas, las caídas de dinastías tienen presiones medibles antes (base fiscal, legitimidad, tesoro) y su ritmo varía entre seeds.
- **Presagios:** en la familia xianxia, la frecuencia de desastres no depende de la dinastía; la caída de legitimidad después de un desastre sí depende de cuánto se crea en el mandato.
- **Trono y sectas:** un estado sin cultivadores propios no ejecuta sentencias contra cultivadores de reino alto.
- **Determinismo:** mismo seed, mismas acciones → mismos edictos, recaudaciones, sucesiones y rebeliones.

## Decisiones tomadas en este borrador (revisables)
- El estado es una organización con plantilla propia; no hay otro motor.
- El régimen se describe con ejes continuos, no con tipos.
- El alcance es verdad calculada; el reclamo y los registros son creencias.
- El Cielo no elige dinastías en la familia xianxia; el mandato es interpretación cultural.
- No hay ciclo dinástico programado: las caídas son descargas de presiones.
- El estado nunca obliga a un cultivador fuerte por la fuerza mortal; negocia.

## Preguntas abiertas
- Calibración: curva de alcance por distancia y terreno; costo de mantener guarniciones y postas.
- Calibración: fuga por escalón de recaudación según sueldos, inspección y valores.
- Calibración: velocidad con que envejecen los registros y crece la tierra exenta.
- Calibración: duración típica de dinastías y frecuencia de crisis de sucesión (que haya variedad entre seeds, de décadas a siglos).
- Calibración: peso de los presagios en la legitimidad según la fracción que cree en el mandato.
