import type { Faction } from "./fleet-motion";

// Classes de vaisseaux par clan, ère des Guerres des Clones. Liste
// indicative proposée à la création — le champ reste un texte libre en
// base, donc rien n'empêche d'en taper une autre.
export const SHIP_CLASSES: Record<Faction, string[]> = {
  republique: [
    "Consular",
    "Pelta-Class",
    "Arquitens",
    "Acclamator",
    "Venator",
    "Victory I",
    "Providence (capturé)",
  ],
  csi: [
    "Providence",
    "Recusant",
    "Munificent",
    "Lucrehulk",
    "Subjugator",
    "Diamond",
    "Hardcell",
  ],
  mandalore: ["Kom'rk", "Gauntlet", "Basilisk", "Jehavey'ir", "Corvette Mandalorienne"],
};
