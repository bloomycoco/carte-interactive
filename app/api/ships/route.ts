import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  currentPosition,
  planTravelAlongPath,
  pickNpcDestination,
  rollEncounterOdds,
  ENCOUNTER_PROXIMITY,
  type Faction,
  type Waypoint,
} from "@/lib/fleets";
import { nearestPlanet, shortestPath } from "@/lib/routes";
import { fleetStrength } from "@/lib/ship-classes";

type ShipRow = {
  id: string;
  fleet_id: string;
  name: string;
  category: string | null;
  faction: Faction;
  is_npc: boolean;
  x: number;
  y: number;
  dest_x: number | null;
  dest_y: number | null;
  dest_planet: string | null;
  departed_at: string | null;
  arrival_at: string | null;
  path: Waypoint[] | null;
  damaged: boolean;
  encounter_pending: boolean;
  encounter_at: string | null;
  encounter_win_chance: number | null;
  encounter_enemy_faction: Faction | null;
  action_type: "influence" | "seized" | null;
  action_started_at: string | null;
  action_ends_at: string | null;
};

// Liste publique de tous les vaisseaux, pour les afficher sur la carte.
// Fait aussi tourner la simulation "en direct" à chaque appel (interrogé
// toutes les 4s par chaque onglet ouvert, faute de tâche de fond) :
// 1) les flottes NPC à quai reprennent la route vers une planète de leur
//    propre clan ; 2) un vaisseau République en transit qui passe près
//    d'un NPC en transit déclenche une vraie rencontre.
// Ni le code du vaisseau ni celui de sa flotte ne sont renvoyés ici.
export async function GET() {
  const db = getDatabase();
  const now = Date.now();

  const ships = await db.sql<ShipRow>`
    select s.id, s.fleet_id, s.name, s.category, f.faction, f.is_npc,
           s.x, s.y, s.dest_x, s.dest_y, s.dest_planet,
           s.departed_at, s.arrival_at, s.path, s.damaged,
           s.encounter_pending, s.encounter_at, s.encounter_win_chance, s.encounter_enemy_faction,
           s.action_type, s.action_started_at, s.action_ends_at
    from ships s
    join fleets f on f.id = s.fleet_id
    order by s.created_at asc
  `;

  // 1) flottes NPC à quai : reprennent la route vers une planète de leur
  // propre clan (jamais hors de leur territoire)
  for (const ship of ships) {
    if (!ship.is_npc) continue;
    const pos = currentPosition(ship, now);
    if (pos.traveling || ship.damaged) continue;
    if (
      ship.action_ends_at &&
      ship.action_started_at &&
      new Date(ship.action_started_at).getTime() <= now &&
      new Date(ship.action_ends_at).getTime() > now
    ) {
      continue;
    }

    const originPlanet = nearestPlanet(pos.x, pos.y);
    const dest = pickNpcDestination(ship.faction, originPlanet.name);
    if (!dest) continue;
    const routePath = shortestPath(originPlanet.name, dest.name);
    if (!routePath) continue;
    const firstHop = routePath[0];
    const startsAtFirstHop = firstHop.x === pos.x && firstHop.y === pos.y;
    const waypoints: Waypoint[] = [
      { x: pos.x, y: pos.y },
      ...(startsAtFirstHop ? routePath.slice(1) : routePath).map((p) => ({ x: p.x, y: p.y })),
    ];
    const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);

    await db.sql`
      update ships
      set x = ${pos.x}, y = ${pos.y}, dest_x = ${dest.x}, dest_y = ${dest.y}, dest_planet = ${dest.name},
          path = ${JSON.stringify(waypoints)}::jsonb,
          departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
          updated_at = now()
      where id = ${ship.id}::uuid
    `;
    ship.x = pos.x;
    ship.y = pos.y;
    ship.dest_x = dest.x;
    ship.dest_y = dest.y;
    ship.dest_planet = dest.name;
    ship.path = waypoints;
    ship.departed_at = departedAt.toISOString();
    ship.arrival_at = arrivalAt.toISOString();
  }

  // 2) rencontres réelles : un vaisseau République en transit qui croise
  // un NPC en transit (distance < ENCOUNTER_PROXIMITY) déclenche une
  // rencontre — figé immédiatement à sa position actuelle
  const npcTraveling = ships.filter((s) => s.is_npc && currentPosition(s, now).traveling);
  const republicShips = ships.filter(
    (s) => !s.is_npc && s.faction === "republique" && !s.damaged && !s.encounter_pending,
  );

  for (const ship of republicShips) {
    const pos = currentPosition(ship, now);
    if (!pos.traveling) continue;

    let closest: ShipRow | null = null;
    let closestDist = ENCOUNTER_PROXIMITY;
    for (const npc of npcTraveling) {
      const npcPos = currentPosition(npc, now);
      const dist = Math.hypot(npcPos.x - pos.x, npcPos.y - pos.y);
      if (dist < closestDist) {
        closest = npc;
        closestDist = dist;
      }
    }
    if (!closest) continue;

    const fleetShips = ships.filter((s) => s.fleet_id === ship.fleet_id);
    const [fleetRow] = await db.sql<{ kills: number; losses: number }>`
      select kills, losses from fleets where id = ${ship.fleet_id}::uuid
    `;
    const strength = fleetStrength(fleetShips, fleetRow?.kills ?? 0, fleetRow?.losses ?? 0);
    const winChance = rollEncounterOdds(strength);
    const encounterAtIso = new Date(now).toISOString();

    await db.sql`
      update ships
      set encounter_pending = true, encounter_at = ${encounterAtIso}, encounter_win_chance = ${winChance},
          encounter_x = ${pos.x}, encounter_y = ${pos.y}, encounter_enemy_faction = ${closest.faction},
          updated_at = now()
      where id = ${ship.id}::uuid
    `;
    ship.encounter_pending = true;
    ship.encounter_at = encounterAtIso;
    ship.encounter_win_chance = winChance;
    ship.encounter_enemy_faction = closest.faction;
  }

  return NextResponse.json({ ships });
}
