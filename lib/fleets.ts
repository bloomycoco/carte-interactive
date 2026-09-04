// Réexporte les maths de déplacement (voir lib/fleet-motion.ts, sans
// dépendance Node) et ajoute la génération de code, qui a besoin de
// crypto — ce fichier est donc réservé au serveur.
import crypto from "node:crypto";
import { currentPosition, planTravelAlongPath, type Faction, type Waypoint } from "./fleet-motion";
import { PLANETS, type Planet } from "./planets";
import { reachableWithin, shortestPath } from "./routes";
import { SHIP_CLASSES, fleetStrength } from "./ship-classes";
import { SEIZURE_DURATION_SECONDS } from "./planet-actions";

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

// Distance en dessous de laquelle des vaisseaux d'une même flotte sont
// considérés comme PHYSIQUEMENT rassemblés (à quai ensemble, ou en
// formation groupée pendant un ordre au code Capitaine) — sert à
// calculer la force réellement engagée dans une rencontre : pas toute
// la flotte dispersée sur la carte, seulement ceux qui sont vraiment là.
const GROUP_PROXIMITY = 5;

// Bonus de coordination par vaisseau au-delà du premier, quand ils sont
// physiquement rassemblés — une vraie formation combat mieux qu'une
// somme de vaisseaux isolés.
const GROUP_COHESION_BONUS_PER_SHIP = 0.1;

// Force de combat réellement engagée dans une rencontre : seulement les
// vaisseaux de la flotte physiquement rassemblés avec le vaisseau
// engagé (voir GROUP_PROXIMITY), avec un bonus de coordination au-delà
// d'un seul — remplace fleetStrength(flotte entière) pour tout ce qui
// est rencontre (transit/sol/chasse), afin que se regrouper physiquement
// ait un effet réel sur le combat.
export function groupedFleetStrength(
  allFleetShips: {
    id: string;
    category: string | null;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    departed_at: string | null;
    arrival_at: string | null;
    path: Waypoint[] | null;
  }[],
  engagingShipId: string,
  kills: number,
  losses: number,
  now = Date.now(),
) {
  const engaging = allFleetShips.find((s) => s.id === engagingShipId);
  if (!engaging) return { strength: 0, count: 0 };
  const engagingPos = currentPosition(engaging, now);
  const grouped = allFleetShips.filter((s) => {
    const p = currentPosition(s, now);
    return Math.hypot(p.x - engagingPos.x, p.y - engagingPos.y) <= GROUP_PROXIMITY;
  });
  const base = fleetStrength(grouped, kills, losses);
  const bonus = 1 + GROUP_COHESION_BONUS_PER_SHIP * Math.max(0, grouped.length - 1);
  return { strength: base * bonus, count: grouped.length };
}

// Distance en dessous de laquelle un vaisseau qui poursuit délibérément
// un NPC (voir POST /api/ships/[id]/chase) est considéré comme l'ayant
// rattrapé — plus généreuse qu'ENCOUNTER_PROXIMITY car il ne s'agit pas
// d'un hasard mais d'une chasse volontaire, elle doit aboutir de façon
// fiable une fois assez proche.
export const CHASE_CATCH_RADIUS = 180;

// Vitesse en plus pour un vaisseau qui poursuit un NPC — pour qu'une
// chasse ait une vraie chance de rattraper sa cible plutôt que de la
// suivre indéfiniment à la même allure.
export const CHASE_SPEED_MULTIPLIER = 1.5;

// En dessous de ce nombre de vaisseaux (toute la flotte, rassemblée sur
// place), une attaque de planète ne peut JAMAIS réussir — quelle que
// soit sa force.
export const MIN_ATTACK_FLEET_SIZE = 4;

// Une capitale (voir Planet.capital) est volontairement quasi
// imprenable : il en faut beaucoup plus rassemblés pour même tenter.
export const MIN_ATTACK_FLEET_SIZE_CAPITAL = 10;

// Seuil effectif pour une planète donnée — capitale ou non.
export function minAttackFleetSize(planet: { capital?: boolean }): number {
  return planet.capital ? MIN_ATTACK_FLEET_SIZE_CAPITAL : MIN_ATTACK_FLEET_SIZE;
}

// Force ennemie aléatoire (min/max) : comparable à une flotte modeste
// de 1 à 2 vaisseaux moyens, pour que les chances restent disputées.
const ENEMY_STRENGTH_MIN = 4;
const ENEMY_STRENGTH_MAX = 16;

// Tire au sort la force de la flotte ennemie croisée et en déduit un %
// de chances de victoire (ratio de forces) — affiché au joueur avant
// qu'il ne choisisse de combattre, négocier, ou fuir. enemyMultiplier
// vient du réglage de difficulté par camp (page Owner, voir
// npcDifficultyMultiplier) : > 1 rend ce camp plus dur à affronter.
export function rollEncounterOdds(friendlyStrength: number, enemyMultiplier = 1) {
  const enemyStrength =
    (ENEMY_STRENGTH_MIN + randomFraction() * (ENEMY_STRENGTH_MAX - ENEMY_STRENGTH_MIN)) * enemyMultiplier;
  const winChancePercent = Math.round((friendlyStrength / (friendlyStrength + enemyStrength)) * 100);
  return Math.min(95, Math.max(5, winChancePercent));
}

// Charge les multiplicateurs de difficulté par camp NPC (page Owner),
// avec repli à 1.0 (aucun changement) si la table est vide ou muette
// sur un camp donné.
export async function npcDifficultyMultipliers(
  db: ReturnType<typeof import("./db").getDatabase>,
): Promise<Record<"csi" | "mandalore" | "cartel", number>> {
  const rows = await db.sql<{ faction: "csi" | "mandalore" | "cartel"; multiplier: number }>`
    select faction, multiplier from npc_difficulty
  `;
  const result: Record<"csi" | "mandalore" | "cartel", number> = { csi: 1, mandalore: 1, cartel: 1 };
  for (const row of rows) result[row.faction] = row.multiplier;
  return result;
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

// Le CSI tente de reprendre une planète contestée (> 10% d'influence
// République) : à chaque tick, chance qu'il lance une contre-attaque
// (annoncée un moment avant de résoudre, voir CSI_COUNTERATTACK_
// TELEGRAPH_SECONDS) — une victoire CSI reprend d'un coup bien plus de
// terrain qu'une victoire République n'en gagne (CSI_COUNTERATTACK_
// INFLUENCE_GAIN, contre +1 point pour une attaque République réussie).
const CSI_COUNTERATTACK_CHANCE = 0.02;
export const CSI_COUNTERATTACK_TELEGRAPH_SECONDS = 25;
export const CSI_COUNTERATTACK_INFLUENCE_GAIN = 10;

export function rollCsiCounterattackStart() {
  return randomFraction() < CSI_COUNTERATTACK_CHANCE;
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

// Camps NPC (jamais joueur) et nombre de flottes que chacun doit toujours
// avoir sur la carte, patrouillant leur propre territoire — une flotte
// détruite au combat réapparaît après NPC_RESPAWN_SECONDS plutôt que de
// disparaître pour de bon. Le CSI en a plus : c'est la seule cible des
// attaques de planète.
export const NPC_FACTIONS: ("csi" | "mandalore" | "cartel")[] = ["csi", "mandalore", "cartel"];
export const NPC_FLEET_TARGET_COUNT: Record<"csi" | "mandalore" | "cartel", number> = {
  csi: 6,
  mandalore: 3,
  cartel: 3,
};
export const NPC_RESPAWN_SECONDS = 5 * 60;

// Chaque flotte NPC ("patrouille") est composée de plusieurs vaisseaux
// (jamais un seul) qui voyagent groupés — une rencontre est donc une
// vraie bataille à plusieurs contre plusieurs, pas 1 contre 1.
const NPC_FLEET_SHIP_COUNT_MIN = 2;
const NPC_FLEET_SHIP_COUNT_MAX = 4;

export function pickNpcFleetShipCount() {
  return NPC_FLEET_SHIP_COUNT_MIN + crypto.randomInt(NPC_FLEET_SHIP_COUNT_MAX - NPC_FLEET_SHIP_COUNT_MIN + 1);
}

// Classe tirée au sort pour UN vaisseau d'une patrouille NPC (à
// distinguer de pickNpcFleetFlavor, qui donne le nom partagé de toute
// la patrouille) — chaque vaisseau de la patrouille peut avoir sa
// propre classe, pour un peu de variété.
export function pickNpcShipCategory(faction: "csi" | "mandalore" | "cartel") {
  const classes = SHIP_CLASSES[faction];
  return classes[crypto.randomInt(classes.length)];
}

const NPC_FLEET_NAME_POOL: Record<"csi" | "mandalore" | "cartel", string[]> = {
  csi: ["Escadron Séparatiste", "Flotte de Raxus", "Patrouille CSI", "Garde Confédérée", "Convoi Techno-Union"],
  mandalore: [
    "Faucons de Death Watch",
    "Patrouille Mandalorienne",
    "Garde de Concord Dawn",
    "Chasseurs Kyr'tsad",
    "Escadron Carlac",
  ],
  cartel: ["Convoi du Cartel", "Garde de Jabba", "Patrouille Hutt", "Escadron Pyke", "Contrebandiers Nikto"],
};

// Nom + classe tirés au sort pour une flotte NPC nouvellement créée ou
// qui réapparaît après avoir été détruite.
export function pickNpcFleetFlavor(faction: "csi" | "mandalore" | "cartel") {
  const names = NPC_FLEET_NAME_POOL[faction];
  const name = `${names[crypto.randomInt(names.length)]} ${crypto.randomInt(100)}`;
  const classes = SHIP_CLASSES[faction];
  const category = classes[crypto.randomInt(classes.length)];
  return { name, category };
}

// Planète de départ pour une flotte NPC qui apparaît (nouvelle ou
// réapparition) : n'importe quelle planète de son propre territoire.
export function pickNpcSpawnPlanet(faction: Faction): Planet {
  const candidates = PLANETS.filter((p) => p.faction === faction);
  return candidates[crypto.randomInt(candidates.length)];
}

const NAL_HUTTA = PLANETS.find((p) => p.name === "Nal Hutta")!;

export type OrderPlan = {
  destination: Planet;
  waypoints: Waypoint[];
  departedAt: Date;
  arrivalAt: Date;
  actionType: "seized" | null;
  actionStartedAt: string | null;
  actionEndsAt: string | null;
};

// Calcule le trajet (et l'éventuelle saisie par le Cartel) pour un ordre
// donné à un vaisseau — partagé entre l'ordre individuel
// (POST /api/ships/[id]/order) et l'ordre groupé au code Capitaine
// (POST /api/fleets/[id]/order), pour ne pas dupliquer cette logique.
// `origin` doit déjà être la position ACTUELLE du vaisseau (interpolée si
// en trajet). Renvoie null si aucune route n'existe vers la destination.
export function planShipOrder(
  origin: { x: number; y: number },
  originPlanetName: string,
  destination: Planet,
  shipFaction: Faction,
  speedMultiplier = 1,
): OrderPlan | null {
  const routePath = shortestPath(originPlanetName, destination.name);
  if (!routePath) return null;

  const firstHop = routePath[0];
  const startsAtFirstHop = firstHop.x === origin.x && firstHop.y === origin.y;
  const waypoints: Waypoint[] = [
    { x: origin.x, y: origin.y },
    ...(startsAtFirstHop ? routePath.slice(1) : routePath).map((p) => ({ x: p.x, y: p.y })),
  ];
  const { departedAt, arrivalAt } = planTravelAlongPath(waypoints, speedMultiplier);

  const plan: OrderPlan = {
    destination,
    waypoints,
    departedAt,
    arrivalAt,
    actionType: null,
    actionStartedAt: null,
    actionEndsAt: null,
  };

  // arriver sur un monde du Cartel risque une saisie du vaisseau (50%),
  // tirée au sort dès maintenant : détourné vers Nal Hutta au lieu de sa
  // destination prévue, révélé dès le départ — sauf pour un vaisseau du
  // Cartel lui-même, chez lui
  if (destination.faction === "cartel" && shipFaction !== "cartel" && rollCartelSeizure()) {
    const seizurePath = shortestPath(originPlanetName, NAL_HUTTA.name);
    if (seizurePath) {
      const seizureFirstHop = seizurePath[0];
      const seizureStartsAtFirstHop = seizureFirstHop.x === origin.x && seizureFirstHop.y === origin.y;
      const seizureWaypoints: Waypoint[] = [
        { x: origin.x, y: origin.y },
        ...(seizureStartsAtFirstHop ? seizurePath.slice(1) : seizurePath).map((p) => ({ x: p.x, y: p.y })),
      ];
      const seizureTravel = planTravelAlongPath(seizureWaypoints);
      plan.destination = NAL_HUTTA;
      plan.waypoints = seizureWaypoints;
      plan.departedAt = seizureTravel.departedAt;
      plan.arrivalAt = seizureTravel.arrivalAt;
      plan.actionType = "seized";
      plan.actionStartedAt = plan.arrivalAt.toISOString();
      plan.actionEndsAt = new Date(plan.arrivalAt.getTime() + SEIZURE_DURATION_SECONDS * 1000).toISOString();
    }
  }

  return plan;
}

// Un vaisseau peut-il recevoir un nouvel ordre maintenant ? (rencontre en
// cours non résolue, action de surface en cours, ou endommagé hors
// Kuat) — partagé entre l'ordre individuel et l'ordre groupé.
export function shipOrderBlockReason(
  ship: {
    damaged: boolean;
    encounter_pending: boolean;
    encounter_at: string | null;
    action_started_at: string | null;
    action_ends_at: string | null;
  },
  origin: { x: number; y: number; traveling: boolean },
  destinationName: string,
  now = Date.now(),
): string | null {
  if (ship.encounter_pending && ship.encounter_at && new Date(ship.encounter_at).getTime() <= now) {
    return "rencontre en cours à résoudre";
  }
  if (
    ship.action_ends_at &&
    ship.action_started_at &&
    new Date(ship.action_started_at).getTime() <= now &&
    new Date(ship.action_ends_at).getTime() > now
  ) {
    return "immobilisé pour le moment";
  }
  const KUAT = PLANETS.find((p) => p.name === "Kuat")!;
  const idleAtKuat = !origin.traveling && Math.abs(origin.x - KUAT.x) < 1 && Math.abs(origin.y - KUAT.y) < 1;
  if (ship.damaged && !idleAtKuat && destinationName !== "Kuat") {
    return "endommagé, doit rejoindre Kuat";
  }
  return null;
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

