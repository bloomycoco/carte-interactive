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
  cartel: [
    "Corvette du Cartel",
    "Canonnière Trandoshane",
    "Yacht de Jabba",
    "Croiseur Pyke",
    "Intercepteur mercenaire",
    "Patrouilleur Nikto",
  ],
};

// Puissance de combat indicative par classe (gabarit/armement approximatifs).
// Sert à calculer la force d'une flotte : plus il y a de vaisseaux, et
// plus ils sont puissants, plus la flotte est forte.
export const SHIP_CLASS_POWER: Record<string, number> = {
  Consular: 3,
  "Pelta-Class": 2,
  Arquitens: 5,
  Acclamator: 7,
  Venator: 10,
  "Victory I": 9,
  "Providence (capturé)": 10,
  Providence: 10,
  Recusant: 6,
  Munificent: 6,
  Lucrehulk: 9,
  Subjugator: 12,
  Diamond: 4,
  Hardcell: 3,
  "Kom'rk": 4,
  Gauntlet: 2,
  Basilisk: 5,
  "Jehavey'ir": 6,
  "Corvette Mandalorienne": 5,
  "Corvette du Cartel": 4,
  "Canonnière Trandoshane": 3,
  "Yacht de Jabba": 5,
  "Croiseur Pyke": 6,
  "Intercepteur mercenaire": 3,
  "Patrouilleur Nikto": 3,
};

// Vaisseau sans classe définie : puissance de base modeste.
export const DEFAULT_SHIP_POWER = 3;

export function shipPower(category: string | null): number {
  if (!category) return DEFAULT_SHIP_POWER;
  return SHIP_CLASS_POWER[category] ?? DEFAULT_SHIP_POWER;
}

// Force totale d'une flotte : somme de la puissance de ses vaisseaux,
// modulée par son expérience de combat (victoires/défaites passées).
// Une flotte qui gagne beaucoup devient donc plus forte au fil du temps.
export function fleetStrength(
  ships: { category: string | null }[],
  kills: number,
  losses: number,
) {
  const base = ships.reduce((sum, s) => sum + shipPower(s.category), 0) || DEFAULT_SHIP_POWER;
  const experience = Math.max(0.5, Math.min(3, 1 + kills * 0.05 - losses * 0.02));
  return base * experience;
}
