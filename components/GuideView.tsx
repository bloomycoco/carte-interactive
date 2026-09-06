import Link from "next/link";
import styles from "./GuideView.module.css";

const FACTIONS = [
  {
    key: "republique",
    name: "République",
    tag: "camp jouable",
    color: "var(--republic)",
    text: "Le camp des joueurs. Capitale Coruscant. Sa force ne se mesure pas flotte par flotte : tous les vaisseaux République réunis au même endroit comptent ensemble, que ce soit pour se défendre ou pour assiéger un monde ennemi.",
  },
  {
    key: "csi",
    name: "Confédération des Systèmes Indépendants",
    tag: "ennemi principal",
    color: "var(--separatist)",
    text: "Seule cible des sièges de planète. Ne négocie et ne pactise jamais : toute rencontre avec une patrouille CSI qui tourne mal se règle au canon. Reprend ses mondes contestés dès que la République y gagne trop de terrain.",
  },
  {
    key: "mandalore",
    name: "Mandalore / Death Watch",
    tag: "territoire contesté",
    color: "var(--mandalore)",
    text: "Deuxième cible des sièges de planète. Comme la CSI, un monde mandalorien repris par la République reste fragile : Mandalore peut lancer une contre-offensive et reprendre l'essentiel du terrain perdu.",
  },
  {
    key: "cartel",
    name: "Cartel du Hutt",
    tag: "hors de portée",
    color: "var(--cartel)",
    text: "On n'assiège pas un monde du Cartel, on essaie juste d'y survivre. Tout vaisseau qui s'y pose risque une saisie pure et simple, sans aucun moyen de s'y soustraire.",
  },
  {
    key: "neutre",
    name: "Mondes neutres",
    tag: "terrain humanitaire",
    color: "var(--neutral)",
    text: "Aucun camp, aucun combat. Ce sont les seuls mondes où une flotte peut se rendre utile sans tirer un coup de feu, via l'aide humanitaire.",
  },
] as const;

const TOC = [
  { id: "contexte", label: "Le contexte" },
  { id: "camps", label: "Les quatre camps" },
  { id: "carte", label: "Naviguer sur la carte" },
  { id: "controle", label: "Prendre le contrôle d'une flotte" },
  { id: "deplacement", label: "Déplacer ses vaisseaux" },
  { id: "rencontres", label: "Les rencontres aléatoires" },
  { id: "sieges", label: "Assiéger une planète" },
  { id: "cartel", label: "Le Cartel : la saisie" },
  { id: "humanitaire", label: "Aide humanitaire" },
  { id: "kuat", label: "Kuat, chantier de réparation" },
  { id: "conseils", label: "Conseils de commandant" },
] as const;

export default function GuideView() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.eyebrow}>Atlas Galactique</span>
          <h1>Guide du Commandant</h1>
        </div>
        <Link href="/" className={styles.backLink}>
          ← Retour à la carte
        </Link>
      </header>

      <div className={styles.hero}>
        <p>
          Tout ce qu&apos;il faut savoir pour mener une flotte à travers la galaxie à l&apos;ère des
          Guerres des Clones : les camps en présence, comment se déplacer et combattre, et
          comment faire basculer une planète du bon côté.
        </p>
      </div>

      <div className={styles.layout}>
        <nav className={styles.toc} aria-label="Sommaire">
          <div className={styles.tocLabel}>Sommaire</div>
          <ul>
            {TOC.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`}>{t.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <main className={styles.content}>
          <section id="contexte" className={styles.section}>
            <h2>Le contexte</h2>
            <p>
              La carte représente la galaxie au plus fort des Guerres des Clones. Chaque
              système est sous l&apos;influence d&apos;un camp : République, Confédération, Mandalore,
              Cartel du Hutt, ou aucun. Chaque joueur reçoit le contrôle d&apos;une ou plusieurs
              flottes républicaines : les faire vivre, les déplacer entre les systèmes, les
              engager au combat, et grignoter du terrain sur les mondes ennemis.
            </p>
          </section>

          <section id="camps" className={styles.section}>
            <h2>Les quatre camps</h2>
            <div className={styles.factionGrid}>
              {FACTIONS.map((f) => (
                <div key={f.key} className={styles.factionCard} style={{ ["--fc" as string]: f.color }}>
                  <div className={styles.factionHead}>
                    <span className={styles.swatch} />
                    <span className={styles.factionName}>{f.name}</span>
                  </div>
                  <div className={styles.factionTag}>{f.tag}</div>
                  <p>{f.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="carte" className={styles.section}>
            <h2>Naviguer sur la carte</h2>
            <ul className={styles.rules}>
              <li>Molette (ou pincement) pour zoomer, glisser pour se déplacer.</li>
              <li>Le bouton <strong>Recentrer</strong> ramène la vue par défaut.</li>
              <li>
                Les puces de camp en haut permettent de masquer/afficher un territoire pour
                mieux s&apos;y retrouver.
              </li>
              <li>
                La barre de recherche trouve n&apos;importe quel système par son nom.
              </li>
              <li>
                Cliquer sur une planète ouvre sa fiche : description, camp, et flottes
                présentes.
              </li>
            </ul>
          </section>

          <section id="controle" className={styles.section}>
            <h2>Prendre le contrôle d&apos;une flotte</h2>
            <p>
              Chaque flotte et chaque vaisseau a son propre code secret, distribué par le
              maître de partie. Le bouton <strong>Mes Flottes</strong>, en haut de l&apos;écran,
              ouvre un champ « Code de flotte ou de vaisseau » où l&apos;entrer.
            </p>
            <ul className={styles.rules}>
              <li><strong>Code de flotte</strong> : lecture seule, consulter la liste des vaisseaux et leur statut.</li>
              <li><strong>Code Capitaine</strong> : donne un ordre à toute la flotte d&apos;un coup (regroupement, cap commun).</li>
              <li><strong>Code de vaisseau</strong> : contrôle direct d&apos;un seul vaisseau, déplacement, actions au sol, décisions de combat.</li>
            </ul>
            <p>
              Une fois déverrouillé, l&apos;accès reste mémorisé dans le navigateur, pas besoin de
              ressaisir le code à chaque visite.
            </p>
          </section>

          <section id="deplacement" className={styles.section}>
            <h2>Déplacer ses vaisseaux</h2>
            <p>
              Un vaisseau ou une flotte déverrouillé(e) peut recevoir une destination sur la
              carte. Le trajet suit le réseau de routes commerciales, jamais une ligne droite :
              sa durée dépend de la distance réellement parcourue, avec un minimum d&apos;une
              minute même pour un saut entre systèmes voisins.
            </p>
            <p>
              Un vaisseau <strong>endommagé</strong> ne peut recevoir qu&apos;un seul ordre : rallier
              Kuat pour s&apos;y faire réparer (voir plus bas).
            </p>
          </section>

          <section id="rencontres" className={styles.section}>
            <h2>Les rencontres aléatoires</h2>
            <p>
              Croiser une patrouille adverse déclenche une rencontre. Les chances de victoire
              sont annoncées à l&apos;avance, calculées sur la force réellement rassemblée sur
              place : des vaisseaux physiquement regroupés combattent mieux qu&apos;isolés.
            </p>
            <ul className={styles.rules}>
              <li>
                <strong>En plein vol</strong> : Combattre / Négocier / Fuir. Négocier passe
                souvent sans combat (sauf face à la CSI, qui ne négocie jamais) ; en cas
                d&apos;échec, le combat s&apos;engage quand même. Fuir réussit toujours, sans dégât, et
                fait rebrousser chemin.
              </li>
              <li>
                <strong>Au sol</strong> (une flotte République et une patrouille CSI posées sur
                la même planète) : Combattre / Tenter de passer inaperçu / Fuir. Fuir replie
                directement vers Kuat.
              </li>
              <li>
                <strong>En chasse</strong> : prendre délibérément un NPC en chasse le
                rattrape plus vite ; une fois rattrapé, mêmes choix qu&apos;en plein vol, mais fuir
                replie vers Kuat comme au sol.
              </li>
            </ul>
            <p>
              Une défaite endommage le vaisseau et le renvoie se faire réparer à Kuat. Une
              victoire détruit toute la patrouille ennemie d&apos;un coup, elle réapparaît sur son
              propre territoire quelques minutes plus tard.
            </p>
          </section>

          <section id="sieges" className={styles.section}>
            <h2>Assiéger une planète</h2>
            <p>
              Sur un monde CSI ou mandalorien, un vaisseau République inoccupé peut lancer
              <strong> Attaquer la planète</strong>. Ce n&apos;est pas l&apos;affaire d&apos;une seule flotte :
              <strong> tous</strong> les vaisseaux République présents sur place, quelle que
              soit leur flotte, unissent leur force.
            </p>
            <ul className={styles.rules}>
              <li>Il faut au moins <strong>4 vaisseaux</strong> réunis pour tenter le siège, sinon l&apos;échec est assuré.</li>
              <li>Une capitale en exige <strong>10</strong>, quasiment imprenable.</li>
              <li>
                Victoire : chaque flotte présente gagne un combat remporté, et la planète
                gagne <strong>7 points d&apos;influence République</strong> (visible à une teinte
                bleutée dès qu&apos;elle dépasse 50 %).
              </li>
              <li>
                Défaite : seul le vaisseau qui a lancé l&apos;attaque est endommagé et renvoyé à
                Kuat ; chaque flotte présente encaisse une défaite.
              </li>
            </ul>
            <p className={styles.callout}>
              Attention à la reconquête : dès que l&apos;influence République dépasse 10 % sur un
              monde CSI ou mandalorien, le camp local peut lancer une contre-attaque (annoncée
              quelques secondes à l&apos;avance) qui reprend d&apos;un coup une grande partie du terrain
              gagné.
            </p>
          </section>

          <section id="cartel" className={styles.section}>
            <h2>Le Cartel : la saisie</h2>
            <p>
              Aucun siège n&apos;est possible sur un monde du Cartel du Hutt. En revanche, tout
              vaisseau qui s&apos;y pose court un risque de <strong>50 %</strong> d&apos;être saisi et
              immobilisé pendant 20 minutes : aucune décision du joueur ne peut l&apos;éviter, il
              n&apos;y a qu&apos;à attendre que ça passe.
            </p>
          </section>

          <section id="humanitaire" className={styles.section}>
            <h2>Aide humanitaire</h2>
            <p>
              Sur un monde neutre, un vaisseau inoccupé peut se voir confier une quête d&apos;aide
              humanitaire : aller chercher des vivres sur une planète tirée au sort (toujours
              lointaine) puis les ramener sur place. Aucun combat en jeu, purement narratif.
            </p>
          </section>

          <section id="kuat" className={styles.section}>
            <h2>Kuat, chantier de réparation</h2>
            <p>
              Kuat est un monde République, siège des chantiers Kuat Drive Yards. Tout
              vaisseau endommagé (à la suite d&apos;une défaite) y est automatiquement renvoyé.
              Une fois posé et immobile à Kuat, le prochain ordre donné au vaisseau le répare
              avant de repartir.
            </p>
          </section>

          <section id="conseils" className={styles.section}>
            <h2>Conseils de commandant</h2>
            <ul className={styles.rules}>
              <li>Se regrouper avant d&apos;engager le combat : la coordination physique compte plus que le nombre dispersé.</li>
              <li>Ne jamais négocier avec la CSI : l&apos;option n&apos;existe même pas, autant s&apos;y préparer.</li>
              <li>Surveiller les mondes tout juste repris : une contre-attaque guette dès 10 % d&apos;influence.</li>
              <li>Éviter d&apos;envoyer un vaisseau précieux sur un monde du Cartel si on ne peut pas se permettre 20 minutes d&apos;immobilisation.</li>
              <li>Un vaisseau endommagé ne sert plus à rien tant qu&apos;il n&apos;est pas reparti de Kuat.</li>
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}
