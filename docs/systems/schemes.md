# Intrigas (planes de NPCs contra otros)

> Un NPC astuto quiere algo que otro tiene o le impide tener. No lo ataca de frente: habla con otros, siembra rumores, prepara una trampa y espera a que la víctima tome las decisiones que él previó. La víctima (el jugador u otro NPC) puede no darse cuenta hasta el final, o nunca.

> Estado: §1-§8 **borrador base**; §9-§13 son una **ampliación en borrador** (2026-10-05): `Scheme` se generaliza a `Project` (planes cooperativos con participantes que conocen versiones distintas del plan, acción colectiva y traición desde adentro), intrigas entre organizaciones ejecutadas con órdenes y modelo del gobierno del blanco, e intrigantes que explotan profecías.

Depende de: [npc-psychology.md](npc-psychology.md) (objetivos, utilidad, creencias sobre otros), [causality.md](causality.md) (todo paso es un evento con causas; presiones), [heaven-karma.md](heaven-karma.md) (las intrigas generan karma). Se apoya en [information.md](information.md) (rumores, mentiras, fuentes rastreables), [organizations.md](organizations.md) (decisiones, órdenes, facciones, relaciones), [contracts.md](contracts.md) (repartos, juramentos de silencio), [divination.md](divination.md) (profecías y presagios). Lo usan: [organizations.md](organizations.md) (intriga entre organizaciones), [state.md](state.md) (purgas y golpes), [war.md](war.md) (casus belli fabricados), [law.md](law.md) (crimen organizado, chivos expiatorios), [secret-realms.md](secret-realms.md) (expediciones), [chronicle.md](chronicle.md) ("Lo que nunca supiste").

## Principios
1. **Nada de guiones.** Una intriga es un plan que un agente ejecuta con las mismas acciones que cualquier otro (hablar, mentir, pagar, esconder, atacar). No hay "evento trampa" escrito a mano; lo que hay es un NPC que decidió mentir sobre un tesoro.
2. **El jugador no es especial.** Los NPCs traman entre ellos todo el tiempo. El jugador es una víctima más, y solo lo eligen si tiene algo que quieren o les estorba.
3. **El plan vive en las creencias del intrigante.** Modela a su víctima con lo que **cree** saber de ella. Si se equivoca sobre tu personalidad, el plan falla. Si lo conocés mejor de lo que él cree, podés usarlo en su contra.
4. **Oculto pero trazable.** El plan es parte de `WorldTruth`, nunca se le pasa al narrador. Se descubre por percepción, rumores, contradicciones e inferencia. Después de muerto (o en el inspector), `why <eventId>` muestra la cadena entera.
5. **La complejidad sale del intelecto, no del autor.** Un intrigante torpe manda matones de noche. Uno brillante arma cinco capas que te hacen elegir lo que él quería creyendo que fue idea tuya.
6. **Cooperar y tramar son la misma maquinaria.** Una intriga es un proyecto con blanco y secreto; los proyectos cooperativos usan el mismo planificador, los mismos pasos y la misma conservación (§9).
7. **Determinista.** Planificar, sumarse, traicionar y re-planificar usan `rng.fork("project", projectId, agentId, tick)`; el mismo seed da los mismos planes.

## 1. Motivos
Una intriga nace cuando un objetivo del NPC (siempre con `originEventId`) tiene a otra persona como **obstáculo o medio**:

| Motivo | Ejemplo |
|---|---|
| Codicia | Tenés una técnica, un tesoro, una herencia. |
| Rival afectivo | A la persona que él quiere le gustás vos. |
| Posición social | Tenés el favor del maestro, el puesto, el matrimonio que él quería. |
| Obstáculo | Investigás algo que lo compromete, o protegés a alguien que quiere eliminar. |
| Venganza | Resentimiento acumulado, aunque lo que recuerda esté distorsionado. |
| Encargo | Otro le paga o lo obliga: es el brazo de una intriga ajena. |
| Prevención | Cree que vos vas a atacarlo (paranoia, esquema "el mundo es hostil"). |

Que el motivo dé lugar a una intriga y no a otra cosa (pedir, competir, rendirse) depende de la utilidad: `boldness`, `control`, `warmth` baja, valores (¿lo frena la honra o el miedo al karma?) y relación con la víctima.

## 2. Métodos (catálogo, en `content/`)
Cada método es una **plantilla de sub-plan** con precondiciones y efectos esperados, armada con acciones normales:

- **Violencia directa:** asesinato nocturno, emboscada, contratar asesinos, envenenar.
- **Cebo:** plantar un rumor (tesoro, herencia, oportunidad) que lleva a la víctima a un lugar o acción preparados.
- **Falsas creencias:** calumniar, falsificar pruebas, hacer que un tercero crea que la víctima le hizo daño. Usar a otro como arma.
- **Reclutar o coaccionar:** sobornar, chantajear con secretos reales, aprovechar deudas o resentimientos ajenos.
- **Dilema fabricado:** forzar una elección donde todas las salidas sirven al plan (por ejemplo, salvar a un amigo o llegar a la prueba de la secta).
- **Tentación:** ofrecer justo lo que la víctima desea (sus objetivos y demonios son conocidos) a cambio de algo que la compromete.
- **Aislar:** separar a la víctima de sus protectores, dañar su reputación antes del golpe final.
- **Encubrir:** coartadas, eliminar testigos, culpar a otro.

Las técnicas que un NPC conoce se **aprenden**: por experiencia propia (memorias de intrigas que funcionaron), por haberlas sufrido o por enseñanza (escuelas, sectas de asesinos, cortes). Un NPC no usa un método que nunca vio ni pensó.

## 3. El planificador
Planificación jerárquica (estilo HTN) **sobre las creencias del intrigante**, no sobre la verdad.

```ts
interface Scheme {
  id: SchemeId;
  owner: AgentId;
  target: AgentId;
  goal: GoalId;                 // el objetivo que la motiva (con originEventId)
  plan: SchemeStep;             // árbol: pasos, ramas condicionales, contingencias
  targetModel: BeliefRef;       // cómo cree el intrigante que piensa la víctima
  accomplices: AgentId[];       // quiénes participan (y cuánto saben)
  status: "preparing" | "active" | "adapting" | "succeeded" | "failed" | "abandoned" | "exposed";
  originEventId: EventId;       // el momento en que decidió tramar
  log: EventId[];               // eventos que produjo
}

interface SchemeStep {          // envuelve un PlanNode de actions §3 (ARCHITECTURE §6)
  step: PlanNode | MethodRef;   // lo que se hace: un plan de verbos o un método conocido
  expects?: PredictedReaction;  // qué cree que hará la víctima
  branches?: Array<{ if: Condition; then: SchemeStep }>; // si la víctima hace otra cosa
  next?: SchemeStep;
}
```

- **Modelo de la víctima:** para predecir tus decisiones, el intrigante corre **la misma función de utilidad de la víctima, pero con los rasgos y objetivos que él cree que tiene**. Si cree que sos codicioso porque te vio regatear, el cebo será un tesoro. Si en realidad sos cauto, no vas, y el plan pasa a una rama o falla.
- **Presupuesto por intelecto:** `intellect` limita la profundidad del árbol y cuántas ramas considera. `control` (paciencia, planificación) limita el horizonte temporal: semanas o décadas. `perception` y `memory` limitan la calidad del modelo de la víctima.
  - Intelecto bajo: 1-2 pasos, sin ramas ("que la maten esta noche").
  - Medio: 3-5 pasos, una contingencia.
  - Alto: árbol profundo, varias capas de engaño, cómplices que no saben que lo son, y un chivo expiatorio preparado.
- **Ejecución:** cada paso se convierte en una acción normal en la cola del intrigante y compite en su utilidad con su vida diaria (no deja de comer ni de cultivar para tramar). Todo lo que hace es un evento con `causes` que apunta al paso anterior y al `originEventId` del plan.
- **Adaptación:** el intrigante solo se entera de lo que percibe o le cuentan. Si la víctima se desvía, re-planifica desde su creencia actual, o abandona si el costo esperado ya no compensa.

## 4. Ejemplo: el tesoro del bosque
Zhao (intelecto alto, `warmth` baja) quiere el puesto de discípulo interno que el maestro piensa darte.

1. Zhao cree que sos ambicioso y que confiás en Wen, el herbolario (lo vio conversar con vos).
2. Le cuenta a Wen, como de pasada, que unos cazadores vieron una hierba espiritual en la cueva del barranco. Wen no miente al pasarlo: cree el rumor.
3. Wen te lo cuenta. Tu fuente es alguien en quien confiás, así que la confianza en el rumor es alta.
4. Zhao le paga a dos bandidos (el dinero sale de sus ahorros: conservación) para esperar en el barranco.
5. Rama: si no vas en tres días, Zhao hace que otro discípulo comente frente a vos que él piensa ir a buscarla.
6. Vas, te emboscan. Si morís, Zhao se lleva el puesto. Si sobrevivís, hay rastros: los bandidos saben quién les pagó, Wen recuerda de dónde sacó el rumor y el dinero de Zhao bajó.

Nada de esto es un evento especial: son conversaciones, un pago, una espera y un ataque. La "trampa" es emergente.

## 5. Descubrir una intriga
Cada paso deja **huellas** reales en el mundo (testigos, dinero que se movió, rumores con fuente rastreable, contradicciones):

- **Percepción:** notar que te siguen, que el rumor llegó demasiado justo, que alguien sabe algo que no debería.
- **Rastrear rumores:** preguntar "¿quién te lo dijo?" sigue la cadena real de `toldBy` en las memorias (con distorsión y olvido).
- **Cómplices:** pueden traicionar, confesar bajo presión o dejar pruebas. Su lealtad es una relación más.
- **Inferencia:** el jugador razona por su cuenta. El narrador solo le muestra lo que su personaje percibió, nunca la conclusión.
- **Contra-intriga:** una víctima que detecta el plan puede fingir que cae, usar la trampa contra el intrigante o exponerlo ante otros.

El ritmo "a lo Lord of the Mysteries" sale de acá: los eventos de fondo ocurren con causas reales, el jugador ve fragmentos sueltos y solo al final (o al leer la crónica) se arma el cuadro.

## 6. Consecuencias
- **Karma:** cada intriga crea `KarmicBond`s entre intrigante, víctima y cómplices, con peso según el daño. Matar por intriga pesa como matar.
- **Psicología:** el éxito refuerza el esquema "la gente es manipulable" y el hábito de tramar. El fracaso o la exposición genera miedo, vergüenza y quizás un demonio. A la víctima que sobrevive le quedan memorias intensas, resentimiento y quizás el esquema "no confíes".
- **Reputación:** una intriga expuesta se vuelve un rumor que se propaga.
- **Cadenas:** la venganza de la víctima o de su familia puede abrir otra intriga. Así nacen enemistades de generaciones.

## 7. Escala por tier
- **Tier 3-4:** planificador completo, intrigas multi-capa.
- **Tier 2:** métodos simples (1-3 pasos), sin modelo fino de la víctima.
- **Tier 0-1 y simulación histórica:** en agregado. Por ejemplo, "en esta corte hay N intrigas por década con tal tasa de éxito", que deja asesinatos, desgracias y enemistades con procedencia resumida.

## 8. Implementación (Fase 3+, después de rumores e información)
- **F1:** asesinato y robo directos motivados por objetivos (sin modelo de la víctima).
- **F2:** cebos y rumores falsos (requiere el sistema de información) y cómplices pagados.
- **F3:** modelo de la víctima (utilidad sobre creencias), ramas y re-planificación.
- **F4:** chantaje, calumnias, dilemas fabricados, contra-intriga y escuelas que enseñan métodos.
- **F5 (proyectos):** `Project` con participantes, `knownPlan`, pool de recursos y repartos con compromisos; proyectos de aldea (canal, defensa), caravanas y expediciones; free riders y traición desde adentro.
- **F6 (instituciones):** intrigas de organizaciones y facciones con órdenes compartimentadas, modelo del gobierno del blanco, métodos institucionales, herencia del plan; explotar profecías.

**Tests:**
- Determinismo: mismo seed y mismas acciones dan la misma intriga.
- Ningún paso sin `causes` hacia el plan.
- El planificador nunca lee `WorldTruth` (solo creencias).
- Un intrigante con un modelo errado de la víctima falla en un escenario controlado.
- Conservación: el dinero de los sobornos sale de algún lado.
- El narrador nunca recibe el `Scheme`.
- Proyectos: todo aporte al pool sale de un participante y todo reparto sale del pool (conservación); el narrador solo recibe el `knownPlan` del personaje.
- Dos participantes con `knownPlan` distintos producen fallas de coordinación en un escenario controlado.
- Intriga institucional: el planificador modela al blanco con los miembros que cree que tiene; si cree vivo a un patriarca muerto, el plan falla.
- Profecías: apuntar una profecía a un rival cambia la conducta del creyente solo si este la cree (nunca por la verdad).
- Determinismo: mismo seed → mismos proyectos, mismas traiciones.

## 9. Proyectos: la intriga es un caso particular

Tramar contra alguien y cooperar con alguien usan la misma maquinaria: un plan jerárquico sobre creencias, pasos que son acciones normales, participantes que saben distintas partes, recursos que salen de algún lado. Por eso `Scheme` se generaliza a **`Project`**, y una intriga es un proyecto con un blanco y con secreto.

```ts
type ProjectKind =
  | "scheme"          // contra un blanco, oculto (secciones 1-8)
  | "venture"         // negocio conjunto: caravana, taller, mina, préstamo sindicado
  | "expedition"      // reino secreto, caza de una bestia, búsqueda de una herencia
  | "construction"    // canal, muralla, templo, formación de una secta
  | "rescue" | "heist" | "defense" | "migration" | "festival" | "courtship" | "custom";

interface Project {
  id: ProjectId;
  kind: ProjectKind;
  owner: AgentId | OrgId | FactionId;   // quien lo concibió o la organización que lo decidió
  goal: GoalId;                          // el objetivo que lo motiva (con originEventId)
  plan: SchemeStep;                      // el plan como lo tiene el dueño (sección 3)
  participants: Participation[];
  targets: Array<AgentId | OrgId>;       // vacío si no es contra nadie
  secrecy: "open" | "discreet" | "secret" | "compartmented";
  pool: LedgerRef;                       // recursos aportados (conservación: cada aporte sale de alguien)
  commitments: CommitmentId[];           // acuerdos de reparto, juramentos de silencio (contracts)
  status: "forming" | "preparing" | "active" | "adapting" | "succeeded" | "failed" | "abandoned" | "exposed" | "dissolved";
  originEventId: EventId;
  log: EventId[];
}

interface Participation {
  agent: AgentId;
  role: RoleId;                          // líder, financista, guía, músculo, cebo, chivo expiatorio, obrero
  knownPlan: SchemeStep | null;            // lo que este participante cree que es el plan (puede diferir del real)
  believedShare: ShareRef;               // lo que cree que va a recibir
  joinedBy: EventId;                     // invitación, orden, contrato, coacción
  stake: number;                         // lo que aportó y arriesga
}
```

- **`Scheme` sigue existiendo** como nombre: es un `Project` con `kind: "scheme"`, `targets` no vacío y secreto. Todo lo de las secciones 1-8 vale igual.
- **Cada uno tiene su versión del plan.** El dueño tiene el plan real; los demás tienen lo que les contaron (`knownPlan`). Puede ser una parte (compartimentado), una versión simplificada o una mentira. Las fallas de coordinación salen solas: dos participantes que creen planes distintos hacen cosas que no encajan.
- **Sumarse es una decisión.** Cada invitado decide con su utilidad: lo que cree que va a recibir, la confianza en el líder (npc-psychology §6), el riesgo creído, sus objetivos y lo que le cuesta decir que no (cara, deuda, miedo). Una orden de la organización entra como peso de obediencia (organizations §4: ejecución).
- **El problema de la acción colectiva.** Aportar compite en la utilidad de cada uno con su vida diaria. Si nadie controla, aparecen los que aportan menos de lo prometido (free riders); si el reparto es injusto o lo parece, aparecen los que se van o traicionan. Los compromisos (contracts: reparto, juramentos, rehenes) y la vigilancia del líder suben el costo de fallar.
- **Traición desde adentro.** Un socio de un golpe que se queda con todo, un miembro de la expedición que vende la ruta a otra secta, el guía que lleva al grupo a una trampa: el participante arma su propio `Project` (un `scheme`) que tiene al proyecto como blanco.
- **El proyecto disfrazado.** Un `scheme` puede presentarse como un proyecto abierto: "sumate a la expedición" cuando el lugar de cada invitado en el plan real es ser el cebo o el sacrificio. Los invitados ven un `knownPlan` cooperativo; la verdad está en el plan del dueño.
- **Recursos y conservación.** Todo aporte entra al `pool` desde un dueño concreto y todo reparto sale del pool. Lo que se gasta (comida de la expedición, salarios de obreros) se registra; lo que sobra se reparte según los compromisos o según quién tenga la llave.
- **Cuando el dueño muere** el proyecto pasa a quien conozca el plan y quiera seguirlo (el segundo, un heredero, la organización), o se disuelve. Un plan escrito puede sobrevivir sin nadie que lo ejecute y encontrarse después (information: secretos en documentos).
- **Ejemplos:** una aldea cava un canal (cada familia aporta días de trabajo según el acuerdo del consejo; los que no aportan pierden agua o cara); cinco cultivadores entran a un reino secreto con un reparto jurado; mercaderes juntan capital para una caravana; una banda planea robar el tesoro de una secta con un infiltrado adentro.

## 10. Intrigas entre organizaciones

Cuando el dueño de un `scheme` es una organización o una facción, el plan se ejecuta con **órdenes** a sus miembros y agentes (organizations §4), y el blanco puede ser otra organización entera.

- **Nace de una decisión.** Un asunto (`Issue`) llega al órgano, o el líder decide solo, o una facción lo arma sin pasar por el órgano. El `originEventId` es el `OrgDecision` o el acuerdo de la facción, y sus causas son las creencias que circularon.
- **El modelo del blanco es un modelo de su gobierno.** Para predecir qué va a hacer la otra organización, el planificador simula **su proceso de decisión** con lo que cree saber: quiénes se sientan en su consejo, qué creen, qué facciones tiene, cuánto pesa su líder. Una intriga contra una secta falla si el que la planeó no sabía que su viejo patriarca había muerto.
- **Compartimentar es la norma.** Cada ejecutor conoce solo su paso (`secrecy: "compartmented"`): el que deja la carta no sabe quién la escribió. Eso da **negación plausible**, pero también fallas: órdenes mal entendidas, ejecutores que improvisan, y nadie que pueda corregir sin saber el todo.
- **Métodos de escala institucional** (en `content/`, como los de la sección 2):
  - **Usar a un tercero como arma:** hacer que la secta A crea que la B mató a su discípulo, para que se desgasten entre ellas.
  - **Infiltración larga:** plantar un discípulo que pasa décadas subiendo en la otra organización. El horizonte sale del `control` del que planea y de la vida de la organización, no de la del agente.
  - **Romper desde adentro:** alimentar una facción rival, financiar un cisma, apoyar a un candidato débil en la sucesión, exponer un secreto en el peor momento (organizations §5, §11, §12).
  - **Asesinar al pilar:** al heredero, al alquimista único, al ancestro que sostiene la formación.
  - **Guerra económica:** acaparar lo que el otro necesita, arruinar su crédito, cortar su ruta (economy).
  - **Fabricar un casus belli** para que la guerra sea justificable ante la propia gente y los aliados ([war.md](war.md) §1).
  - **Absorber:** alianzas de matrimonio, deudas que se cobran en territorio, protección que se vuelve vasallaje.
- **Herencia del plan.** Las organizaciones viven más que sus miembros, así que una intriga puede atravesar generaciones si el plan está en la memoria de los que suceden (o en un archivo). Si se pierde con un muerto, los agentes que quedaron sueltos siguen con su última orden o se independizan.
- **Exposición.** Una intriga institucional descubierta se vuelve agravio entre organizaciones (organizations §10: `grievances`), puede escalar a vendetta o guerra, deja karma repartido entre quienes ordenaron y ejecutaron ([heaven-karma.md](heaven-karma.md) §6) y suele terminar con un chivo expiatorio que la organización sacrifica para negarla.
- **El estado.** Purgas, golpes de palacio y conspiraciones de corte son esto mismo con el estado como dueño o como blanco ([state.md](state.md)).

## 11. Intrigantes y profecías

Una profecía es una creencia que mueve utilidades ([divination.md](divination.md) §5). Un intrigante que la conoce puede usarla aunque no crea en ella, y a veces justamente porque no cree.

- **Apuntarla a otro.** "El hijo de la casa Li derrocará al rey" no dice cuál hijo: el intrigante hace correr que es el hijo de su rival, y el rey hace el trabajo.
- **Fabricar al elegido.** Encontrar o preparar a alguien que encaje en los signos (fecha de nacimiento, marca, linaje) y falsificar lo que falte (social-structure: falsificar la posición). Un títere con profecía tiene seguidores que un títere sin ella no tiene.
- **Comprar o coaccionar adivinos** para que interpreten a favor, o para que "descubran" una profecía nueva.
- **Usar presagios calculables.** Quien sabe calcular eclipses o mareas (pronóstico por conocimiento, divination §3) puede elegir la fecha de un golpe para que coincida con un presagio que los demás leen como señal del Cielo.
- **Contra-profecía.** Neutralizar una profecía peligrosa con otra, o con una interpretación que la dé por cumplida ("ya se cumplió: el que derrocó al rey fue la inundación").
- **En el planificador.** La profecía entra al modelo de la víctima como una creencia con peso: el intrigante predice cómo reacciona su blanco a ella (miedo, esperanza, obsesión). Si cree mal cuánto cree la víctima, el plan falla.
- **Se escapa de las manos.** Una profecía usada no obedece al que la usó: viaja, se deforma y mueve a otros. El intrigante que la apuntó al hijo del rival puede terminar con un ejército de creyentes que lo busca a él, o con el niño que sobrevivió y creció con odio. La profecía sigue cumpliéndose o frustrándose sola (divination §5).
- **Riesgos metafísicos.** Un adivino real que lea el caso puede ver la mano del intrigante (los hilos kármicos de la falsificación); en mundos donde el Cielo cuida su voz, fabricar presagios a su nombre puede sumar atención y deuda (heaven-karma §3).

## 12. El jugador y el narrador

- **El jugador puede armar proyectos** con las mismas estructuras: juntar un grupo para una expedición, proponer un negocio, organizar a la aldea contra los bandidos. Invita con actos de habla y la gente decide con su utilidad; no hay "reclutar compañero" como menú.
- **Cuando participa en un proyecto ajeno**, el narrador recibe solo su `knownPlan` y lo que percibe. Si el proyecto es una intriga disfrazada, el jugador ve la versión cooperativa y las grietas que su personaje pueda notar.
- **El jugador puede tramar contra organizaciones:** infiltrarse, sembrar discordia, apuntar una profecía. Los NPCs de esa organización lo modelan con lo que creen de él (sección 3).
- **El inspector** muestra todos los proyectos, el plan real, la versión de cada participante y el blanco (`plans`, [causality.md](causality.md) §10).
- **La crónica** suma los proyectos en "Lo que nunca supiste": las expediciones en las que eras el cebo, las intrigas de sectas que te rozaron, las profecías que alguien apuntó a vos.

## 13. Escala (LOD) de proyectos
- **Tier 3-4:** planificador completo, `knownPlan` por participante, traiciones internas, intrigas institucionales con modelo del gobierno del blanco.
- **Tier 2:** proyectos simples (pocos pasos, roles fijos, reparto por norma), sin versiones distintas del plan salvo la del cebo.
- **Tier 0-1:** proyectos en agregado: obras públicas que salen de presiones (un canal por década en un valle con sequía y un consejo que funciona), expediciones como tasas de entrada y retorno por reino secreto, intrigas entre organizaciones como tasa por par de organizaciones según su relación (agravios, rivalidad, fuerza creída), que dejan eventos con procedencia resumida.
- **Historia profunda:** las intrigas institucionales exitosas que nadie descubrió quedan como "hechos" en la memoria colectiva con la versión falsa (la secta B mató al discípulo de A), y su verdad solo está en el grafo.

## Crónica: "Lo que nunca supiste"
Al morir, la crónica tiene una sección que revela las intrigas que te afectaron y nunca descubriste: quién tramó, por qué, qué pasos dio y qué decisiones tuyas había previsto. Se arma desde `WorldTruth` y el grafo causal (los `Scheme` y su `log`), y es el único momento en que el narrador recibe esa información. Incluye también las intrigas que fracasaron sin que te enteraras.

## Decisiones (2026-10-05)
- **Límite de intrigas por psicología, no por CPU:** un NPC sostiene entre 1 y 3 intrigas activas según inteligencia y ambición, con un techo duro de 5. Las que no entran quedan como **deseos latentes** (motivación sin plan armado) y pueden activarse cuando se cierra una.

- **`Scheme` es un `Project`** con blanco y secreto; una sola estructura para cooperar y tramar.
- **Cada participante tiene su versión del plan** (`knownPlan`); la coordinación y el engaño salen de esa diferencia.
- **Las intrigas institucionales se ejecutan con órdenes** (organizations §4) y modelan el proceso de decisión del blanco, no una utilidad única de la organización.

## Preguntas abiertas
- Calibración: tasa de intrigas entre organizaciones por par según agravios y rivalidad; proporción de free riders por cultura y tamaño del grupo; con qué frecuencia una profecía usada se vuelve contra el que la usó.
- ¿Pueden los proyectos cooperativos grandes (una muralla, una expedición de cien personas) tener líderes intermedios con su propio sub-plan? Propuesta: sí, como sub-proyectos con `owner` el líder intermedio y el proyecto padre como objetivo.
