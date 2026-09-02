// Maths de déplacement des flottes — sans dépendance Node, utilisable
// aussi bien côté serveur (routes API) que côté client (interpolation
// visuelle en temps réel sur la carte).

export type Faction = "republique" | "csi" | "mandalore";

// Unités-monde par seconde. La carte fait 5460x3460 : la traverser en
// entier prend un peu plus de 2 minutes.
export const FLEET_SPEED = 45;
export const MIN_TRAVEL_SECONDS = 8;

export type FleetTravelState = {
  x: number;
  y: number;
  dest_x: number | null;
  dest_y: number | null;
  departed_at: string | null;
  arrival_at: string | null;
};

export type PublicFleet = FleetTravelState & {
  id: string;
  name: string;
  faction: Faction;
  dest_planet: string | null;
};

// Une flotte "déverrouillée" côté navigateur : son code est mémorisé en
// local pour lui donner des ordres sans le retaper à chaque fois.
export type UnlockedFleet = {
  id: string;
  code: string;
  name: string;
  faction: Faction;
};

// Position actuelle d'une flotte : interpolée entre (x,y) et (dest_x,dest_y)
// si un trajet est en cours, sinon la position au repos.
export function currentPosition(f: FleetTravelState, now = Date.now()) {
  if (f.dest_x == null || f.dest_y == null || !f.departed_at || !f.arrival_at) {
    return { x: f.x, y: f.y, traveling: false as const };
  }
  const start = new Date(f.departed_at).getTime();
  const end = new Date(f.arrival_at).getTime();
  if (now >= end) return { x: f.dest_x, y: f.dest_y, traveling: false as const };
  const t = Math.max(0, (now - start) / Math.max(1, end - start));
  return {
    x: f.x + (f.dest_x - f.x) * t,
    y: f.y + (f.dest_y - f.y) * t,
    traveling: true as const,
  };
}

export function planTravel(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const seconds = Math.max(MIN_TRAVEL_SECONDS, dist / FLEET_SPEED);
  const departedAt = new Date();
  const arrivalAt = new Date(departedAt.getTime() + seconds * 1000);
  return { departedAt, arrivalAt };
}
