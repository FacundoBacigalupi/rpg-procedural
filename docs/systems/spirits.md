# Espíritus

> Nota: este doc describe la **familia xianxia**. Otras familias de mundos cambian estas reglas; ver [metaphysics.md](metaphysics.md).

> Los espíritus existen, pero ninguno aparece porque sí. Al morir, un alma normalmente vuelve al ciclo del Cielo. Un espíritu es **un alma (o una conciencia) que no volvió porque algo la ancla**, o una conciencia que nació de algo que acumuló qi durante mucho tiempo. Ese "algo" es siempre una causa concreta que se puede descubrir.

> Estado: §0-§5 decididos (2026-10-05). §6-§12 (ofrendas, santuarios, ancestros, dioses locales, abandono, economía de las ofrendas) en borrador 2026-10-06.

Depende de: [heaven-karma.md](heaven-karma.md) (el ciclo del Cielo, mérito), [npc-psychology.md](npc-psychology.md) (memoria, objetivos, emociones, sinceridad), [planet-gen.md](planet-gen.md) (qi yin, tesoros naturales), [economy.md](economy.md) (ofrendas como lotes y sumideros), [family-lineage.md](family-lineage.md) (linajes, salón ancestral).
Lo usan: [family-lineage.md](family-lineage.md) (ancestros que siguen ahí), [organizations.md](organizations.md) (templos, clanes, aval de un ancestro), [contracts.md](contracts.md) (pactos con espíritus, tierras de culto), [divination.md](divination.md) (oráculos sobre espíritus reales), [cultivation.md](cultivation.md) (cultivo de espíritus), [chronicle.md](chronicle.md) (la verdad detrás de los cultos).

## 0. Volverse espíritu es difícil
Tener un objetivo fuerte o odiar a alguien **no alcanza**. Al morir, las Fuentes Amarillas (黄泉) arrastran el alma hacia el ciclo, y quedarse es **resistir esa fuerza**. Un espíritu se forma solo si se cumplen **todas** estas condiciones a la vez:

1. **Alma con fuerza suficiente.** El alma de un mortal es débil y se dispersa en horas o días. El cultivo (sobre todo el de alma) la fortalece. Por eso casi todos los espíritus fuertes fueron cultivadores.
2. **Un ancla real**, y de una intensidad enorme: una emoción en el pico de la escala, un objetivo que era el centro de la identidad (no uno más), un objeto preparado, una atadura impuesta.
3. **Un entorno que lo sostenga:** qi yin, un lugar con qi acumulado, un objeto capaz de contener un alma. Sin sustento, el alma se gasta resistiendo.
4. **Circunstancias de la muerte que la retengan:**
   - En contra: ritos funerarios correctos, ser llorado y enterrado, morir en paz.
   - A favor: morir lejos y sin entierro, por violencia o traición, en un lugar con muchas otras muertes, o sellado.

El resultado no es una tirada: es una comparación determinista entre `fuerza del alma × intensidad del ancla × sustento × circunstancias` y la **atracción de las Fuentes** (que depende de la fuerza del Cielo en ese mundo). El azar solo afina los márgenes. Un mortal común casi nunca queda, y si queda es débil y se desvanece pronto, salvo en una confluencia extrema (una masacre en un valle yin, sin ritos, con cientos de muertos a la vez).

## 1. Orígenes
| Tipo | Causa | Qué es |
|---|---|---|
| **Espíritu resentido** (怨灵) | Muerte con emoción extrema (odio, terror, injusticia) + alma suficiente + qi yin + circunstancias (ver §0) | El alma queda atada al lugar y a la emoción de su muerte. Fuerza = intensidad × qi yin. |
| **Ancestro que se queda** | Asunto pendiente con el linaje como objetivo, más un santuario que lo sostiene (§8) | Un espíritu ancestral que cuida, juzga y pide a sus descendientes. Raro, más común entre cultivadores. |
| **Asunto pendiente** | Un objetivo central para la identidad, sin cumplir, más las demás condiciones de §0 (un objetivo fuerte solo no alcanza) | El alma queda atada al **objetivo**. Si se cumple (por ella o por otro), se libera. Sale directamente de los objetivos en capas del modelo psicológico. |
| **Remanente de alma** (残魂) | Un cultivador con alma fuerte que, al morir, se refugió en un objeto (anillo, espada, jade) con una técnica | Conserva **memorias y conocimiento reales**: puede enseñar, mentir, negociar o intentar poseer un cuerpo. El clásico "viejo en el anillo" con causa. |
| **Espíritu de lugar** | Un sitio con mucho qi acumulado durante milenios (un tesoro natural, una montaña, un río viejo) que despierta conciencia | Espíritus de montaña, de río, de árbol antiguo. Están atados al lugar, lo protegen y lo sienten. Si el lugar se agota, se debilitan. |
| **Espíritu de objeto** (器灵) | Un arma o artefacto usado durante siglos, impregnado del qi y la intención de sus dueños | Tiene la personalidad que le dejaron sus usos (una espada que mató mucho es sanguinaria). Puede elegir dueño o rechazarlo. |
| **Espíritus fabricados** | Técnicas de cultivadores de almas: estandartes de almas, refinación de fantasmas, sacrificios | Almas capturadas y esclavizadas. Mucho karma. Si el que los ata muere o el objeto se rompe, quedan libres, y quizás resentidos. |
| **Muerte masiva** | Una batalla, masacre, plaga o desastre con miles de muertos en un lugar | Acumula qi yin y espíritus resentidos. Puede volverse una **zona maldita**: tierra de fantasmas donde los mortales no viven. |

**Fe y ofrendas:** la creencia de muchos (templos, incienso, rezos) **refuerza** a un espíritu que ya existe, porque concentra qi en el santuario. Pero **no crea** dioses de la nada. Un "dios local" es un espíritu real (de lugar, un remanente, un ancestro) que la gente alimenta con su culto. Un santuario vacío durante siglos puede despertar un espíritu de lugar nuevo, hecho de las intenciones de los que rezaron (§7). La física de las ofrendas, los ancestros, los cultos y qué pasa cuando se dejan de hacer: §6-§11.

## 2. Qué es un espíritu en la simulación
- Es un **agente** con una psicología reducida: memorias (sobre todo de su muerte o su origen), la emoción o el objetivo que lo ancla, y valores congelados. No crece como un vivo: cambia muy poco, salvo los de lugar y los remanentes.
- **Conservación:** se sostiene con qi (yin para los resentidos, el del lugar para los de lugar). Sin qi se desvanece y su qi vuelve al entorno.
- **Ancla:** cada espíritu tiene un `anchor` explícito (lugar, objetivo, objeto, atadura). Romper o cumplir el ancla lo libera o lo destruye.
- **Ver espíritus** depende de la percepción y el cultivo: un mortal siente frío o ve sombras, un cultivador los ve, uno de alma fuerte habla con ellos.

```ts
interface Spirit {
  id: AgentId;
  kind: "resentful" | "unfinished" | "ancestral" | "remnant" | "place" | "object" | "bound" | "hungry";
  anchor: { place?: CellId; goal?: GoalId; object?: ItemId; binder?: AgentId; lineage?: LineageId; shrine?: ShrineId };
  formerSelf?: AgentId;          // quién era en vida (si fue alguien)
  qi: number;                    // se sostiene y se desvanece con esto
  upkeep: number;                // qi que pierde por tick (más en lugares yang y de día)
  sustainedBy?: ShrineId[];      // santuarios cuyo qiPool lo alimenta (§7)
  originEventId: EventId;        // la muerte, el despertar o la atadura
}
```

## 3. Verdad y creencia
- Que un lugar "esté embrujado" es una **creencia** de los aldeanos. Puede ser cierta (hay un espíritu resentido), falsa (eran bandidos que usaban el rumor) o deformada (hay un espíritu, pero no es lo que cuentan).
- Un remanente de alma puede mentir sobre quién fue: su historia es una memoria con autoengaño, como la de cualquier NPC.
- Los espíritus resentidos recuerdan su muerte como la vivieron, no como fue. Su venganza puede apuntar al culpable equivocado.

## 3b. El ciclo: las Fuentes Amarillas y la reencarnación
- Las almas que no quedan como espíritus cruzan las **Fuentes Amarillas** y vuelven a nacer. La reencarnación es real.
- **El Cielo cobra al cruzar:** se le muele al alma lo que tomó (esencia refinada, años de más, karma neto) y vuelve al ciclo. Un mortal pasa casi entero; un cultivador alto puede disolverse del todo ([heaven-karma.md](heaven-karma.md), cobro en las Fuentes).
- **El karma no se hereda.** Cruzar las Fuentes salda las deudas kármicas, porque se cobran en el alma: la nueva vida empieza limpia (y más débil, si debía mucho). Lo que **sí queda** está en los demás: quienes te odiaron o te amaron siguen recordándote, y un enemigo longevo puede reconocerte en tu nueva vida aunque vos no lo recuerdes.
- **Los recuerdos se lavan.** Cuánto sobrevive depende de la fuerza del alma: ver las opciones en las preguntas abiertas.
- Las almas se conservan: no se crean de la nada. La población de almas en el ciclo es parte del ledger (el Cielo las administra).

## 3c. Tu personaje como espíritu
- Morir **no siempre termina la partida.** Si se cumplen las condiciones de §0, seguís jugando como espíritu, atado a tu ancla, con las limitaciones de serlo: no podés tocar el mundo físico como antes, te sostenés con qi, te ven solo los que pueden.
- La partida termina cuando tu alma **cruza las Fuentes o se disipa**. Ahí se escribe la crónica.
- **A futuro, con el diseño de cultivo:** volver a ser humano (un cuerpo vacío, una posesión, reconstruir un cuerpo con tesoros), o cultivar como espíritu (camino de los fantasmas cultivadores). Definido en [cultivation.md](cultivation.md) §14.

## 3d. Recuerdos de vidas pasadas
Cruzar las Fuentes implica la sopa del olvido (孟婆汤). Cuánto se resiste combina cuatro mecanismos:
- **Fuerza del alma:** decide cuánto sobrevive. Un mortal no conserva nada, un alma media conserva sensaciones (miedos sin origen, talentos inexplicables) y un alma muy fuerte conserva recuerdos concretos.
- **Sellados, no borrados:** lo que sobrevive queda sellado y despierta con disparadores (lugares, personas, llegar al mismo reino de cultivo, estar al borde de la muerte). Primero llega en sueños y fragmentos (sueños inyectados: [npc-psychology.md](npc-psychology.md) §15).
- **Preparación:** sellos en el alma, jades de memoria o un discípulo que te reconoce mejoran lo que sobrevive. Cuestan y hay que planearlos.
- **Desafiar al Cielo:** un alma muy fuerte puede intentar rechazar la sopa. Es una rebelión como una tribulación: si falla, el alma queda dañada.

Son memorias con `source: "past-life"`, más distorsionadas que las normales.

## 3e. Si el jugador sigue en otro cuerpo: lo que sabe el usuario y lo que sabe el personaje
**Cruzar las Fuentes siempre termina la partida.** El alma que renace después del cobro y de la sopa ya no es el personaje: es un NPC más, que puede aparecer en el epílogo ([chronicle.md](chronicle.md) §8). No hay "continuar" gratis.

El jugador solo sigue en un cuerpo nuevo si lo **ganó**: evitar las Fuentes con una de las vías de [cultivation.md](cultivation.md) §14 (renacer a propósito, posesión, cuerpo vacío, cuerpo construido), o cruzarlas rechazando la sopa (§3d), que es una rebelión con su propio riesgo. Todas se preparan en vida, cuestan y el mundo las puede impedir (te sellan el alma, te destruyen el jade, matan a quien te iba a reconocer).

En ese caso, el usuario recuerda todo aunque el personaje no. **No se le prohíbe nada** (libertad total), pero el conocimiento se equilibra solo:
- **El mundo siguió.** Entre la muerte y el renacer pasan décadas o siglos (lo decide la sim). Los tesoros se saquean, las sectas caen, los enemigos mueren o se fortalecen. Además, lo que sabías eran **creencias** de tu vida pasada, no verdades, y quizás eran falsas.
- **Saber no es poder hacer.** Técnicas, cultivo y habilidades viven en el cuerpo y el alma, no en el usuario. Hay que reentrenar todo. Saber el camino acelera, pero no salta etapas. La sim valida lo que el *personaje* puede hacer, como siempre.
- **Actuar con lo que sabés es un disparador.** Si tu alma conservó ese recuerdo (sellado), despierta de verdad y el personaje pasa a saberlo. Si no lo conservó, igual podés actuar (ir a la cueva), pero sin los detalles finos (cómo abrir el sello), que hay que redescubrir.
- **El mundo lo nota.** Un niño que va directo a una cueva escondida o habla de una secta extinta llama la atención: rumores, sospechas de un viejo monstruo reencarnado, y **los enemigos de tu vida pasada pueden estar buscando esas señales**. Usar tu conocimiento es poderoso y peligroso.

## 4. Consecuencias
- **Liberar un espíritu** (cumplir su asunto pendiente, vengar su muerte, enterrarlo bien) es un acto con karma positivo, y una fuente de misiones que salen del estado sin escribirlas.
- **Zonas malditas** cambian el mapa humano: abandono, tabúes, mitos. Purificarlas es una hazaña.
- **Remanentes:** un maestro escondido en un objeto es un aliado poderoso y un riesgo (quiere un cuerpo).
- **Cultivo de almas:** camino propio (técnicas yin, estandartes), con mucho karma y enemigos.

## 5. Escala
- Espíritus importantes (remanentes, espíritus de lugar grandes, resentidos fuertes): agentes completos.
- Espíritus menores de una zona maldita: población agregada (tier 0) con fuerza total y humor colectivo.
- **Ofrendas en LOD bajo:** por cultura y región, una tasa de ofrendas por hogar (que depende de riqueza, devoción y calendario) y su efecto agregado en la economía (sumidero, oficios, tierras de culto). Los santuarios sin ocupante real son un `qiPool` por celda y un efecto social; no se simulan ritos uno por uno.
- **Solo los ocupantes reales son agentes:** un ancestro espiritual o un dios local se simula como agente (tier según importancia) con su balance de qi. Los ritos que lo alimentan se agregan por período.
- **Cuando el jugador entra** a un salón o un templo, el rito se materializa con sus participantes, sus lotes y su devoción, coherente con el agregado.

## 6. Las ofrendas son física

Una ofrenda es un **acto con bienes concretos** que salen de la economía, más un poco de qi de quien la hace. No es un pago al más allá. Que alguien la reciba depende de quién esté de verdad del otro lado, y casi nunca hay nadie.

- **Casi siempre no llega a nadie.** La mayoría de las almas mortales cruzan al ciclo (§0, §3b). El abuelo al que una familia le quema incienso durante cuarenta años suele estar ya renacido en otro lado, o esperando una concepción en las Fuentes. **Las ofrendas no alcanzan a las almas del ciclo ni a las reencarnadas**: no hay correo al más allá. El rito sigue teniendo efectos enormes, pero sobre los vivos (§10, §11).
- **Qué pasa con los bienes:** cada ofrenda es un lote de economy con su destino (`disposal`). Lo quemado (incienso, papel, ropa, dinero de papel) se vuelve ceniza y humo: es un sumidero real de trabajo y materiales. Lo enterrado (ajuar funerario) sigue existiendo bajo tierra: es el botín de los saqueadores de tumbas y el material de la arqueología (deep-history). La comida suele comerla la familia después del rito, el clero o los mendigos. No es un sumidero sino una transferencia, y si alimenta a quien lo necesita cuenta como mérito ([heaven-karma.md](heaven-karma.md) §7: vale lo que sostiene vidas).
- **Qué pasa con el qi:** quemar algo que tiene qi (incienso de hierbas espirituales, una píldora, un talismán) lo libera en el santuario. Un espíritu presente y anclado ahí absorbe una fracción según su afinidad, y el resto vuelve al ambiente de la celda. La comida mortal y el papel casi no tienen qi: alimentan creencias, no espíritus.
- **La devoción gasta qi propio.** Rezar con intención concentrada gasta una cantidad **minúscula** del qi vital de quien reza, que se repone comiendo y durmiendo (body-health). La cantidad depende de la **sinceridad** (npc-psychology: si cree y si le importa): un rito hecho por obligación, mirando para otro lado, no aporta casi nada. Mil fieles sinceros durante un siglo mueven mucho qi; un solo devoto, casi nada. Es una ley de la familia xianxia (metaphysics: `Law`); otras familias pueden ponerla en cero o hacer que la fe genere esencia.
- **Conservación:** todo el qi de las ofrendas y la devoción sale de algo (bienes, cuerpos) y va a algún lado (un espíritu, el santuario, el ambiente). El ledger cuadra.

```ts
interface Rite {
  id: EventId;
  shrine: ShrineId;
  performers: AgentId[] | { population: PopulationId; count: number };  // agregado en LOD bajo
  addressedTo: BeliefRef;            // a quién creen que le hablan (el abuelo, el dios del río)
  offerings: { lot: LotId; disposal: "burned" | "buried" | "eaten_by_performers" | "eaten_by_clergy" | "given_to_poor" | "left_to_rot" }[];
  devotionQi: number;                // suma de lo que aportó cada uno según su sinceridad
  received: { spirit?: AgentId; qi: number; toShrine: number };   // WorldTruth: quién recibió qué
  festival?: FestivalId;             // calendario de la cultura (living-world §5)
  causes: EventId[];                 // la costumbre, una muerte, una desgracia, un pedido
}
```

## 7. Santuarios

Un santuario es un sitio donde se ofrenda: un altar en la casa, una tumba, el salón ancestral de un clan, un templete en el camino, el templo de una ciudad, el túmulo sobre una fosa común.

```ts
interface Shrine {
  id: ShrineId;
  kind: "household_altar" | "grave" | "ancestral_hall" | "roadside" | "temple" | "mass_grave";
  cell: CellId;
  keepers: AgentId[] | OrgId;        // quién lo cuida (familia, clan, templo, aldea)
  dedicatedTo: BeliefRef;            // a quién está dedicado según la gente
  occupant?: AgentId;                // quién está de verdad (WorldTruth), o nadie
  tablets?: { name: string; believedPerson: BeliefRef; person?: AgentId }[];  // tablillas: nombres creídos, a veces inventados
  qiPool: number;                    // qi concentrado en el sitio (parte del ledger de la celda)
  condition: number;                 // el edificio: se pudre, se quema, se repara
  formation?: FormationId;           // algunos templos tienen una formación que concentra (crafts)
  endowment?: AssetId[];             // tierras y rentas de culto (§11)
  originEventId: EventId;
}
```

- **El santuario concentra.** Un lugar donde se queman ofrendas y se reza durante siglos acumula qi en su `qiPool`, que se escapa despacio al ambiente (más rápido si el edificio está roto). Un templo viejo se siente "pesado" para un cultivador aunque no tenga a nadie adentro.
- **Un santuario vacío durante siglos puede despertar un espíritu de lugar** (§1: el qi acumulado mucho tiempo despierta conciencia). Ese espíritu no es el dios al que rezaban: es algo nuevo, con una personalidad hecha de las intenciones de los que rezaron, igual que un espíritu de objeto se hace de los usos de sus dueños. Un templo de la misericordia puede despertar algo compasivo; un altar de venganzas, algo cruel. La gente lo llama con el nombre del dios de siempre, y el espíritu puede aceptarlo o no. Así un culto termina teniendo un dios real, con causa y sin crear nada de la nada.
- **Las tablillas son creencias escritas.** Como el libro del linaje ([family-lineage.md](family-lineage.md) §9), registran lo que el clan quiere: un ancestro ilustre inventado tiene su tablilla y recibe ofrendas durante siglos.
- **Profanar** un santuario (romperlo, robar el ajuar, ensuciar el altar) es un crimen en casi todos los códigos ([law.md](law.md)), una ofensa enorme a la cara de quien lo cuida y, si hay un ocupante real, un ataque que él recuerda.

## 8. Ancestros que se quedan

Un **espíritu ancestral** es un alma que cumplió las condiciones de §0 con el **linaje** como ancla: muere con su objetivo central puesto en sus descendientes ("que la casa no caiga", "que mi hijo llegue a heredero") y tiene un lugar que lo sostiene (su tumba, su tablilla, el salón). Es una variante del asunto pendiente (§1), y es raro: la mayoría de los ancestros no se quedan.

- **Más común entre cultivadores:** un ancestro con alma fuerte (cultivation) cumple las condiciones con mucha más facilidad. Un clan cultivador puede tener uno o dos ancestros espirituales reales; un clan mortal, casi nunca.
- **Qué quiere:** lo que quería en vida para los suyos, congelado (§2: valores congelados). Juzga a los descendientes con normas de hace siglos, y puede detestar al heredero actual por casarse con alguien "indigno" según criterios que ya nadie comparte.
- **Qué puede hacer:** lo que su qi y su naturaleza le permiten, como cualquier agente. Puede aparecer en sueños (npc-psychology: sueños con causa externa), avisar de un peligro que percibe, asustar a un intruso, mover cosas pequeñas, guardar un secreto del clan y, si fue cultivador, enseñar. No da "suerte": no hay suerte mágica, hay actos.
- **Su sustento es el salón.** Vive del `qiPool` de su santuario, que se llena con ofrendas y devoción y se vacía con su gasto y con la fuga al ambiente. Su qi propio sigue la regla de §2: si no le alcanza, se debilita (§10).
- **Pertenece a la familia.** Se le consulta, se le teme y se discute con él (family-lineage: ancestros que siguen ahí). Puede avalar o rechazar a un heredero ([organizations.md](organizations.md): aval de un ancestro), y su aval pesa en la legitimidad mientras se crea en él.

## 9. Dioses locales y cultos

Un **dios local** es un espíritu real (de lugar, un remanente, un ancestro que se volvió patrono de una aldea, una bestia despierta) al que una comunidad le rinde culto. El culto y el dios se necesitan: él vive de las ofrendas y la devoción; la comunidad, de lo que él hace o de lo que cree que hace.

```ts
interface Cult {
  id: CultId;
  shrines: ShrineId[];
  believedDeity: BeliefRef;          // nombre, forma, poderes y mitos que le atribuyen
  deity?: AgentId;                   // WorldTruth: el espíritu real, o nadie
  devotees: { agent: AgentId; sincerity: number }[] | { population: PopulationId; share: number; sincerity: number };
  clergy?: OrgId;                    // el templo como organización (organizations §13)
  rites: { festival?: FestivalId; kind: string; offerings: GoodTypeId[] }[];
  taboos: NormId[];                  // lo que el dios "prohíbe"
  originEventId: EventId;            // un milagro, una aparición, una desgracia, un fundador
}
```

- **El dios tiene incentivos.** Es un agente con utilidad: quiere seguir existiendo y lo que su ancla le pida. Sus fieles son su sustento, así que le conviene **cumplir algo**: espantar bestias del valle, avisar de una crecida, curar un poco con su qi, aparecer en sueños para pedir más. Tiene atención finita y un alcance que se gasta con la distancia, como todo agente.
- **Los fieles le atribuyen más de lo que hace.** La lluvia que llegó después del rito o la cura de un niño que se iba a curar igual: el sesgo de confirmación (information) arma la reputación del dios con coincidencias. Un culto sin dios real funciona igual en lo social (living-world §5: religiones), y nunca se entera.
- **Los dioses compiten.** Dos cultos en el mismo valle se disputan fieles, y un dios que pierde fieles pierde sustento. Hay dioses que hacen milagros visibles para no desaparecer, otros que mandan a sus sacerdotes a difamar al rival y otros que hacen pactos ([contracts.md](contracts.md): pacto con espíritu).
- **El trono y las sectas los miran.** Un estado puede canonizar a un dios local y darle títulos (legitimidad mutua), prohibirlo o destruir su templo ([state.md](state.md)). Un cultivador puede matar a un dios para quedarse con su qi, con karma y con una aldea que lo odia.
- **Un culto se puede fundar a propósito.** Un charlatán, un sacerdote ambicioso o un espíritu que quiere sustento pueden empezar uno con un milagro, real, fabricado o casual. Lo que crece después depende de lo que la gente crea y de si hay alguien del otro lado.

## 10. Cuando un linaje deja de ofrendar

Un linaje deja de ofrendar por algo concreto: se extinguió, migró y dejó el salón atrás, se empobreció en una hambruna, se convirtió a otra religión, una guerra quemó el salón, una rama rompió con la otra, el estado prohibió el culto o los descendientes cultivadores ya no creen. Lo que pasa después depende de si había alguien del otro lado.

**Si no había nadie (lo normal):**
- **En la verdad, nada sobrenatural.** El salón se deteriora, las tablillas se pierden y con ellas la genealogía (family-lineage: el libro del linaje como creencia escrita), y el `qiPool` acumulado se escapa al ambiente en décadas.
- **En los vivos, mucho.** Cae la pertenencia y la cohesión del clan (npc-psychology: sentido y pertenencia), sube la culpa en los que creen y los vecinos juzgan ([social-structure.md](social-structure.md): cara; la piedad filial es una norma de estatus). Cada desgracia posterior se le atribuye al abandono ("los ancestros están enojados"): se consultan adivinos ([divination.md](divination.md)), se paga a sacerdotes y exorcistas, se retoman los ritos o las ramas se pelean por la culpa. Es un mercado (§11).

**Si había un ancestro o un dios real**, el abandono es una presión con etapas:
1. **Hambre.** El `qiPool` baja y el espíritu gasta su propio qi. Pide con sueños insistentes, señales y ruidos en el salón.
2. **Enojo.** Si nadie responde, su relación con los descendientes cambia (npc-psychology: relaciones) y pasa de protector a acreedor. Puede asustar, revelar secretos del clan o retirar su aval a un heredero.
3. **Tomar.** Un espíritu con hambre puede **tomar qi de los vivos** cerca de su ancla. Causa cansancio, frío, enfermedades leves que no se curan (body-health: el qi vital baja) y comida que se pudre rápido. Es un acto con causa y con huellas, detectable por un cultivador o un médico que sepa mirar.
4. **Desenlace.** Depende de su fuerza, su temperamento y lo que pase:
   - **Se apaga:** su qi llega a cero, el ancla se suelta y el alma cruza al ciclo, debilitada (§3b).
   - **Se vuelve fantasma hambriento** (饿鬼): cambia de `kind` a `"hungry"`, su objetivo pasa de "que la casa prospere" a "comer" y deja de distinguir a los suyos. Toma de quien pueda: viajeros, aldeas vecinas, ofrendas ajenas. Es un problema regional con causa: un clan que se fue sin llevarse a su ancestro.
   - **Se vuelve resentido:** si el abandono vino con una traición (el heredero que vendió el salón, la rama que lo profanó), puede convertirse en un espíritu resentido atado al lugar y a la emoción (§1), con odio dirigido a esa rama. Es una maldición familiar con origen.
   - **Se reconcilia:** los descendientes vuelven y pagan (ofrendas, cumplir el asunto que lo ata, devolver el salón), y la relación se repara, con memoria del abandono.
- **Llevarse a los ancestros.** Un clan que migra puede llevarse las tablillas o las cenizas. Si el ancla del espíritu es el objeto y no el lugar, el ancestro viaja con ellos; si es la tumba, se queda.
- **Los muertos sin familia.** Muchas culturas ofrendan a los muertos que nadie recuerda (festivales de fantasmas, platos en la puerta). En la verdad, eso alimenta a los pocos espíritus errantes reales de la zona y, sobre todo, a los mendigos que se comen la comida, lo que sí es mérito real. Una aldea que deja de hacerlo junto a una fosa común (§1: muerte masiva) puede tener problemas reales.

## 11. Economía de las ofrendas

Las ofrendas mueven buena parte de la economía de un mundo así ([economy.md](economy.md)).
- **Gasto de los hogares:** ritos de calendario, funerales, aniversarios, pedidos. Las familias pobres se endeudan para un funeral digno (economy: crédito y usura), porque un funeral pobre es una pérdida de cara para toda la familia.
- **Oficios que viven de esto:** fabricantes de incienso (de hierbas mortales o espirituales, con precios muy distintos), papel de ofrenda, velas, tallistas de tablillas, geománticos que eligen tumbas, plañideras, sacerdotes, adivinos y exorcistas.
- **Tierras de culto** (祭田): un clan aparta tierras cuya renta paga los ritos. Son inalienables por norma (un `Commitment` del clan con sus ancestros y entre ramas, [contracts.md](contracts.md)), y por eso son motivo de disputas: quién las administra, quién las vende en secreto, qué rama se queda con la renta. El estado a veces las exime de impuestos ([state.md](state.md): exenciones), y entonces crecen.
- **Templos como tesoros:** reciben ofrendas y tierras, prestan con interés y guardan depósitos. Son ricos, y por eso los saquean los ejércitos y los codician los reyes ([war.md](war.md), state).
- **El mercado de creencias:** se vende mérito, perdón, una buena reencarnación y papel moneda "para el más allá". Nada de eso funciona como se dice (heaven-karma §7: el mérito no se compra), pero todo mueve dinero real. El que regala comida a los pobres en el festival sí gana mérito, aunque crea que lo ganó por otra razón.
- **Ajuar funerario:** los ricos se entierran con bienes. Es riqueza sacada de circulación que vuelve por el saqueo (law: profanación), por la arqueología (deep-history) o nunca.

## 12. El jugador y el narrador
- **El narrador cuenta el rito y lo que el personaje percibe**, nunca lo que pasa del otro lado si el personaje no puede verlo. Un mortal huele el incienso y siente paz o culpa; un cultivador con sentido espiritual puede notar que el salón está vacío, o que algo absorbe el humo.
- **El jugador puede ofrendar a sus ancestros** (los de su familia generada), fundar un culto, financiar un templo, robar tumbas o cuidar un santuario olvidado, con todas las consecuencias de arriba.
- **Si el jugador muere y se queda como espíritu** (§3c), las ofrendas pasan a ser su sustento real: su supervivencia depende de que sus descendientes o sus fieles sigan ofrendando, y puede intentar volverse dios local de una aldea.
- **La crónica final revela la verdad:** a quién le ofrendaron de verdad durante siglos, qué "maldición" fue una enfermedad y qué dios era un espíritu real ([chronicle.md](chronicle.md): lo que nunca supiste).


## Implementación
- **Fase 4 (cultivo):** almas, muerte con ancla, resentidos y asuntos pendientes, percepción de espíritus.
- **Fase 6-7:** remanentes, espíritus de objeto, cultivo de almas, zonas malditas en la historia.
- **Fase 3 (economía):** ofrendas como lotes con destino (sumidero, transferencia, entierro), oficios de culto, gasto de funerales.
- **Fase 4 (cultivo):** `qiPool` de santuarios, devoción con sinceridad, balance de qi de espíritus (`upkeep`), ancestros que se quedan.
- **Fase 6 (sociedad):** salones ancestrales, tablillas, tierras de culto como compromiso, abandono y sus etapas, fantasmas hambrientos, culpa y cara.
- **Fase 7 (historia):** cultos fundados por eventos, santuarios viejos que despiertan espíritus de lugar, ajuar enterrado para la arqueología.
- **Fase 8:** espíritus de lugar con facciones, cultos y religiones locales, dioses que compiten por fieles, canonización y prohibición por el estado.

## Tests
- Ningún espíritu sin `originEventId` ni `anchor`.
- Conservación: el qi de un espíritu sale del entorno y vuelve al desvanecerse.
- Cumplir el objetivo ancla libera al espíritu.
- Ledger de ofrendas: el qi de cada rito (bienes quemados más devoción) termina en un espíritu, en el `qiPool` o en el ambiente; los bienes quemados desaparecen, los enterrados siguen existiendo y la comida se transfiere.
- Ninguna ofrenda llega a un alma que está en el ciclo o reencarnada.
- Un rito sin sinceridad aporta (casi) cero devoción.
- Escenario controlado: un ancestro real cuyo linaje deja de ofrendar pasa por hambre y, sin reconciliación, termina apagado, hambriento o resentido; con ofrendas retomadas, se reconcilia.
- Un santuario sin ocupante no produce ningún efecto sobrenatural; sí cambia creencias, cohesión y gasto.
- Determinismo: mismo seed → mismos ritos, mismos balances de qi y mismos desenlaces de abandono.

## Decisiones (2026-10-05)
- **Sin tiempo fijo en las Fuentes.** Hay un mínimo de 49 días (el tránsito, 中阴) y después el alma espera a que se **conciba un cuerpo** en el mundo: nadie renace sin una concepción real (causalidad). Las almas fuertes resisten la atracción y pueden esperar un cuerpo mejor (más afín, mejor linaje, cerca de lo que las ata); las débiles caen en la primera concepción disponible. Si hay pocas concepciones (despoblamiento, guerra), las almas se acumulan y la espera se alarga.

## Decisiones tomadas en el borrador de ofrendas (2026-10-06, revisables)
- **Las ofrendas no alcanzan a las almas del ciclo ni a las reencarnadas.** Solo las recibe un espíritu real anclado al santuario; si no hay nadie, el efecto es sobre los vivos.
- **La devoción gasta una cantidad minúscula del qi vital del que reza**, según su sinceridad, y se conserva; la fe no crea esencia en la familia xianxia.
- **Un santuario acumula qi** y, tras siglos vacío, puede despertar un espíritu de lugar con la personalidad de las intenciones de los fieles.
- **El abandono de un ancestro real es una presión con etapas** (hambre, enojo, tomar de los vivos) y cuatro desenlaces: apagarse, fantasma hambriento, resentido o reconciliación.

## Preguntas abiertas
- Calibración: cuánto qi aporta un fiel sincero; ritmo de fuga del `qiPool` según el estado del edificio; cuántos siglos hacen falta para que un santuario despierte un espíritu; `upkeep` de un espíritu por tipo, lugar y hora.
- Otras: ninguna por ahora (cultivo de espíritus y volver a tener cuerpo: [cultivation.md](cultivation.md) §14).
