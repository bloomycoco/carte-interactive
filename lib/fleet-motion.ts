// Maths de déplacement des vaisseaux — sans dépendance Node, utilisable
// aussi bien côté serveur (routes API) que côté client (interpolation
// visuelle en temps réel sur la carte). Les vaisseaux suivent le réseau
// de routes (voir lib/routes.ts), jamais une ligne droite.

export type Faction = "republique" | "csi" | "mandalore" | "cartel";

// Unités-monde par seconde. La carte fait 5460x3460 : la traverser en
// entier prend environ 9 minutes ; un petit saut entre systèmes voisins
// prend au moins une minute (MIN_TRAVEL_SECONDS) — les trajets sont
// volontairement longs.
export const SHIP_SPEED = 10;
export const MIN_TRAVEL_SECONDS = 60;

export type Waypoint = { x: number; y: number };

export type ShipTravelState = {
  x: number;
  y: number;
  dest_x: number | null;
  dest_y: number | null;
  departed_at: string | null;
  arrival_at: string | null;
  // chemin suivi (départ réel -> ... -> destination), via le réseau de
  // routes. Null/absent = ancien trajet en ligne droite (rétrocompat).
  path?: Waypoint[] | null;
  // rencontre aléatoire en cours de route : le vaisseau se fige à
  // encounter_at tant qu'elle n'est pas résolue (combattre / fuir). Le
  // % de chances de victoire est calculé et annoncé dès la programmation
  // de la rencontre, pour que le joueur sache à quoi s'attendre.
  encounter_pending?: boolean;
  encounter_at?: string | null;
  encounter_win_chance?: number | null;
  // clan de la flotte NPC croisée, pour l'affichage ("vous croisez une
  // flotte du Cartel !")
  encounter_enemy_faction?: Faction | null;
  // "transit" : croisement en plein vol (Combattre/Négocier/Fuir).
  // "ground" : les deux flottes posées sur la même planète
  // (Combattre/Tenter de passer inaperçu/Fuir). "chase" : le joueur a
  // délibérément pris le NPC en chasse (Combattre/Négocier/Fuir, comme
  // "transit", mais fuir replie vers Kuat comme "ground").
  encounter_kind?: "transit" | "ground" | "chase" | null;
  // poursuite en cours (voir POST /api/ships/[id]/chase) : id du
  // vaisseau NPC visé, tant qu'il n'a pas été rattrapé (ni abandonné).
  // Ne fige rien à lui seul — c'est le tick de GET /api/ships qui
  // réoriente le trajet vers la cible et déclenche la rencontre une
  // fois assez proche.
  chase_target_id?: string | null;
  // action en cours à la surface d'une planète (saisie par le Cartel) :
  // le vaisseau est immobilisé entre action_started_at et action_ends_at
  // (une saisie est programmée dès le départ mais ne commence qu'à
  // l'arrivée). Attaquer une planète, en comparaison, se résout
  // immédiatement — pas d'immobilisation, donc pas besoin de ces champs.
  action_type?: "seized" | null;
  action_started_at?: string | null;
  action_ends_at?: string | null;
  // quête d'aide humanitaire en cours (monde neutre) : le vaisseau va
  // chercher des vivres sur quest_target_planet (phase "fetching") puis
  // les ramener sur quest_origin_planet (phase "returning") — le trajet
  // lui-même utilise dest_planet/path/departed_at/arrival_at comme
  // n'importe quel ordre normal, ces champs ne font que le qualifier.
  quest_type?: "humanitarian" | null;
  quest_origin_planet?: string | null;
  quest_target_planet?: string | null;
  quest_phase?: "fetching" | "returning" | null;
};

// Vrai si une action de surface (saisie) est active MAINTENANT — pas
// simplement programmée pour plus tard (cas d'une saisie promise à
// l'arrivée, tant que le vaisseau n'y est pas encore).
export function isActionActive(s: ShipTravelState, now = Date.now()) {
  if (!s.action_started_at || !s.action_ends_at) return false;
  const start = new Date(s.action_started_at).getTime();
  const end = new Date(s.action_ends_at).getTime();
  return start <= now && now < end;
}

// Un vaisseau tel que renseigné sur la carte publique — pas de code ici
// (le contrôle n'a d'intérêt que côté déverrouillage). fleet_id sert à
// savoir si toute une flotte est rassemblée quelque part (ex: attaquer
// une planète), pas à afficher quoi que ce soit de sensible.
export type PublicShip = ShipTravelState & {
  id: string;
  fleet_id: string;
  name: string;
  category: string | null;
  faction: Faction;
  is_npc: boolean;
  dest_planet: string | null;
  damaged: boolean;
  chase_target_id: string | null;
};

// Une flotte "déverrouillée" côté navigateur avec son code : donne accès
// à la liste de ses vaisseaux et leur statut, mais pas le contrôle.
export type UnlockedFleet = {
  id: string;
  code: string;
  name: string;
  faction: Faction;
  kills: number;
  losses: number;
  strength: number;
  ships: { id: string; name: string; dest_planet: string | null }[];
};

// Une flotte déverrouillée avec son code CAPITAINE : donne le droit
// d'envoyer TOUTE la flotte quelque part en un ordre (distinct du code de
// flotte, lecture seule, et du code de chaque vaisseau, individuel).
export type UnlockedCaptainFleet = {
  id: string;
  code: string;
  name: string;
  faction: Faction;
  strength: number;
};

// Un vaisseau "déverrouillé" côté navigateur avec son propre code : donne
// le contrôle (peut recevoir des ordres).
export type UnlockedShip = {
  id: string;
  code: string;
  name: string;
  faction: Faction;
  fleetName: string;
};

function pathLength(points: Waypoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

// Position actuelle d'un vaisseau : interpolée le long de son chemin
// (path) si un trajet est en cours, sinon la position au repos. La
// fraction de temps écoulé égale exactement la fraction de distance
// parcourue puisque la vitesse est constante — pas besoin d'horodater
// chaque segment.
export function currentPosition(s: ShipTravelState, now = Date.now()) {
  if (s.dest_x == null || s.dest_y == null || !s.departed_at || !s.arrival_at) {
    // une rencontre au sol peut figer un vaisseau À QUAI (pas seulement
    // en plein vol) — toujours signaler "stuck" pour l'affichage
    const stuck = !!(s.encounter_pending && s.encounter_at && now >= new Date(s.encounter_at).getTime());
    return { x: s.x, y: s.y, traveling: false as const, stuck };
  }
  const start = new Date(s.departed_at).getTime();
  const end = new Date(s.arrival_at).getTime();

  // une rencontre non résolue fige le vaisseau à sa position au moment
  // où elle a eu lieu, tant que le joueur n'a pas choisi combattre/fuir
  let effectiveNow = now;
  let stuck = false;
  if (s.encounter_pending && s.encounter_at) {
    const encAt = new Date(s.encounter_at).getTime();
    if (now >= encAt) {
      effectiveNow = encAt;
      stuck = true;
    }
  }

  if (!stuck && effectiveNow >= end) {
    return { x: s.dest_x, y: s.dest_y, traveling: false as const, stuck: false as const };
  }

  const t = Math.max(0, (effectiveNow - start) / Math.max(1, end - start));
  const points: Waypoint[] =
    s.path && s.path.length >= 2 ? s.path : [{ x: s.x, y: s.y }, { x: s.dest_x, y: s.dest_y }];

  const total = pathLength(points);
  if (total === 0) {
    return { x: points[points.length - 1].x, y: points[points.length - 1].y, traveling: true as const, stuck };
  }

  let target = total * t;
  for (let i = 1; i < points.length; i++) {
    const segLen = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (target <= segLen || i === points.length - 1) {
      const segT = segLen === 0 ? 1 : Math.min(1, target / segLen);
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * segT,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * segT,
        traveling: true as const,
        stuck,
      };
    }
    target -= segLen;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, traveling: true as const, stuck };
}

// Planifie un trajet le long d'un chemin (liste de points, départ réel
// inclus) : la durée dépend de la longueur RÉELLE du chemin, pas de la
// distance à vol d'oiseau — plus c'est loin par les routes, plus c'est long.
// speedMultiplier > 1 accélère le trajet (le plancher MIN_TRAVEL_SECONDS
// est réduit d'autant, sinon un boost ne changerait rien aux petits
// sauts) — utilisé pour la poursuite d'un NPC (voir CHASE_SPEED_MULTIPLIER).
export function planTravelAlongPath(points: Waypoint[], speedMultiplier = 1) {
  const total = pathLength(points);
  const seconds = Math.max(MIN_TRAVEL_SECONDS / speedMultiplier, total / (SHIP_SPEED * speedMultiplier));
  const departedAt = new Date();
  const arrivalAt = new Date(departedAt.getTime() + seconds * 1000);
  return { departedAt, arrivalAt };
}
