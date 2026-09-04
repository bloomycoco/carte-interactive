import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  currentPosition,
  generateCode,
  groupedFleetStrength,
  planShipOrder,
  planTravelAlongPath,
  pickBossPathTo,
  pickBossRoute,
  BOSS_SPEED_MULTIPLIER,
  pickNpcFleetFlavor,
  pickNpcFleetShipCount,
  pickNpcRoute,
  pickNpcShipCategory,
  pickNpcSpawnPlanet,
  npcDifficultyMultipliers,
  rollCombatWin,
  rollCsiCounterattackStart,
  rollEncounterOdds,
  CHASE_CATCH_RADIUS,
  CHASE_SPEED_MULTIPLIER,
  ENCOUNTER_PROXIMITY,
  NPC_FACTIONS,
  NPC_FLEET_TARGET_COUNT,
  NPC_RESPAWN_SECONDS,
  CSI_COUNTERATTACK_TELEGRAPH_SECONDS,
  CSI_COUNTERATTACK_INFLUENCE_GAIN,
  type Faction,
  type Waypoint,
} from "@/lib/fleets";
import { nearestPlanet, shortestPath } from "@/lib/routes";
import { PLANETS, type Planet } from "@/lib/planets";
import { fleetStrength } from "@/lib/ship-classes";

// Une rencontre au sol non tranchée dans ce délai est résolue
// automatiquement : la CSI attaque, avec de moins bonnes chances pour la
// République qu'à l'origine (prise de court).
const GROUND_ENCOUNTER_TIMEOUT_MS = 30_000;
const GROUND_ENCOUNTER_TIMEOUT_PENALTY = 20;

type BossRow = {
  id: string;
  name: string;
  x: number;
  y: number;
  dest_x: number | null;
  dest_y: number | null;
  dest_planet: string | null;
  path: Waypoint[] | null;
  departed_at: string | null;
  arrival_at: string | null;
  hits: number;
  hits_required: number;
  win_chance: number;
  alive: boolean;
  target_planet: string | null;
  target_ship_id: string | null;
};

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
  encounter_kind: "transit" | "ground" | "chase" | "boss" | null;
  encounter_x: number | null;
  encounter_y: number | null;
  encounter_friendly_count: number | null;
  encounter_enemy_count: number | null;
  chase_target_id: string | null;
  chasing_boss_id: string | null;
  action_type: "seized" | null;
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
// 0) chaque camp NPC garde toujours son nombre de flottes ("patrouilles",
//    plusieurs vaisseaux chacune) sur la carte (une flotte détruite au
//    combat réapparaît après son délai de respawn) ; 1) une flotte
//    République et une patrouille CSI posées sur la même planète
//    déclenchent une rencontre au sol — TOUTE la patrouille CSI est
//    impliquée, pas un seul de ses vaisseaux (choix différents, et non
//    résolue passé 30s la CSI attaque en premier) ; 2) les patrouilles
//    NPC à quai (non figées) reprennent la route vers une planète de
//    leur propre clan, TOUS LEURS VAISSEAUX à la fois pour rester
//    groupés ; 2.5) une poursuite volontaire en cours rattrape sa cible
//    — et toute sa patrouille — ou se réoriente si elle a changé de cap ;
//    3) un vaisseau République en transit qui passe près d'une
//    patrouille NPC en transit déclenche une vraie rencontre contre
//    TOUTE la patrouille ; 5) le clan spolié (CSI ou Mandalore) tente de
//    reprendre une planète perdue (> 10% d'influence République) ; 6) le
//    boss galactique (s'il est vivant) se balade partout sauf Coruscant,
//    ou fonce droit sur la planète que le Owner lui a ordonné de
//    capturer (page de contrôle) — une fois arrivé, elle devient
//    "Hostile" (verte) sur la carte.
// La force réellement engagée côté République ne compte que les
// vaisseaux PHYSIQUEMENT rassemblés avec celui qui engage le combat
// (voir groupedFleetStrength) — se regrouper avant une rencontre
// augmente donc vraiment les chances de victoire.
// Ni le code du vaisseau ni celui de sa flotte ne sont renvoyés ici.
export async function GET() {
  const db = getDatabase();
  const now = Date.now();
  const difficulty = await npcDifficultyMultipliers(db);

  const ships = await db.sql<ShipRow>`
    select s.id, s.fleet_id, s.name, s.category, f.faction, f.is_npc,
           s.x, s.y, s.dest_x, s.dest_y, s.dest_planet,
           s.departed_at, s.arrival_at, s.path, s.damaged,
           s.encounter_pending, s.encounter_at, s.encounter_win_chance, s.encounter_enemy_faction,
           s.encounter_npc_ship_id, s.encounter_kind, s.encounter_x, s.encounter_y,
           s.encounter_friendly_count, s.encounter_enemy_count, s.chase_target_id, s.chasing_boss_id,
           s.action_type, s.action_started_at, s.action_ends_at,
           s.quest_type, s.quest_origin_planet, s.quest_target_planet, s.quest_phase
    from ships s
    join fleets f on f.id = s.fleet_id
    order by s.created_at asc
  `;

  // 0) maintien du nombre de flottes NPC : chaque camp (CSI, Mandalore,
  // Cartel) garde toujours NPC_FLEET_TARGET_COUNT[faction] flottes sur la
  // carte, chacune composée de plusieurs vaisseaux (une "patrouille",
  // jamais un seul) qui voyagent groupés. Une flotte détruite au combat
  // (voir resolve-encounter) n'est pas supprimée : elle reste sans
  // vaisseau avec une date de réapparition (respawn_at), et se voit
  // redonner ses vaisseaux ici une fois ce délai écoulé.
  async function spawnNpcFleetShips(
    fleetId: string,
    faction: "csi" | "mandalore" | "cartel",
    fleetName: string,
  ): Promise<ShipRow[]> {
    const spawnPlanet = pickNpcSpawnPlanet(faction);
    const count = pickNpcFleetShipCount();
    const created: ShipRow[] = [];
    for (let i = 0; i < count; i++) {
      const category = pickNpcShipCategory(faction);
      const rows = await db.sql<{ id: string }>`
        insert into ships (fleet_id, name, category, code, x, y)
        values (${fleetId}::uuid, ${fleetName}, ${category}, ${generateCode()}, ${spawnPlanet.x}, ${spawnPlanet.y})
        returning id
      `;
      created.push({
        id: rows[0].id,
        fleet_id: fleetId,
        name: fleetName,
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
        encounter_kind: null,
        encounter_x: null,
        encounter_y: null,
        encounter_friendly_count: null,
        encounter_enemy_count: null,
        chase_target_id: null,
        chasing_boss_id: null,
        action_type: null,
        action_started_at: null,
        action_ends_at: null,
        quest_type: null,
        quest_origin_planet: null,
        quest_target_planet: null,
        quest_phase: null,
      });
    }
    return created;
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
    const missing = NPC_FLEET_TARGET_COUNT[faction] - factionFleets.length;
    for (let i = 0; i < missing; i++) {
      const { name } = pickNpcFleetFlavor(faction);
      const [fleet] = await db.sql<{ id: string }>`
        insert into fleets (name, faction, code, is_npc)
        values (${name}, ${faction}, ${generateCode()}, true)
        returning id
      `;
      ships.push(...(await spawnNpcFleetShips(fleet.id, faction, name)));
    }

    for (const f of factionFleets) {
      if (ships.some((s) => s.fleet_id === f.id)) continue;
      if (f.respawn_at && new Date(f.respawn_at).getTime() > now) continue;
      ships.push(...(await spawnNpcFleetShips(f.id, faction, f.name)));
      await db.sql`update fleets set respawn_at = null, updated_at = now() where id = ${f.id}::uuid`;
    }
  }

  // 1) rencontres au sol : une flotte République et une patrouille CSI
  // (NPC) posées, idle, sur la MÊME planète (pas en transit) — TOUTE la
  // patrouille CSI est figée (pas un seul de ses vaisseaux), avec un
  // choix différent (pas de négociation possible avec le CSI, mais
  // tenter de passer inaperçu). Tourne AVANT le réassignement des
  // flottes NPC à quai (étape 2) pour ne pas laisser une patrouille CSI
  // repartir avant d'avoir eu la chance d'être détectée.
  const idleCsiNpc = ships.filter(
    (s) => s.is_npc && s.faction === "csi" && !s.damaged && !s.encounter_pending && !currentPosition(s, now).traveling,
  );
  const idleRepublicShips = ships.filter(
    (s) => !s.is_npc && s.faction === "republique" && !s.damaged && !s.encounter_pending && !currentPosition(s, now).traveling,
  );

  for (const ship of idleRepublicShips) {
    const pos = currentPosition(ship, now);
    const planet = nearestPlanet(pos.x, pos.y);
    const csiHere = idleCsiNpc.find((npc) => nearestPlanet(currentPosition(npc, now).x, currentPosition(npc, now).y).name === planet.name);
    if (!csiHere) continue;

    const enemyFleetShips = ships.filter((s) => s.fleet_id === csiHere.fleet_id);
    const fleetShips = ships.filter((s) => s.fleet_id === ship.fleet_id);
    const [fleetRow] = await db.sql<{ kills: number; losses: number }>`
      select kills, losses from fleets where id = ${ship.fleet_id}::uuid
    `;
    const grouped = groupedFleetStrength(fleetShips, ship.id, fleetRow?.kills ?? 0, fleetRow?.losses ?? 0, now);
    const winChance = rollEncounterOdds(grouped.strength, difficulty.csi);
    const encounterAtIso = new Date(now).toISOString();

    await db.sql`
      update ships
      set encounter_pending = true, encounter_at = ${encounterAtIso}, encounter_win_chance = ${winChance},
          encounter_x = ${pos.x}, encounter_y = ${pos.y}, encounter_enemy_faction = ${csiHere.faction},
          encounter_npc_ship_id = ${csiHere.id}::uuid, encounter_kind = 'ground',
          encounter_friendly_count = ${grouped.count}, encounter_enemy_count = ${enemyFleetShips.length},
          updated_at = now()
      where id = ${ship.id}::uuid
    `;
    ship.encounter_pending = true;
    ship.encounter_at = encounterAtIso;
    ship.encounter_win_chance = winChance;
    ship.encounter_enemy_faction = csiHere.faction;
    ship.encounter_npc_ship_id = csiHere.id;
    ship.encounter_kind = "ground";
    ship.encounter_x = pos.x;
    ship.encounter_y = pos.y;
    ship.encounter_friendly_count = grouped.count;
    ship.encounter_enemy_count = enemyFleetShips.length;

    for (const npcShip of enemyFleetShips) {
      await db.sql`
        update ships
        set encounter_pending = true, encounter_at = ${encounterAtIso},
            encounter_x = ${pos.x}, encounter_y = ${pos.y}, encounter_kind = 'ground',
            updated_at = now()
        where id = ${npcShip.id}::uuid
      `;
      npcShip.encounter_pending = true;
      npcShip.encounter_at = encounterAtIso;
      npcShip.encounter_x = pos.x;
      npcShip.encounter_y = pos.y;
      npcShip.encounter_kind = "ground";
      const idx = idleCsiNpc.indexOf(npcShip);
      if (idx !== -1) idleCsiNpc.splice(idx, 1);
    }
  }

  // 2) patrouilles NPC à quai : reprennent la route vers une planète de
  // leur propre clan (jamais hors de leur territoire), TOUS LEURS
  // VAISSEAUX à la fois (même trajet, même horaire) pour rester groupés
  // — sauf si elles viennent d'être figées dans une rencontre au sol à
  // l'instant (étape 1). Ne repart que si TOUTE la patrouille est
  // disponible (sinon elle attend que le dernier vaisseau se libère).
  const npcFleetIdsForWander = [...new Set(ships.filter((s) => s.is_npc).map((s) => s.fleet_id))];
  for (const fleetId of npcFleetIdsForWander) {
    const fleetShips = ships.filter((s) => s.fleet_id === fleetId);
    if (fleetShips.length === 0) continue;
    const allIdle = fleetShips.every((s) => {
      const pos = currentPosition(s, now);
      if (pos.traveling || s.damaged || s.encounter_pending) return false;
      if (
        s.action_ends_at &&
        s.action_started_at &&
        new Date(s.action_started_at).getTime() <= now &&
        new Date(s.action_ends_at).getTime() > now
      ) {
        return false;
      }
      return true;
    });
    if (!allIdle) continue;

    const leader = fleetShips[0];
    const pos = currentPosition(leader, now);
    const originPlanet = nearestPlanet(pos.x, pos.y);
    const route = pickNpcRoute(leader.faction, originPlanet.name);
    if (!route) continue;
    const { destination: dest, path: routePath } = route;
    const firstHop = routePath[0];
    const startsAtFirstHop = firstHop.x === pos.x && firstHop.y === pos.y;
    const waypoints: Waypoint[] = [
      { x: pos.x, y: pos.y },
      ...(startsAtFirstHop ? routePath.slice(1) : routePath).map((p) => ({ x: p.x, y: p.y })),
    ];
    const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);

    for (const ship of fleetShips) {
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
  }

  // 2.5) poursuites en cours (voir POST /api/ships/[id]/chase) : un
  // chasseur rattrape sa cible — et donc TOUTE sa patrouille — s'il s'en
  // approche à moins de CHASE_CATCH_RADIUS. Sinon, s'il vise déjà la
  // bonne destination (celle où va la cible en ce moment), on ne touche
  // à rien ; sinon on réoriente la poursuite (la cible a changé de cap,
  // ex: elle vient de reprendre une route au hasard à l'étape 2).
  const chasers = ships.filter((s) => !s.is_npc && s.chase_target_id && !s.damaged && !s.encounter_pending);
  for (const ship of chasers) {
    const target = ships.find((s) => s.id === ship.chase_target_id);
    if (!target || target.damaged || target.encounter_pending) {
      await db.sql`update ships set chase_target_id = null, updated_at = now() where id = ${ship.id}::uuid`;
      ship.chase_target_id = null;
      continue;
    }

    const shipPos = currentPosition(ship, now);
    const targetPos = currentPosition(target, now);
    const dist = Math.hypot(targetPos.x - shipPos.x, targetPos.y - shipPos.y);

    if (dist <= CHASE_CATCH_RADIUS) {
      const enemyFleetShips = ships.filter((s) => s.fleet_id === target.fleet_id);
      const fleetShips = ships.filter((s) => s.fleet_id === ship.fleet_id);
      const [fleetRow] = await db.sql<{ kills: number; losses: number }>`
        select kills, losses from fleets where id = ${ship.fleet_id}::uuid
      `;
      const grouped = groupedFleetStrength(fleetShips, ship.id, fleetRow?.kills ?? 0, fleetRow?.losses ?? 0, now);
      const winChance = rollEncounterOdds(grouped.strength, difficulty[target.faction as "csi" | "mandalore" | "cartel"]);
      const encounterAtIso = new Date(now).toISOString();

      await db.sql`
        update ships
        set encounter_pending = true, encounter_at = ${encounterAtIso}, encounter_win_chance = ${winChance},
            encounter_x = ${shipPos.x}, encounter_y = ${shipPos.y}, encounter_enemy_faction = ${target.faction},
            encounter_npc_ship_id = ${target.id}::uuid, encounter_kind = 'chase', chase_target_id = null,
            encounter_friendly_count = ${grouped.count}, encounter_enemy_count = ${enemyFleetShips.length},
            updated_at = now()
        where id = ${ship.id}::uuid
      `;
      ship.encounter_pending = true;
      ship.encounter_at = encounterAtIso;
      ship.encounter_win_chance = winChance;
      ship.encounter_enemy_faction = target.faction;
      ship.encounter_npc_ship_id = target.id;
      ship.encounter_kind = "chase";
      ship.chase_target_id = null;
      ship.encounter_friendly_count = grouped.count;
      ship.encounter_enemy_count = enemyFleetShips.length;

      for (const npcShip of enemyFleetShips) {
        await db.sql`
          update ships
          set encounter_pending = true, encounter_at = ${encounterAtIso},
              encounter_x = ${targetPos.x}, encounter_y = ${targetPos.y}, encounter_kind = 'chase',
              updated_at = now()
          where id = ${npcShip.id}::uuid
        `;
        npcShip.encounter_pending = true;
        npcShip.encounter_at = encounterAtIso;
        npcShip.encounter_kind = "chase";
      }
      continue;
    }

    const targetAimPlanet =
      targetPos.traveling && target.dest_planet ? target.dest_planet : nearestPlanet(targetPos.x, targetPos.y).name;
    if (ship.dest_planet === targetAimPlanet) continue;

    const destPlanet = PLANETS.find((p) => p.name === targetAimPlanet);
    if (!destPlanet) continue;
    const originPlanet = nearestPlanet(shipPos.x, shipPos.y);
    const plan = planShipOrder(shipPos, originPlanet.name, destPlanet, ship.faction, CHASE_SPEED_MULTIPLIER);
    if (!plan) continue;

    await db.sql`
      update ships
      set x = ${shipPos.x}, y = ${shipPos.y},
          dest_x = ${plan.destination.x}, dest_y = ${plan.destination.y}, dest_planet = ${plan.destination.name},
          path = ${JSON.stringify(plan.waypoints)}::jsonb,
          departed_at = ${plan.departedAt.toISOString()}, arrival_at = ${plan.arrivalAt.toISOString()},
          updated_at = now()
      where id = ${ship.id}::uuid
    `;
    ship.x = shipPos.x;
    ship.y = shipPos.y;
    ship.dest_x = plan.destination.x;
    ship.dest_y = plan.destination.y;
    ship.dest_planet = plan.destination.name;
    ship.path = plan.waypoints;
    ship.departed_at = plan.departedAt.toISOString();
    ship.arrival_at = plan.arrivalAt.toISOString();
  }

  // 3) rencontres réelles : un vaisseau République en transit qui croise
  // une patrouille NPC en transit (distance < ENCOUNTER_PROXIMITY)
  // déclenche une rencontre contre TOUTE cette patrouille — un seul
  // représentant par patrouille suffit à détecter la proximité, puisque
  // tous ses vaisseaux voyagent groupés, à la même position.
  const npcTravelingAll = ships.filter(
    (s) => s.is_npc && !s.encounter_pending && currentPosition(s, now).traveling,
  );
  const npcTravelingByFleet = new Map<string, ShipRow>();
  for (const s of npcTravelingAll) {
    if (!npcTravelingByFleet.has(s.fleet_id)) npcTravelingByFleet.set(s.fleet_id, s);
  }
  const npcTraveling = [...npcTravelingByFleet.values()];
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

    const enemyFleetShips = ships.filter((s) => s.fleet_id === closest!.fleet_id);
    const fleetShips = ships.filter((s) => s.fleet_id === ship.fleet_id);
    const [fleetRow] = await db.sql<{ kills: number; losses: number }>`
      select kills, losses from fleets where id = ${ship.fleet_id}::uuid
    `;
    const grouped = groupedFleetStrength(fleetShips, ship.id, fleetRow?.kills ?? 0, fleetRow?.losses ?? 0, now);
    const winChance = rollEncounterOdds(grouped.strength, difficulty[closest.faction as "csi" | "mandalore" | "cartel"]);
    const encounterAtIso = new Date(now).toISOString();
    const npcPos = currentPosition(closest, now);

    await db.sql`
      update ships
      set encounter_pending = true, encounter_at = ${encounterAtIso}, encounter_win_chance = ${winChance},
          encounter_x = ${pos.x}, encounter_y = ${pos.y}, encounter_enemy_faction = ${closest.faction},
          encounter_npc_ship_id = ${closest.id}::uuid, encounter_kind = 'transit',
          encounter_friendly_count = ${grouped.count}, encounter_enemy_count = ${enemyFleetShips.length},
          updated_at = now()
      where id = ${ship.id}::uuid
    `;
    ship.encounter_pending = true;
    ship.encounter_at = encounterAtIso;
    ship.encounter_win_chance = winChance;
    ship.encounter_enemy_faction = closest.faction;
    ship.encounter_npc_ship_id = closest.id;
    ship.encounter_kind = "transit";
    ship.encounter_friendly_count = grouped.count;
    ship.encounter_enemy_count = enemyFleetShips.length;

    // toute la patrouille NPC croisée est elle aussi figée, à la même
    // heure, tant que le joueur République n'a pas tranché
    for (const npcShip of enemyFleetShips) {
      await db.sql`
        update ships
        set encounter_pending = true, encounter_at = ${encounterAtIso},
            encounter_x = ${npcPos.x}, encounter_y = ${npcPos.y}, encounter_kind = 'transit',
            updated_at = now()
        where id = ${npcShip.id}::uuid
      `;
      npcShip.encounter_pending = true;
      npcShip.encounter_at = encounterAtIso;
      npcShip.encounter_kind = "transit";
    }
    // retiré de la liste des cibles disponibles pour ce même passage
    const idx = npcTraveling.indexOf(closest);
    if (idx !== -1) npcTraveling.splice(idx, 1);
  }

  // 4) rencontre au sol non tranchée depuis GROUND_ENCOUNTER_TIMEOUT_MS :
  // la CSI attaque automatiquement, avec de moins bonnes chances pour la
  // République qu'à l'origine (surprise, prise de court).
  const groundTimedOut = ships.filter(
    (s) =>
      !s.is_npc &&
      s.encounter_pending &&
      s.encounter_kind === "ground" &&
      s.encounter_at &&
      now - new Date(s.encounter_at).getTime() >= GROUND_ENCOUNTER_TIMEOUT_MS,
  );
  for (const ship of groundTimedOut) {
    const frozenPos = { x: ship.encounter_x ?? ship.x, y: ship.encounter_y ?? ship.y };
    const penalizedChance = Math.max(5, (ship.encounter_win_chance ?? 50) - GROUND_ENCOUNTER_TIMEOUT_PENALTY);
    const won = rollCombatWin(penalizedChance);
    const npcId = ship.encounter_npc_ship_id;

    let npcFleetId: string | null = null;
    if (npcId) {
      const [npc] = await db.sql<{ fleet_id: string }>`select fleet_id from ships where id = ${npcId}::uuid`;
      npcFleetId = npc?.fleet_id ?? null;
      if (npcFleetId) {
        await db.sql`
          update ships
          set encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
              encounter_kind = null, updated_at = now()
          where fleet_id = ${npcFleetId}::uuid
        `;
      }
    }

    if (won) {
      await db.sql`
        update ships
        set encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
            encounter_win_chance = null, encounter_enemy_faction = null, encounter_npc_ship_id = null,
            encounter_kind = null, encounter_friendly_count = null, encounter_enemy_count = null,
            updated_at = now()
        where id = ${ship.id}::uuid
      `;
      await db.sql`update fleets set kills = kills + 1, updated_at = now() where id = ${ship.fleet_id}::uuid`;
      if (npcFleetId) {
        await db.sql`delete from ships where fleet_id = ${npcFleetId}::uuid`;
        const respawnAt = new Date(now + NPC_RESPAWN_SECONDS * 1000).toISOString();
        await db.sql`
          update fleets set losses = losses + 1, respawn_at = ${respawnAt}, updated_at = now()
          where id = ${npcFleetId}::uuid
        `;
      }
    } else {
      const originPlanet = nearestPlanet(frozenPos.x, frozenPos.y);
      const retreatPath = shortestPath(originPlanet.name, "Kuat");
      if (retreatPath) {
        const firstHop = retreatPath[0];
        const startsAtFirstHop = firstHop.x === frozenPos.x && firstHop.y === frozenPos.y;
        const waypoints: Waypoint[] = [
          frozenPos,
          ...(startsAtFirstHop ? retreatPath.slice(1) : retreatPath).map((p) => ({ x: p.x, y: p.y })),
        ];
        const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);
        const dest = waypoints[waypoints.length - 1];
        await db.sql`
          update ships
          set x = ${frozenPos.x}, y = ${frozenPos.y},
              dest_x = ${dest.x}, dest_y = ${dest.y}, dest_planet = 'Kuat',
              path = ${JSON.stringify(waypoints)}::jsonb,
              departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
              damaged = true,
              encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
              encounter_win_chance = null, encounter_enemy_faction = null, encounter_npc_ship_id = null,
              encounter_kind = null, encounter_friendly_count = null, encounter_enemy_count = null,
              updated_at = now()
          where id = ${ship.id}::uuid
        `;
      }
      await db.sql`update fleets set losses = losses + 1, updated_at = now() where id = ${ship.fleet_id}::uuid`;
    }
  }

  // 5) le clan concerné (CSI ou Mandalore) tente de reprendre les
  // planètes qu'il a perdues (> 10% d'influence République — aucun clan
  // ne tolère plus qu'un pied-à-terre minime) : une attaque est d'abord
  // annoncée (csi_attack_at, clignote rouge sur la carte) puis résolue
  // après ce délai — une victoire reprend d'un coup CSI_COUNTERATTACK_
  // INFLUENCE_GAIN points, plafonnée à 10% (le clan continue de
  // retenter tant que ce n'est pas redescendu à 10% ou moins), bien plus
  // qu'une victoire République (+7 seulement).
  const contestedPlanets = await db.sql<{
    planet_name: string;
    republic_pct: number;
    csi_attack_at: string | null;
  }>`
    select planet_name, republic_pct, csi_attack_at from planet_influence where republic_pct > 10
  `;
  for (const row of contestedPlanets) {
    const planet = PLANETS.find((p) => p.name === row.planet_name);
    if (!planet || (planet.faction !== "csi" && planet.faction !== "mandalore")) continue;
    const faction = planet.faction;

    if (!row.csi_attack_at) {
      if (!rollCsiCounterattackStart()) continue;
      const attackAt = new Date(now + CSI_COUNTERATTACK_TELEGRAPH_SECONDS * 1000).toISOString();
      await db.sql`
        update planet_influence set csi_attack_at = ${attackAt}, updated_at = now()
        where planet_name = ${row.planet_name}
      `;
      row.csi_attack_at = attackAt;
      continue;
    }
    if (new Date(row.csi_attack_at).getTime() > now) continue; // encore en approche

    const attackerFleetIds = [...new Set(ships.filter((s) => s.is_npc && s.faction === faction).map((s) => s.fleet_id))];
    if (attackerFleetIds.length === 0) {
      await db.sql`update planet_influence set csi_attack_at = null, updated_at = now() where planet_name = ${row.planet_name}`;
      continue;
    }
    const attackerFleetId = attackerFleetIds[Math.floor(Math.random() * attackerFleetIds.length)];
    const attackerShips = ships.filter((s) => s.fleet_id === attackerFleetId);
    const [fleetRow] = await db.sql<{ kills: number; losses: number }>`
      select kills, losses from fleets where id = ${attackerFleetId}::uuid
    `;
    const strength = fleetStrength(attackerShips, fleetRow?.kills ?? 0, fleetRow?.losses ?? 0) * difficulty[faction];
    const won = rollCombatWin(rollEncounterOdds(strength));

    if (won) {
      await db.sql`
        update planet_influence
        set republic_pct = greatest(10, republic_pct - ${CSI_COUNTERATTACK_INFLUENCE_GAIN}), csi_attack_at = null, updated_at = now()
        where planet_name = ${row.planet_name}
      `;
      await db.sql`update fleets set kills = kills + 1, updated_at = now() where id = ${attackerFleetId}::uuid`;
    } else {
      await db.sql`update planet_influence set csi_attack_at = null, updated_at = now() where planet_name = ${row.planet_name}`;
    }
  }

  // 6) le boss galactique (s'il est vivant) : se balade PARTOUT sauf
  // Coruscant, comme une flotte NPC mais sans territoire — et les
  // vaisseaux qui l'ont pris en chasse (chasing_boss_id) le rattrapent
  // ou se réorientent, exactement comme une chasse normale, sauf que ses
  // chances de combat restent toujours fixées à boss.win_chance, quelle
  // que soit la force engagée (voir resolve-encounter).
  const [boss] = await db.sql<BossRow>`
    select id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
           hits, hits_required, win_chance, alive, target_planet, target_ship_id
    from boss where alive = true order by spawned_at desc limit 1
  `;

  if (boss) {
    const bossIdlePos = currentPosition(boss, now);
    if (!bossIdlePos.traveling) {
      const originPlanet = nearestPlanet(bossIdlePos.x, bossIdlePos.y);

      // le détenteur du code secret a ordonné au boss de capturer une
      // planète précise (page de contrôle) : soit il vient d'y arriver
      // (capture), soit il s'y dirige directement au lieu d'un trajet
      // aléatoire.
      if (boss.target_planet && originPlanet.name === boss.target_planet) {
        await db.sql`
          insert into boss_hostile_planets (planet_name) values (${boss.target_planet})
          on conflict (planet_name) do nothing
        `;
        await db.sql`update boss set target_planet = null, updated_at = now() where id = ${boss.id}::uuid`;
        boss.target_planet = null;
      }

      // ou ordonné de traquer un vaisseau précis : vise sa destination
      // actuelle, recalculée à chaque tick puisque la cible bouge —
      // repli sur un trajet aléatoire si elle est introuvable (détruite)
      // ou hors de portée (réfugiée sur Coruscant, où le boss ne va
      // jamais).
      let targetShipAim: { destination: Planet; path: Planet[] } | null = null;
      if (boss.target_ship_id) {
        const target = ships.find((s) => s.id === boss.target_ship_id && !s.damaged);
        if (target) {
          const tPos = currentPosition(target, now);
          const aimName =
            tPos.traveling && target.dest_planet ? target.dest_planet : nearestPlanet(tPos.x, tPos.y).name;
          targetShipAim = pickBossPathTo(originPlanet.name, aimName);
        }
      }

      const route = boss.target_planet
        ? pickBossPathTo(originPlanet.name, boss.target_planet)
        : (targetShipAim ?? pickBossRoute(originPlanet.name));
      if (route) {
        const { destination: dest, path: routePath } = route;
        const firstHop = routePath[0];
        const startsAtFirstHop = firstHop.x === bossIdlePos.x && firstHop.y === bossIdlePos.y;
        const waypoints: Waypoint[] = [
          { x: bossIdlePos.x, y: bossIdlePos.y },
          ...(startsAtFirstHop ? routePath.slice(1) : routePath).map((p) => ({ x: p.x, y: p.y })),
        ];
        const { departedAt, arrivalAt } = planTravelAlongPath(waypoints, BOSS_SPEED_MULTIPLIER);
        await db.sql`
          update boss
          set x = ${bossIdlePos.x}, y = ${bossIdlePos.y}, dest_x = ${dest.x}, dest_y = ${dest.y},
              dest_planet = ${dest.name}, path = ${JSON.stringify(waypoints)}::jsonb,
              departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
              updated_at = now()
          where id = ${boss.id}::uuid
        `;
        boss.x = bossIdlePos.x;
        boss.y = bossIdlePos.y;
        boss.dest_x = dest.x;
        boss.dest_y = dest.y;
        boss.dest_planet = dest.name;
        boss.path = waypoints;
        boss.departed_at = departedAt.toISOString();
        boss.arrival_at = arrivalAt.toISOString();
      }
    }

    // s'il traque un vaisseau précis et le rattrape (même portée que la
    // chasse volontaire), il l'endommage et le renvoie sur Kuat — pas de
    // combat, pas de choix pour l'équipage, le boss frappe le premier.
    // La directive est ensuite levée (mission accomplie).
    if (boss.target_ship_id) {
      const liveBossPos = currentPosition(boss, now);
      const ship = ships.find((s) => s.id === boss.target_ship_id && !s.damaged);
      if (ship) {
        const shipPos = currentPosition(ship, now);
        const dist = Math.hypot(liveBossPos.x - shipPos.x, liveBossPos.y - shipPos.y);
        if (dist <= CHASE_CATCH_RADIUS) {
          const originPlanet = nearestPlanet(shipPos.x, shipPos.y);
          const retreatPath = shortestPath(originPlanet.name, "Kuat");
          if (retreatPath) {
            const firstHop = retreatPath[0];
            const startsAtFirstHop = firstHop.x === shipPos.x && firstHop.y === shipPos.y;
            const waypoints: Waypoint[] = [
              { x: shipPos.x, y: shipPos.y },
              ...(startsAtFirstHop ? retreatPath.slice(1) : retreatPath).map((p) => ({ x: p.x, y: p.y })),
            ];
            const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);
            const dest = waypoints[waypoints.length - 1];

            await db.sql`
              update ships
              set x = ${shipPos.x}, y = ${shipPos.y},
                  dest_x = ${dest.x}, dest_y = ${dest.y}, dest_planet = 'Kuat',
                  path = ${JSON.stringify(waypoints)}::jsonb,
                  departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
                  damaged = true,
                  encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
                  encounter_win_chance = null, encounter_enemy_faction = null, encounter_npc_ship_id = null,
                  encounter_kind = null, encounter_friendly_count = null, encounter_enemy_count = null,
                  chase_target_id = null, chasing_boss_id = null,
                  updated_at = now()
              where id = ${ship.id}::uuid
            `;
            ship.x = shipPos.x;
            ship.y = shipPos.y;
            ship.dest_x = dest.x;
            ship.dest_y = dest.y;
            ship.dest_planet = "Kuat";
            ship.path = waypoints;
            ship.departed_at = departedAt.toISOString();
            ship.arrival_at = arrivalAt.toISOString();
            ship.damaged = true;
            ship.encounter_pending = false;
            ship.chase_target_id = null;
            ship.chasing_boss_id = null;
            await db.sql`update fleets set losses = losses + 1, updated_at = now() where id = ${ship.fleet_id}::uuid`;
            await db.sql`update boss set target_ship_id = null, updated_at = now() where id = ${boss.id}::uuid`;
            boss.target_ship_id = null;
          }
        }
      }
    }

    const bossChasers = ships.filter(
      (s) => !s.is_npc && s.chasing_boss_id === boss.id && !s.damaged && !s.encounter_pending,
    );
    for (const ship of bossChasers) {
      const shipPos = currentPosition(ship, now);
      const livePos = currentPosition(boss, now);
      const dist = Math.hypot(livePos.x - shipPos.x, livePos.y - shipPos.y);

      if (dist <= CHASE_CATCH_RADIUS) {
        const encounterAtIso = new Date(now).toISOString();
        await db.sql`
          update ships
          set encounter_pending = true, encounter_at = ${encounterAtIso}, encounter_win_chance = ${boss.win_chance},
              encounter_x = ${shipPos.x}, encounter_y = ${shipPos.y}, encounter_enemy_faction = null,
              encounter_npc_ship_id = null, encounter_kind = 'boss', chasing_boss_id = null,
              encounter_friendly_count = null, encounter_enemy_count = null,
              updated_at = now()
          where id = ${ship.id}::uuid
        `;
        ship.encounter_pending = true;
        ship.encounter_at = encounterAtIso;
        ship.encounter_win_chance = boss.win_chance;
        ship.encounter_kind = "boss";
        ship.chasing_boss_id = null;
        continue;
      }

      const bossAimPlanet =
        livePos.traveling && boss.dest_planet ? boss.dest_planet : nearestPlanet(livePos.x, livePos.y).name;
      if (ship.dest_planet === bossAimPlanet) continue;
      const destPlanet = PLANETS.find((p) => p.name === bossAimPlanet);
      if (!destPlanet) continue;
      const originPlanet = nearestPlanet(shipPos.x, shipPos.y);
      const plan = planShipOrder(shipPos, originPlanet.name, destPlanet, ship.faction, CHASE_SPEED_MULTIPLIER);
      if (!plan) continue;

      await db.sql`
        update ships
        set x = ${shipPos.x}, y = ${shipPos.y},
            dest_x = ${plan.destination.x}, dest_y = ${plan.destination.y}, dest_planet = ${plan.destination.name},
            path = ${JSON.stringify(plan.waypoints)}::jsonb,
            departed_at = ${plan.departedAt.toISOString()}, arrival_at = ${plan.arrivalAt.toISOString()},
            updated_at = now()
        where id = ${ship.id}::uuid
      `;
      ship.x = shipPos.x;
      ship.y = shipPos.y;
      ship.dest_x = plan.destination.x;
      ship.dest_y = plan.destination.y;
      ship.dest_planet = plan.destination.name;
      ship.path = plan.waypoints;
      ship.departed_at = plan.departedAt.toISOString();
      ship.arrival_at = plan.arrivalAt.toISOString();
    }
  }

  // influence République cosmétique par planète attaquée (voir
  // POST /api/ships/[id]/action) — pour teinter la carte et afficher une
  // jauge au clic sur la planète, et signaler une contre-attaque CSI en
  // approche (csiAttackAt) pour la faire clignoter en rouge.
  const influenceRows = await db.sql<{ planet_name: string; republic_pct: number; csi_attack_at: string | null }>`
    select planet_name, republic_pct, csi_attack_at from planet_influence
  `;
  const planetInfluence = Object.fromEntries(
    influenceRows.map((r) => [r.planet_name, { republicPct: r.republic_pct, csiAttackAt: r.csi_attack_at }]),
  );

  const publicBoss = boss
    ? {
        id: boss.id,
        name: boss.name,
        x: boss.x,
        y: boss.y,
        dest_x: boss.dest_x,
        dest_y: boss.dest_y,
        dest_planet: boss.dest_planet,
        path: boss.path,
        departed_at: boss.departed_at,
        arrival_at: boss.arrival_at,
        hits: boss.hits,
        hitsRequired: boss.hits_required,
        winChance: boss.win_chance,
        targetPlanet: boss.target_planet,
        targetShipId: boss.target_ship_id,
      }
    : null;

  // planètes capturées par le boss (page de contrôle secrète) — verdies
  // sur la carte ("Hostile"), indépendamment du sort du boss lui-même.
  const hostileRows = await db.sql<{ planet_name: string }>`select planet_name from boss_hostile_planets`;
  const hostilePlanets = hostileRows.map((r) => r.planet_name);

  return NextResponse.json({ ships, planetInfluence, boss: publicBoss, hostilePlanets });
}
