// Réexporte les maths de déplacement (voir lib/fleet-motion.ts, sans
// dépendance Node) et ajoute la génération de code, qui a besoin de
// crypto — ce fichier est donc réservé au serveur.
import crypto from "node:crypto";
import { currentPosition, type Faction, type Waypoint } from "./fleet-motion";
import { PLANETS, type Planet } from "./planets";
import { reachableWithin, shortestPath } from "./routes";

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

// Distance (en unités-monde) en dessous de laquelle un vaisseau République
// en transit et un vaisseau NPC en transit sont considérés comme se
// croisant — déclenche une rencontre réelle (voir le tick dans
// GET /api/ships), pas un tirage abstrait.
export const ENCOUNTER_PROXIMITY = 120;

// Force ennemie aléatoire (min/max) : comparable à une flotte modeste
// de 1 à 2 vaisseaux moyens, pour que les chances restent disputées.
const ENEMY_STRENGTH_MIN = 4;
const ENEMY_STRENGTH_MAX = 16;

// Tire au sort la force de la flotte ennemie croisée et en déduit un %
// de chances de victoire (ratio de forces) — affiché au joueur avant
// qu'il ne choisisse de combattre, négocier, ou fuir.
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

// Chances qu'une tentative de négociation réussisse (passer sans combat).
// En cas d'échec, un combat s'engage quand même (résolu comme "combattre").
const NEGOTIATION_SUCCESS_CHANCE = 0.85;

export function rollNegotiationSuccess() {
  return randomFraction() < NEGOTIATION_SUCCESS_CHANCE;
}

// Risque de saisie du vaisseau par le Cartel à l'arrivée sur un de ses
// mondes — 50/50, aucune action du joueur ne peut l'éviter.
const CARTEL_SEIZURE_CHANCE = 0.5;

export function rollCartelSeizure() {
  return randomFraction() < CARTEL_SEIZURE_CHANCE;
}

// Position d'un vaisseau à un instant donné le long d'un trajet connu
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

// Fraction des planètes les plus éloignées (par distance à vol d'oiseau)
// parmi lesquelles piocher la cible d'une quête d'aide humanitaire — pour
// que ce soit toujours loin, jamais la planète juste à côté.
const HUMANITARIAN_FAR_FRACTION = 0.35;

// Choisit, pour une quête d'aide humanitaire déclenchée sur `origin`, une
// planète lointaine où aller chercher des vivres (n'importe quel clan —
// l'aide humanitaire va chercher des ressources où elle peut).
export function pickHumanitarianQuestTarget(origin: Planet): Planet {
  const others = PLANETS.filter((p) => p.name !== origin.name)
    .map((p) => ({ p, d: Math.hypot(p.x - origin.x, p.y - origin.y) }))
    .sort((a, b) => b.d - a.d);
  const poolSize = Math.max(1, Math.round(others.length * HUMANITARIAN_FAR_FRACTION));
  const pool = others.slice(0, poolSize);
  return pool[crypto.randomInt(pool.length)].p;
}

// Choisit une destination aléatoire ET son trajet pour une flotte NPC :
// une planète de son propre clan, ATTEIGNABLE sans jamais quitter le
// territoire de ce clan (le chemin lui-même est restreint aux planètes
// du clan, pas seulement la destination — sinon le trajet le plus court
// peut couper à travers un territoire voisin).
export function pickNpcRoute(
  faction: Faction,
  currentPlanetName: string,
): { destination: Planet; path: Planet[] } | null {
  const allowed = new Set(PLANETS.filter((p) => p.faction === faction).map((p) => p.name));
  const reachable = [...reachableWithin(currentPlanetName, allowed)];
  if (reachable.length === 0) return null;

  const destName = reachable[crypto.randomInt(reachable.length)];
  const path = shortestPath(currentPlanetName, destName, allowed);
  if (!path) return null;

  const destination = PLANETS.find((p) => p.name === destName);
  if (!destination) return null;
  return { destination, path };
}
