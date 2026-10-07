# Experimentación, descubrimiento e iluminación

> Estado: **borrador de diseño**. Cómo un agente (NPC, jugador, organización, cultura) llega a **saber cómo funciona el mundo**: forma hipótesis sobre las leyes, junta evidencia, experimenta, se equivoca con forma, inventa cosas nuevas y, en el plano de la comprensión, acumula hasta que algo se rompe y entiende (悟, iluminación). Cubre también los dogmas de las escuelas y el arte con intención (aprender contemplando una obra). Es la pieza que convierte la `WorldTruth` en conocimiento sin que nadie la lea.

Depende de: [causality.md](causality.md) (Ley 4: se actúa según lo que se cree; nada aparece sin causa), [metaphysics.md](metaphysics.md) (la ley vs las escuelas; el costo de experimentar), [perception.md](perception.md) (toda evidencia entra por percepción, incluida la interna), [information.md](information.md) (las hipótesis son creencias `law`; transmisión, textos, secretos), [npc-psychology.md](npc-psychology.md) (curiosidad, intelecto, sesgos, esquemas, corazón del Dao), [cultivation.md](cultivation.md) (umbrales reales vs reinos de escuela, técnicas, insights), [body-health.md](body-health.md) (sustancias, medicina, percepción del propio cuerpo), [living-world.md](living-world.md) (el conocimiento es físico, culturas, mitos). Lo usan: [cultivation.md](cultivation.md) (insights, técnicas nuevas, escuelas que corrigen sus mapeos), [body-health.md](body-health.md) (medicina de cada cultura, antídotos), [heaven-karma.md](heaven-karma.md) (comprender la ley del Cielo), [deep-history.md](deep-history.md) (técnicas perdidas y redescubiertas), [organizations.md](organizations.md), [crafts.md](crafts.md), [technology.md](technology.md) (catálogo de procesos mortales), [divination.md](divination.md), y [chronicle.md](chronicle.md).

## Principios
1. **La ley es verdad; el saber es hipótesis.** Las leyes del mundo (qué cura una hierba, dónde está un umbral, cómo se vencen los elementos) viven en `WorldTruth`. Ningún agente las consulta. Lo que tiene son **creencias `law`** (information §1) con confianza, fuentes y evidencia.
2. **Se aprende de consecuencias reales.** No hay una tirada de "descubriste X". La sim resuelve lo que pasa con sus leyes; el agente percibe (o no) causa y efecto, y actualiza. Si el efecto no se percibe, no se aprende.
3. **Equivocarse tiene forma.** Las supersticiones, los dogmas y las teorías falsas salen de mecanismos concretos (confusión de causas, muestras chicas, sesgos, autoridad), con la misma lógica que los errores de percepción y la deformación de rumores. Una teoría falsa siempre tiene una historia que la explica.
4. **Tres formas de saber.** *Saber que* (proposiciones, se transmiten como texto), *saber cómo* (técnicas y recetas, se enseñan y se practican) y *comprender* (insights, no se transmiten, solo se cultivan). Cada una se adquiere y se pierde distinto.
5. **La iluminación es un umbral, no un milagro.** Es el cruce de un estado acumulado (experiencia sin integrar, profundidad previa, mente calma y un disparador). Se puede preparar, nunca forzar ni regalar.
6. **Inventar es buscar en un espacio que la ley evalúa.** Quien crea una técnica o una receta elige componentes según lo que cree; lo que la creación **hace de verdad** lo calcula la ley. Los defectos de una técnica son los errores de su autor hechos objeto.
7. **Experimentar cuesta.** Materiales (que se consumen: conservación), tiempo, salud, riesgo de desviación y a veces karma (experimentar con personas). El valor de la información compite con todo lo demás en la utilidad.
8. **Determinista.** `rng.fork("discovery", agentId, lawKey, eventId)` para el ruido de observación y la generación de hipótesis; `rng.fork("insight", agentId, aspectId, eventId)` para la iluminación.

## 1. Qué se puede descubrir
El espacio de lo descubrible es un **catálogo cerrado de tipos de ley** (en `content/`), instanciado por la ley de cada mundo. Una `LawKey` es la pregunta; la verdad es su respuesta en `WorldTruth`.

```ts
type LawKey =
  | { kind: "effect"; agent: SubstanceId | ElementId | ActionClass | TechniqueId;
      target: TargetClass; effect?: EffectKey }                    // ¿qué hace esta hierba al cuerpo? ¿el fuego daña la madera?
  | { kind: "condition"; base: LawKey; factor: ConditionKey }      // ¿funciona solo fresca? ¿solo de noche? ¿solo en raíces de agua?
  | { kind: "threshold"; path: PathId; position: number;
      property: "exists" | "requires" | "ceiling" | "effects" }    // ¿hay una barrera acá? ¿qué pide? ¿hay techo?
  | { kind: "elementRelation"; a: ElementId; b: ElementId }        // generación, destrucción, inversión por cantidad (elements.md)
  | { kind: "regularity"; phenomenon: PhenomenonKey; correlate: CorrelateKey }  // el qi sube con la luna llena; las bestias migran con el frío
  | { kind: "siteCause"; site: SiteId }                            // ¿por qué este valle tiene tanto qi?
  | { kind: "process"; recipe: RecipeSketch }                      // ¿qué sale si destilo esto con aquello a este fuego?
  | { kind: "flaw"; technique: TechniqueId | TechniqueCopyId };    // ¿esta técnica tiene un error? ¿dónde?
```

- **Lo que no es descubrimiento.** Quién mató a quién, dónde está alguien o qué precio tiene el arroz son **hechos**, y van por [information.md](information.md). Descubrimiento son las **regularidades**: lo que vale siempre (o bajo ciertas condiciones) y sirve para predecir.
- **La verdad es una función, no un texto.** Para cada `LawKey` la ley sabe responder "¿qué pasa si…?" (la misma función que usa la sim para resolver). Eso permite evaluar cualquier hipótesis contra la verdad sin que la verdad esté escrita como frase.
- **Comprender no está en este catálogo.** Los aspectos de la ley que se comprenden (el filo, el agua, la muerte) son `LawAspect` (§7): no son proposiciones verdaderas o falsas sino profundidad de entendimiento.
- **Observabilidad.** Cada ley tiene un `observability` que sale de su forma: efectos inmediatos y grandes (un veneno rápido) son fáciles; efectos lentos, chicos, condicionales o raros (un tóxico que se acumula veinte años, un umbral que casi nadie alcanza) son difíciles. Es lo que hace que ciertas cosas tarden siglos en saberse y otras se sepan desde siempre.

## 2. Hipótesis
Una hipótesis es una respuesta candidata a una `LawKey`. Las creencias `law` de un agente son una **distribución sobre hipótesis**, no un valor.

```ts
interface Hypothesis {
  id: HypothesisId;
  key: LawKey;
  claim: LawClaim;                  // forma tipada: "efecto = curar fiebre, magnitud media, si se hierve"
  predicts: (situation: Situation) => Distribution<OutcomeClass>;   // qué espera ver
  falsifiable: boolean;             // las explicaciones morales o místicas pueden no predecir nada
  origin: HypothesisOrigin;
}

type HypothesisOrigin =
  | { kind: "tradition"; culture: CultureId | OrgId }   // la heredó: dogma, saber popular
  | { kind: "told"; beliefId: BeliefId }                 // se la contaron o la leyó (information)
  | { kind: "generated"; agent: AgentId; eventId: EventId; from: GenerationRule }  // se le ocurrió
  | { kind: "player"; eventId: EventId };                // la propuso el jugador (§14)

interface LawBelief extends Belief {                     // Belief con prop.kind === "law"
  hypotheses: Array<{ h: HypothesisId; weight: number }>;
  evidence: ObservationId[];                             // el ledger que la sostiene (resumido según tier, §15)
  anomalies: ObservationId[];                            // lo que no cuadra con la hipótesis dominante
}
```

### De dónde salen las hipótesis
- **Tradición.** Cada cultura y escuela trae un **prior**: las hierbas que "todo el mundo sabe", la teoría médica de la época, los dogmas de la secta (§6). Es el punto de partida casi siempre, y es lo que un NPC usa sin pensarlo.
- **Generación.** Cuando algo **sorprende** (una observación con baja probabilidad bajo lo que ya cree), el agente puede generar candidatos nuevos con un catálogo de **reglas de generación**:
  - *Post hoc*: lo que pasó justo antes es la causa ("comí la raíz y se me pasó la fiebre").
  - *Analogía*: "si el jade frío calma el qi de fuego, quizás el hielo también".
  - *Condición oculta*: "funcionó la primera vez y no la segunda; algo cambió" (hora, frescura, persona).
  - *Inversión*: "si esto daña, lo contrario quizás cura".
  - *Simetría y patrón*: "los primeros tres umbrales pidieron saturación; el cuarto debe pedir otra cosa".
  - *Moralización*: "le pasó porque ofendió al Cielo" (rara vez falsable).
  - *Agencia*: "alguien lo hizo a propósito" (espíritus, maldiciones, un rival).
- **Cuántas y cuáles.** El número de candidatos y la regla que se usa dependen de `intellect`, `curiosity`, la formación (un alquimista conoce reglas que un campesino no) y los esquemas (`heaven_is_just` favorece la moralización, `people_are_untrustworthy` la agencia).
- **Vocabulario.** Solo se puede pensar con los conceptos que se tienen. Una cultura que no conoce los meridianos no formula hipótesis sobre ellos (puede formular "el aliento interno", que mapea mal). Los **conceptos** son conocimiento cultural, se aprenden y a veces se inventan (un concepto nuevo es un descubrimiento en sí, y abre familias enteras de hipótesis).
- **La verdad puede no estar en la lista.** Si nadie pensó la respuesta correcta, ninguna cantidad de evidencia la encuentra: solo baja la confianza en lo que sí se pensó (anomalías). Pensar lo impensado es lo raro y valioso, y es lo que hacen los genios y los herejes.

## 3. Evidencia: observaciones
Toda evidencia es un percept (perception) sobre un evento que la sim ya resolvió con la ley real.

```ts
interface Observation {
  id: ObservationId;
  observer: AgentId;
  key: LawKey;
  eventId: EventId;                 // el evento real que la produjo
  situation: PerceivedSituation;    // lo que el observador notó de las condiciones (no todas)
  outcome: PerceivedOutcome;        // lo que notó del resultado, con su confianza
  delay: Duration;                  // cuánto tardó en manifestarse el efecto
  deliberate: boolean;              // experimento (§4) o experiencia pasiva
  recordedIn?: ItemId;              // si quedó escrita (cuaderno, registro de secta)
}
```

- **Generación.** Cuando un evento resuelto toca una ley del catálogo (alguien comió una hierba, cruzó un umbral, se estrelló contra uno), cada agente que percibió **la causa y el efecto** recibe una observación. Si solo vio uno de los dos, no hay observación (o hay una incompleta que puede completar después: "tomó algo anoche").
- **Actualización.** `peso(h) ∝ peso(h) × P(observación | h)`, donde `P` usa la **situación percibida**, no la real. Ajustes:
  - **Confianza del percept:** una observación borrosa pesa poco.
  - **Sesgo de confirmación:** lo que confirma la hipótesis dominante pesa más, según los esquemas y cuánto está atada la creencia a la identidad (information §1).
  - **Ventana de atribución:** un efecto que tarda más que la ventana del agente (crece con `intellect` y `memory`, y con registros escritos) no se conecta con su causa. Por eso los tóxicos lentos de las píldoras tardan generaciones en sospecharse.
  - **Hipótesis no falsables** no ganan ni pierden peso con la evidencia; viven de la tradición y la autoridad.
- **Experiencia indirecta.** Ver a otro vivir el efecto también es observación (con más incertidumbre sobre la situación). Escuchar el relato es **testimonio**, no observación: entra por la credibilidad de la fuente (information §1).
- **Memoria.** Las observaciones decaen como memorias. Sin escritura, el agente recuerda la tendencia ("casi siempre funciona") y pierde los casos; el conteo se vuelve gist, y los gists exageran. Con un cuaderno, la evidencia se conserva (y se puede pasar a otro: un registro de observaciones es un objeto valioso).

## 4. Experimentar
Experimentar es una **acción deliberada** para producir observaciones sobre una ley. Es como la experiencia pasiva, pero eligiendo las condiciones.

```ts
interface Experiment {
  agent: AgentId;
  key: LawKey;
  hypotheses: HypothesisId[];       // qué quiere distinguir
  design: {
    vary: ConditionKey[];           // qué cambia a propósito
    control: ConditionKey[];        // qué intenta mantener igual
    repetitions: number;
    subjects: SubjectRef[];         // uno mismo, un animal, un sirviente, un voluntario, un prisionero, un material
  };
  materials: ItemId[];              // se consumen (conservación)
  risk: RiskEstimate;               // lo que el agente CREE que arriesga
}
```

- **Calidad del diseño.** Elegir qué variar y qué controlar sale de `intellect`, de la formación y de la **cultura epistémica** (§13). Un diseño malo no controla la variable que importa: produce evidencia que confunde (la hierba "funciona" porque siempre la probó en invierno). El diseño se valora por la **ganancia de información esperada** entre las hipótesis que el agente tiene, así que nunca apunta a lo que no se le ocurrió.
- **Los resultados los da la sim.** Cada repetición es un evento real resuelto con la ley; el agente recibe observaciones como siempre. El experimento no "revela" nada: produce evidencia que todavía hay que interpretar.
- **Costo y riesgo reales.**
  - Probar sustancias en el propio cuerpo envenena de verdad (body-health §9). El herbolario que prueba cien hierbas (神农) acumula toxinas.
  - Probar variantes de cultivo en los propios meridianos puede desviar el qi (body-health §12); probar una ruptura a ciegas es apostar la vida (cultivation §6).
  - Experimentar con animales cuesta animales; con sirvientes, prisioneros o discípulos crea karma, memorias, demonios internos y enemigos. Las sectas demoníacas son las que experimentan con personas sin freno, y por eso a veces saben cosas que las ortodoxas no.
  - Consume materiales que salen de algún lado (hierbas, piedras, núcleos) y tiempo de vida.
- **Por qué alguien experimenta.** Lo decide la utilidad: `valor = ganancia de información esperada × lo que está en juego (curar a un hijo, romper un umbral, ganar un mercado) + curiosidad (valor knowledge) − costo − riesgo percibido`. Un desesperado prueba cosas que un cauto no; un curioso experimenta sin necesidad.
- **Experimentos en otros.** Un médico que prueba un tratamiento en un paciente, un maestro que hace practicar dos variantes a dos discípulos, una secta que manda grupos a romper con distintos métodos: todos producen observaciones para quien diseñó y para quien vivió el resultado (que puede sacar otra conclusión).

## 5. Equivocarse con forma
Cada error de conocimiento tiene un mecanismo, y el inspector puede mostrar cuál fue:

| Mecanismo | Qué pasa | Ejemplo |
|---|---|---|
| **Confusor oculto** | Una variable que el agente no percibe produce el efecto | La raíz "cura" porque se da cuando la fiebre ya baja sola |
| **Regresión** | Se trata en el peor momento y la mejoría natural parece efecto | Las sangrías "funcionan" en enfermos que se iban a curar |
| **Muestra chica** | Dos o tres casos fijan una creencia fuerte | "Esa cueva trae mala suerte" por dos accidentes |
| **Supervivencia** | Solo cuentan los que sobrevivieron al método | El método brutal de la secta "funciona": los que murieron no enseñan |
| **Efecto lento** | La causa queda fuera de la ventana de atribución | Las píldoras de ruptura acortan la vida, pero nadie conecta las muertes tempranas |
| **Autoridad** | El peso del maestro o del texto aplasta la evidencia propia | "El maestro dice que el cuarto reino tiene tres barreras" |
| **Identidad** | La creencia sostiene quién es el agente o su secta | Admitir el error del fundador es traicionar a la secta |
| **No falsable** | La explicación no predice nada, así que nada la mata | "Falló porque su corazón no era puro" |
| **Vocabulario pobre** | La hipótesis correcta no se puede formular | Sin el concepto de contagio, la plaga es castigo |
| **Fusión** | Dos efectos distintos se toman por uno | Dos hierbas parecidas se confunden y "a veces cura, a veces mata" |

- **Las supersticiones son descubrimientos fallidos.** Rituales, amuletos, días nefastos, curas falsas: todos nacen de observaciones reales mal atribuidas y viajan como cualquier rumor (information §3). Algunas aciertan por casualidad parcial (el amuleto de plata no espanta espíritus, pero el agua guardada en plata se pudre menos).
- **Errores que funcionan.** Una teoría falsa puede dar recetas que sirven ("el fuego del hígado" no existe, pero la hierba que la teoría receta sí baja la fiebre). La gente no tiene incentivo para corregir lo que funciona, y eso hace durar a las teorías falsas.
- **Ningún error inventa por fuera.** Las hipótesis erróneas salen de reglas de generación aplicadas a lo que el agente percibió y cree, igual que los errores de percepción y los rumores.

## 6. Dogmas de escuela
Los `dogmas` de un `CultivationSystem` (cultivation §2), y en general las teorías de cualquier tradición (médica, alquímica, de la forja), son **creencias `law` colectivas** de una organización o una cultura.

### Cómo nacen
- Del fundador: sus hipótesis dominantes al sistematizar lo que vivió, con sus errores y sus aciertos. Una escuela hereda la ventana de atribución, la muestra y los sesgos de quien la fundó.
- Por supervivencia: los linajes cuyo método funcionaba (aunque fuera por razones equivocadas) sobrevivieron y enseñaron.
- Por autoridad acumulada: lo que repitieron muchas generaciones se vuelve evidente.

### Cómo se sostienen
- **Autoridad y textos:** el prior institucional pesa mucho en quien se forma ahí.
- **Incentivos:** el estatus de la secta, el puesto de los ancianos y los exámenes de rango dependen de la doctrina. Cambiarla cuesta poder a alguien.
- **Castigo:** la herejía se persigue ([organizations.md](organizations.md) §8, law). Quien duda en voz alta arriesga su lugar.
- **Errores que funcionan** (§5): si la doctrina produce cultivadores razonables, la presión para revisarla es baja.

### Qué cuestan
Los mapeos equivocados de cultivation §2 son dogmas con consecuencias concretas:
- **Barrera inventada** (un umbral partido en dos reinos): los discípulos pierden años preparando una ruptura que no existe, o temen intentar algo que pasarían.
- **Barrera ignorada** (dos umbrales en un reino): se estrellan contra un umbral que nadie les dijo que estaba; la escuela lo explica con "falta de talento" o "corazón impuro".
- **Techo falso** ("nadie pasa del Alma Naciente"): nadie lo intenta, y la profecía se cumple sola.
- **Requisito equivocado:** preparan lo que no hace falta y descuidan lo que sí.

### Anomalías y cambio
Cada organización lleva un **registro de anomalías** sobre sus dogmas: observaciones que no cuadran (un discípulo que rompió sin la "segunda barrera", uno que superó el "techo", muertes que la doctrina no explica).
- Las anomalías se acumulan con saliencia, como las memorias. Mientras son pocas, se explican con las reglas de siempre (talento, suerte, corazón).
- Cuando pesan más que la autoridad del dogma **para algún miembro con suficiente intelecto, curiosidad y poca atadura de identidad**, ese miembro cambia de hipótesis. Ahí empieza el conflicto: puede callar, convencer, ser castigado, irse.
- **Herejía → cisma → escuela nueva.** Si el que cambió tiene seguidores y su método funciona mejor, la escuela se parte o nace otra ([organizations.md](organizations.md) §11). Es el camino "descubridor de técnica → escuela → secta" de la Fase 6. La escuela vieja puede adoptar el cambio décadas después y reescribir su historia (crónicas sesgadas).
- **El jugador puede estar ahí.** Descubrir que su escuela se equivoca (cultivation §16) es exactamente esto: juntar anomalías, probar, y decidir qué hacer con lo que sabe.

## 7. Comprensión: insights
Los insights de cultivation §9 son la tercera forma de saber. No son proposiciones: son **profundidad de entendimiento** de un aspecto de la ley.

```ts
interface LawAspect {
  id: LawAspectId;                  // filo, agua, fuego, flujo, muerte, vida, espacio, tiempo, karma...
  related: Array<{ aspect: LawAspectId; transfer: number }>;  // entender el agua ayuda con el flujo
  elements: ElementVector;          // afinidad con el sistema elemental del mundo
  tier: number;                     // los aspectos profundos (tiempo, karma) piden base en otros
}

interface Insight {
  aspect: LawAspectId;
  depth: number;                    // cuánto lo entiende
  fidelity: number;                 // qué tan fiel a la ley real: comprensión torcida es posible
  pending: number;                  // experiencia acumulada que todavía no se integró
  habituation: Record<ExperienceKind, number>;  // lo repetido enseña cada vez menos
  originEventId: EventId;           // la primera vez que algo se le encendió
  milestones: EventId[];            // iluminaciones y avances que lo formaron
}
```

- **Los aspectos son del mundo.** El seed genera el grafo de aspectos a partir del sistema elemental y de los caminos de la ley (un mundo con camino de sangre tiene el aspecto "sangre"). Las culturas los nombran y los agrupan a su manera (otra vez: clasificación cultural sobre la verdad).
- **Acumular (`pending`).** Cada experiencia que toca un aspecto deposita material:
  ```
  Δpending = intensidad × resonancia(aspecto) × atención × aptitud(comprehension) × (1 − habituation[tipo])
  ```
  - *Intensidad:* una pelea a muerte con espada enseña más del filo que mil cortes de práctica; ver morir a alguien amado enseña de la muerte más que mil cadáveres.
  - *Resonancia:* raíces y elementos, temperamento (el impulsivo resuena con el fuego), camino y técnicas que practica.
  - *Atención:* la experiencia vivida distraído deposita poco (perception §4).
  - *Habituación:* repetir lo mismo rinde cada vez menos. La comprensión pide **variedad**: viajar, pelear con distintos rivales, vivir junto al mar y después en el desierto.
- **Integrar (`pending` → `depth`).** La meditación, la reclusión y la práctica reflexiva convierten lo acumulado en profundidad, lento (comprensión gradual, 渐悟). La velocidad depende de `comprehension`, de la calma (emociones, dolor, demonios internos) y de técnicas de contemplación.
- **Fidelidad.** Lo que se integra bajo emociones fuertes, obsesión o técnicas que amplifican la psique (npc-psychology §9b) baja la fidelidad: se entiende "la muerte" como hambre de matar, "la libertad" como desprecio por todo vínculo. Una comprensión infiel da poder igual, pero desvía: aumenta el riesgo de desviación de qi y de demonios internos, y puede llevar a un camino demoníaco sin que el cultivador lo haya elegido.
- **Experiencia sin integrar pesa.** Mucho `pending` con poca integración (un soldado que vio demasiado y nunca se detuvo) no es neutral: alimenta pesadillas, estrés y demonios internos (npc-psychology). La misma masa de experiencia puede terminar en iluminación o en quiebre.
- **Qué da la profundidad.** Intención (剑意), eficiencia de técnicas del mismo aspecto, requisitos de umbrales de comprensión, crear técnicas (§10) y, muy arriba, dominios. Detalle en cultivation §9.

## 8. Iluminación (悟)
La iluminación súbita (顿悟) es un **evento** que ocurre cuando el estado acumulado cruza un umbral.

```ts
interface EnlightenmentCheck {
  agent: AgentId;
  aspect: LawAspectId;
  pending: number;
  threshold: number;                // crece con depth: cada nivel pide más que el anterior
  trigger?: PerceptId;              // el percept que encendió todo
  calm: number;                     // estado mental en ese momento
}
```

- **Condiciones.** `pending` por encima del umbral, **un disparador** (un percept con alta resonancia con el aspecto: una hoja que cae sobre el agua, el filo de un rival, el último aliento de alguien) y **calma suficiente** para que la mente no lo descarte. Sin disparador, el estado se queda cargado, a veces años; un buen maestro sabe poner a un discípulo cargado frente al disparador justo.
- **Determinista y legible.** La sim evalúa el check cuando entra un percept resonante; el azar decide solo cerca del umbral. Nunca hay iluminación sin `pending` acumulado (sin huérfanos).
- **Qué pasa.**
  - `pending` se convierte en `depth` de golpe, con una ganancia mayor que la integración lenta (por eso vale esperar el momento).
  - El agente queda en **trance de iluminación** (minutos a días). Interrumpirlo es grave: pierde parte de lo ganado o se daña (como interrumpir una reclusión, cultivation §5). Proteger a alguien en trance es una obligación de maestros y amigos; atacarlo, una oportunidad para enemigos.
  - Puede destrabar una ruptura de comprensión, sugerir una técnica nueva (§10) o mover un cuello de botella.
  - **Fenómenos:** en profundidades altas, el qi del entorno se mueve hacia el iluminado (sacado de las celdas vecinas: conservación). Es visible para quien tenga sentido de Esencia y hace correr rumores.
  - **Es un evento formativo** (npc-psychology §2): puede mover esquemas y valores. Muchos cambian de vida después de una iluminación.
- **Iluminación falsa.** Si la fidelidad de lo acumulado es baja, el cruce produce una comprensión torcida con la misma sensación de certeza. Desde adentro no se distingue; se nota después, por las consecuencias (o lo nota alguien con más profundidad en el mismo aspecto).
- **Para comprender las leyes del Cielo** (karma, destino, el ciclo): los aspectos más altos rozan la ley superior. Comprenderlos sube la `transgression` del cultivador ante el Cielo (heaven-karma), así que la iluminación profunda también atrae tribulaciones.

## 9. Arte con intención
Una obra hecha por alguien con comprensión puede **llevar** esa comprensión: una pintura de montañas que enseña la quietud, una caligrafía con intención de espada, un surco de espada en la roca de una batalla antigua, una pieza musical, una formación.

```ts
interface IntentImprint {
  carrier: ItemId | SiteId;         // la obra, o el lugar (restos de batalla)
  aspect: LawAspectId;
  depth: number;                    // tope: la profundidad del autor en ese momento
  fidelity: number;                 // la del autor
  charge: number;                   // esencia infundida; se va perdiendo
  author: EntityId;
  originEventId: EventId;           // cuándo y cómo se hizo (obra deliberada o combate)
}
```

- **Crear.** Hacer una obra con intención es una acción del autor que **infunde esencia propia** en el soporte (conservación: el `charge` sale de él). La profundidad de la impronta es la que el autor tenía; la calidad depende de su oficio (pintor, calígrafo, herrero) y del soporte.
- **Huellas no deliberadas.** Una pelea entre grandes cultivadores deja improntas en el lugar: tajos en la roca, un lago congelado que no se descongela. Salen del evento, con su causa. Son lugares de peregrinación y de disputa.
- **Contemplar.** Es una acción larga que deposita `pending` en el aspecto de la obra (§7), con la resonancia del que mira. **No se puede pasar la profundidad del autor** contemplando su obra: lo que da es el camino hasta donde él llegó. Después hace falta otra fuente.
- **Requisitos y peligro.** Quien no tiene base mínima no ve nada (una pintura bonita). Una impronta mucho más profunda que el que mira puede **dañarlo**: la intención de espada de un maestro hiere el alma de un novato (body-health, alma). Las obras con comprensión torcida (fidelidad baja) contagian su desvío.
- **Desgaste.** El `charge` se pierde de a poco (vuelve al ambiente), más rápido en soportes pobres; cada contemplación también gasta un poco. Una obra contemplada por toda una secta durante siglos se apaga. Por eso las sectas restringen el acceso, y por eso una obra "virgen" encontrada en una ruina vale tanto.
- **Copias y falsificaciones.** Copiar la forma no copia la impronta: una copia solo la tiene si el copista tiene comprensión propia (y entonces lleva la **suya**). Un falsificador vende copias sin intención que se ven idénticas: solo se detectan con sentido espiritual o contemplándolas (perception). Las obras con intención son un mercado ([economy.md](economy.md)).
- **Fuentes naturales.** Una cascada, una tormenta, el cielo estrellado también sirven para contemplar: no tienen techo de autor, pero rinden mucho menos y habitúan rápido. Las obras son atajos; la naturaleza es el camino largo.

## 10. Inventar: técnicas, recetas y procesos
Crear algo nuevo es **buscar en un espacio de diseño** guiado por lo que el agente cree y comprende. Lo creado es una entidad nueva con autor y `originEventId`, y sus propiedades reales las calcula la ley.

### Técnicas
- **Espacio de diseño.** Una técnica se compone de piezas de un catálogo (en `content/`, por familia): rutas de circulación por los meridianos, mezcla elemental, patrón de compresión, respiración, movimientos, fuente de esencia, costo. La `Technique` de cultivation §8 es el resultado.
- **El autor elige con sus creencias.** Arma la técnica según sus hipótesis sobre la ley (qué umbral viene, qué pide, cómo interactúan los elementos) y su profundidad en los aspectos relevantes. Cuanto más fiel su conocimiento, más cerca queda de lo que imagina.
- **La ley evalúa.** `efficiency`, `coverage`, `effects` y `flaws` se calculan aplicando la ley real al diseño. Los `flaws` no se tiran al azar: son **los puntos donde las creencias del autor divergen de la verdad** (una ruta que él cree segura y no lo es, un umbral que no sabía que había, un elemento que choca). La técnica hereda los errores de quien la hizo.
- **Probar es experimentar.** El autor la practica (en sí mismo o en discípulos) y recibe observaciones; corrige o no. Una técnica "terminada" es una apuesta sobre cuánto se probó.
- **Variantes.** Con dominio alto (cultivation §8), el practicante puede variar una técnica conocida: es la misma búsqueda, partiendo de la técnica original como diseño. Una buena variante es una técnica nueva con `ancestor`.
- **Iluminación como fuente.** Una iluminación (§8) puede proponer un diseño directamente: el aspecto recién comprendido sugiere piezas que el agente no habría elegido. Así nacen las técnicas que fundan sectas.

### Recetas y procesos
- Alquimia, forja, medicina, cocina, agricultura: una receta es un **proceso** (ingredientes, proporciones, fuego, tiempo, orden) cuyo resultado calcula la ley ([crafts.md](crafts.md) §9; [elements.md](elements.md)).
- Se descubren por experimentación (§4) o por accidente (algo salió distinto y alguien lo notó). Las propiedades no buscadas (toxinas residuales, efectos secundarios) existen aunque el creador no las sepa.
- **Tecnología mortal** ([technology.md](technology.md)) usa este mismo mecanismo con el catálogo de procesos mortales: el arado de hierro, el papel, la imprenta.

### Descubrimiento múltiple
Como el descubrimiento sale del estado (necesidad, materiales, conceptos, observaciones), dos agentes en condiciones parecidas llegan a lo mismo por separado. Las disputas de prioridad ("lo inventé yo") son conflictos reales, y la atribución viaja deformada como cualquier rumor.

## 11. Transmitir, guardar y perder
- **Saber que** viaja como creencia (information): contado, escrito, enseñado. Con la credibilidad de la fuente, así que un descubrimiento verdadero contado por alguien sin prestigio no convence. La **demostración** (hacer el experimento delante de otro) es la mejor prueba: convierte testimonio en observación.
- **Saber cómo** se enseña (cultivation §8, aprender técnicas) o se escribe en recetas y manuales, que se copian con errores.
- **Comprender** no se transmite. Se puede **señalar**: un maestro elige experiencias para el discípulo (pelear con cierto rival, ir a cierto lugar, contemplar cierta obra), le da un koan, le pone el disparador delante (§8). Un maestro que entiende el aspecto acelera mucho `pending` y la fidelidad del discípulo. Por eso un maestro sabio vale más que un manual.
- **Secretos.** Un descubrimiento valioso suele guardarse (information §7): la receta de la familia, la técnica núcleo de la secta. Vale mientras pocos la saben, y su filtración es un evento.
- **Pérdida y redescubrimiento.** El conocimiento sin soporte muere con quien lo tiene (living-world §7). Una cultura puede **olvidar** algo que sabía (la cura de una plaga que no volvió en tres siglos) y redescubrirlo, o encontrarlo en una ruina (deep-history). Las leyes no cambian; lo que se pierde es saberlas.

## 12. Descubrirse a uno mismo
- Los **talentos ocultos** (VISION, principio 9) se descubren con la misma mecánica: la `LawKey` es sobre el propio cuerpo ("¿absorbo fuego mejor que agua?", "¿por qué el veneno no me hace nada?"). La evidencia viene de la percepción interna (perception §10) y de compararse con otros.
- Las **mediciones** de las sectas (piedras de prueba, cultivation §3) son instrumentos: dan observaciones con su precisión y sus errores. Un talento raro mal medido se puede redescubrir uno mismo, contra la opinión del instrumento y de la secta.
- El panel del personaje muestra estas creencias con su incertidumbre, nunca el `Aptitude` real.

## 13. Conocimiento en la sociedad
- **Conocimiento colectivo.** Cada cultura y organización tiene su base de creencias `law` con la fracción que las sostiene (information §9): qué hierbas curan, qué reinos existen, qué días son nefastos. De ahí se muestrean las creencias de los NPCs materializados.
- **Cultura epistémica.** Cada cultura y organización tiene un rasgo que evoluciona con su historia:
  ```ts
  interface EpistemicCulture {
    authorityWeight: number;        // cuánto pesa lo que dice el maestro o el texto contra la evidencia propia
    recordKeeping: number;          // cuánto se escriben las observaciones (registros, archivos)
    experimentNorms: number;        // si probar está bien visto, y con qué controles
    tabooedInquiry: LawKey[];       // lo que no se pregunta (lo prohibido, lo sagrado)
    debate: number;                 // si las disputas doctrinales se resuelven discutiendo o castigando
    originEventId: EventId;
  }
  ```
  Una secta con archivos y debate acumula conocimiento rápido y se equivoca menos; una con autoridad fuerte y herejía castigada es estable y se estanca. La cultura epistémica cambia con eventos (un fundador escéptico, un desastre que la doctrina no previó, un emperador que manda compilar).
- **Oficios del saber.** Eruditos, herbolarios, alquimistas, archiveros, monjes y maestros de secta viven del conocimiento: lo producen, lo guardan, lo venden y lo defienden. Las academias y bibliotecas son organizaciones ([organizations.md](organizations.md) §13).
- **Mecenazgo.** Quien tiene recursos paga experimentos (un rey que quiere la píldora de la longevidad, una secta que quiere romper su techo). Lo que se busca depende de lo que el mecenas quiere, y eso dirige qué se descubre en cada época.

## 14. El jugador y el narrador
- **El diario de hipótesis.** El jugador ve las creencias `law` de su personaje como hipótesis con peso, la evidencia que las sostiene (observaciones propias, lo que le contaron, lo que leyó) y las anomalías. Nunca ve la verdad.
- **El jugador piensa por su personaje.** Puede proponer hipótesis ("creo que la hierba solo funciona si se cosecha de noche"): el parser las traduce a una `Hypothesis` del catálogo con `origin: player` y se suman al espacio del personaje. La **confianza** solo la mueve la evidencia. Razonar bien sobre la física del mundo es habilidad legítima del jugador (VISION, principio 10), y como la ley cambia por seed, el conocimiento del género da priors, no respuestas.
- **Experimentos en texto libre.** "Pruebo la raíz en una rata, una cruda y otra hervida, tres veces cada una" se traduce a un `Experiment`. La sim lo resuelve; el narrador cuenta lo que el personaje **percibió** (la rata se durmió, la otra no), nunca la conclusión ni si la hipótesis es cierta.
- **Iluminación narrada desde adentro.** El narrador recibe el aspecto, el disparador y las memorias que alimentaron el `pending`, y arma la escena con eso. La sensación de certeza es la misma si la comprensión es fiel o torcida.
- **Contemplar** una obra se narra con lo que el personaje alcanza a ver según su base: para uno es un paisaje, para otro es un filo que corta.
- **Inspector god-mode:** la ley real de cada `LawKey`, las hipótesis de cada agente, el ledger de evidencia, el mecanismo de cada error (§5), los registros de anomalías de las escuelas y el estado de `pending` de cada insight.

## 15. Escala (LOD)
- **Tier 4:** hipótesis con distribución, ledger completo de observaciones, experimentos diseñados, insights con habituación, checks de iluminación por percept.
- **Tier 3:** hipótesis top-3 por `LawKey`, ledger resumido (conteos por condición percibida), insights sin habituación detallada; iluminación evaluada por semana.
- **Tier 2:** creencias `law` escalares (valor + confianza, information: decisiones), conteo de anomalías, insights como profundidad por aspecto; iluminación como tirada anual sobre el estado.
- **Tier 0-1 y simulación histórica:** el descubrimiento es un **proceso de riesgo por población**:
  ```
  tasa(lawKey, cultura) = practicantes expuestos × observabilidad(ley) × cultura epistémica × recursos × conceptos disponibles × presión (necesidad)
  ```
  Cuando dispara, se materializa un descubridor (un agente coherente con la población) y un evento con causas; la creencia se difunde por la cultura con los frentes de information §4. Los dogmas son fracciones de creencias por escuela con su registro de anomalías agregado; los cismas salen de cuando las anomalías superan la autoridad en una fracción suficiente. Técnicas y recetas nacen y se pierden con el mismo modelo, dejando entradas para deep-history.
- **Materialización:** un herbolario o un discípulo generado recibe las creencias de su cultura y escuela, una ventana de evidencia sintetizada compatible con su biografía, e insights coherentes con su camino y su edad.
- **Leyes que nadie mira** no cuestan nada: la evaluación de la verdad es perezosa (se calcula cuando un evento o un experimento la toca).

## Implementación
- **Fase 2 (psicología y memoria):** creencias `law` con hipótesis y pesos como caso del catálogo de information; observaciones desde percepts; actualización con sesgo de confirmación; el diario de hipótesis del jugador.
- **Fase 3 (offscreen y economía):** saber popular de hierbas y medicina de la aldea como prior cultural; el herbolario que experimenta; supersticiones con mecanismo; recetas simples; ventana de atribución y efectos lentos (toxinas).
- **Fase 4 (cultivo):** hipótesis sobre umbrales y requisitos; dogmas de la escuela con mapeos equivocados; insights con `pending`, integración, fidelidad e iluminación; contemplación de obras e improntas; variantes de técnicas.
- **Fase 4b:** diseño de técnicas nuevas evaluadas por la ley, con defectos que salen de las creencias del autor.
- **Fase 6 (organizaciones):** registro de anomalías por organización, herejía, cismas y escuelas nuevas; cultura epistémica; archivos; mecenazgo.
- **Fase 7 (historia):** descubrimiento como proceso de riesgo por población, pérdida y redescubrimiento, conceptos que se inventan, evolución de la cultura epistémica.

## Tests
- Determinismo: mismo seed y mismas acciones dan las mismas hipótesis, observaciones, iluminaciones e invenciones.
- **Ningún agente lee la ley:** la actualización de hipótesis usa solo la situación y el resultado percibidos.
- Toda observación apunta a un evento real; toda hipótesis tiene origen (tradición, testimonio, generación con su regla, jugador).
- Las hipótesis generadas solo usan conceptos que el agente tiene y reglas de generación del catálogo.
- Convergencia: con observaciones independientes, sin confusores y con la hipótesis verdadera en el espacio, el peso de la verdadera crece en promedio (test estadístico sobre muchos seeds).
- Confusor: en un escenario controlado con recuperación espontánea, una cultura sin controles termina creyendo en una cura falsa; con controles, no.
- Ninguna iluminación sin `pending` acumulado; ningún insight sin `originEventId`.
- Conservación: el `charge` de una impronta sale de la esencia del autor y vuelve al ambiente al gastarse; los fenómenos de iluminación mueven qi, no lo crean.
- Contemplar una obra nunca lleva la profundidad del que mira por encima de la impronta.
- Técnicas inventadas: sus propiedades salen de evaluar el diseño con la ley; sus `flaws` coinciden con divergencias entre creencias del autor y la verdad.
- Agregado: la tasa de descubrimientos de una cultura en tier 0 coincide en promedio con la de simular a sus practicantes.

## Decisiones tomadas en este borrador (revisables)
- Tres formas de saber con mecánicas distintas: proposiciones (hipótesis con evidencia), saber cómo (técnicas y recetas) y comprensión (insights con `pending` e iluminación).
- Las hipótesis son un espacio finito por agente: la verdad puede no estar en él, y pensar lo impensado es un evento raro con causa.
- Los errores de conocimiento tienen un catálogo de mecanismos y son trazables, como los errores de percepción.
- Los dogmas cambian por acumulación de anomalías contra autoridad e incentivos; el cambio pasa por personas concretas (herejes) y puede terminar en cisma.
- La iluminación es un umbral de `pending` con disparador y calma; puede ser falsa (fidelidad baja) y se siente igual.
- Las obras con intención llevan una impronta con esencia del autor, con techo en su profundidad, que se gasta; las copias no la llevan.
- Los defectos de una técnica inventada son los errores de su autor evaluados por la ley.

## Decisiones (2026-10-05)
- **Hipótesis del jugador:** el jugador puede proponer hipótesis aunque su personaje no las hubiera generado (`origin: player`, §14); la confianza la mueve solo la evidencia. Se descartó limitar las hipótesis al intelecto del personaje porque castiga pensar, y razonar sobre la física del mundo es habilidad legítima del jugador.

## Preguntas abiertas
- Calibración: velocidad de integración de `pending`, umbrales de iluminación por profundidad, habituación por tipo de experiencia.
- Calibración: tasas de descubrimiento por cultura en la sim histórica (que el progreso no sea ni estático ni explosivo) y cuánto tardan en caer los dogmas.
- Calibración: ruido de observación y ventana de atribución, para que las supersticiones sean comunes pero no universales.
