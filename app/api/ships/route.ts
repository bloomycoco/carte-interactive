import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  currentPosition,
  generateCode,
  planTravelAlongPath,
  pickNpcFleetFlavor,
  pickNpcRoute,
  pickNpcSpawnPlanet,
  rollEncounterOdds,
  ENCOUNTER_PROXIMITY,
  NPC_FACTIONS,
  NPC_FLEET_TARGET_COUNT,
  type Faction,
  type Waypoint,
} from "@/lib/fleets";
import { nearestPlanet } from "@/lib/routes";
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
  encounter_npc_ship_id: string | null;
  action_type: "influence" | "seized" | null;
  action_started_at: string | null;
  action_ends_at: string | null;
  quest_type: "humanitarian" | null;
  quest_origin_planet: string | null;
  quest_target_planet: string | null;
  quest_phase: "fetching" | "returning" | null;
};

// Liste publique de tous les vaisseaux, pour les afficher sur la carte.
// Fait aussi tourner la simulation "en direct" à chaque appel (interrogé
// toutes les 4s par chaque onglet ouvert, faute de tâche de fond) :
// 0) chaque camp NPC garde toujours 3 flottes sur la carte (une flotte
//    détruite au combat réapparaît après son délai de respawn) ;
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
           s.encounter_npc_ship_id, s.action_type, s.action_started_at, s.action_ends_at,
           s.quest_type, s.quest_origin_planet, s.quest_target_planet, s.quest_phase
    from ships s
    join fleets f on f.id = s.fleet_id
    order by s.created_at asc
  `;

  // 0) maintien du nombre de flottes NPC : chaque camp (CSI, Mandalore,
  // Cartel) garde toujours NPC_FLEET_TARGET_COUNT flottes sur la carte.
  // Une flotte détruite au combat (voir resolve-encounter) n'est pas
  // supprimée : elle reste sans vaisseau avec une date de réapparition
  // (respawn_at), et se voit redonner un vaisseau ici une fois ce délai
  // écoulé.
  async function spawnNpcShip(
    fleetId: string,
    faction: "csi" | "mandalore" | "cartel",
    name: string,
    category: string,
  ): Promise<ShipRow> {
    const spawnPlanet = pickNpcSpawnPlanet(faction);
    const rows = await db.sql<{ id: string }>`
      insert into ships (fleet_id, name, category, code, x, y)
      values (${fleetId}::uuid, ${name}, ${category}, ${generateCode()}, ${spawnPlanet.x}, ${spawnPlanet.y})
      returning id
    `;
    return {
      id: rows[0].id,
      fleet_id: fleetId,
      name,
      category,
      faction,
      is_npc: true,
      x: spawnPlanet.x,
      y: spawnPlanet.y,
      dest_x: null,
      dest_y: null,
      dest_planet: null,
      departed_at: null,
      arrival_at: null,
      path: null,
      damaged: false,
      encounter_pending: false,
      encounter_at: null,
      encounter_win_chance: null,
      encounter_enemy_faction: null,
      encounter_npc_ship_id: null,
      action_type: null,
      action_started_at: null,
      action_ends_at: null,
      quest_type: null,
      quest_origin_planet: null,
      quest_target_planet: null,
      quest_phase: null,
    };
  }

  const npcFleetRows = await db.sql<{
    id: string;
    name: string;
    faction: "csi" | "mandalore" | "cartel";
    respawn_at: string | null;
  }>`
    select id, name, faction, respawn_at from fleets
    where is_npc = true and faction in ('csi', 'mandalore', 'cartel')
  `;

  for (const faction of NPC_FACTIONS) {
    const factionFleets = npcFleetRows.filter((f) => f.faction === faction);
    const missing = NPC_FLEET_TARGET_COUNT - factionFleets.length;
    for (let i = 0; i < missing; i++) {
      const { name, category } = pickNpcFleetFlavor(faction);
      const [fleet] = await db.sql<{ id: string }>`
        insert into fleets (name, faction, code, is_npc)
        values (${name}, ${faction}, ${generateCode()}, true)
        returning id
      `;
      ships.push(await spawnNpcShip(fleet.id, faction, name, category));
    }

    for (const f of factionFleets) {
      if (ships.some((s) => s.fleet_id === f.id)) continue;
      if (f.respawn_at && new Date(f.respawn_at).getTime() > now) continue;
      const { category } = pickNpcFleetFlavor(faction);
      ships.push(await spawnNpcShip(f.id, faction, f.name, category));
      await db.sql`update fleets set respawn_at = null, updated_at = now() where id = ${f.id}::uuid`;
    }
  }

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
    const route = pickNpcRoute(ship.faction, originPlanet.name);
    if (!route) continue;
    const { destination: dest, path: routePath } = route;
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
  // rencontre — les DEUX vaisseaux sont figés à leur position actuelle
  // tant qu'elle n'est pas résolue (le NPC ne peut pas non plus bouger).
  const npcTraveling = ships.filter(
    (s) => s.is_npc && !s.encounter_pending && currentPosition(s, now).traveling,
  );
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
    const npcPos = currentPosition(closest, now);

    await db.sql`
      update ships
      set encounter_pending = true, encounter_at = ${encounterAtIso}, encounter_win_chance = ${winChance},
          encounter_x = ${pos.x}, encounter_y = ${pos.y}, encounter_enemy_faction = ${closest.faction},
          encounter_npc_ship_id = ${closest.id}::uuid,
          updated_at = now()
      where id = ${ship.id}::uuid
    `;
    ship.encounter_pending = true;
    ship.encounter_at = encounterAtIso;
    ship.encounter_win_chance = winChance;
    ship.encounter_enemy_faction = closest.faction;
    ship.encounter_npc_ship_id = closest.id;

    // le vaisseau NPC croisé est lui aussi figé, à la même heure, tant
    // que le joueur République n'a pas tranché
    await db.sql`
      update ships
      set encounter_pending = true, encounter_at = ${encounterAtIso},
          encounter_x = ${npcPos.x}, encounter_y = ${npcPos.y},
          updated_at = now()
      where id = ${closest.id}::uuid
    `;
    closest.encounter_pending = true;
    closest.encounter_at = encounterAtIso;
    // retiré de la liste des cibles disponibles pour ce même passage
    const idx = npcTraveling.indexOf(closest);
    if (idx !== -1) npcTraveling.splice(idx, 1);
  }

  return NextResponse.json({ ships });
}
