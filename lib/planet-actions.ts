import type { Faction as PlanetFaction } from "./planets";
import type { Faction as ShipFaction } from "./fleet-motion";

// Action disponible pour un vaisseau IDLE sur une planète, selon le
// clan de la planète et celui du vaisseau :
// - monde neutre -> aide humanitaire, déclenchée par le joueur, instantanée
// - monde d'un clan ennemi -> propagation d'influence, déclenchée par le
//   joueur, immobilise le vaisseau 15 min
// - monde du Cartel -> pas d'action volontaire, mais 50% de risque d'être
//   saisi par le Cartel à l'arrivée (immobilisé 20 min) — voir
//   ROLL_SEIZURE_CHANCE côté serveur (lib/fleets.ts)
export type PlanetAction = "humanitarian" | "influence";

export const INFLUENCE_DURATION_SECONDS = 15 * 60;
export const SEIZURE_DURATION_SECONDS = 20 * 60;

export function availablePlanetAction(
  planetFaction: PlanetFaction,
  shipFaction: ShipFaction,
): PlanetAction | null {
  if (planetFaction === "neutre") return "humanitarian";
  if (planetFaction === "cartel") return null;
  if (planetFaction === "republique" || planetFaction === "csi" || planetFaction === "mandalore") {
    return planetFaction !== shipFaction ? "influence" : null;
  }
  return null;
}

export const ACTION_LABEL: Record<PlanetAction | "seized", string> = {
  humanitarian: "Aide humanitaire",
  influence: "Répandre l'influence",
  seized: "Saisi par le Cartel",
};
