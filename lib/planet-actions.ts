import type { Faction as PlanetFaction } from "./planets";
import type { Faction as ShipFaction } from "./fleet-motion";

// Action disponible pour un vaisseau IDLE sur une planète, selon le
// clan de la planète et celui du vaisseau :
// - monde neutre -> aide humanitaire : déclenche une quête (aller
//   chercher des vivres sur une planète tirée au sort, toujours
//   lointaine, puis les ramener) — voir HumanitarianQuest ci-dessous
// - monde d'un clan ennemi -> attaquer la planète : résolu
//   immédiatement (pas d'immobilisation), voir POST /api/ships/[id]/action
// - monde du Cartel -> pas d'action volontaire, mais 50% de risque d'être
//   saisi par le Cartel à l'arrivée (immobilisé 20 min) — voir
//   ROLL_SEIZURE_CHANCE côté serveur (lib/fleets.ts)
export type PlanetAction = "humanitarian" | "attack" | "humanitarian_pickup" | "humanitarian_deliver";

export const SEIZURE_DURATION_SECONDS = 20 * 60;

// État de la quête d'aide humanitaire en cours pour un vaisseau, tel que
// stocké sur la ligne `ships` (quest_type/quest_origin_planet/
// quest_target_planet/quest_phase) — null si aucune quête en cours.
export type HumanitarianQuest = {
  originPlanet: string;
  targetPlanet: string;
  phase: "fetching" | "returning";
} | null;

export function availablePlanetAction(
  planetName: string,
  planetFaction: PlanetFaction,
  shipFaction: ShipFaction,
  quest: HumanitarianQuest = null,
): PlanetAction | null {
  if (quest) {
    if (quest.phase === "fetching" && planetName === quest.targetPlanet) return "humanitarian_pickup";
    if (quest.phase === "returning" && planetName === quest.originPlanet) return "humanitarian_deliver";
    return null;
  }
  if (planetFaction === "neutre") return "humanitarian";
  if (planetFaction === "cartel") return null;
  if (planetFaction === "republique" || planetFaction === "csi" || planetFaction === "mandalore") {
    return planetFaction !== shipFaction ? "attack" : null;
  }
  return null;
}

export const ACTION_LABEL: Record<PlanetAction | "seized", string> = {
  humanitarian: "Aide humanitaire",
  humanitarian_pickup: "Récupérer les vivres",
  humanitarian_deliver: "Livrer l'aide humanitaire",
  attack: "Attaquer la planète",
  seized: "Saisi par le Cartel",
};
