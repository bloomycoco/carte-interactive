// Maths de déplacement des vaisseaux — sans dépendance Node, utilisable
// aussi bien côté serveur (routes API) que côté client (interpolation
// visuelle en temps réel sur la carte). Les vaisseaux suivent le réseau
// de routes (voir lib/routes.ts), jamais une ligne droite.

export type Faction = "republique" | "csi" | "mandalore";

// Unités-monde par seconde. La carte fait 5460x3460 : la traverser en
// entier prend un peu plus de 2 minutes.
export const SHIP_SPEED = 45;
export const MIN_TRAVEL_SECONDS = 8;

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
};

// Un vaisseau tel que renseigné sur la carte publique — pas de code ici,
// ni de flotte (le rattachement n'a d'intérêt que côté admin/déverrouillage).
export type PublicShip = ShipTravelState & {
  id: string;
  name: string;
  category: string | null;
  faction: Faction;
  dest_planet: string | null;
};

// Une flotte "déverrouillée" côté navigateur avec son code : donne accès
// à la liste de ses vaisseaux et leur statut, mais pas le contrôle.
export type UnlockedFleet = {
  id: string;
  code: string;
  name: string;
  faction: Faction;
  ships: { id: string; name: string; dest_planet: string | null }[];
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
    return { x: s.x, y: s.y, traveling: false as const };
  }
  const start = new Date(s.departed_at).getTime();
  const end = new Date(s.arrival_at).getTime();
  if (now >= end) return { x: s.dest_x, y: s.dest_y, traveling: false as const };

  const t = Math.max(0, (now - start) / Math.max(1, end - start));
  const points: Waypoint[] =
    s.path && s.path.length >= 2 ? s.path : [{ x: s.x, y: s.y }, { x: s.dest_x, y: s.dest_y }];

  const total = pathLength(points);
  if (total === 0) return { x: points[points.length - 1].x, y: points[points.length - 1].y, traveling: true as const };

  let target = total * t;
  for (let i = 1; i < points.length; i++) {
    const segLen = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (target <= segLen || i === points.length - 1) {
      const segT = segLen === 0 ? 1 : Math.min(1, target / segLen);
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * segT,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * segT,
        traveling: true as const,
      };
    }
    target -= segLen;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, traveling: true as const };
}

// Planifie un trajet le long d'un chemin (liste de points, départ réel
// inclus) : la durée dépend de la longueur RÉELLE du chemin, pas de la
// distance à vol d'oiseau — plus c'est loin par les routes, plus c'est long.
export function planTravelAlongPath(points: Waypoint[]) {
  const total = pathLength(points);
  const seconds = Math.max(MIN_TRAVEL_SECONDS, total / SHIP_SPEED);
  const departedAt = new Date();
  const arrivalAt = new Date(departedAt.getTime() + seconds * 1000);
  return { departedAt, arrivalAt };
}
