# Psicología de NPCs

> Estado: §1-§9c y la escala son el **borrador base**; §10-§17 son una **ampliación en borrador** (2026-10-05): la mente cambia por etapas de vida con períodos sensibles, la salud mental son estados con causa (duelo, depresión, trauma, ansiedad, adicción) que cada cultura nombra a su manera, el declive cognitivo lee el cuerpo y pesa en la legitimidad, sentido y pertenencia son necesidades lentas, las multitudes son agregados temporales con umbrales, el sueño consolida memorias y los sueños se arman con ellas, y los gustos personales salen de temperamento, cultura, cuerpo y exposición.

Depende de: [causality.md](causality.md) (procedencia, creencias vs verdad), [heaven-karma.md](heaven-karma.md) (karma y demonios internos), [body-health.md](body-health.md) (`cognition`, sueño, dolor, sustancias y adicción física, envejecimiento), [family-lineage.md](family-lineage.md) (genoma del temperamento, crianza, hogar), [perception.md](perception.md) (lo único que entra a la mente), [information.md](information.md) (creencias, rumores, reputación), [social-structure.md](social-structure.md) (cara, estatus, ritos de paso, revueltas), [organizations.md](organizations.md) (membresía y lealtad), [cultivation.md](cultivation.md) (el cultivo altera la psique, longevidad), [spirits.md](spirits.md) (memorias de otra vida, visitas en sueños), [metaphysics.md](metaphysics.md) (fe y teorías de la mente por mundo). Lo usan: casi todos los sistemas con agentes: [schemes.md](schemes.md) (intrigas sobre creencias y debilidades), [economy.md](economy.md) (demanda por necesidades y gustos), [organizations.md](organizations.md) (lealtad, líder que declina), [state.md](state.md) y [social-structure.md](social-structure.md) (descontento, multitudes, revueltas), [war.md](war.md) (moral, desbandadas, trauma de guerra), [law.md](law.md) (linchamientos, testigos que recuerdan mal), [discovery.md](discovery.md) (insights, arte con intención), [divination.md](divination.md) (sueños como presagio), [family-lineage.md](family-lineage.md) (deseo, crianza que forma lo adquirido), [chronicle.md](chronicle.md) (lo que el personaje recordaba y lo que no).

## Principios
1. **Nada de la mente es aleatorio en el momento.** Cada esquema, condición, gusto, sueño y umbral tiene `originEventId` y causas; el inspector puede mostrar por qué alguien es como es.
2. **La mente solo lee creencias.** Interpretación, sueños, multitudes y diagnósticos trabajan sobre lo percibido y lo creído, nunca sobre la verdad.
3. **El cuerpo pone límites.** `cognition`, fatiga, dolor y sustancias (body-health) recortan memoria, control y juicio; la psicología no los ignora ni los duplica.
4. **La cultura nombra, la ley decide.** Lo que le pasa a una mente es un estado real; cómo se lo llama (posesión, demonio, humores, debilidad) y cómo se lo trata es una creencia cultural que tiene consecuencias propias.
5. **Mismo modelo para todos.** NPCs y personaje del jugador usan las mismas estructuras; al jugador la simulación nunca le elige la acción, solo resuelve cómo sale y qué siente o recuerda su personaje.
6. **Determinista.** Formación, consolidación nocturna, sueños, cascadas de multitud y generación de gustos usan streams propios (`rng.fork("psyche", npcId, tick)`, `rng.fork("dream", npcId, night)`, `rng.fork("crowd", crowdId, tick)`), y la LOD materializa lo mismo para el mismo seed.

## Idea central

Un NPC es **temperamento innato + todo lo que le pasó**, interpretado a su manera. Nada de su mente es aleatorio en el momento: si alguien es desconfiado, hay eventos concretos (y un temperamento) que lo explican, y el inspector puede mostrarlos.

```
genética (padres + varianza de seed)
        │
        ▼
  TEMPERAMENTO ──────────┐
        │                │ filtra
        ▼                ▼
   evento real ──► INTERPRETACIÓN ──► emoción ahora
                         │            memoria episódica
                         │            cambio en relaciones
                         │            (si es formativo) cambio en esquemas y valores
                         ▼
              ESQUEMAS + VALORES + RELACIONES + MEMORIAS
                         │
                         ▼
               objetivos en capas → utilidad → acción → nuevos eventos
```

Las mismas reglas valen para el jugador, salvo que sus decisiones las toma el jugador.

## 1. Temperamento (innato)

Seis ejes continuos en [-1, 1]. Están fijos desde el nacimiento y solo cambian ante eventos extremos (ver demonios internos y desviación de qi).

| Eje | Bajo | Alto |
|---|---|---|
| `reactivity` | Imperturbable | Emocionalmente volátil |
| `sociability` | Solitario | Busca gente |
| `curiosity` | Prefiere lo conocido | Busca lo nuevo |
| `control` | Impulsivo | Disciplinado, planifica |
| `warmth` | Frío, dominante | Empático, cooperativo |
| `boldness` | Cauto, evita riesgos | Temerario |

Además tiene **aptitudes**: `intellect`, `perception`, `willpower` y `memory`. El talento de cultivo (raíces espirituales) va en [cultivation.md](cultivation.md) §3.

**Herencia.** Cada eje sale del promedio de los padres más varianza, usando `rng.fork("genetics")`, con heredabilidad de ~0.5. Los hijos de dos padres impulsivos tienden a serlo, pero no siempre. El evento de nacimiento es el `originEventId` del temperamento.

## 2. Lo adquirido: esquemas, valores, hábitos

### Esquemas (creencias nucleares sobre el mundo y uno mismo)
Son proposiciones con fuerza en [0, 1] y la lista de eventos que las formaron:

- `world_is_dangerous` — el mundo es peligroso
- `people_are_untrustworthy` — no se puede confiar en la gente
- `strength_is_worth` — valgo lo que valgo por mi fuerza
- `family_first` — la familia es lo primero
- `heaven_is_just` / `heaven_is_cruel` — el Cielo es justo / cruel
- `effort_pays` — el esfuerzo rinde
- `i_am_unworthy` — no valgo nada
- …(catálogo cerrado en `content/`, ampliable)

### Valores (qué le importa)
Son pesos normalizados sobre `power`, `safety`, `family`, `knowledge`, `freedom`, `justice`, `wealth`, `status`, `pleasure`, `tradition`, `immortality`. Se derivan de temperamento + cultura de origen + esquemas, y se ajustan con eventos formativos.

### Cómo se forma lo adquirido
Cada evento que el NPC vive y le resulta **intenso** puede mover esquemas y valores:

```
Δ = intensidad × plasticidad(edad) × susceptibilidad(temperamento) × dirección(interpretación)
```

- **Plasticidad**: alta en la infancia y baja en la adultez. Para un cultivador de 800 años es casi nula, salvo traumas enormes. Esto da que los viejos sean "duros" y que los traumas infantiles marquen de por vida.
- **Susceptibilidad**: por ejemplo, alta `reactivity` amplifica los eventos negativos.
- **Crianza**: los padres son la mayor fuente de eventos formativos tempranos (cuidado, abandono, violencia, enseñanza). La crianza no es un modificador abstracto: son **eventos de crianza** que la simulación genera según cómo son los padres y su situación (pobreza, guerra, deudas).

**Ejemplo.** Al padre de Li Wei lo hiere un discípulo de una secta, y la familia queda endeudada con los Zhao.
- El evento se interpreta con su temperamento (`boldness` alto, `warmth` medio).
- Sube `strength_is_worth` y el valor `power`.
- Nace un resentimiento hacia el discípulo y su secta, y una relación de deuda con los Zhao.
- Se crea un vínculo kármico (heridor → familia del herido).
- Queda una memoria intensa, semilla de un posible demonio interno.

Todo lo anterior apunta al mismo evento.

### Hábitos y habilidades
Son lo que hizo repetidamente (cazar, mentir, meditar). Salen de las acciones registradas, no se asignan.

## 3. Interpretación (appraisal)

Es el paso clave: **el mismo evento produce efectos distintos en NPCs distintos.**

`appraise(npc, perceivedEvent) → { emotions, valence, intensity, blame, schemaUpdates, relationshipDeltas }`

- Solo recibe lo que el NPC **percibió** o le contaron (ver [causality.md](causality.md)), nunca la verdad.
- A quién culpa depende de sus creencias. Con `people_are_untrustworthy` alto tiende a atribuir mala intención.
- Es determinista: temperamento + esquemas + relaciones + el evento percibido.

## 4. Emociones (corto plazo)

Las emociones son `fear`, `anger`, `sadness`, `joy`, `shame`, `guilt`, `envy` y `love`, cada una con intensidad. Decaen en horas o días según `reactivity`.

- Modulan las decisiones del momento: con ira se toman más riesgos y con miedo se huye.
- El **estrés** crónico es un acumulador lento. Si se sostiene, mueve esquemas como un evento formativo.
- **Contagio emocional:** las emociones **percibidas** en otros entran a la interpretación como un evento más. Su peso depende de `sociability`, de la relación con quien la muestra y de cuántos la muestran. Así se dan el pánico en una batalla, la euforia en un festival o la furia de una turba. Los grupos de tier 0 tienen un humor colectivo que se mueve con la misma regla, en agregado.

## 5. Memoria episódica

```ts
interface Memory {
  id: MemoryId;
  owner: AgentId;
  eventId: EventId;          // el evento real (la verdad), para el inspector
  perceived: PerceivedEvent; // lo que el NPC cree que pasó (puede diferir)
  source: "witnessed" | "told" | "inferred";
  toldBy?: AgentId;
  intensity: number;         // emocional, al formarse
  valence: number;           // -1..1
  salience: number;          // decae; si baja de un umbral → se comprime
  confidence: number;        // cuánto cree que fue así
  distortion: number;        // cuánto se alejó `perceived` del original
  lastRecalled: Time;
}
```

- **Degradación:** la `salience` cae con el tiempo. Recordar una memoria (pensarla, contarla, ver algo relacionado) la refuerza. Las memorias muy intensas casi no decaen (memorias "flash").
- **Distorsión:** cada vez que se recuerda o se cuenta, los detalles derivan hacia los esquemas de quien recuerda (el desconfiado recuerda más malicia). Usa `rng.fork("memory", npcId)`, así que es determinista, y se registra para que el inspector muestre "recuerda X, pero pasó Y".
- **Compresión:** una memoria olvidada no desaparece sin rastro. Queda como resumen (*gist*): "los Zhao nos humillaron". Sus efectos en relaciones y esquemas ya se aplicaron.
- **Memoria vs conocimiento:** la memoria es episódica ("vi a Wu robar"). Las **creencias** semánticas ("Wu es ladrón", "hay una veta en el Monte Hierro") viven en `sim/knowledge`. Una memoria puede generar creencias. Los rumores y la propagación van en [information.md](information.md).

## 6. Relaciones

Son asimétricas: lo que A siente por B no es lo que B siente por A.

```ts
interface Relationship {
  from: AgentId;   // NPC, jugador
  to: AgentId;     // NPC, jugador, organización, el Cielo
  trust: number; respect: number; affection: number; fear: number;
  attraction: number; gratitude: number; jealousy: number; resentment: number;
  familiarity: number; dependency: number;
  debts: CommitmentRef[];   // compromisos activos entre los dos (dinero, favores, vida, juramentos): contracts.md
  bonds: BondLabel[];        // derivados: parentesco + `status` de compromisos (spouse, master, disciple, sworn_sibling…)
  history: EventId[];        // eventos que la moldearon
}
```

- Cada cambio proviene de una interpretación de un evento. No hay deriva aleatoria.
- **Decaimiento hacia la línea base** por dimensión: `familiarity` decae rápido sin contacto. `resentment` decae lento, y más lento todavía en quien tiene esquemas de venganza.
- Los **vínculos** (`bonds`) son institucionales o declarados: nacen de eventos como un casamiento, tomar un discípulo o un juramento, que crean compromisos ([contracts.md](contracts.md)). Las dimensiones son continuas y pueden contradecir al vínculo: un padre al que se teme y no se quiere.
- Las relaciones con **organizaciones** y con el **Cielo** usan la misma estructura. Así funcionan el odio a una secta o la fe.
- La relación con el jugador **no es especial**.

## 7. Motivación y decisión

### Necesidades
`hunger`, `rest`, `safety`, `social` y `cultivation` (qi, recursos). Suben con el tiempo y bajan al satisfacerse. Son la capa "inmediata".

Dos necesidades **lentas** se miden en meses: `belonging` y `meaning` (sección 13). Las adicciones agregan necesidades `substance:<id>` (sección 11). El peso de cada necesidad cambia con la etapa de vida (sección 10).

### Objetivos en capas
| Capa | Ejemplo | De dónde sale |
|---|---|---|
| Núcleo | Volverse inmortal, proteger a la familia, venganza | Valores + esquemas + eventos formativos |
| Largo plazo | Entrar a la Secta del Río Sereno | Plan para un objetivo núcleo, según creencias |
| Mediano | Pagar la deuda con los Zhao | Situación + relaciones |
| Corto | Cazar esta semana | Medio para un objetivo de arriba |
| Inmediato | Comer, huir, dormir | Necesidades + emociones |

Todo objetivo tiene `originEventId`. Por ejemplo, "venganza contra X" nace cuando una memoria con `resentment` alto cruza un umbral que depende de `warmth`, `control` y del esquema `strength_is_worth`. Ningún NPC "decide ser villano" al azar.

### Utilidad
Para cada acción candidata, del **mismo catálogo que usa el jugador** ([actions.md](actions.md)):

```
U(a) = Σ_obj  peso(obj) × contribución(a, obj) × P_éxito_creída(a)
       − riesgo_creído(a) × aversión(boldness, miedo)
       + modificadores emocionales + coherencia con valores
```

- La `P_éxito` y el riesgo salen de **creencias**, no de la verdad. Así el NPC se equivoca de forma creíble.
- Elige con `softmax` sobre U usando `rng.fork("decision", npcId)`: casi siempre la mejor opción, a veces la segunda. La temperatura depende de `control`.
- Planificación simple (encadenar acciones hacia un objetivo) en Fase 3. HTN o GOAP más adelante si hace falta.

### Planes contra otros (intrigas)
Cuando el objetivo de un NPC choca con otra persona (un rival por el mismo afecto, alguien que tiene el favor que él quiere, un estorbo, una víctima con algo valioso), puede armar un **plan multi-paso** que usa a otros NPCs, información falsa y trampas. Eso está en [schemes.md](schemes.md).

### Coherencia con valores (disonancia)
Actuar contra un valor propio, por ejemplo robar valorando `justice`, genera `guilt`, y si se repite mueve esquemas o alimenta un demonio interno. Esto permite caídas morales graduales: alguien que roba por hambre una y otra vez termina creyendo que "el mundo es así".

## 8. Diálogo

> Diseño completo de la conversación (actos de habla, persuasión, verbalización): [dialogue.md](dialogue.md).

La **simulación** decide el acto de habla: amenazar, mentir, halagar, negarse, contar un secreto, pedir ayuda. Lo elige por utilidad, como cualquier acción. Una mentira es una decisión del sim con un contenido concreto (qué creencia falsa intenta instalar).

El **LLM** solo lo verbaliza. Recibe:
- el acto de habla y su contenido;
- un resumen de la personalidad (temperamento, 2–3 esquemas fuertes);
- las memorias relevantes del NPC sobre el interlocutor;
- la relación con quien le habla;
- el estado emocional actual.

El LLM nunca decide qué sabe o qué quiere el NPC.

## 9. Demonios internos (心魔) y corazón del Dao

```ts
interface InnerDemon {
  owner: AgentId;
  theme: "hatred" | "guilt" | "fear" | "obsession" | "regret" | "desire" | "despair";
  strength: number;
  roots: Array<MemoryId | KarmicBondId | SchemaKey>;  // de qué se alimenta
}
```

- **Se forman** cuando una herida queda sin resolver: memorias intensas negativas, vínculos kármicos no saldados ([heaven-karma.md](heaven-karma.md)) o disonancia repetida con los propios valores. Se calculan del estado psicológico; no aparecen al azar.
- **Se alimentan** cuando algo dispara las raíces: ver al asesino, volver al lugar, repetir la culpa.
- **Se resuelven** con cierre real: vengarse, ser perdonado, reparar, o aceptar mediante meditación prolongada (una acción de cultivo con costo de tiempo). Resolver la raíz puede saldar el vínculo kármico, y viceversa.
- **Efectos:**
  - En rupturas y tribulaciones: la prueba del demonio interno tiene dificultad `f(strength)`. Fallar provoca desviación de qi, locura (cambios bruscos de esquemas, incluso del temperamento) o la muerte.
  - En el día a día, cuando se activan: emociones intrusivas y decisiones que contradicen la utilidad "racional".
- **Los demonios hablan.** En meditación profunda, rupturas y tribulaciones, el narrador los manifiesta como voces o visiones. Se arman **solo** con sus raíces reales: las memorias (distorsionadas como las recuerda el dueño), las personas involucradas y la culpa o el odio concretos. El demonio sabe lo mismo que su dueño, nunca la verdad del mundo. Puede mentir, retorcer recuerdos y tentar: lo que dice lo decide la sim (qué raíz ataca, qué ofrece) y el LLM lo verbaliza.
- **Corazón del Dao (道心):** estabilidad = convicción (claridad de los objetivos núcleo) × coherencia (actuar según los propios valores). Resiste a los demonios. Un cultivador cruel pero coherente puede tener un Dao firme; uno bondadoso que se traiciona, no.

## 9b. El cultivo altera la psique

Las técnicas y los caminos de cultivo pueden modificar la psicología, siempre con procedencia (el evento en que se aprendió o practicó la técnica):

- **Supresión emocional** (estilo 无情道, Dao sin emociones): baja la intensidad de las emociones y el peso de `warmth`. Protege contra ciertos demonios (apego, miedo) pero debilita relaciones y abre otros (vacío, desesperanza).
- **Amplificación:** técnicas demoníacas o de sangre que aumentan `anger` o el deseo y dan poder a cambio.
- **Efectos acumulativos:** practicar una técnica durante años mueve esquemas y valores como un evento formativo crónico.
- **Desviación de qi:** puede provocar cambios bruscos de temperamento.

Se modela como modificadores activos `{ source: TechniqueId, originEventId, effects }` sobre temperamento, emociones y valores. El detalle va en [cultivation.md](cultivation.md) (§8, `psyche` de cada técnica).

## 9c. Capas de profundidad

Mecánicas que se apoyan en las piezas anteriores y hacen que los NPCs se sientan humanos (o inhumanos) de formas reconocibles.

### Cómo se mienten a sí mismos
- **Autoengaño dirigido.** La distorsión de la memoria (sección 5) no es ruido aleatorio: está sesgada hacia proteger la **autoimagen**. Quien hizo daño recuerda que el otro empezó, y quien huyó recuerda que fue prudente. Nadie es el villano de su propia historia. El sesgo es mayor con `control` bajo y disonancia alta.
- **Identidad (autoimagen).** Cada NPC tiene un pequeño conjunto de creencias sobre sí mismo ("soy el genio del clan", "soy justo", "soy un superviviente"), formadas como los esquemas. Un evento que la contradice (ser superado, quedar expuesto) es una **amenaza a la identidad**: emoción intensa y respuesta defensiva (negar, atacar, tramar) o, si es muy fuerte, un quiebre que reescribe la identidad.
- **Máscaras.** Algunos actúan distinto en público y en privado. La máscara cuesta esfuerzo (`control`) y se agrieta con estrés, alcohol, emociones intensas o cuando el NPC cree que nadie lo ve. El jugador puede percibir las grietas. Es el anciano recto de la secta que en privado es otra cosa.

### Cultura del género
- **La cara (面子).** Necesidad central y **colectiva**: la cara de un discípulo es la de su maestro, su familia y su secta. Una humillación pública pesa más que una herida física y obliga a responder para recuperarla. El tamaño de la ofensa depende de los testigos y de su estatus. De acá sale el "¿te atrevés a ofender a mi joven maestro?" sin escribirlo.
- **Rencor entre generaciones.** El odio se hereda como **memoria contada** (`source: "told"`), distorsionada en cada transmisión. "Mataste a mi padre" puede llegar a los nietos como una historia bastante distinta de lo que pasó.

### La longevidad: distancia, no maldad
Vivir siglos **no vuelve malo a nadie**. Cambia otras cosas:

- **Compresión emocional sin cambio de signo.** Con los años, la intensidad de las emociones baja, pero los valores y el temperamento conservan su dirección. Un inmortal bondadoso sigue siendo bondadoso y uno cruel sigue siendo cruel, nunca más cruel por la edad.
- **El círculo moral se achica por escala.** El peso que un NPC le da a otro en su utilidad se multiplica por un factor de **distancia**: diferencia de reino de cultivo, diferencia de esperanza de vida y falta de vínculo. Para un ancestro de mil años, un mortal vive y muere en un parpadeo, como una hormiga. Lo que produce es **indiferencia**, no crueldad: no hay motivo para dañarlo, pero tampoco para desviarse por él.
  - El **bondadoso** distante: ayuda a veces, por capricho o costumbre, como quien corre un insecto del camino. Protege a sus descendientes y protegidos.
  - El **cruel** distante: no masacra a nadie (no tiene utilidad y el karma pesa en las tribulaciones), pero si un mortal lo molesta, lo aparta sin pensar, aunque eso lo mate.
- **Anclas.** Los vínculos formados antes (compañero del Dao, hijos, maestro, viejos amigos) **no** se atenúan por distancia. Son lo que mantiene humano a un inmortal. Perderlos todos alimenta el demonio del vacío (`despair`).
- **El Dao como pasión dominante.** Cuando todo lo demás se aplana, queda el avanzar: curiosidad por el Dao, meditaciones de décadas, reclusión. Los inmortales se retiran del mundo más de lo que lo dominan.
- **Desesperación al final de la vida.** El peligro real de un viejo monstruo no es el aburrimiento sino la **muerte cercana sin haber avanzado**. Con poca vida restante, la utilidad de las acciones extremas para ganar longevidad (robar un tesoro, poseer un cuerpo joven, sacrificar discípulos) se dispara, sobre todo con valores débiles. Es el arco clásico, y emerge de la utilidad, no de la maldad.
- **Memoria de siglos.** La memoria tiene capacidad: lo antiguo se comprime en gist y se pierde. Un ancestro puede no recordar el nombre de su bisnieto, pero sí, con todo detalle, la humillación de hace 800 años, porque la saliencia de lo intenso dura.

Freno global: el karma (ver [heaven-karma.md](heaven-karma.md)). Matar mortales en masa crea vínculos kármicos que endurecen la tribulación, así que hasta los inmortales indiferentes tienen motivos para no hacerlo.

### Cómo leen a los demás
- **Aprenden patrones.** Los NPCs infieren hábitos de las acciones repetidas que perciben ("siempre ayuda a los mendigos", "nunca pelea de noche"). Esas inferencias forman la **reputación** y se propagan como rumores. Cualquiera puede explotarlas, incluidos los intrigantes de [schemes.md](schemes.md).
- **Teoría de la mente en niveles.** "Creo que él cree que yo sé…". La profundidad del razonamiento recursivo está limitada por `intellect` (1 a 3 niveles). Habilita faroles, dobles engaños y contra-intrigas.
- **Imitación y legado.** Los NPCs adoptan hábitos y valores de quienes admiran (`respect` + `affection` altos), sobre todo de jóvenes. Un discípulo que te admira copia tu forma de ser. Tu personalidad se propaga, y la crónica la registra.

### Arcos que emergen solos
- **Pendiente de corrupción y redención.** La disonancia (sección 7) tiene dos salidas: sentir culpa o cambiar los valores para que el acto "estuviera bien". Cada vez que gana la segunda, el umbral para el siguiente mal baja. A la inversa, la culpa sostenida puede volverse un objetivo de expiación.
- **Secretos.** Cada NPC guarda hechos que lo dañarían si se supieran, con peso y miedo a la exposición. Son materia prima para chantajes e intrigas y se descubren con las mismas mecánicas (huellas, testigos, rumores).
- **Traumas y disparadores.** Una memoria muy intensa queda ligada a estímulos (un olor, el fuego, un nombre, un lugar). Al percibirlos se reactiva y provoca pánico, ira o evitación. El narrador lo puede mostrar como un recuerdo intrusivo.
- **Sesgos cognitivos.** Son parte de la interpretación y de la utilidad, no adornos:
  - Efecto halo: al fuerte, al hermoso o al de alto rango se le cree más.
  - Sesgo de grupo: los de mi secta o clan son buenos y los otros sospechosos.
  - Costo hundido: seguir con un método de cultivo fallido porque ya se invirtieron 50 años.
  - Confirmación: lo que encaja con un esquema se recuerda mejor.

## 10. Desarrollo por etapas

La mente no cambia al mismo ritmo toda la vida. Cada etapa tiene una **plasticidad** distinta (sección 2), **períodos sensibles** donde ciertos esquemas se fijan con mucha más fuerza, y necesidades con pesos propios.

```ts
type LifeStageId = "infancy" | "childhood" | "adolescence" | "youngAdult" | "adult" | "elder" | "ancient";

interface LifeStageDef {               // en content/, por especie y por cultura
  id: LifeStageId;
  bodyAge: [number, number];           // fracción de la curva de vida de la especie (body-health §10), no años fijos
  plasticity: number;                   // multiplica el Δ de la sección 2
  sensitive: SchemaId[];                // esquemas que se fijan con más fuerza en esta etapa
  needWeights: Partial<Record<NeedId, number>>;
  riskBias: number;                     // inclinación hacia acciones de riesgo en la utilidad
  peerWeight: number;                   // cuánto pesa la opinión de pares vs familia
}

interface DevelopmentState {
  stage: LifeStageId;
  stageEnteredAt: Tick;
  riteOfPassage?: EventId;              // el rito cultural que marcó el paso, si lo hubo
  attachment: "secure" | "anxious" | "avoidant" | "disorganized"; // derivado de esquemas de infancia, cacheado
  formativeEvents: EventId[];           // los eventos de alto impacto en períodos sensibles
}
```

| Etapa | Período sensible | Necesidades que pesan más | Qué cambia |
|---|---|---|---|
| Infancia | Apego: `others_are_trustworthy`, `i_am_worthy` | `safety`, cuidado | La crianza (family-lineage §7) fija el estilo de apego, que tiñe todas las relaciones después |
| Niñez | Lengua, normas de la cultura, oficio de la casa | `belonging` (familia) | Aprende qué es "normal"; los hábitos se forman rápido |
| Adolescencia | Identidad, pertenencia a pares | `belonging` (pares), `status` | Más riesgo, más peso de los pares, primeras lealtades fuera de la familia; las sectas reclutan acá |
| Adultez joven | Rol, pareja, oficio | `status`, `meaning` | Elige (o le eligen) camino; los objetivos núcleo se consolidan |
| Adultez | Poca: cambia por eventos grandes | `meaning`, legado | Esquemas estables; cambia por crisis, no por goteo |
| Vejez | Revisión de vida | `meaning`, legado, `belonging` | Más sabiduría o más rigidez según `curiosity` y `control`; arreglar cuentas, legar |
| Antigüedad (solo longevos) | Ninguno nuevo | `meaning` | La distancia de la sección 9c: valores iguales, menos peso de cada vida mortal |

- **La etapa la marca el cuerpo y la experiencia, no el calendario.** Un cultivador con cuerpo de veinte años y trescientos vividos está en la etapa "antigua" para la mente: la plasticidad depende de la **edad vivida** y de la curva de su especie, no de cómo se ve.
- **Ritos de paso** (social-structure): la cultura marca transiciones con eventos (mayoría de edad, iniciación, boda, entrada a la secta). Son eventos con causa que mueven el peso de pares a roles adultos; quien no los tuvo puede quedar "sin lugar" (déficit de `belonging`).
- **Infancias que marcan.** Hambre, abandono, violencia o una pérdida temprana en un período sensible pesan varias veces más que lo mismo de adulto. Así se explican tiranos con infancias duras y discípulos que buscan un padre en el maestro, sin escribirlo a mano.
- **El apego** no es una variable más: es un resumen cacheado de los esquemas de infancia que el inspector muestra, y que entra como sesgo en cómo se interpretan los actos de los cercanos (sección 3) y en la formación de relaciones (sección 6).

## 11. Salud mental

Los estados mentales persistentes son **condiciones con causa**, igual que las enfermedades del cuerpo. No hay "locura al azar": hay pérdidas, estrés, trauma, sustancias, cuerpo y esquemas que las producen, y cosas que las alivian.

```ts
type MentalConditionKind = "grief" | "depression" | "trauma" | "anxiety" | "addiction" | "mania" | "psychosis" | "dissociation";

interface MentalCondition {
  id: ConditionId;
  kind: MentalConditionKind;
  severity: number;                     // 0..1
  originEventIds: EventId[];            // pérdidas, el evento traumático, la primera dosis, la fiebre
  onset: Tick;
  course: "acute" | "chronic" | "remitting" | "resolving";
  triggers: StimulusPattern[];          // trauma y adicción: olor, lugar, nombre, hora, la vista de la sustancia
  protective: EventId[];                // relaciones, rutinas, sentido, tratamiento: lo que la sostiene a raya
  effects: ConditionEffect[];           // sobre necesidades, utilidad, percepción, sueño, cultivo
}

interface ConditionBelief {             // cómo lo ve alguien (incluido el que lo sufre)
  holder: AgentId;
  about: AgentId;
  label: CulturalLabelId;               // "lo poseyó un espíritu", "humores fríos", "debilidad", "corazón herido"
  confidence: number;
  sourceEventId: EventId;
}
```

- **Duelo.** Perder a alguien con relación fuerte (sección 6) abre un duelo con intensidad proporcional a la relación y al modo (muerte violenta, sin cuerpo, por culpa propia). Lo normal es que se resuelva con el tiempo, el ritual de la cultura y los vínculos. Se **complica** si no hubo ritual, si hay culpa, si la pérdida es repetida o si falta apoyo, y entonces deriva en depresión o en obsesión (demonio de `regret` o `hatred`).
- **Depresión.** Sale de estrés crónico (sección 4), pérdidas acumuladas, esquemas de indefensión (`effort_is_useless`, `i_am_worthless`), dolor crónico y enfermedad (body-health), aislamiento y falta de sentido (sección 13). Efectos: baja la recompensa esperada de casi todas las acciones (la utilidad se aplana), sube la de quedarse quieto, empeora el sueño, baja la eficiencia del cultivo y alimenta el demonio de `despair`. Se sale por relaciones, sentido, rutina, tiempo y los tratamientos que el mundo tenga.
- **Trauma.** Extiende los disparadores de la sección 9c. La probabilidad y severidad salen de **intensidad × indefensión × falta de apoyo después**, moduladas por temperamento (`reactivity`) y apego. Síntomas como efectos concretos: recuerdos intrusivos (la memoria se reactiva con su emoción), evitación (la utilidad castiga acercarse al estímulo), hipervigilancia (la atención de perception se sesga hacia amenazas: ve más peligros, también falsos) y entumecimiento (baja la intensidad de emociones positivas). Las guerras, masacres y desastres dejan **trauma colectivo**: muchas condiciones con la misma causa, que la LOD agrega como prevalencia.
- **Ansiedad.** Miedo crónico sin objeto presente: esquema `the_world_is_dangerous` + `reactivity` alta + amenazas reales sostenidas (una aldea en la frontera, una deuda con usureros). Sube la cautela y baja el `boldness` efectivo; en exceso paraliza.
- **Adicción (lado mental).** body-health §9 pone la tolerancia, la dependencia y la abstinencia. La psicología agrega:
  - El **ansia** como necesidad nueva (`substance:<id>`) que compite en la utilidad y crece con la abstinencia.
  - **Señales:** lugares, personas, horas y emociones ligadas al consumo disparan el ansia aunque no haya abstinencia física (recaídas años después).
  - **Autoengaño** (sección 9c): "lo controlo", "es medicina".
  - **Costos sociales:** mentir, robar, vender lealtades. Quien controla el suministro tiene una palanca (schemes).
  - **Adicciones de conducta** con la misma forma: el juego de azar (economy), el combate, el riesgo de rupturas forzadas, las píldoras de cultivo por la sensación de avance.
- **Manía, psicosis, disociación.** Raras, siempre con causa: genoma (predisposición, family-lineage), fiebre y daño cerebral (body-health), sustancias, privación de sueño extrema, desviación de qi (走火入魔), daño del alma (spirits) o técnicas que separan la mente. Producen creencias falsas con alta confianza (perception §5: errores con forma), que el NPC actúa como verdaderas.
- **La cultura nombra.** Cada cultura tiene una teoría de la mente (`content/`): posesión, desequilibrio de humores o de qi, castigo del Cielo, debilidad moral, corazón herido. La **etiqueta** decide el tratamiento (exorcismo, hierbas, encierro, meditación, ninguno), el estigma (information: reputación) y lo que hace la familia (esconderlo, casarlo, mandarlo a un templo). A veces el tratamiento cultural ayuda por razones reales (rutina, comunidad, descanso) y a veces daña.
- **Con el cultivo.** Las condiciones son raíces para los demonios internos (sección 9): el trauma alimenta `fear` y `hatred`, la depresión `despair`, la adicción `desire`. Cultivar con una condición activa sube el riesgo de desviación (body-health §12). A la inversa, un corazón del Dao firme da resiliencia, y algunas técnicas suprimen emociones a cambio de entumecimiento (sección 9b).
- **Resiliencia** no es un número aparte: sale de temperamento, apego seguro, relaciones fuertes, sentido y experiencias previas superadas (una crisis superada deja el esquema `i_can_endure`).

## 12. Declive cognitivo

La psicología lee `cognition` de body-health (vejez, golpes en la cabeza, fiebre, sustancias, deuda de sueño, daño del alma) y lo traduce en efectos sobre la mente. No hay un número de "inteligencia que baja": hay procesos concretos que fallan.

```ts
interface CognitiveProfile {           // derivado cada tick de body-health + aptitudes (§1)
  encoding: number;                     // qué tan bien se guardan memorias nuevas
  retrieval: number;                    // qué tan bien se recuperan (y cuánta distorsión entra)
  control: number;                      // tope sobre el `control` del temperamento
  tomDepth: number;                     // niveles de teoría de la mente disponibles (§9c)
  flexibility: number;                  // cuánto pesa el hábito frente a la deliberación
  fluctuation: number;                  // días buenos y malos
  causes: EventId[];                    // la caída, la fiebre, el veneno lento, la vejez
}
```

- **Memoria:** con `encoding` bajo, las memorias nuevas entran con saliencia baja y se pierden rápido; lo viejo queda (el anciano recuerda su juventud y no lo de ayer). Con `retrieval` bajo sube la distorsión y aparece la **confabulación**: el hueco se llena con lo que el esquema espera.
- **Control y desinhibición:** el `control` efectivo tiene un tope; sale lo que antes se frenaba (insultos, deseos, secretos dichos en voz alta, con consecuencias reales).
- **Teoría de la mente:** pierde niveles; el que tramaba en tres niveles ya no lee las intrigas a su alrededor, que es justo cuando los demás empiezan a tramar.
- **Rigidez:** los hábitos dominan la utilidad; repite decisiones viejas aunque el mundo cambió.
- **Sospecha:** lo que no encuentra "se lo robaron". Acusa, y la acusación es un evento social real (law, information).
- **Los demás lo perciben** por señales (perception: repeticiones, olvidos, órdenes contradictorias). La creencia de que alguien declina baja su legitimidad (organizations, state) y activa a herederos, regentes e intrigantes. **Esconder el declive** es una intriga clásica: el círculo íntimo filtra quién lo ve (schemes), y descubrirlo es un secreto con valor.
- **Cultivadores:** el alma y el cuerpo refinados retrasan el declive, pero no lo evitan cerca del límite de vida, con daño del alma o con desviaciones. Un anciano patriarca que declina en su reclusión es un motor de crisis de sucesión.
- **El personaje del jugador:** si su `cognition` baja, el narrador recibe sus memorias con la distorsión que tienen y la percepción con los errores que tiene. Las acciones pueden salir peor (más errores de ejecución), pero el jugador sigue eligiendo qué intentar.

## 13. Sentido y pertenencia

Dos necesidades nuevas en la sección 7, **lentas**: no suben en horas sino en meses, y no se satisfacen comiendo sino con vínculos, roles y propósitos.

```ts
interface BelongingSource {
  kind: "family" | "clan" | "village" | "sect" | "guild" | "faith" | "gang" | "court" | "band";
  ref: OrgId | AgentId | PlaceId;
  strength: number;                     // densidad de relaciones + años + rituales compartidos
  identityWeight: number;               // cuánto de "quién soy" depende de esto (autoimagen, §9c)
}

interface MeaningSource {
  kind: "coreGoal" | "role" | "faith" | "craft" | "legacy" | "dao" | "duty" | "love";
  ref: GoalId | OrgId | EventId;
  strength: number;
}
```

- **`belonging`** baja con el aislamiento, el exilio, la expulsión, la orfandad, la migración y, en los longevos, con sobrevivir a todos. Un déficit alto vuelve a la persona **susceptible a quien le ofrezca un lugar**: sectas, cultos, bandas, un maestro, un amante. La lealtad hacia quien le dio pertenencia es más fuerte que la que nace del interés (organizations: lealtad).
- **`meaning`** sube con el avance hacia los objetivos núcleo, un rol reconocido, una fe, un oficio dominado, el legado y, para cultivadores, el Dao. Su déficit alimenta la depresión, el demonio de `despair`, actos de riesgo y conversiones.
- **El vacío del objetivo cumplido.** Al lograr un objetivo núcleo (la venganza consumada, la ruptura soñada) el sentido que daba desaparece. Sin otro que lo reemplace, aparece un vacío: arco clásico del vengador que no sabe qué hacer después, que la utilidad produce sola.
- **Identidad de grupo.** Lo que pertenece pesa en la autoimagen: sacrificarse por el clan, morir por la secta, odiar al grupo rival (sesgo de grupo, §9c). Los mártires salen de `identityWeight` alto + amenaza al grupo + un rol que lo pide.
- **Fe.** Creer en dioses, doctrinas o en el Cielo es un conjunto de creencias (information) con fuerte carga de sentido y pertenencia. Las **conversiones** ocurren cuando la doctrina nueva promete lo que falta (sentido a un desesperado, pertenencia a un desarraigado) y hay alguien que la ofrece con confianza; no son tiradas al azar.

## 14. Psicología de multitudes

Una multitud no tiene mente propia, pero tampoco es la suma simple de individuos: la densidad, el anonimato y la visibilidad de lo que hacen los demás cambian cómo decide cada uno.

```ts
interface Crowd {
  id: CrowdId;
  originEventId: EventId;               // la ejecución, el reparto de granos, el sermón, la derrota, el incendio
  place: PlaceId;
  members: AgentId[] | PopulationSlice;  // individuos (tier 2+) o una porción agregada
  density: number;
  mood: EmotionVector;                  // promedio ponderado de las emociones percibidas
  arousal: number;
  focus?: AgentId | PlaceId | OrgId;    // el blanco o el centro de atención
  agitators: AgentId[];                 // quienes empujan
  thresholds: Distribution;             // fracción de otros que tiene que ver actuar para sumarse
  rumorBuffer: RumorId[];               // rumores que corren adentro, con deformación acelerada
}
```

- **Se forma** cuando hay densidad y un estímulo compartido (hambre y un granero cerrado, una ejecución, un milagro, una derrota, un incendio, una fiesta). Se disuelve por dispersión, cansancio, fuerza, satisfacción o un estímulo nuevo.
- **Contagio:** a alta densidad, el contagio emocional de la sección 4 se amplifica (cada uno ve muchas caras con la misma emoción) y el arousal sube.
- **Anonimato:** baja el costo esperado de violar normas (nadie me ve, nadie me castiga), y la utilidad de cada miembro cambia en consecuencia.
- **Umbrales (cascada):** cada miembro tiene un umbral, la fracción de otros que tiene que ver actuando para sumarse. Sale de temperamento (`boldness`), agravio (memorias y relaciones con el blanco), valores y necesidad. Unos pocos con umbral cero (agitadores, desesperados) pueden encender a todos si la distribución lo permite, o a nadie si hay un hueco. La cascada se calcula de forma determinista sobre la distribución.
- **Resultados:** motín, saqueo, linchamiento (law: justicia por mano propia), estampida (body-health: heridas por aplastamiento), conversión masiva, aclamación de un líder, desbandada de un ejército (war: la moral usa este mismo mecanismo), el germen de una revuelta (social-structure).
- **Agitadores y líderes:** alguien con estatus, voz y un relato puede mover el foco ("¡fue el magistrado!"). Los intrigantes los usan (schemes); el estado los busca después (law).
- **Rumores:** adentro corren más rápido y se deforman más (information); lo que la multitud "sabía" se vuelve memoria compartida.
- **Lo que queda:** cada miembro guarda su memoria del evento. Después llegan la culpa, la racionalización (sección 9c) o el orgullo, y un **agravio colectivo** que alimenta el humor de la población (tier 0) por años.
- **Cultivadores frente a multitudes:** la presión de presencia (威压) de un cultivador fuerte es un estímulo de miedo enorme que puede quebrar una multitud de mortales o, si el agravio es mayor que el miedo, convertirla en mártires.

## 15. Sueño, consolidación y sueños

Dormir (body-health §8) no es solo pagar la deuda de sueño: es cuando la memoria se reorganiza.

```ts
interface ConsolidationPass {          // una por noche de sueño, en NPCs de tier 2+
  npc: AgentId;
  night: Tick;
  sleepQuality: number;                 // de body-health: frío, dolor, miedo, pesadillas
  strengthened: MemoryId[];             // las de más intensidad emocional y relevancia con objetivos
  merged: [MemoryId, MemoryId][];        // memorias parecidas que se funden (y se distorsionan)
  schemaUpdates: SchemaDelta[];          // confirmaciones que se integran a esquemas
}

interface Dream {
  id: DreamId;
  dreamer: AgentId;
  night: Tick;
  sources: MemoryId[];                  // memorias del día, traumas, deseos, objetivos
  tone: EmotionVector;
  symbols: SymbolId[];                  // del vocabulario de la cultura (content/)
  nightmare: boolean;
  injected?: { by: AgentId | SpiritId | "heaven" | "pastLife"; eventId: EventId }; // causa real externa, si la hay
}
```

- **Consolidación:** las memorias del día con más emoción y relevancia para los objetivos ganan saliencia; las triviales se degradan más rápido; las parecidas se funden (la fuente de muchos recuerdos falsos con forma); las que confirman un esquema lo refuerzan. Con mala calidad de sueño la consolidación es pobre: se recuerda peor y con más distorsión.
- **Sueños como contenido:** se arman con las memorias recientes y las intensas, las emociones activas, los traumas, los deseos y los objetivos, traducidos a símbolos de la cultura. Un sueño no trae información nueva por sí solo.
- **Pesadillas:** el trauma las produce, empeoran el sueño, la falta de sueño empeora el control y el ánimo, y eso refuerza el trauma. El ciclo se calcula; no es una regla escrita.
- **Interpretación:** la cultura tiene una teoría de los sueños (presagio, mensaje de ancestros, deseo oculto, nada). Quien cree que su sueño es un presagio actúa en consecuencia ([divination.md](divination.md): presagios), y eso cambia el mundo aunque el sueño fuera solo memoria.
- **Sueños con causa externa** (`injected`): cuando hay un agente real detrás, el sueño trae información nueva y es un evento con causa: visitas de espíritus y ancestros ([spirits.md](spirits.md)), fragmentos de una vida anterior (spirits: memorias que vuelven en sueños), asaltos de un demonio interno (sección 9), técnicas de caminar en sueños, lecturas de adivinación por sueño (divination). El soñador no distingue un sueño propio de uno inyectado salvo por las mismas pistas imperfectas de cualquier percepción.
- **Dormir sobre un problema:** la consolidación puede juntar dos memorias que el NPC nunca relacionó despierto y producir una hipótesis ([discovery.md](discovery.md): insights). Es una bonificación modesta, no una revelación gratis.
- **Meditación:** en mundos y prácticas que la permiten reemplaza parte de la consolidación con un modo más ordenado: menos distorsión y menos sueños, a cambio de tiempo de práctica.

## 16. Gustos personales

Cada persona tiene preferencias que no son necesidades: comidas, colores, materiales, músicas, formas de arte, paisajes, animales, olores, climas, pasatiempos, tipos de compañía. Se generan, no se sortean.

```ts
interface Preference {
  domain: TasteDomainId;                // "food.flavor", "color", "music", "landscape", "pastime"...
  item: TasteItemId;                    // "picante", "azul profundo", "flauta", "montaña nevada", "go"
  valence: number;                      // -1..1 (aversiones también)
  strength: number;
  originEventIds: EventId[];            // la comida de la infancia, la canción de la amada muerta, la intoxicación
  acquired: boolean;                    // gusto adquirido por exposición repetida (té, vino, poesía difícil)
}
```

- **De dónde salen:**
  - **Temperamento:** `curiosity` busca novedad y lo raro, `boldness` lo intenso (picante, alturas, apuestas), `sociability` los pasatiempos en grupo, `control` lo ordenado y lo sutil.
  - **Cuerpo y genoma** (family-lineage, body-health): sensibilidad al amargo, al picante, intolerancias, oído musical.
  - **Cultura:** lo que la cultura de crianza tiene, valora o prohíbe define el menú posible y lo "normal".
  - **Exposición:** lo conocido gusta más; la comida de la infancia es consuelo; lo que se comió antes de enfermar da asco; la repetición crea gustos adquiridos.
  - **Memorias:** un objeto, una canción o un lugar ligado a una memoria fuerte hereda su emoción.
  - **Estatus:** el gusto como distinción (social-structure). Se imita el gusto de los de arriba (imitación, §9c) y los de arriba cambian cuando los de abajo los alcanzan: así nacen las **modas**.
- **Para qué sirven:**
  - **Demanda:** alimentan la demanda social y de prestigio de [economy.md](economy.md) §4; un mercado de lujo es la suma de gustos con presupuesto.
  - **Regalos:** el regalo justo sube `affection` mucho más que el caro. Saber qué le gusta a alguien es una creencia (teoría de la mente, information), y averiguarlo es parte de cortejar, sobornar o congraciarse.
  - **Pasatiempos:** son acciones en la utilidad cuando las necesidades están cubiertas; llenan días offscreen y crean relaciones (los jugadores de go del pueblo).
  - **Arte y oficios:** el gusto del artista da forma a lo que hace ([discovery.md](discovery.md): arte con intención; [crafts.md](crafts.md)); el gusto del comprador decide qué vale en una subasta.
  - **Obsesión:** un gusto llevado al extremo por un demonio de `obsession` (sección 9) es el coleccionista que mata por una pieza.
- **Cultivadores:** algunos gustos se apagan (quien no necesita comer deja de distinguir sabores) y aparecen otros (calidades del qi, espadas, venas, el silencio). La longevidad (§9c) vuelve los gustos más raros y más exigentes.

## 17. El jugador y el narrador

- **El personaje del jugador tiene la misma mente** en lo que la simulación necesita: etapa, condiciones, cognición, necesidades de sentido y pertenencia, gustos, sueños y memorias. **La simulación nunca le elige la acción.** Lo que hace es resolver cómo sale (manos que tiemblan por abstinencia, el pánico ante un disparador baja la ejecución) y qué siente, ve o recuerda su personaje.
- **El narrador recibe** solo lo que el personaje percibe o sabe: las señales visibles en otros (alguien que repite preguntas, el olor a vino de un adicto, un grito en la noche), nunca el diagnóstico real; los sueños del personaje desde su registro `Dream`; los recuerdos intrusivos con su distorsión; la multitud como se ve desde adentro. Las etiquetas que usa son las de la cultura del personaje ("dicen que lo poseyó un espíritu"), no las clínicas.
- **Los gustos del personaje** se generan al empezar desde su crianza y su cuerpo, igual que los de un NPC. El narrador puede mencionarlos ("el té amargo te recuerda a tu abuela"), y el jugador puede ignorarlos. Los NPCs que lo conocen pueden aprenderlos y usarlos en regalos o en trampas.
- **El inspector** (modo debug) muestra la verdad completa: condiciones con sus causas, el umbral de cada miembro de una multitud, por qué un gusto existe, qué memorias se fundieron anoche.

## 18. Escala: cuánta psicología por tier

Los tiers son los de [VISION.md](../VISION.md); su asignación, la materialización y la puesta al día están en [simulation.md](simulation.md) §4-§8.

| Tier | Qué se guarda | Cómo se actualiza |
|---|---|---|
| 0 — estadística | Distribuciones de temperamento y valores por población; humor colectivo (miedo, descontento) | Agregado, por eventos que afectan a la población |
| 1 — generado al acercarse | Temperamento, 2–3 esquemas, relaciones con familia, memorias resumidas | Se **materializa** coherente con la estadística y con la historia registrada |
| 2 — activo en la zona | Modelo completo; memorias acotadas a las top-N por saliencia | Decisión diaria, interpretación de eventos percibidos |
| 3 — importante | Modelo completo + objetivos núcleo + demonios | Siempre simulado, a menor frecuencia lejos del jugador |
| 4 — conectado al jugador | Todo, sin límite de memorias | Máxima resolución, nunca se degrada |

- **Materializar (0 → 1):** el temperamento sale de la población y de los padres si existen. Lo adquirido sale de una **biografía sintetizada**: eventos de vida coherentes con lo que la historia agregada registró ("hubo hambruna hace 10 años", "su aldea perdió una guerra"), procesados con las mismas reglas de formación. Esos eventos quedan registrados y pasan a ser verdad, según la regla de detalle diferido de [causality.md](causality.md).
- **Bajar de tier:** comprimir memorias a resúmenes, conservar las relaciones fuertes, guardar el resto como estadística. Un NPC que interactuó con el jugador nunca baja de tier 4.
- **Etapas y condiciones en agregado (tier 0):** pirámide de edades por población y **prevalencia** de duelo, trauma, depresión y adicción como tasas que suben con eventos (guerra, hambre, peste, una droga nueva en la ruta) y bajan con el tiempo. Al materializar, la biografía sintetizada decide quién la tiene y por qué.
- **Multitudes:** en tier 0-1 son una porción de población con una distribución de umbrales y una cascada agregada; si el jugador está adentro, los cercanos se materializan a tier 2 y deciden uno por uno.
- **Sueños:** la consolidación nocturna corre para tier 2+ (en lote, sin contenido); el `Dream` con contenido solo se genera para tier 3-4 o cuando hay una causa externa (`injected`).
- **Gustos:** en tier 0 la cultura tiene distribuciones de gustos (que alimentan la demanda agregada); al materializar se generan desde la cultura, el cuerpo y la biografía; en tier 1 se guardan 3-5, en tier 2+ el perfil completo.
- **Declive cognitivo:** derivado cada vez desde body-health, no se guarda; solo se registran sus causas.

## 19. Implementación por fases

- **Fase 1:** temperamento + emociones básicas + relación con el jugador (`trust`, `fear`, `affection`). Alcanza para que la aldea reaccione distinto según quién sea cada uno.
- **Fase 2:** interpretación completa, memorias (degradación, distorsión, compresión), relaciones multidimensionales, esquemas, diálogo con actos de habla.
- **Fase 3:** objetivos en capas, utilidad offscreen, crianza → rasgos adquiridos, herencia de temperamento.
- **Fase 2+:** autoimagen, autoengaño dirigido, cara, sesgos y disparadores (extienden interpretación y memoria).
- **Fase 3:** reputación por patrones, imitación, secretos, pendiente de corrupción, teoría de la mente en niveles.
- **Fase 4 (cultivo):** demonios internos, corazón del Dao, pruebas en rupturas, longevidad (distancia, anclas, desesperación al final de la vida).
- **Fase 5 (LOD):** tiers, materialización por biografía sintetizada.
- **Fase 2 (ampliación):** consolidación nocturna (fusiones, refuerzo de esquemas, efecto de la calidad del sueño); gustos básicos (comida, pasatiempos) que el narrador puede mencionar.
- **Fase 3 (ampliación):** etapas de vida con plasticidad y períodos sensibles; apego desde la crianza; `belonging` y `meaning`; condiciones mentales (duelo, depresión, trauma, ansiedad) con etiquetas culturales; lado mental de la adicción; gustos que alimentan la demanda y los regalos; sueños con contenido y su interpretación cultural.
- **Fase 4 (ampliación):** declive cognitivo leído de body-health y su efecto en la legitimidad; condiciones como raíces de demonios internos; sueños inyectados (espíritus, vidas anteriores, demonios); gustos de cultivadores.
- **Fase 6 (ampliación):** multitudes con umbrales y cascadas (motines, linchamientos, estampidas, desbandadas), agravio colectivo, conversiones y modas.

Tests clave:
- Mismo seed → misma psicología.
- Todo esquema, objetivo, relación y demonio tiene causas trazables (sin huérfanos).
- La interpretación de eventos nunca lee la verdad.
- Memorias: la saliencia es monótona sin recuerdo y la distorsión está acotada.
- Longevidad: la edad nunca cambia el signo de valores ni temperamento (solo intensidad y distancia).
- Sim headless de siglos: los inmortales no producen masacres sin motivo causal.
- Toda `MentalCondition`, `Preference`, `Dream` y `Crowd` tiene `originEventId` o causas trazables (sin huérfanos).
- Etapas: el mismo evento cambia más los esquemas en un período sensible que en la adultez (plasticidad monótona por etapa).
- Condiciones: sin eventos causales no aparece ninguna; con apoyo y sin nuevas pérdidas, el duelo se resuelve en la mayoría de los casos; el trauma escala con intensidad × indefensión × falta de apoyo.
- Declive: con `cognition` normal no cambia nada; al bajar, la distorsión de memorias sube y los niveles de teoría de la mente bajan de forma monótona.
- Multitudes: la cascada es determinista dada la distribución de umbrales; quitar a los miembros de umbral cero en una distribución con hueco evita el motín.
- Sueños: un `Dream` sin `injected` solo contiene símbolos derivados de memorias del soñador (nunca información que no tenía).
- Gustos: dos NPCs con mismo genoma, cultura y biografía tienen los mismos gustos; cambiar una memoria formativa cambia el gusto ligado.
- Determinismo: mismo seed → mismas condiciones, mismos sueños y mismas cascadas de multitud.

## Decisiones tomadas en este borrador (revisables)
- Temperamento de **6 ejes propios** en lugar de Big Five literal: más legible para el juego y fácil de mapear.
- Esquemas y valores en **catálogo cerrado** (en `content/`), no texto libre generado por LLM, para mantener el determinismo y la inspección.
- Decisión por **utilidad + softmax**, no árboles de comportamiento.
- Sí al contagio emocional, sí a los demonios que hablan (solo con sus raíces), sí a las técnicas que alteran la psique.
- **Etapas por edad vivida y curva de la especie**, no por calendario ni por cómo se ve el cuerpo: un cultivador joven de cara puede ser "antiguo" de mente.
- **Condiciones mentales como estados con causa** (catálogo cerrado en `content/`), separadas de su **etiqueta cultural**, que es una creencia con consecuencias propias (tratamiento, estigma).
- **`belonging` y `meaning` como necesidades lentas** dentro de la misma utilidad, no un sistema aparte.
- **Multitudes por umbrales (cascada)** sobre la decisión individual, sin "mente colmena".
- **Los sueños no traen información nueva** salvo que haya un agente real que la inyecte (`injected`), y eso es un evento con causa.
- **Gustos generados** desde temperamento, cuerpo, cultura, exposición, memorias y estatus; nunca sorteados en el vacío.
- **Efectos mentales sobre el personaje del jugador** (pánico ante un disparador, ansia, abstinencia): nunca bloquean la acción; solo bajan la calidad de ejecución y el narrador describe la lucha interna (aprobado 2026-10-05).

## Preguntas abiertas
- Cuántas memorias por NPC de tier 2: se arranca con **20** (top-N por intensidad y relevancia) y se ajusta con la sim headless.
- Calibración: plasticidad por etapa, prevalencias base de cada condición, tasa de resolución del duelo, distribución de umbrales en multitudes, cuántas fusiones por noche de consolidación.
- ¿Existen en algunos mundos tratamientos metafísicos que borran trauma o memoria (técnicas, píldoras de olvido)? Propuesta: sí, como técnicas con costo (se pierden también las memorias ligadas y los esquemas que formaron).

## Ampliación (2026-10-08): decisiones de niño con consecuencias

Las viñetas de la infancia (player-loop) son decisiones reales dentro de los períodos sensibles: cada una mueve temperamento, esquemas y habilidades, y también deja consecuencias que aparecen años después (una promesa hecha, un vínculo, una deuda de favor, una herida mal curada). Los adultos del entorno reaccionan según lo que perciben del niño. Fase 3, junto con crianza.

## Implementación (2026-10-08): lo adquirido
`sim/mind` guarda por persona `Mind` (`MIND`): esquemas con `strength` y `causes` (los últimos 12 eventos) y los eventos formativos de períodos sensibles. Los valores **no se guardan**: `valuesOf` los deriva de lo innato y los esquemas (suma 1, piso 0,02). Las etapas son contenido por edad vivida en años (`young-adult` con guion, los ids de contenido son minúsculas). `FORMATION_RATE` 0,25, `SENSITIVE_BOOST` 2, y la reactividad amplifica solo los temas que duelen. La siembra no simula la historia previa: esquemas de base = 0,25 + empuje del temperamento + variación (desvío 0,05). Calibración pendiente: esas constantes y las plasticidades por etapa.

## Implementación (2026-10-08): relaciones
`sim/relations` guarda por persona `Relations` (`RELATIONS`): un `Relationship` por cada otro con vínculo, con las diez dimensiones, los `bonds` (ids de `content/relation-bonds/`, derivados del registro civil: `kinBonds`) y el `history` (últimos 16 eventos). Quien no figura es un extraño, no una fila vacía: una aldea no guarda N² relaciones. El decaimiento no es un proceso sino una lectura: `current` lleva cada dimensión hacia su base (o el piso del vínculo) desde `updated` con vida media en días de mundo, y por eso leer en cualquier orden da lo mismo. `slowedBy` alarga la vida media según la fuerza de un esquema de quien siente. Los valores iniciales de un vínculo suman a la base; el piso nunca supera lo inicial. Calibración pendiente: las vidas medias, los iniciales y los pisos por vínculo.
