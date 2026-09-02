// Réexporte les maths de déplacement (voir lib/fleet-motion.ts, sans
// dépendance Node) et ajoute la génération de code, qui a besoin de
// crypto — ce fichier est donc réservé au serveur.
import crypto from "node:crypto";
import { currentPosition, type Waypoint } from "./fleet-motion";

export * from "./fleet-motion";

// Alphabet sans caractères ambigus (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateCode(length = 6) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

function randomFraction() {
  // [0, 1) avec une bonne source d'aléa
  return crypto.randomInt(1_000_000) / 1_000_000;
}

// En dessous de cette durée de trajet, jamais de rencontre (les petits
// sauts entre voisins restent tranquilles).
const ENCOUNTER_MIN_TRAVEL_SECONDS = 90;
// Probabilité qu'un trajet assez long déclenche une rencontre.
const ENCOUNTER_CHANCE = 0.3;
// Force ennemie aléatoire (min/max) : comparable à une flotte modeste
// de 1 à 2 vaisseaux moyens, pour que les chances restent disputées.
const ENEMY_STRENGTH_MIN = 4;
const ENEMY_STRENGTH_MAX = 16;

// Tire au sort si une flotte ennemie sera croisée sur ce trajet et, si
// oui, à quel moment (quelque part entre 20% et 80% du chemin — jamais
// pile au départ ou à l'arrivée).
export function maybeScheduleEncounter(departedAt: Date, arrivalAt: Date): { encounterAt: Date } | null {
  const durationSeconds = (arrivalAt.getTime() - departedAt.getTime()) / 1000;
  if (durationSeconds < ENCOUNTER_MIN_TRAVEL_SECONDS) return null;
  if (randomFraction() >= ENCOUNTER_CHANCE) return null;

  const frac = 0.2 + randomFraction() * 0.6;
  const encounterAt = new Date(departedAt.getTime() + (arrivalAt.getTime() - departedAt.getTime()) * frac);
  return { encounterAt };
}

// Tire au sort la force de la flotte ennemie croisée et en déduit un %
// de chances de victoire (ratio de forces) — affiché au joueur avant
// qu'il ne choisisse de combattre ou fuir.
export function rollEncounterOdds(friendlyStrength: number) {
  const enemyStrength = ENEMY_STRENGTH_MIN + randomFraction() * (ENEMY_STRENGTH_MAX - ENEMY_STRENGTH_MIN);
  const winChancePercent = Math.round((friendlyStrength / (friendlyStrength + enemyStrength)) * 100);
  return Math.min(95, Math.max(5, winChancePercent));
}

// Résout un combat selon le % de chances déjà annoncé au joueur (calculé
// par rollEncounterOdds au moment de la rencontre, pas re-tiré ici).
export function rollCombatWin(winChancePercent: number) {
  return randomFraction() * 100 < winChancePercent;
}

// Position d'un vaisseau au moment précis d'une rencontre programmée
// (réutilise l'interpolation le long du chemin).
export function positionAt(
  path: Waypoint[],
  departedAt: Date,
  arrivalAt: Date,
  at: Date,
) {
  return currentPosition(
    {
      x: path[0].x,
      y: path[0].y,
      dest_x: path[path.length - 1].x,
      dest_y: path[path.length - 1].y,
      departed_at: departedAt.toISOString(),
      arrival_at: arrivalAt.toISOString(),
      path,
    },
    at.getTime(),
  );
}
