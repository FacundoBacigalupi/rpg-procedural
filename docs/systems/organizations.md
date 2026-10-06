# Organizaciones

> Estado: **borrador de diseño**. Clanes, sectas, gremios, casas comerciales, templos, bandas, sociedades secretas: cómo existen, quiénes las forman, cómo deciden, qué tienen, cómo se pelean por dentro y con otras, y cómo nacen, se parten y mueren. Es la capa 6 de [causality.md](causality.md): **las organizaciones son agentes compuestos que deciden a través de personas, no con una IA propia**. Una secta no "declara la guerra": su anciano ambicioso convence al consejo porque la vena se agota y tiene un rencor personal.

Depende de: [causality.md](causality.md) (procedencia, presiones, capas 5-6), [npc-psychology.md](npc-psychology.md) (utilidad, relaciones con organizaciones, cara, identidad, sesgo de grupo, máscaras), [schemes.md](schemes.md) (intrigas entre miembros y facciones), [information.md](information.md) (creencias de organizaciones, secretos con niveles de acceso, espías, propaganda, reputación por comunidad), [economy.md](economy.md) (tenencias finitas, tesoros, tributos, sueldos, gremios, casas de cambio y subastas), [cultivation.md](cultivation.md) (escuelas y reinos culturales como escala de rangos, técnicas secretas, maestro y discípulo), [discovery.md](discovery.md) (dogmas, registro de anomalías, herejía y cisma, cultura epistémica), [heaven-karma.md](heaven-karma.md) (karma maestro–discípulo, deudas de sangre heredadas), [spirits.md](spirits.md) (ancestros de clan, remanentes que quieren restaurar su secta), [living-world.md](living-world.md) (religiones, culturas, el conocimiento es físico), [deep-history.md](deep-history.md) (organizaciones como legados entre épocas). Lo usan: [economy.md](economy.md) (estructura de gremios y casas), [cultivation.md](cultivation.md) (sectas, pruebas, maestros), [discovery.md](discovery.md) (cismas y escuelas nuevas, academias, mecenazgo), [contracts.md](contracts.md) (obligaciones de membresía, tratados, representación), [family-lineage.md](family-lineage.md) (clanes, genealogías, matrimonios de alianza), [social-structure.md](social-structure.md) (rangos de sirvientes, castas hereditarias, cierre de élites), [law.md](law.md) (jurisdicción de secta, entregas entre organizaciones, crimen organizado), [state.md](state.md) (el estado como plantilla, trono y sectas), [war.md](war.md) (fuerzas armadas como organizaciones, guerras entre sectas), [divination.md](divination.md), y [chronicle.md](chronicle.md).

## Principios
1. **Una organización es gente, cosas, reglas y una creencia compartida.** No tiene mente: tiene miembros con puestos, una tenencia (economy §2b), normas, un archivo y la creencia de mucha gente de que existe y de que sus puestos mandan. Todo lo que "hace" una organización lo hace una persona concreta, con sus motivos, y queda como evento con causas.
2. **La autoridad es una creencia que se cumple mientras se crea.** Un puesto manda porque los demás obedecen; obedecen por lealtad, miedo, interés, costumbre o norma. Cuando dejan de creer en el líder (derrota, sucesión dudosa, rumor de que el ancestro murió), el puesto queda vacío de poder aunque tenga dueño.
3. **Los intereses de la organización no son los de sus miembros.** Cada miembro usa la organización para sus objetivos: protegerse, avanzar, enriquecer a su rama, vengarse. El "interés de la secta" es lo que cada uno **cree** que es, ponderado contra el propio. De ahí salen la corrupción, el nepotismo, las facciones y la traición, sin escribirlas.
4. **Nada nace ni muere porque sí.** Toda organización tiene un evento fundador con un fundador y sus motivos; todo cisma, absorción o colapso es la descarga de presiones medibles (causality Ley 3). Al morir deja legados: ruinas, tesoros enterrados, técnicas dispersas, deudas de sangre y sobrevivientes que quieren restaurarla.
5. **Recursos finitos.** El tesoro de una secta es una tenencia más: lo que entra (tributo, minas, misiones) sale de algún bolsillo, y lo que sale (sueldos, píldoras, formaciones) se va del tesoro. Una secta no paga sueldos que no tiene ni enciende formaciones sin piedras.
6. **Verdad vs creencia, también por dentro.** El organigrama real (quién manda de verdad, qué facción controla qué, si el ancestro vive) es `WorldTruth`. Cada miembro y cada observador de afuera tiene su versión. Una organización "cree" lo que creen quienes deciden y lo que dicen sus archivos (information §9).
7. **Un solo modelo para todas.** Clan, secta, gremio, banda de bandidos, templo, casa de cambio, red de espías, el consejo de una aldea: misma estructura, distintas plantillas. El estado y el ejército usan este modelo y se detallan en [state.md](state.md) y [war.md](war.md).
8. **Determinista.** `rng.fork("org", orgId, eventId)` para deliberaciones y desempates; `rng.fork("faction", orgId, period)` para la dinámica de facciones; `rng.fork("succession", orgId, eventId)` para crisis de sucesión.

## 1. Qué es una organización

```ts
interface Organization {
  id: OrgId;
  name: LexemeRef;                       // en la lengua de los fundadores (living-world §3); puede tener otros nombres afuera
  template: OrgTemplateId;               // clan, secta, gremio, casa_comercial, templo, banda… (§13, en content/)
  originEventId: EventId;                // la fundación (§11)
  founders: AgentId[];
  charter: Charter;                      // propósito, normas, órganos, reglas de sucesión y de ingreso (§3, §8)
  members: MembershipId[];               // (§2) agregados por rango en tiers bajos (§17)
  positions: PositionId[];               // (§3)
  organs: OrganId[];                     // consejo de ancianos, asamblea de clan, cabildo del gremio, o ninguno
  structure: OrgStructure;               // formal (estatuto) y real (medida); varía por organización (§3b)
  factions: FactionId[];                 // (§5) emergentes, no fijadas por la plantilla
  holdings: HolderRef;                   // tesoro: lotes, tierras, minas, venas, claims (economy §2b)
  sites: SiteId[];                       // montaña, salón ancestral, tiendas, cuevas de cultivo, guaridas
  archive: ArchiveId;                    // textos, técnicas, registros contables, crónicas (§7)
  doctrine: Doctrine;                    // ideología, dogmas, sistema de cultivo, cultura epistémica (§7)
  identity: OrgIdentity;                 // símbolos, uniformes, sellos, lema, cara colectiva (§14)
  parent?: OrgId;                        // rama de otra, sucursal, secta subordinada, clan vasallo
  children: OrgId[];
  status: "forming" | "active" | "declining" | "schism" | "dormant" | "destroyed" | "dissolved" | "absorbed";
  history: EventId[];                    // eventos institucionales (fundación, sucesiones, cismas, guerras)
}
```

- **La plantilla es un punto de partida, no una jaula.** Ninguna organización está obligada a tener rangos, consejo ni salones (§3b). Define qué puestos, órganos, formas de ingreso y fuentes de ingreso suele tener un tipo, en una cultura dada. Cada instancia se aparta según su historia: una secta que empezó como clan conserva la herencia de sangre en sus puestos; un gremio que se enriqueció se vuelve casa comercial.
- **Organizaciones anidadas.** Una secta tiene picos (sub-linajes) y sucursales; un clan tiene ramas; un gremio tiene cofradías por ciudad; una secta mayor tiene sectas subordinadas que le pagan tributo; un estado tiene todo lo anterior adentro. `parent` registra el vínculo formal; el real (quién obedece a quién) se ve en las decisiones.
- **El hogar no es una organización.** Es la unidad económica de economy §3 (presupuesto compartido). Una familia extendida con patrimonio común, salón ancestral y reglas de linaje sí es un **clan**. El paso de una a otra es un evento (un ancestro que se volvió cultivador, una fortuna que hay que proteger, una rama que se separa).

## 2. Membresía

```ts
interface Membership {
  id: MembershipId;
  agent: AgentId;
  org: OrgId;
  rank: RankId;                          // escala de la plantilla: sirviente, externo, interno, núcleo, personal, anciano…
  positions: PositionId[];
  via: "birth" | "adoption" | "marriage" | "entry_trial" | "recommendation" | "purchase" | "oath"
     | "capture" | "absorption" | "apprenticeship" | "founding";
  since: Time;
  master?: AgentId;                      // maestro dentro de la organización (§9)
  obligations: Obligation[];             // servicio, aportes, misiones mínimas, silencio (contracts.md §12)
  privileges: Privilege[];               // sueldo, acceso al archivo nivel N, cueva, protección, voto
  contribution: number;                  // cuenta de puntos de contribución: un derecho contra el tesoro (§6)
  standing: number;                      // prestigio interno percibido: méritos, faltas, cara
  originEventId: EventId;                // la prueba, el nacimiento, el juramento
}
```

### Ingreso
- **Por nacimiento** (clanes, castas hereditarias de sirvientes), **por matrimonio** (el que entra al clan del otro), **por adopción** (un huérfano con talento).
- **Pruebas de ingreso** (sectas, academias, gremios): son eventos con jueces concretos e instrumentos con error (discovery §12). Miden lo que miden: raíces espirituales con una piedra de prueba, perseverancia con una escalera, carácter con una ilusión, oficio con una obra maestra. Los jueces tienen sesgos, favoritos y precio: el soborno, la recomendación de un anciano y la cara del clan de origen pesan. Un talento raro mal medido queda afuera (y es una oportunidad para otro).
- **Por compra o recomendación:** una plaza de discípulo externo para el hijo del mercader rico, a cambio de un aporte. El mismo puesto vale distinto para cada candidato.
- **Por juramento:** bandas, hermandades juradas (结义), sociedades secretas, cultos. El juramento crea un `KarmicBond` (heaven-karma) y, en algunos mundos, una restricción real en el alma (metaphysics).
- **Por captura o absorción:** los sobrevivientes de una secta destruida que se rinden, los cautivos que una banda recluta, los miembros de un gremio absorbido.

### Lealtad
La lealtad no es un número de la membresía: es la **relación** del miembro con la organización (npc-psychology §6, `to: OrgId`) más lo que pesa en su identidad.
- **Componentes:** `trust`, `respect`, `affection`, `gratitude` (lo que la organización le dio), `fear` (lo que le pasa a los desertores), `dependency` (sin la secta no tiene recursos ni protección), `resentment` (el castigo injusto, el puesto negado).
- **Identidad:** "soy discípulo del Pico Nube" es una creencia sobre uno mismo (npc-psychology §9c). Cuanto más central, más duele la traición propia y más ofende lo que ofende a la organización (la cara colectiva, §14).
- **Lealtad aparente vs real.** Las máscaras de npc-psychology valen acá: el anciano que sonríe al líder y lleva años vendiendo técnicas. La lealtad real decide cuando hay que elegir; la aparente es lo que perciben los demás.
- **Lealtades múltiples** y en conflicto: hijo de clan y discípulo de secta; miembro del gremio y socio de un contrabandista; espía (information §8), cuya lealtad declarada es una y la real otra. Cuando chocan, decide la utilidad con los pesos de cada relación, y la elección deja culpa o resentimiento.

### Salida
- **Retiro, muerte, matrimonio hacia otro clan, graduación** (el aprendiz que se vuelve maestro independiente).
- **Expulsión:** decisión de un puesto con poder disciplinario (§8). Puede incluir quitarle lo que se lleva: técnicas (sello, abolición del cultivo), bienes, nombre.
- **Deserción:** irse sin permiso. Una organización con secretos teme al que se va con ellos, y eso es una presión: perseguirlo, comprarle silencio, matarlo, o dejarlo ir si cuesta más. Lo que se lleva (técnicas en la memoria, un manual robado) es conservación: existe en otro lado y puede fundar algo.
- **Traición:** pasarse a un rival con información. Karma (betrayal) y deuda de sangre institucional si hubo muertos.

## 3. Puestos, órganos y autoridad

```ts
interface Position {
  id: PositionId;
  org: OrgId;
  title: LexemeRef;                      // "Maestro de la Secta", "Anciano de Disciplina", "Patriarca", "Decano del gremio"
  powers: Power[];                       // ver abajo
  selection: SelectionRule;              // herencia, nombramiento, elección del órgano, prueba, duelo, antigüedad, designación del predecesor
  term?: Time | "life" | "until_removed";
  holder?: AgentId;
  stipend?: Array<{ good: GoodId; qty: number; per: Time }>;
  accountableTo?: PositionId | OrganId;  // ante quién responde (si responde)
  originEventId: EventId;                // cuándo se creó el puesto
}

type Power =
  | { kind: "allocate"; scope: ResourceScope; cap?: number }      // repartir píldoras, cuevas, sueldos
  | { kind: "admit" | "expel"; ranks: RankId[] }
  | { kind: "discipline"; maxPenalty: Penalty }
  | { kind: "command"; over: RankId[] | "guards" | "all" }         // dar órdenes (§4)
  | { kind: "represent" }                                          // hablar y firmar por la organización (contracts)
  | { kind: "archive_access"; level: number }
  | { kind: "appoint"; positions: PositionId[] }
  | { kind: "convene"; organ: OrganId }
  | { kind: "veto"; organ: OrganId };

interface Organ {
  id: OrganId;
  org: OrgId;
  seats: Array<{ holder: PositionId | RankId; weight: number }>;  // quién se sienta y cuánto pesa su voto
  rule: "unanimity" | "majority" | "weighted_majority" | "leader_decides_after_consult" | "consensus_of_elders";
  convenedBy: PositionId[];
  quorum?: number;
}
```

- **Poder formal vs poder real.** El estatuto dice quién puede qué; lo que pasa depende de si los demás obedecen. El poder real de una persona en la organización se mide (inspector) como cuántas de sus órdenes y propuestas prosperan, y sale de:
  ```
  influencia(a, org) = puesto(a) + fuerza percibida(a) + respeto y miedo que le tienen + deudas que le deben
                       + tamaño y cohesión de su facción + control de recursos + habilidad retórica
  ```
  Un anciano de reino alto sin puesto puede pesar más que el líder formal; un líder débil sostenido por un ancestro en reclusión manda mientras se crea que el ancestro vive.
- **Legitimidad.** Cada miembro tiene una creencia sobre si el titular de un puesto tiene derecho a ocuparlo. Sube si la regla de selección se cumplió, si da resultados, si tiene el aval de quien importa (el ancestro, el fundador, el Cielo según la doctrina) y si encarna la cara de la organización; baja con derrotas, injusticias percibidas, rumores (un nacimiento dudoso, un asesinato en la sucesión) y con un rival legítimo. La legitimidad media pondera la obediencia (§4) y es la presión que dispara crisis (§12).
- **Rangos sobre reinos culturales.** En las sectas, los rangos de discípulo se apoyan en los reinos de la escuela (cultivation §2): "para ser discípulo interno hay que estar en la etapa X". Como los reinos son clasificaciones con error, los rangos heredan los errores (el talento atascado en una barrera inventada nunca asciende).

## 3b. Cada organización tiene su propia estructura
No hay una estructura canónica. La plantilla (§13) es solo la **costumbre** de un tipo en una cultura; cada organización concreta tiene la estructura que le dejaron su fundador, su tamaño, su historia y la gente que la ocupa hoy. Una secta puede ser un maestro con doce discípulos donde todo lo decide él, o una institución milenaria con discípulos externos, internos, del núcleo y personales, ancianos, ancianos supremos, ancestros en reclusión y una docena de salones, o cualquier cosa en el medio. Y la misma organización cambia de forma a lo largo de su vida.

### Ejes de la estructura
La estructura se describe con ejes continuos. No se eligen al crear la organización: el formal sale del estatuto y el real **se mide** de lo que pasa (quién decide, qué se cumple).

```ts
interface StructureProfile {
  concentration: number;      // 0 = asamblea de todos · consejo de iguales · líder que consulta · 1 = una persona decide todo
  formalization: number;      // costumbre oral y arbitrio ↔ estatuto escrito, procedimientos, registros
  depth: number;              // niveles de rango: plana (maestro y discípulos) ↔ escalera larga de rangos y títulos
  differentiation: number;    // todos hacen de todo ↔ salones especializados (disciplina, tesoro, misiones, archivo, diplomacia)
  rankBasis: Partial<Record<"blood" | "strength" | "seniority" | "merit" | "wealth" | "favor" | "election", number>>;
  tenure: "life" | "term" | "until_challenged" | "until_retirement_age" | "at_will_of_superior";
  territorial: number;        // todo desde la sede ↔ ramas, picos o sucursales casi autónomas
  openness: number;           // cerrada por sangre o juramento ↔ abierta por prueba ↔ cualquiera que pague
  secrecy: number;            // estructura pública ↔ células donde nadie conoce más que la suya
}

interface OrgStructure {
  formal: StructureProfile;   // lo que dice el estatuto (o la costumbre, si no hay estatuto)
  real: StructureProfile;     // lo que se mide en la práctica (inspector), con su ventana de tiempo
  originEventId: EventId;     // la fundación o la última reforma
  changes: EventId[];         // concentraciones, reformas, colapsos (abajo)
}
```

- **Formal y real pueden divergir mucho.** El estatuto dice "decide el consejo" y en la práctica nadie vota contra el líder; o al revés, el líder formal es un sello y decide una facción detrás. El real se mide como la fracción de asuntos que pasan por cada órgano, de cuántas decisiones ganó la preferencia de cada persona y de cuántas órdenes de cada uno se cumplen (§3, poder real).
- **La forma de decidir sale de la estructura real** (§4): en una autocracia, deliberar es convencer al líder; en un colegio de iguales, es votar; en una federación de ramas, es negociar entre ramas; en una cofradía plana, decide quien puede imponerse en el momento o el consenso.

### Algunas configuraciones (ejemplos, no tipos cerrados)
| Configuración | Cómo se ve | Fortaleza y punto débil |
|---|---|---|
| **El fundador autócrata** | Una secta de un solo maestro, una banda, una casa comercial nueva. Todo pasa por él; consejo decorativo o inexistente | Rápida y coherente; frágil cuando él falta, y nadie aprendió a decidir |
| **El viejo que no suelta** | El líder sigue en el puesto mucho después de que debería, por voluntad propia (abajo) | Continuidad; decisiones postergadas, sucesores que envejecen esperando, facciones que conspiran |
| **La fuerza abrumadora** | Un ancestro varios umbrales por encima de todos: nadie vota contra él. El consejo existe para cuando está en reclusión, y en esas ventanas el poder se reparte | Nadie se atreve a atacarla; todo depende de que él viva y de que se crea que vive |
| **La secta tradicional** | Escalera larga de rangos (sirvientes, externos, internos, núcleo, personales, ancianos, ancianos supremos, ancestros), salones especializados, estatuto escrito, consejo con reglas | Estable y resistente a la muerte de cualquiera; lenta, burocrática, corrupción en los intersticios, rangos que se vuelven hereditarios de hecho |
| **El líder figura** | Título sin poder: un niño heredero con regente, un ancestro senil, un líder elegido por débil | Mantiene la forma; el poder real está en otro lado, y eso es inestable |
| **El colegio de iguales** | Gremio de maestros, consejo de aldea, socios de una casa comercial | Legitimidad alta; se traba cuando los intereses se separan |
| **La federación de ramas** | Clan con ramas casi independientes, secta con picos autónomos donde el líder es árbitro | Resiste la pérdida de una rama; en una crisis cada rama tira para su lado |
| **La cofradía plana** | Hermanos jurados, una banda chica, un grupo de errantes | Lealtad personal intensa; no escala más allá de unos pocos |
| **Células ocultas** | Culto o sociedad secreta: nadie conoce más que su célula y su contacto | Sobrevive a infiltrados y capturas; coordinar es lento y las órdenes se deforman |

### De dónde sale la estructura
- **El fundador.** Un fundador dominante (`warmth` baja, `control` alto, valor `power`) centraliza; uno que fundó con compañeros iguales arma un consejo; uno que desconfía de todos no escribe nada y lo guarda en su cabeza. La primera estructura es casi siempre la forma de ser de quien fundó.
- **La fuerza relativa.** Cuanto más separa el cultivo (o la riqueza, o el control de la fuerza) al de arriba de los demás, más se concentra el poder real, diga lo que diga el estatuto.
- **La cultura** (living-world §3): un imperio de río trae burocracia y rangos; un pueblo nómada, consejo de clanes; una cultura con prestigio de la antigüedad, gerontocracia.
- **El tamaño y la atención finita del líder.** El que decide tiene un presupuesto de atención por período (según `control`, `intellect` y el tiempo que pasa en reclusión). Lo que no atiende lo deciden otros de hecho o queda sin decidir. Un autócrata con tres mil discípulos no puede decidirlo todo: aparecen poderes intermedios aunque nadie los haya creado, y con el tiempo se formalizan o se le escapan.
- **El recurso.** Una vena única en la sede favorece la centralización (quien controla la montaña controla todo); minas, aldeas y sucursales dispersas favorecen la federación.
- **Las amenazas.** La guerra concentra el poder (hace falta decidir rápido) y rara vez lo devuelve sola.
- **La historia.** Después de un tirano, el estatuto limita al líder; después de una sucesión sangrienta, se escribe la regla; después de una traición, sube el secreto.

### Cómo cambia (siempre con un evento)
- **Concentración:** un líder que rompe un umbral muy por encima de los demás, que gana una guerra o que purga a sus rivales vacía el consejo. El estatuto puede seguir igual: lo que cambia es el real.
- **Dispersión:** muere el autócrata sin un sucesor de su talla, o entra en reclusión larga: el consejo recupera poder, o las facciones se reparten la organización.
- **Formalización:** una crisis (sucesión, malversación, cisma) produce reglas escritas, salones nuevos o un registro.
- **Reforma:** un líder que quiere cambiar la estructura (crear salones, abrir el ingreso, quitarle poder a los ancianos) lo intenta como cualquier decisión (§4), contra los que pierden con el cambio.
- **Osificación:** rangos por mérito que se vuelven hereditarios de hecho, salones que existen solo para dar sueldos, normas que nadie recuerda por qué existen.
- **Cambio de tipo:** la secta que se vuelve clan, el gremio que se vuelve casa comercial, la banda que se vuelve señorío.

### El líder que no suelta
Que un líder se quede hasta morir no es una regla de la plantilla: es una **decisión** suya que se renueva cada vez que hay presión para que se vaya.
- **Lo que lo retiene:** valores `power` y `status`, una identidad atada al puesto ("soy el Maestro de la Secta"), desconfianza de los sucesores, miedo a lo que le pasa sin la protección del puesto (rivales, deudas de sangre), costo hundido, y la desesperación al final de la vida (npc-psychology §9c): soltar el puesto es soltar los recursos que necesita para alargarla.
- **Lo que lo empuja:** su legitimidad cae a medida que declina (body-health: envejecimiento; npc-psychology: declive cognitivo), con malos resultados, ausencias y decisiones erráticas; los sucesores se impacientan; la costumbre de retiro (si existe) pesa; los aliados externos piden un interlocutor.
- **Cómo termina:** muere en el puesto (y la sucesión es peor porque nadie se preparó), se retira por fin con condiciones, lo destituye el consejo, lo apartan con un golpe o un veneno, o queda como figura con el título mientras el poder real se mueve a otro.

## 4. Cómo decide una organización
La organización no tiene una función de utilidad. Tiene **asuntos**, **gente que propone**, **un órgano que decide** y **gente que ejecuta**.

### Rutina y asuntos
- **Rutina:** casi todo lo que hace una organización lo hacen titulares de puestos siguiendo normas sin deliberar: pagar sueldos, recaudar el tributo, tomar la prueba anual, asignar misiones, vigilar el portón. Cada rutina es un objetivo del titular con peso según su lealtad y su diligencia; si el titular es corrupto o perezoso, la rutina sale mal y eso deja huellas (los sueldos llegan tarde, el tesoro no cuadra).
- **Asuntos** (`Issue`): lo que no está en la rutina. Nacen cuando un miembro con acceso a un órgano **percibe** una presión y le conviene plantearla:
  ```ts
  interface Issue {
    id: IssueId;
    org: OrgId;
    raisedBy: AgentId;
    kind: IssueKind;                     // amenaza externa, recurso que se agota, oferta de alianza, sucesión, falta grave,
                                         // herejía, reparto, deuda, venganza, expansión, petición de un aliado
    beliefs: BeliefRef[];                // lo que el que lo plantea cree (puede ser falso o un cebo de una intriga)
    causes: CauseRef[];
  }
  ```
  Un asunto que nadie plantea no existe para la organización aunque la presión sea real: la vena se agota en silencio si al único que lo nota le conviene callar.

### Deliberación
1. **Propuestas.** Cada participante del órgano arma opciones con su planificador (el mismo de npc-psychology §7 y schemes §3), valorándolas así:
   ```
   U_a(opción) = w_org(a)     × U_org_creída_por_a(opción)        // lo que a cree que le conviene a la organización
               + w_facción(a) × U_facción_creída(opción)
               + w_self(a)    × U_a_personal(opción)               // sus objetivos, su rencor, su puesto
   ```
   Los pesos salen de la lealtad, los valores (`tradition`, `power`, `family`), `warmth`, la identidad y la cercanía a la sucesión. El "interés de la organización" que cada uno imagina sale de la doctrina, de sus creencias y de sus esquemas: el belicoso cree que a la secta le conviene la guerra.
2. **Discusión con actos de habla** (npc-psychology §8): argumentar con creencias (y mentiras), apelar a la doctrina, a la tradición, al fundador, a la cara; prometer apoyo a cambio de algo; amenazar; exponer un secreto ajeno; comprar votos. Cada acto mueve las creencias y las utilidades de los demás. Antes de la sesión hay pasillos: las coaliciones se arman afuera.
3. **Decisión** según la regla del órgano, con los votos de cada uno decididos por utilidad (softmax con `rng.fork("org", …)`). El resultado es un evento `OrgDecision` con causas: quién planteó, qué creencias circularon, quién votó qué, qué favores se movieron.
4. **Si el poder está concentrado** (banda, secta de un solo maestro, clan patriarcal, un ancestro abrumador), decide el líder con su utilidad, y los demás se limitan a influirlo con actos de habla: el consejo, si existe, ratifica. Si el líder no atiende el asunto (atención finita, reclusión), lo decide de hecho quien tenga el poder intermedio, o nadie. Si el poder está repartido entre ramas (federación), el asunto se negocia entre ramas como entre aliados (§10) y obliga solo a las que aceptan. Cuál de estos casos aplica sale de la estructura real (§3b), no del estatuto.

### Ejecución
- La decisión se baja como **órdenes** (`Order { from, to, task, deadline, resources, originEventId }`) que entran a los objetivos de cada receptor con un peso:
  ```
  peso(orden) = obediencia(receptor, emisor) × costo_de_desobedecer_creído + coherencia con sus valores − costo personal
  obediencia = f(lealtad a la organización, legitimidad del emisor, miedo, norma cultural, relación personal)
  ```
- **La brecha entre decidir y hacer** es donde vive el drama: órdenes cumplidas a medias, saboteadas por la facción que perdió la votación, filtradas al enemigo, ejecutadas con exceso de celo, o reinterpretadas por quien tiene que cumplirlas. Todo deja eventos con la orden como causa.
- **Políticas permanentes:** una decisión puede crear una norma o una rutina nueva ("desde ahora, las aldeas del valle pagan el doble") que sigue sola hasta que alguien plantee cambiarla.

### Ejemplo
La vena del Monte Hierro baja (planet-gen, cultivation §5). El Anciano de Recursos lo nota en las cuevas, pero no lo plantea: le conviene que el déficit se descubra en el turno del Anciano de Tesoro, su rival. Un año después, los discípulos internos se quejan de que las cuevas rinden menos (perciben la caída); el asunto llega al consejo. El anciano Feng, que tiene un rencor con la Secta Nube Azur por la muerte de su hermano, propone tomar la vena del Lago Jade y lo argumenta con un rumor (falso) de que el ancestro de Nube Azur murió en reclusión. El líder, débil y en sucesión discutida, necesita el apoyo de la facción de Feng y vota a favor. La guerra de causality §4 empieza así: con una presión real, una creencia falsa, un rencor y una coalición.

## 5. Facciones
Las facciones no se declaran en la plantilla: **emergen** cuando miembros con intereses compatibles y un vínculo que los junte encuentran un motivo para coordinarse.

```ts
interface Faction {
  id: FactionId;
  org: OrgId;
  leader?: AgentId;
  core: AgentId[];                       // los que se juegan por ella
  sympathizers: AgentId[];               // votan con ella cuando les conviene
  basis: Array<"lineage" | "branch" | "master_line" | "peak" | "doctrine" | "generation" | "origin" | "economic" | "patron">;
  agenda: GoalId[];                      // objetivos compartidos: un puesto, una doctrina, un reparto, una guerra
  cohesion: number;                      // cuánto se sostienen juntos (sale de relaciones internas y éxitos)
  resources: HolderRef[];                // lo que controlan sus miembros (no hay "tesoro de facción" salvo que lo armen)
  visibility: "open" | "known_to_insiders" | "secret";
  originEventId: EventId;                // el catalizador: una sucesión, una herejía, un reparto injusto
}
```

- **Bases naturales.** En una secta, cada pico o línea de maestro es una facción en potencia (los discípulos de un anciano le deben todo); en un clan, cada rama; en un gremio, los maestros ricos contra los pobres; en todas, generaciones (los viejos contra los jóvenes), orígenes (los de la capital contra los provincianos) y doctrina (ortodoxos contra reformistas: discovery §6).
- **Formación.** Se detecta como una agrupación de miembros con relaciones fuertes entre sí y objetivos alineados; se vuelve facción cuando un evento catalizador (una vacante, un reparto, una herejía) les da un objetivo común y alguien con influencia los convoca. Es un evento con causa.
- **Dinámica.** Compiten por puestos, recursos y la sucesión; arman coaliciones con otras; se espían; traman (schemes): un anciano trama contra otro con los mismos métodos que cualquier intrigante, a veces usando a la organización como arma (calumnia ante la sala de disciplina, misión suicida para el discípulo rival).
- **Disolución.** Cuando el objetivo se logra o se pierde del todo, cuando muere el líder sin sucesor, o cuando el costo de seguir supera lo que se espera ganar. Una facción derrotada sin salida se calla, se va o rompe (cisma, §11).
- **Facciones secretas:** una conspiración dentro de la secta, una célula de un culto demoníaco infiltrada, la red de un espía. Son facciones con `visibility: "secret"` cuya existencia se descubre con las mecánicas de schemes §5.

## 6. Recursos y economía interna
El tesoro es una tenencia (economy §2b). La organización no tiene plata "propia" fuera de lo que está en sus lotes y sus derechos.

### Ingresos
| Fuente | Ejemplo | De dónde sale (conservación) |
|---|---|---|
| Tributo de protección | Aldeas al pie de la secta pagan grano, trabajo, hijos con talento | Del excedente de los hogares (economy §14) |
| Rentas | Tierras arrendadas del clan, tiendas alquiladas | Del trabajo de arrendatarios |
| Extracción propia | Minas de piedras, vetas, valles de hierbas, la vena misma | De stocks naturales (economy §3) |
| Producción | Píldoras, armas, talismanes, telas, servicios | Insumos + trabajo de miembros |
| Misiones para externos | Cazar una bestia para un magistrado, escoltar una caravana | Del bolsillo del que contrata |
| Aportes de miembros | Cuotas de gremio, porcentaje de ganancias, regalos de ingreso | Del bolsillo del miembro |
| Ofrendas | Templos, cultos, santuarios de ancestros | De fieles (y a veces se queman: sumidero) |
| Herencias | Lo que deja un anciano sin heredero, según el estatuto | De la tenencia del muerto (disputable) |
| Botín y confiscación | Guerra, castigo de un miembro, absorción | De la tenencia del derrotado |

### Gastos
Sueldos por rango (en plata o piedras), recursos de cultivo (píldoras, piedras, tiempo en cuevas), manutención de sirvientes y mortales, formaciones defensivas (queman piedras sin parar), construcción y reparación, regalos diplomáticos, sobornos, guerra, compra de técnicas y materiales. Cultivar quema dinero (economy §12): una secta con muchos cultivadores fuertes es un sumidero enorme.

### Puntos de contribución
- La moneda interna de las sectas: se ganan con misiones, servicios y méritos, y se canjean por recursos (técnicas del archivo, píldoras, tiempo en la cueva de qi denso, materiales).
- **Son derechos, no cosas** (economy §2): un claim contra el tesoro. Si la secta reparte más puntos de lo que el tesoro respalda (para comprar lealtad, para financiar una guerra), los puntos pierden valor: el salón de contribución sube los precios, se acaban las píldoras, y los discípulos lo perciben como injusticia. Inflación interna con causa.
- Los puntos no salen de la secta: no se pueden gastar afuera, salvo por canje ilegal entre discípulos (mercado negro interno).

### Asignación y corrupción
- Repartir es una decisión de quien tiene el poder `allocate`, con sus sesgos: su facción, sus discípulos, sus deudas. El nepotismo y la discriminación salen de la utilidad del que reparte, no de una regla.
- **Malversación:** el administrador que se queda con píldoras, falsea registros o vende técnicas afuera. Deja huellas en el tesoro (lo que falta existe en otro lado: en su cueva, en el mercado) y en los libros, si la organización lleva libros (`recordKeeping` de la cultura epistémica). Una auditoría (orden de un puesto superior) es una investigación con las mecánicas de percepción y huellas.
- **Presupuesto como presión.** Gastos que superan ingresos son una presión: subir el tributo (descontento de las aldeas), vender técnicas (pierde ventaja), recortar sueldos (deserción, facciones), expandirse o pelear por recursos (guerra). Qué opción se elige lo decide la deliberación (§4).
- **El qi también se gasta.** Una secta sobre una vena consume el qi de su celda (cultivation §5). Crecer agota la montaña: la presión más clásica del género, con la causa a la vista para quien mire.

## 7. Conocimiento, doctrina y secretos
- **Archivo.** El pabellón de escrituras, la biblioteca del gremio, los registros del clan: soportes físicos (living-world §7) con niveles de acceso. Técnicas, recetas, mapas, genealogías, crónicas, libros contables. Se copian con errores, se queman, se roban (un discípulo que memoriza lo que no debía es un robo). Las técnicas secretas son el capital más defendido.
- **Doctrina.**
  ```ts
  interface Doctrine {
    values: ValueWeights;                // ideología: el mismo catálogo de valores de npc-psychology §2
    norms: NormId[];                     // código de conducta (§8)
    cultivationSystem?: SystemId;        // escuela de cultivo con sus dogmas (cultivation §2, discovery §6)
    theology?: BeliefRef[];              // qué cree del Cielo, de los ancestros, de los dioses (living-world §5)
    epistemic: EpistemicCulture;         // discovery §13
    anomalies: AnomalyLogId;             // registro de anomalías (discovery §6)
    originEventId: EventId;
  }
  ```
  La doctrina sesga a quien se forma ahí (prior institucional) y es el lenguaje con el que se argumenta en el consejo. "Ortodoxa" y "demoníaca" no son tipos: son reputaciones que salen de los valores y los métodos de una secta según quién mira.
- **Herejía y cisma doctrinal:** el mecanismo de discovery §6 pasa por acá. Quien cambia de hipótesis contra el dogma es un miembro con un problema: callar, convencer (deliberación), ser castigado (§8) o irse (§11).
- **Secretos con niveles de acceso** (information §7): qué saben los externos, los internos, los ancianos y el líder. El secreto más peligroso de una secta suele ser sobre su propia fuerza (el ancestro que murió, la formación que ya no tiene piedras, la vena que se agota).
- **Las creencias de la organización son una vista.** Para decidir, "lo que la secta sabe" es lo que saben los que deciden más lo que alguien busque en el archivo. Información que llegó a un discípulo externo y no subió no existe para el consejo. Subir información es una decisión (le conviene o no al que la tiene).
- **Memoria institucional:** crónicas propias sesgadas ([chronicle.md](chronicle.md) §1-2), enemigos hereditarios, deudas de sangre que se enseñan a cada generación como memoria contada (npc-psychology §9c, rencor entre generaciones).

## 8. Normas, disciplina y justicia interna
- **Normas** del estatuto (en `content/` como catálogo): no matar a hermanos de secta, no revelar técnicas, obedecer al maestro, aportar el diezmo, no casarse fuera del clan sin permiso, no vender por debajo del precio del gremio. Cada norma tiene una pena prevista y quién la aplica.
- **Investigar** una falta es una acción de los titulares con poder disciplinario: interrogar, buscar huellas, leer el alma si el mundo y el cultivo lo permiten. Se equivocan con las mismas reglas que cualquier investigador (perception, information).
- **Penas:** multa en contribución, confinamiento, trabajo forzado, latigazos, sello del cultivo, abolición del cultivo, expulsión, muerte. Aplicarlas es una decisión del que juzga, con sus sesgos: la norma se aplica distinto al discípulo del anciano poderoso que al huérfano sin protector. Esa diferencia se percibe y alimenta resentimiento y facciones.
- **Por encima de la ley.** Una secta fuerte protege a sus miembros de la justicia mortal ("si tocás a mi discípulo, tocás a la secta"), y una de las fuentes de tensión con el estado ([law.md](law.md) §10; [state.md](state.md) §10) es exactamente esa. Lo que la organización está dispuesta a hacer por un miembro sale de su rango, su valor para ella y la cara en juego (§14).
- **Vendetta institucional:** la muerte de un miembro crea una presión de venganza en la organización, que se procesa como asunto (§4). Que la secta responda depende de quién era el muerto, quién lo mató y cuánto cuesta responder.

## 9. Maestro y discípulo
El vínculo más importante del mundo del cultivo (cultivation §15), y el de maestro y aprendiz en los oficios.
- **Se crea con un evento:** una ceremonia (reverencias, té, registro en el linaje), o a veces de hecho (enseñar sin ceremonia, salvar una vida y enseñar). Deja un `bond` en las relaciones de los dos (npc-psychology §6) y un `KarmicBond` master_disciple (heaven-karma) que se hereda en las dos direcciones.
- **Obligaciones mutuas** (formalizadas en [contracts.md](contracts.md) como compromiso de `status`): el maestro enseña, protege y provee recursos; el discípulo obedece, sirve, defiende la cara del maestro, lo cuida en la vejez y lo venga si lo matan.
- **Grados:** discípulo personal (directo, recibe lo esencial), discípulo registrado (nominal), discípulo de nombre (enseñado de lejos). El maestro reparte atención, recursos y técnicas según su utilidad: favoritos, rivalidades entre hermanos marciales.
- **Transmisión:** técnicas (de la memoria del maestro, con sus errores), guía que acelera la integración de insights (discovery §7: un maestro que señala el camino), contactos y enemigos (el discípulo hereda los rencores del maestro).
- **El árbol del linaje:** hermanos marciales mayores y menores, tíos marciales, abuelo marcial. Es una jerarquía de respeto y de facción (§5) que atraviesa la organización, y una red de deudas y rencores.
- **Cuando sale mal:** el maestro que usa a sus discípulos (como recursos, como cuerpos para poseer al final de la vida: npc-psychology §9c, desesperación), el discípulo que supera al maestro y le pierde el respeto, el que lo traiciona por una técnica. Romper el vínculo pesa en karma y en reputación.

## 10. Relaciones entre organizaciones

```ts
interface OrgRelation {
  from: OrgId; to: OrgId;                // asimétrica
  formal: Array<"alliance" | "vassal" | "suzerain" | "protector" | "protected" | "trade_partner" | "marriage_alliance"
              | "rival" | "feud" | "war" | "truce" | "nonaggression">;   // tratados y estados declarados (contracts)
  sentiment: RelationshipDims;           // trust, respect, fear, resentment… agregadas de los que deciden (npc-psychology §6)
  believedStrength: BeliefRef;           // qué cree `from` de la fuerza de `to` (cultivadores por rango, ancestros, formaciones)
  grievances: EventId[];                 // deudas de sangre, ofensas, robos, promesas rotas
  originEventId: EventId;
  history: EventId[];
}
```

- **El sentimiento de una organización hacia otra** es la agregación de las relaciones de sus decisores con esa organización y con sus miembros, más la memoria institucional. Un líder nuevo con un amigo en la otra secta cambia la relación sin que cambie nada más.
- **La fuerza ajena es una creencia.** Se estima por lo que se ve (cuántos cultivadores en las ferias, el aura de sus ancianos), por espías y por rumores. El secreto mejor guardado de muchas sectas es si su ancestro sigue vivo. Atacar a una secta que parece débil y no lo es (o al revés) es el error de Ley 4 a escala institucional.
- **Diplomacia hecha por personas:** emisarios (que pueden mentir, ser sobornados u ofender sin querer), regalos (conservación: salen del tesoro), matrimonios de alianza ([family-lineage.md](family-lineage.md) §6), intercambio de discípulos y rehenes, tratados ([contracts.md](contracts.md) §12), torneos y ferias entre sectas (donde se mide la fuerza a la vista y se gana o pierde cara).
- **Jerarquías regionales:** una secta grande con sectas y clanes subordinados que pagan tributo y mandan discípulos; la subordinada obedece mientras la cree más fuerte y le conviene. Cuando el señor se debilita, los vasallos lo perciben (o no) y prueban.
- **Escalera de conflicto:** competencia (por discípulos, mercados, territorios), intriga entre organizaciones (schemes, ítem 22 del backlog), escaramuzas y asesinatos, vendetta (deudas de sangre institucionales que se cobran por generaciones), guerra ([war.md](war.md)). Cada escalón es una decisión (§4) con causas, y bajar también.
- **Espías e infiltrados** (information §8): miembros de una organización que trabajan para otra. Son personas con lealtades en conflicto, no un atributo de la relación.

## 11. Ciclo de vida

### Nacimiento
Toda organización nace de un evento con un fundador y motivos. Precondiciones: un fundador con algo que ofrecer (fuerza, técnica, riqueza, carisma, doctrina), seguidores con motivos para unirse (protección, avance, ganancia, fe, hambre), un lugar o un recurso, y el reconocimiento mínimo de afuera (o la fuerza para no necesitarlo).

| Origen | Cadena típica |
|---|---|
| **Descubridor de técnica** | Un cultivador descubre algo (discovery §8) → enseña a unos pocos → escuela → secta con montaña |
| **Vena encontrada** | Un errante encuentra una vena (causality §4) → se asienta → toma discípulos → secta |
| **Familia que acumula** | Un ancestro se vuelve cultivador o una familia se enriquece → patrimonio común que proteger → clan |
| **Problema común de un oficio** | Artesanos golpeados por la competencia o los impuestos → cofradía → gremio con licencias |
| **Comerciante exitoso** | Un mercader con capital y socios → sucursales → casa comercial, casa de cambio |
| **Profeta o milagro** | Alguien vio una tribulación o un "milagro" que fue un cultivador (living-world §5) → fieles → templo, religión |
| **Hambre y armas** | Desertores, campesinos sin tierra, una mala cosecha → banda de bandidos |
| **Cisma** | Una facción derrotada o hereje se va (abajo) |
| **Decreto** | Un estado o una secta mayor crea una rama, una academia, una oficina ([state.md](state.md)) |

### Crecimiento e institucionalización
- **Crecer** por reclutamiento, absorción, conquista, alianzas y matrimonios. Lo limitan el qi de la vena, los ingresos, la cohesión (más miembros, más facciones, más costo de control) y la reacción de los vecinos, que perciben la amenaza.
- **Del carisma a las reglas.** La primera generación funciona por la autoridad personal del fundador. Escribir el estatuto, crear puestos y fijar la sucesión es un evento (a veces forzado por una crisis). La muerte del fundador sin reglas claras es la primera gran crisis de casi toda organización.

### Declive
Agotamiento de la vena o de la mina, pérdida del cultivador más fuerte, sucesiones disputadas, corrupción que vacía el tesoro, doctrina estancada que produce peores cultivadores, derrotas, deudas, fuga de talentos hacia rivales. Ninguno es un dial: son presiones medibles, y el inspector puede mostrar cuál pesó.

### Cisma
- Pasa cuando una facción (§5) pierde y no puede o no quiere quedarse: sucesión perdida, herejía castigada, reparto que la condena.
- **Qué se lleva cada lado es conservación:** los miembros que la siguen (cada uno decide), los bienes que controlan sus miembros, las técnicas que saben, los manuales que roban, las aldeas que la siguen pagando. Los dos lados se disputan nombre, sellos, archivo, sede y legitimidad ("somos la verdadera secta").
- El cisma deja rencor de las dos partes y deudas de sangre si hubo muertos. Las ramas separadas a veces se reconcilian siglos después; a veces se odian más que a cualquier extraño.

### Fusión y absorción
Por alianza matrimonial, por rendición, por compra (un gremio pobre absorbido por uno rico), por conquista. Los absorbidos son una facción natural (origen) con memoria de lo que eran.

### Muerte
- **Destrucción:** guerra, catástrofe, purga del estado. Los miembros mueren, se dispersan o se rinden; el tesoro se saquea o **se pierde** (la cueva sellada que nadie abrió, el anillo del líder muerto en la batalla). Queda la sede en ruinas.
- **Disolución:** se apaga de a poco (sin ingresos, sin discípulos), o se transforma (secta que se vuelve clan, gremio que se vuelve casa comercial).
- **Legados** (deep-history): ruinas con lo que no se llevaron, técnicas dispersas en sobrevivientes y en manuscritos, deudas de sangre abiertas, enemigos que todavía la odian, aldeas que recuerdan su protección, espíritus (un ancestro remanente que quiere restaurarla: spirits §1).
- **Restauración:** alguien con la herencia (el sello del líder, las técnicas, la sangre) puede refundarla. La legitimidad de la restauración la deciden los demás: antiguos aliados, antiguos enemigos, los que ocuparon su montaña. El jugador puede ser ese alguien.

## 12. Sucesión
- **Reglas** (`SelectionRule` del puesto): primogenitura, elección del consejo, designación del predecesor (testamento, sello), prueba o duelo, antigüedad, "el más fuerte", aval de un ancestro. Cada cultura y plantilla tiene las suyas, y el estatuto puede contradecir la costumbre.
- **Crisis** cuando: la regla es ambigua, hay varios candidatos con apoyos, el designado es más débil que un rival, el testamento es dudoso (o falso), o **no se sabe si el líder murió** (reclusión: cultivation §15). La crisis es una presión que acelera las facciones, las intrigas (schemes) y las alianzas externas (un candidato pide ayuda afuera y queda en deuda).
- **Interregno y regencia:** mientras no hay sucesor aceptado, el poder formal queda en un regente o en el consejo, y el real en quien controle la fuerza y el tesoro.
- **El resultado se decide por los mecanismos de §4:** quién se impone es quien junta más legitimidad e influencia, no quien "tiene derecho". Un ganador con poca legitimidad gobierna con miedo y deja una sucesión siguiente peor.
- **Ancestros en reclusión:** un poder latente que puede volver y desarmar una sucesión, o no volver nunca. Su existencia, y su vida, es una de las creencias más disputadas del mundo.

## 13. Plantillas por tipo (en `content/`)
Cada plantilla trae rangos, puestos, órganos, ingreso, fuentes de ingresos y normas típicas; cada cultura las varía (living-world §3).

- **Clan:** linaje (genealogía en [family-lineage.md](family-lineage.md) §9), línea principal y ramas, salón ancestral con ofrendas a ancestros (spirits), patrimonio común vs de cada familia, matrimonios estratégicos, sirvientes hereditarios y clientes. Clan cultivador (con ancestros fuertes) o clan mortal con un cultivador que lo sostiene. El patriarca y el consejo de mayores. La sangre decide más que el talento, hasta que un genio de rama secundaria lo pone en duda.
- **Secta:** montaña sobre una vena, picos y líneas de maestros, rangos de discípulos (sirviente, externo, interno, núcleo, personal), pruebas de ingreso, salón de misiones y de contribución, pabellón de escrituras, sala de disciplina, ancianos y ancestros en reclusión, aldeas tributarias al pie. Su base económica son la vena, las minas y el tributo; su capital son las técnicas.
- **Escuela o academia:** menos jerárquica, más enseñanza que poder; vive de matrículas y mecenazgo (discovery §13). Puede ser mortal (letras, medicina, exámenes imperiales).
- **Gremio:** maestros, oficiales y aprendices; licencias para ejercer, calidad mínima, marca del gremio, precios acordados, recetas protegidas, cabildo de maestros (economy §10). Su tensión permanente: a cada miembro le conviene romper el acuerdo.
- **Casa comercial y casa de cambio:** socios con participaciones (claims sobre la casa), sucursales con encargados de confianza (principal–agente a distancia: el encargado lejano roba o no), capital de confianza, letras (economy §2).
- **Casa de subastas:** reputación de discreción y garantía como capital (economy §9), empleados sobornables.
- **Templo y religión:** clero con jerarquía, fieles como membresía difusa (una creencia más que un registro), ofrendas, doctrina sobre el Cielo, culto a un espíritu real o a nada (spirits §1). Cismas por doctrina y por milagros.
- **Monasterio:** comunidad cerrada con reglas de vida, tierras propias, archivo; refugio y prisión.
- **Banda:** bandidos, piratas, saqueadores. Líder por fuerza, reparto de botín, guarida, normas mínimas; nace del hambre y se disuelve rápido cuando el botín no alcanza o el líder cae. Puede crecer a señor de la guerra.
- **Sociedad secreta y culto:** membresía oculta, células, juramentos, ritos; facción secreta en otras organizaciones. Desde un culto demoníaco hasta una hermandad de revolucionarios.
- **Red de inteligencia y casa de información** (information §8): agentes, corresponsales, cifrados; su capital es la exactitud.
- **Mercenarios y escoltas:** contratos de fuerza; lealtad al que paga, mientras pague.
- **Consejo de aldea:** los mayores que deciden el reparto del agua, la defensa y el tributo; la organización más chica y la primera que ve el jugador.
- **Estado y ejército:** este mismo modelo con plantillas propias; detalle en [state.md](state.md) y [war.md](war.md).

## 14. Identidad y cara colectiva
- **Señales:** nombre, emblema, colores, uniformes, sellos, fichas de identidad (jade de discípulo), técnicas de firma reconocibles en combate (cultivation). Todas se perciben (perception) y se pueden falsificar o robar: vestir el uniforme de una secta es usar su cara prestada, con sus riesgos.
- **Cara colectiva** (npc-psychology §9c): la de un miembro es la de su maestro, su línea y su organización. Ofender a un discípulo en público es un asunto para la secta si el ofendido importa o si hubo muchos testigos. La organización responde para recuperar cara cuando lo decide alguien con poder (§4), no automáticamente.
- **Reputación de la organización** por comunidad (information §9): "los del Filo de Hierro protegen a sus aldeas", "el gremio de sal roba en el peso". Se forma por patrones percibidos de sus miembros y por historias. Un miembro que se porta mal le cuesta reputación a todos (y eso es una presión disciplinaria).
- **Sesgo de grupo** (npc-psychology §9c): los de adentro son creíbles y los de afuera sospechosos. Es parte de por qué las organizaciones se equivocan sobre sus rivales.

## 15. Organizaciones y el Cielo
- Una organización no tiene alma ni karma propio por defecto: el karma es entre agentes (heaven-karma §2), y lo que hace una organización lo hacen personas. Las deudas de sangre "de la secta" son la suma de los vínculos de quienes ordenaron y ejecutaron, más la memoria de los que las cobran.
- La **fortuna colectiva** (气运) de organizaciones y naciones es una ampliación pendiente (ítem 20 del backlog, heaven-karma); este doc deja `Organization` lista para que se le agregue.

## 16. El jugador y el narrador
- **Entrar:** presentarse a una prueba, conseguir una recomendación, casarse en un clan, jurar en una banda. Todo son acciones del catálogo resueltas por la sim; nadie lo acepta por ser el jugador.
- **Subir:** contribución, cultivo, méritos, alianzas, favores, intrigas. Los puestos se ganan con las mismas reglas que los NPCs (§3, §12).
- **Liderar no es un menú.** Como líder o anciano, el jugador da **órdenes** a personas concretas, convoca órganos, plantea asuntos, propone y negocia en texto libre (actos de habla). Las órdenes se cumplen según la obediencia de cada uno (§4): el jugador que gobierna sin legitimidad ve cómo sus órdenes se diluyen. Para no microgestionar, puede fijar **políticas permanentes** y delegar en titulares, que las ejecutan con su lealtad y su honestidad.
- **Fundar:** juntar seguidores, un lugar, recursos y reconocimiento. La sim decide si la gente lo sigue; el narrador no fabrica discípulos.
- **Lo que el jugador ve** de su organización es lo que su personaje sabe según su nivel de acceso y lo que le contaron: el organigrama oficial, los rumores sobre facciones, lo que ve en el consejo. El narrador nunca revela la facción secreta ni el tesoro real si el personaje no los conoce.
- **Inspector god-mode:** organigrama real y oficial, poder real por persona (órdenes que prosperan), facciones con sus miembros (incluidas las secretas), tesoro y flujos, decisiones con su cadena de causas (`why <decisionId>`), legitimidad media de cada puesto, relaciones entre organizaciones y qué cree cada una de la fuerza de la otra.

## 17. Escala (LOD)
- **Tier 4 (la organización del jugador y las que lo tocan de cerca):** miembros individuales, deliberaciones completas con actos de habla, órdenes con ejecución individual, facciones detectadas por relaciones, tesoro con lotes.
- **Tier 3 (organizaciones importantes):** líder, ancianos, titulares y líderes de facción como agentes; el resto como población por rango (pirámide de miembros con cultivo y lealtad agregados). Decisiones por estación o por asunto, con deliberación resumida (votos por utilidad sin diálogo).
- **Tier 2:** líder y consejo resumidos, facciones como bloques con peso y agenda, tesoro agregado por categoría. Decisiones por regla agregada (votación ponderada de facciones) y rutinas como flujos.
- **Tier 0-1 y simulación histórica:** la organización es un vector de estado (miembros por rango, tesoro, territorio, ingresos y gastos, cohesión, legitimidad del líder, doctrina, relaciones) con **procesos de riesgo** por período para sucesión, cisma, guerra, absorción, colapso y nacimiento:
  ```
  P(cisma) = f(facciones fuertes perdedoras, legitimidad baja, anomalías doctrinales, presión de recursos)
  P(nacimiento, región) = f(descubridores, venas libres, hambre, comercio, fervor religioso)
  ```
  Calibrados contra el modo individual (causality §5.1). Cuando dispara, se materializan los protagonistas (el hereje, el sucesor, el fundador) y el evento queda con causas.
- **Materialización:** al bajar de tier, los miembros reciben biografías coherentes con la historia de la organización (antigüedad, maestro, línea, facción, lo que vivieron en la última guerra), y las facciones se reconstruyen desde esas relaciones.

## Implementación
- **Fase 1:** nada de organizaciones; la aldea tiene un jefe y mayores como NPCs con respeto, sin estructura.
- **Fase 3 (offscreen):** consejo de aldea como primera organización (reparto, defensa, tributo); bandas de bandidos que nacen del hambre y se disuelven; membresía y lealtad como relación con la organización.
- **Fase 4 (cultivo):** secta mínima como plantilla: prueba de ingreso con instrumentos con error, rangos sobre reinos culturales, maestro y discípulo, sueldos, puntos de contribución.
- **Fase 6 (organizaciones):** el modelo completo: puestos, órganos, deliberación y ejecución con brecha, facciones emergentes, tesoro con ingresos y gastos, corrupción con huellas, normas y disciplina, sucesión y crisis, relaciones y diplomacia, cismas, absorciones, plantillas de clan, gremio, casa comercial, templo y sociedad secreta.
- **Fase 7 (historia):** ciclo de vida en modo agregado (procesos de riesgo), organizaciones que nacen y mueren en la historia y dejan legados, rencores hereditarios entre organizaciones.
- **Fase 8:** estado y ejército sobre este modelo ([state.md](state.md), [war.md](war.md)), jerarquías regionales de sectas.

## Tests
- Determinismo: mismo seed y mismas acciones dan las mismas decisiones, facciones, sucesiones y cismas.
- **Ninguna decisión institucional sin personas:** todo `OrgDecision` tiene un `raisedBy`, votantes o un decisor, y causas hacia sus creencias; ningún proceso "de la organización" actúa sin un titular.
- Ninguna organización sin `originEventId` y fundadores; ningún cisma sin facción previa; ningún colapso sin presión medible.
- **Conservación:** los sueldos, regalos y gastos salen del tesoro; un cisma reparte (no duplica) miembros, bienes y manuales; un tesoro saqueado aparece en otra tenencia o como pérdida registrada.
- Los puntos de contribución son claims: canjearlos descuenta del tesoro; emitir más de lo respaldado baja lo que se puede canjear.
- **Ningún decisor lee `WorldTruth`:** la fuerza de otra organización y el estado propio se deciden con creencias.
- Escenario controlado: una organización que crece sin delegar satura la atención del líder, y sube la fracción de asuntos que deciden otros de hecho.
- Escenario controlado: al morir un autócrata sin sucesor de su talla, la concentración real cae y el consejo o las facciones ganan peso.
- Dos organizaciones de la misma plantilla y cultura, con fundadores de temperamento opuesto, terminan con estructuras reales distintas.
- Escenario controlado: con un líder de legitimidad baja, la tasa de órdenes cumplidas baja y sube la de saboteadas.
- Escenario controlado: una secta que sobreexplota su vena entra en déficit, y eso aparece como asunto en su consejo solo cuando alguien con acceso lo percibe y lo plantea.
- Escenario controlado: un rumor falso sobre la muerte del ancestro de una secta rival aumenta la probabilidad de guerra contra ella.
- Agregado: la frecuencia de cismas y sucesiones disputadas en tier 0 coincide en promedio con la de simular a los miembros.

## Decisiones tomadas en este borrador (revisables)
- Las organizaciones no tienen IA propia: deciden con asuntos planteados por personas, deliberación por utilidad mixta (organización creída, facción, uno mismo) y ejecución por órdenes con obediencia.
- La autoridad y la legitimidad son creencias; el poder real se mide por lo que prospera.
- Las facciones emergen de relaciones y catalizadores; no las fija la plantilla.
- El tesoro es una tenencia finita; los puntos de contribución son derechos contra él.
- No hay estructura canónica: cada organización tiene una estructura formal y una real, descritas por ejes continuos (concentración, formalización, profundidad, diferenciación, base del rango, permanencia, territorialidad, apertura, secreto), que salen del fundador, la fuerza relativa, la cultura, el tamaño y la historia, y cambian con eventos (§3b). Que un líder se aferre al puesto es una decisión suya, no una regla de la plantilla.
- Un solo modelo con plantillas para todos los tipos, incluidos estado y ejército (que se detallan en sus docs).
- El hogar no es una organización; un clan sí.
- El karma de lo que hace una organización es de las personas que lo hicieron; la fortuna colectiva queda para el ítem 20.
- El jugador lidera con órdenes, propuestas y políticas permanentes, no con un menú de gestión.

## Preguntas abiertas
- Calibración: frecuencia de cismas, sucesiones disputadas y colapsos por siglo; vida media de sectas, clanes y gremios por tipo y era.
- Calibración: tamaño a partir del cual aparecen facciones y costo de cohesión por miembro.
- Calibración: presupuesto de atención de un líder y velocidad con que la estructura real se concentra o se dispersa.
- Calibración: pesos típicos `w_org`/`w_facción`/`w_self` por temperamento y lealtad, para que la corrupción sea común pero no universal.
