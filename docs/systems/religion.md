# Religión y doctrinas

> Principio: **una religión es lo que un grupo cree sobre el mundo invisible y lo que hace por eso.** Sus afirmaciones son creencias: algunas aciertan, otras no, y la sim nunca las vuelve verdad porque mucha gente las crea. Lo que una religión mueve (gente, tierras, dinero, guerras, conciencias) sí es real. Que haya o no alguien del otro lado lo decide la ley del mundo, no la doctrina.

> Estado: **borrador** (2026-10-06).

Depende de: [metaphysics.md](metaphysics.md) (la ley del mundo: panteón, almas, más allás), [heaven-karma.md](heaven-karma.md) §1, §2, §7 (el Cielo, karma, mérito), [spirits.md](spirits.md) §3b, §6, §9 (el ciclo, ofrendas como física, dioses locales y cultos), [culture.md](culture.md) (cosmovisión, ritos, contacto, sincretismo), [information.md](information.md) §1, §3, §9 (creencias colectivas, deformación, reputación), [discovery.md](discovery.md) §6, §8 (dogmas, anomalías, iluminación), [living-world.md](living-world.md) §4, §5 (mitos, creencias sobre el Cielo), [npc-psychology.md](npc-psychology.md) §2, §7, §11, §13, §14 (valores, utilidad, salud mental, sentido y pertenencia, multitudes), [organizations.md](organizations.md) §7, §8, §11, §13 (doctrina, herejía, cismas, templos y monasterios), [language.md](language.md) §7, §11 (tabúes de palabra, lenguas litúrgicas).
Lo usan: [state.md](state.md) §8, §10 (legitimidad, culto de estado, trono y sectas), [law.md](law.md) (delitos religiosos, fueros del clero), [war.md](war.md) (guerras santas, justificaciones), [economy.md](economy.md) (templos como terratenientes y prestamistas, peregrinaciones), [property.md](property.md) (tenencia de culto), [social-structure.md](social-structure.md) (ideologías de la jerarquía), [family-lineage.md](family-lineage.md) (matrimonio, culto de los ancestros), [divination.md](divination.md) (profecías, oráculos), [cultivation.md](cultivation.md) (escuelas con forma religiosa), [chronicle.md](chronicle.md) (textos sagrados, historias oficiales), [cosmology.md](cosmology.md) (qué hay de verdad arriba y abajo), [narration.md](narration.md) (lo sagrado según el personaje).

---

## Principios

- **Creencia, no verdad.** Una doctrina es un conjunto de afirmaciones (`BeliefRef` colectivas, information §9) sobre el Cielo, la muerte, los dioses, la moral y el cultivo. Cada afirmación tiene contraparte en `WorldTruth` o no la tiene. La sim lleva las dos cosas por separado.
- **La verdad metafísica sale de la ley del mundo.** Si hay dioses reales, si las ofrendas llegan, si el rito ayuda al alma, si el mérito existe: todo eso lo dicen metaphysics, heaven-karma y spirits. Una religión puede acertar, errar o acertar por razones equivocadas.
- **Funciona igual aunque esté equivocada.** Consuela, une, legitima, recauda, organiza la caridad, justifica guerras y persecuciones. Esos efectos son reales porque pasan por la conducta de la gente.
- **Vive en personas.** Como la cultura (culture §1), la religión es la fe, la práctica y la pertenencia de individuos con más o menos sinceridad. "La religión del valle" es un parecido entre muchos.
- **Todo tiene origen.** Cada religión, doctrina, texto, santo, fiesta y herejía nace de un evento registrado (`originEventId`): un profeta, un milagro (que muchas veces fue un cultivador), un desastre, un contacto, un cisma.
- **Sin rieles para el jugador:** puede creer, dudar, fingir, convertirse, profanar, predicar, fundar un culto o volverse objeto de culto, con las consecuencias que eso tenga.

---

## 1. El modelo

```ts
interface Religion {
  id: ReligionId;
  names: { self: LexemeRef; others: Record<CommunityId, LexemeRef> };   // language §9
  kind: ReligionKind;                          // §2
  doctrines: DoctrineId[];                     // §3
  practices: PracticeId[];                     // §6
  moralCode: NormId[];                         // §7 (normas con sanción creída)
  sacredBeings: Array<{ belief: BeliefRef; truth?: AgentId | SoulId | 'none' }>;  // dioses, santos, ancestros, inmortales venerados; truth: quién está de verdad
  texts: TextId[];                             // §4
  sacredLanguage?: LanguageId;                 // language §11
  sacredPlaces: Array<{ site: SiteId; why: EventId }>;
  calendar?: CalendarId;                       // fiestas y cuenta de años (living-world §5)
  institutions: OrgId[];                       // clero, monasterios, órdenes (§5)
  parent?: ReligionId;                         // de qué salió (cisma, reforma)
  syncretizedFrom?: ReligionId[];              // §9
  founder?: AgentId;
  originEventId: EventId;
}

interface Doctrine {
  id: DoctrineId;
  claim: Proposition;                          // "los soberbios reciben el rayo del Cielo", "las ofrendas alimentan a los muertos"
  topic: 'cosmos' | 'heaven' | 'death' | 'gods' | 'morality' | 'ritual-efficacy' | 'cultivation' | 'society' | 'history';
  centrality: number;                          // cuánto de la identidad religiosa depende de esto
  source: Array<{ kind: 'revelation' | 'text' | 'founder' | 'council' | 'tradition' | 'miracle' | 'inference'; ref: EventId | TextId }>;
  truthStatus?: 'true' | 'false' | 'partly' | 'unknowable';   // solo para el inspector y la crónica: comparación con WorldTruth
  anomalies: ObservationId[];                  // discovery §6: lo que no cuadra
  originEventId: EventId;
}

interface ReligiousIdentity {                  // por persona (tier 0-2) o agregada por población
  agent: AgentId;
  affiliations: Array<{
    religion: ReligionId;
    belief: number;                            // cuánto cree sus afirmaciones centrales
    practice: number;                          // cuánto cumple
    belonging: number;                         // cuánto se siente parte (npc-psychology §13)
    outward: number;                           // cuánto muestra (puede fingir; culture §1 por fuera y por dentro)
    learnedFrom: AgentId[];
    since: Tick;
  }>;
  doubts: ObservationId[];                     // lo que vio y no cuadra
  vows: CommitmentId[];                        // votos (contracts)
}
```

- **Pertenencia múltiple:** en muchas culturas (sobre todo en la familia xianxia) la gente no pertenece a una sola religión: honra a sus ancestros, le reza al dios del lugar, llama a un monje para un funeral y a un sacerdote del Dao para un exorcismo. Las religiones exclusivas ("uno solo") son un rasgo de algunas doctrinas, no la norma.
- **Fe, práctica y pertenencia son separables:** se puede cumplir sin creer (por costumbre o por miedo al vecino), creer sin cumplir y pertenecer sin ninguna de las dos (identidad étnica, culture §8).

## 2. Tipos de religión

| Tipo | Rasgos | Cómo nace |
|---|---|---|
| Religión popular | Difusa, sin clero central: ancestros, dioses locales, adivinación, fiestas, tabúes | Se acumula en siglos desde la vida de la aldea (culture, spirits §8, §9) |
| Tradición de sabios | Textos, maestros, escuelas de interpretación; mezcla de filosofía, ética, ritual y cultivo | Un fundador o un grupo que sistematizó una visión (discovery §6) |
| Religión de revelación | Un profeta, un mensaje, un texto, a veces exclusiva | Una visión, un sueño, un encuentro (real o no) con algo de arriba |
| Culto de misterio | Iniciación, secretos, grados | Un grupo cerrado alrededor de un saber o un ser |
| Religión de estado | Culto oficial que legitima al trono | Un estado que adopta, canoniza o inventa (state §8) |
| Culto a un inmortal | Venerar a un cultivador vivo, ascendido o muerto | Un cultivador que salvó o aterró a una región |
| Movimiento milenarista | Fin de una era, salvación inminente, a menudo rebelde | Crisis, profecía, líder carismático (§11) |
| Escepticismo y filosofías sin dioses | "No hay Cielo, hay leyes"; rito como orden social | Escuelas de sabios, cultivadores que conocen la ley, élites |

Los tipos son tendencias. Una religión puede empezar como culto de misterio, volverse tradición de sabios y terminar como religión de estado.

## 3. Doctrina y verdad

- **Las doctrinas cubren lo que la gente necesita explicar:** qué es el Cielo y qué quiere, qué pasa al morir, por qué hay sufrimiento, por qué unos cultivan y otros no, qué está bien, qué hacer para tener suerte.
- **Se comparan con la ley del mundo.** En un mundo xianxia base: la doctrina "el alma cruza a las Fuentes y vuelve" acierta (spirits §3b); "las ofrendas quemadas mantienen a los muertos" erra (spirits §6) salvo en un mundo con inframundo con economía (metaphysics §6); "el mérito se compra con donaciones" erra (heaven-karma §7); "el Cielo castiga a los soberbios" acierta a medias (heaven-karma §3: la atención va por saliencia, no por soberbia).
- **Errores que funcionan:** una doctrina falsa puede tener efectos buenos por otra vía. "Donar al templo da mérito" no da mérito por la donación, pero si el templo alimenta a los pobres, sostener vidas sí lo da (heaven-karma §7). La gente atribuye el efecto a la doctrina.
- **Prácticas con efecto real:** algunas prácticas religiosas sirven de verdad, aunque por razones distintas de las que da la doctrina. La meditación calma la mente y ayuda contra los demonios internos (npc-psychology §9); el ayuno purga ciertas toxinas de píldoras (body-health); un santuario viejo acumula qi (spirits §7). La sim resuelve el efecto por la física, no por la fe.
- **Anomalías y cambio:** como los dogmas de escuela (discovery §6), cada doctrina acumula anomalías (el santo que murió de una enfermedad común, la oración que no paró la sequía). Se explican con reglas de siempre ("falta de fe", "pecado oculto") hasta que pesan más que la autoridad para alguien con seguidores.
- **El inspector y la crónica** muestran qué doctrinas aciertan (`truthStatus`). El personaje nunca lo sabe con certeza (aprobado 2026-10-06): junta evidencia y anomalías como cualquier hipótesis (discovery §2, §3), y su confianza puede subir o bajar, pero nunca se vuelve verdad revelada.

## 4. Textos sagrados

- **Son objetos:** rollos, libros, tablillas, inscripciones, jades de memoria (information §4, §6). Tienen autor (real o atribuido), copias con errores, traducciones y comentarios.
- **El canon se arma:** un concilio, un emperador o una escuela decide qué textos valen y cuáles no. Los descartados quedan como apócrifos y a veces vuelven.
- **Lengua sagrada:** el texto fundacional suele quedar en una lengua que después muere (language §11). Lo leen pocos, y quien lo lee tiene autoridad. Las traducciones a la lengua común son un hecho político.
- **Interpretación:** el mismo verso sostiene lecturas opuestas. Las escuelas de interpretación son facciones (organizations §5).
- **Textos falsos y "redescubiertos":** un texto puede aparecer "encontrado en una cueva" para darle autoridad a una doctrina nueva. Detectarlo es una tarea de discovery y de deep-history (datación, lengua anacrónica, language §4).
- **Manuales de cultivo disfrazados:** en la familia xianxia, algunos textos sagrados contienen técnicas reales escritas en clave o en metáfora. Quien los lee como plegaria no las ve; quien los lee con conocimiento de cultivo, sí (cultivation, discovery §10).

## 5. Clero, templos y órdenes

- **El clero es una organización** con la plantilla de templo, monasterio u orden (organizations §13): puestos, ordenación, jerarquía, tesoro, disciplina y sucesión.
- **Especialistas sin iglesia:** en la religión popular, adivinos, médiums, exorcistas, sacerdotes del Dao a sueldo y monjes errantes ofrecen servicios por pago. Compiten por clientes y por reputación (economy).
- **Los templos son económicos:** tienen tierras (property: tenencia de culto), siervos o arrendatarios, molinos, talleres, prestan dinero a interés (economy, crédito), guardan depósitos, reciben donaciones y herencias. Un monasterio rico es una tentación para el estado y para los bandidos (§10).
- **Entrar al clero** es una vía de movilidad social (social-structure): da comida, techo, educación y a veces exención de impuestos y levas. Por eso entran muchos que no creen. Si el estado vende certificados de ordenación, se vuelven un bien más.
- **Votos:** pobreza, castidad, obediencia, silencio, dieta, no matar. Son compromisos (contracts) con ejecutores que leen creencias: la comunidad y la jerarquía. Si el Cielo o una atadura del alma los lee de verdad depende de cómo se juraron (contracts: juramentos y sellos en el alma).
- **Corrupción emergente:** el abad que vive como un señor, el sacerdote que vende perdones, la monja que es espía. Sale de la utilidad de cada uno y de lo que se puede esconder, como en law.

## 6. Prácticas

- **Rito, oración y ofrenda:** con efecto físico según spirits §6 (casi nunca llega a nadie, salvo a un espíritu o dios real cercano con la sinceridad que pide). El efecto social y psicológico es siempre real: consuelo, cohesión, cara.
- **Fiestas y calendario:** fechas sagradas que ordenan el año (culture, weather §4). Mueven mercados, gastos, viajes y peleas.
- **Peregrinación:** viajes largos a lugares sagrados (travel). Crean rutas, posadas, mercados y contagios.
- **Ayuno, dieta y pureza:** reglas sobre qué se come, con quién, qué toca a quién. Leen y modifican cuerpo (body-health) y relaciones (social-structure).
- **Ascetismo:** soledad, privación, dolor buscado. Tiene efectos reales en el cuerpo (desnutrición, heridas) y en la mente (estados alterados, a veces iluminación, discovery §8; a veces locura, npc-psychology §11). En la familia xianxia se confunde con el cultivo, y a veces lo es.
- **Meditación y contemplación:** reduce estrés, fortalece la voluntad, ayuda con los demonios internos, y puede ser la puerta al cultivo si el practicante tiene talento y el lugar tiene qi.
- **Exorcismo y protección:** amuletos, sellos y ritos contra espíritus. Funcionan si hay un espíritu real y si quien los hace sabe (crafts: talismanes); si no, es teatro con efecto placebo y social.
- **Sacrificio:** de bienes, de animales, en algunas culturas de personas. Con efecto según la ley (un dios que come vida existe en algunos mundos) y con consecuencias de karma y de ley.

## 7. Moral, pecado y premio

- **Códigos morales** como normas (culture: normas y tabúes) con una sanción creída: castigo del Cielo, infierno, mala reencarnación, enfermedad, desgracia del linaje.
- **La sanción creída entra en la utilidad** (npc-psychology §7): un NPC que cree en el infierno pesa distinto el robo. Que la sanción exista de verdad es otra cosa (heaven-karma §2, §6: el karma inclina tiradas, acotado).
- **Confesión, penitencia y perdón:** ritos para aliviar la culpa (npc-psychology §11). Sirven a la mente aunque no cambien el karma, y se pueden vender.
- **Doble moral:** las doctrinas suelen tener una moral para el común y otra para los de arriba, o para los de adentro y los de afuera (el infiel no cuenta). Eso habilita crueldades con la conciencia tranquila.

## 8. Pertenencia y conversión

- **Se nace en una religión** y se aprende en los períodos sensibles (npc-psychology §10), con la transmisión de culture §4.
- **Se cambia por razones concretas** que pasan por la utilidad: una cura o un "milagro" visto, una comunidad que acoge al que está solo, casarse, el favor de un patrón o del estado, escapar de un impuesto, miedo, convicción intelectual, una crisis personal (duelo, enfermedad, npc-psychology §11).
- **Conversión desde arriba:** cuando un rey, un jefe de clan o un patriarca de secta se convierte, sus dependientes lo siguen por fuera; por dentro, despacio o nunca (culture §5).
- **Misioneros:** personas con la meta de convertir. Viajan, aprenden lenguas, traducen textos, curan, adaptan la doctrina al lugar (y así abren sincretismos). Si los dioses viven de la fe (metaphysics: panteón), los dioses mismos los empujan.
- **Apostasía:** dejar una religión tiene costos (familia, comunidad, ley en algunos lugares). Muchos dejan de creer y siguen cumpliendo.

## 9. Herejía, cisma, sincretismo y reforma

- **Herejía:** una doctrina distinta dentro de la misma religión. Nace de anomalías, de textos nuevos, de intereses (una facción que pierde el poder cambia de doctrina) o de un místico. La jerarquía la tolera, la absorbe o la persigue (organizations §8, law).
- **Cisma:** cuando la herejía tiene seguidores, recursos y un lugar donde estar, la organización se parte (organizations §11). Cada parte reescribe la historia (chronicle).
- **Sincretismo:** dioses que se funden, fiestas que se superponen, el santo del pueblo que es el viejo espíritu del río con otro nombre (culture §7). Si el espíritu del río es real, ahora recibe la devoción de las dos tradiciones (spirits §9).
- **Reforma:** volver "a la fuente" contra una institución rica o corrupta. Suele ir con traducciones a la lengua común y con la expropiación de bienes del clero.

## 10. Religión y estado

- **Legitimidad:** el trono se apoya en doctrinas (mandato del Cielo, linaje divino, protección de un dios) y la religión gana patrocinio (state §8). Un presagio mal leído o una sequía sacuden a los dos.
- **Culto de estado:** ritos oficiales que hace el gobernante; canonización y títulos para dioses locales (spirits §9); registro y control del clero; exámenes que leen los textos de una tradición de sabios (state §6).
- **Persecución:** el estado confisca tierras y metales de los templos cuando el tesoro está vacío, prohíbe cultos que organizan a los pobres o que dan lealtades fuera del trono, y quema textos. Siempre con causa: tesoro, miedo, una facción de la corte.
- **Teocracia:** un clero que gobierna, o un estado que es una religión armada.
- **Fueros:** el clero puede tener sus propios tribunales y exenciones (law: jurisdicciones superpuestas).

## 11. Movimientos, profecías y guerras santas

- **Milenarismo:** cuando la presión es alta (hambre, impuestos, epidemias, conquista; causality: presiones), una profecía del fin de una era o un líder que promete salvación junta multitudes (npc-psychology §14, divination). Muchos movimientos se vuelven rebeliones (state §13).
- **Profetas:** cualquiera que diga haber recibido un mensaje. Puede haberlo recibido de verdad (un dios real, un espíritu, un sueño enviado), puede creer que lo recibió (un sueño propio, una enfermedad, un cultivador que se le apareció) o puede mentir. La sim sabe cuál; la gente no.
- **Guerras santas:** la religión justifica y moviliza (war), pero detrás suele haber tierras, rutas o sucesiones. Las dos cosas son causas registradas.
- **Mártires:** una muerte por la fe puede fortalecer al movimiento más que cualquier victoria (información y multitudes).

## 12. Religión y cultivo

- **Escuelas con forma religiosa:** muchas tradiciones de cultivo tienen templos, votos, textos sagrados y jerarquía. La frontera entre secta de cultivo y religión es difusa: un monasterio puede ser las dos cosas (cultivation §2, organizations §13).
- **Doctrinas sobre el Cielo:** adorarlo, apaciguarlo, desafiarlo, negarlo (living-world §5, heaven-karma §1). La doctrina de una secta sobre el Cielo cambia cómo encaran sus discípulos la tribulación, y puede estar mal.
- **Mortales que adoran a cultivadores** (aprobado 2026-10-06): un inmortal que pasó volando se vuelve un dios en el valle. La devoción sincera le da un hilo de esencia, con el mismo techo y la misma pérdida por distancia que las ofrendas (spirits §6). A cambio carga con más atención del Cielo (heaven-karma §3), con lo que sus fieles esperan de él, y con karma si los usa o los abandona en una desgracia que podía evitar.
- **Cultivadores que explotan la fe:** fundar un culto para tener sirvientes, ofrendas y discípulos, o usar el templo como fachada. Con karma según lo que hagan (heaven-karma).
- **Religiones contra el cultivo:** doctrinas que ven el cultivo como soberbia o robo al Cielo. Pueden tener razón a su manera (heaven-karma: el cobro en las Fuentes) y pueden perseguir a los que cultivan.

## 13. Dioses reales según la familia del mundo

- **Familia xianxia base** (aprobado 2026-10-06): no hay un panteón real. Hay espíritus y dioses locales (spirits §9), el Cielo como ley (heaven-karma) y cultivadores muy fuertes. Las religiones grandes hablan de seres que no existen o que son esas cosas con otro nombre.
- **Familias con panteón** (metaphysics: panteón, mitológica): los dioses son agentes con utilidad, territorio y rivalidades, que viven de la fe y compiten por creyentes. Envían sueños, señales y a veces poder (fuente otorgada). Sus religiones tienen parte de verdad y parte de propaganda de cada dios.
- **Dios muerto o ausente:** religiones que siguen rezándole a nadie, y restos de su poder que se pueden cosechar.
- **Algo afuera:** cultos a lo que está más allá del mundo, con poder real y corrupción.
- Lo que hay de verdad arriba y abajo (planos, inframundos) lo fija [cosmology.md](cosmology.md); este doc solo dice cómo lo cree la gente.

## 14. El jugador y el narrador

- **El narrador habla desde la fe del personaje:** un templo es sagrado, una estatua es el dios o una piedra, según lo que crea. Nunca dice si una doctrina es verdad.
- **Libertad total:**
  - creer, dudar, fingir, cambiar de religión o pertenecer a varias;
  - hacer votos y romperlos, con las consecuencias que lean la comunidad y, si corresponde, el Cielo;
  - profanar, robar un templo, matar a un dios local (spirits §9);
  - predicar, escribir un texto, fundar un culto, falsificar un milagro, declararse profeta o dejarse adorar;
  - investigar si una doctrina es cierta (discovery), con evidencia y errores.
- **Lo que descubre puede romperle la fe** o confirmarla. La sim no premia ni castiga la fe del jugador por sí misma (aprobado 2026-10-06): solo lo que hace, y lo que la ley del mundo diga de eso. La fe sí tiene efectos psicológicos reales, iguales para cualquier creyente: consuelo en el duelo, voluntad ante el miedo, menos demonios internos para quien está en paz con su doctrina (npc-psychology §9, §11).
- **Panel:** un comando fuera del personaje muestra en qué cree, qué cumple y de qué duda, como creencias, sin corregirlas.

## 15. Escala (LOD)

| Resolución | Qué se simula |
|---|---|
| Escena | Ritos, prédicas, conversiones, milagros percibidos, exorcismos, profanaciones |
| Local | Identidad religiosa de cada persona, templo de la aldea, especialistas, fiestas, votos |
| Regional | Templos y monasterios como organizaciones con tierras y crédito, peregrinaciones, herejías, cultos que compiten |
| Mundo | Religiones con su fracción por comunidad, relación con los estados, misiones, persecuciones |
| Historia | Nacimiento de religiones desde eventos, textos y cánones, cismas, sincretismos, desaparición |

- En agregado, `ReligiousIdentity` es una distribución por población (creencia, práctica, pertenencia) que cambia con presiones y contactos; al materializar una persona se fija desde esa distribución (simulation: hechos fijados).

## 16. Implementación por fase

- **Fase 1:** religión popular de la aldea desde `content/` (ancestros, el dios local o su ausencia, una fiesta, tabúes) que leen culture, spirits y el narrador.
- **Fase 2:** identidad religiosa por persona (creencia, práctica, pertenencia, por fuera y por dentro); sanción creída en la utilidad; consuelo y culpa.
- **Fase 3:** economía del templo (ofrendas, tierras, préstamos), especialistas por pago, fiestas fuera de escena.
- **Fase 4:** doctrinas sobre el Cielo y el cultivo en las sectas; meditación y ascetismo con efectos reales.
- **Fase 6:** clero como organización, herejía, cisma, conversión con motivos, misioneros, votos como compromisos.
- **Fase 7:** religiones que nacen de eventos en la historia profunda, textos y cánones, lenguas sagradas, sincretismos, persecuciones de estado, milenarismos.
- **Fase 8:** religiones del mundo con LOD, guerras santas, dioses reales en familias con panteón.

## Implementación (Fase 1, 2026-10-07)

- `sim/religion`: `DoctrineDef` en `content/doctrines/` (afirmación, tema, centralidad, fuente, `truthStatus` y `whyTruth` para el inspector) y `ReligionDef` en `content/religions/` (cultura de la que sale, doctrinas, seres venerados con `truth: none|spirit`, prácticas `offering|festival|taboo|rite|divination` con `believedEffect` y `socialEffect` separados, adherencia, exclusividad, origen contado). Las referencias a cultura, doctrinas, bienes y rasgos se validan al cargar; `religionProblems` revisa lo interno (ofrenda sin destinatario, ser repetido).
- `seedReligion` escribe `COMMUNITY_RELIGION` por asentamiento con evento `religion.seeded` colgado de la fundación. No crea espíritus: sembrar creencias no cambia `WorldTruth`. Lectores: `villageReligion`, `practicesOfKind`, `tabooOnGood`.
- La aldea trae folk con ancestros de la casa, el dueño del pozo y el Cielo (los tres sin nadie de verdad), ración de grano para la tablilla, balde anual al pozo, fiesta de la cosecha, tabú de la primera gavilla, velorio y mirar golondrinas.
- Falta: economía y fiestas fuera de escena (Fase 3).

## Implementación (Fase 2, identidad por persona, 2026-10-08)

- `sim/religion/identity.ts`: `Affiliation` (creencia, práctica, pertenencia, por fuera; `learnedFrom`, `since`, origen) y `ReligiousIdentity` en la tabla `RELIGIOUS_IDENTITY`. `seedAffiliation` parte de la media de la comunidad (o del promedio con los padres) con desvío; cumplir sigue a creer y a pertenecer; mostrar suma la presión de pertenecer, así que quien pertenece sin creer finge.
- `PracticeDef.sanction` (0-1) es la gravedad creída de romper un tabú. `sanctionWeight(identidad, comunidad, bien)` da miedo (sanción por creencia) y vergüenza (sanción por pertenencia) y su `penalty`, que se resta a la utilidad: no mira `WorldTruth`. `guiltAfter` y `comfortOf` (parte social para todo el que pertenece, parte de fe solo para el que cree) son las intensidades que usarán la mente y el duelo.
- **Panel del personaje (2026-10-09):** `characterPanel.faith` (`game/life/panels.ts`) dice la religión de la aldea, cuánto cree, cumple y pertenece en palabras (`faithLevel`: ninguna, leve, firme, honda; sin números) y las prácticas de la religión; nunca el `truthStatus`. La culpa y el consuelo viven en el panel cuando existan los eventos que los producen.
- Falta el cableado (nacer con identidad, utilidad de lo tabú, estímulo `guilt`, alivio del duelo): ver sub-ítems en el ROADMAP.

## Tests

- **Determinismo:** mismo seed, mismas religiones, doctrinas y conversiones.
- **Verdad separada:** ninguna creencia colectiva, por más difundida que esté, cambia `WorldTruth` (una ofrenda en un mundo sin inframundo con economía no llega a nadie aunque todos crean que sí).
- **Origen:** toda religión, doctrina, texto y herejía tiene evento de origen y causas.
- **Sin fuga:** el narrador no recibe `truthStatus` ni la identidad real de un ser venerado que el personaje no conoce.
- **Conversión con motivo:** cada cambio de religión de un NPC tiene un insumo de utilidad o una creencia nueva registrada.
- **Persecución con causa:** toda confiscación o prohibición del estado tiene una presión o una facción detrás.

## Decisiones (aprobado 2026-10-06)
- **Sin panteón real en la familia xianxia base:** espíritus y dioses locales, el Cielo como ley y cultivadores muy fuertes (§13).
- **La devoción a un cultivador le da un hilo de esencia** con techo, más atención del Cielo, obligaciones y karma si traiciona (§12).
- **La fe no se premia por sí misma;** sus efectos psicológicos son reales e iguales para todos (§14).
- **El personaje nunca sabe con certeza si una doctrina es cierta;** la verdad solo en el inspector y la crónica (§3).

## Decisiones tomadas en este borrador (revisables)

- **Pertenencia múltiple por defecto** en la religión popular; la exclusividad es un rasgo de algunas doctrinas (§1).
- **Fe, práctica y pertenencia separadas,** con por fuera y por dentro (§1).
- **Las prácticas tienen efecto por la física,** no por la fe (§3, §6).
- **Sin panteón real en la familia xianxia base;** los dioses son espíritus locales o nada (§13).
- **La sim no premia la fe del jugador por sí misma** (§14).

## Preguntas abiertas

- Calibración: velocidad de conversión según el motivo; cuánto pesa la sanción creída en la utilidad; umbral de anomalías para una herejía; frecuencia de milenarismos según la presión; cuánto acumula un templo antes de que el estado lo mire.
