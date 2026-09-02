// Maths de déplacement des vaisseaux — sans dépendance Node, utilisable
// aussi bien côté serveur (routes API) que côté client (interpolation
// visuelle en temps réel sur la carte).

export type Faction = "republique" | "csi" | "mandalore";

// Unités-monde par seconde. La carte fait 5460x3460 : la traverser en
// entier prend un peu plus de 2 minutes.
export const SHIP_SPEED = 45;
export const MIN_TRAVEL_SECONDS = 8;

export type ShipTravelState = {
  x: number;
  y: number;
  dest_x: number | null;
  dest_y: number | null;
  departed_at: string | null;
  arrival_at: string | null;
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

// Position actuelle d'un vaisseau : interpolée entre (x,y) et
// (dest_x,dest_y) si un trajet est en cours, sinon la position au repos.
export function currentPosition(s: ShipTravelState, now = Date.now()) {
  if (s.dest_x == null || s.dest_y == null || !s.departed_at || !s.arrival_at) {
    return { x: s.x, y: s.y, traveling: false as const };
  }
  const start = new Date(s.departed_at).getTime();
  const end = new Date(s.arrival_at).getTime();
  if (now >= end) return { x: s.dest_x, y: s.dest_y, traveling: false as const };
  const t = Math.max(0, (now - start) / Math.max(1, end - start));
  return {
    x: s.x + (s.dest_x - s.x) * t,
    y: s.y + (s.dest_y - s.y) * t,
    traveling: true as const,
  };
}

export function planTravel(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const seconds = Math.max(MIN_TRAVEL_SECONDS, dist / SHIP_SPEED);
  const departedAt = new Date();
  const arrivalAt = new Date(departedAt.getTime() + seconds * 1000);
  return { departedAt, arrivalAt };
}
