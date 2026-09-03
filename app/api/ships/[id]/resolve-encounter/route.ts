import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  NPC_RESPAWN_SECONDS,
  planTravelAlongPath,
  positionAt,
  rollCombatWin,
  rollNegotiationSuccess,
  type Waypoint,
} from "@/lib/fleets";
import { nearestPlanet, shortestPath } from "@/lib/routes";

// Résout une rencontre en cours : combattre (chance de victoire, calculée
// au moment de la rencontre), négocier le passage (très souvent réussi,
// sinon un combat s'engage quand même), ou fuir (toujours réussi, mais
// annule le trajet et renvoie le vaisseau d'où il venait). Une défaite
// au combat (choisi ou après une négociation ratée) endommage le
// vaisseau et le force à rallier Coruscant ; fuir n'inflige aucun dégât.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/ships/[id]/resolve-encounter">,
) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const choice = body?.choice;

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });
  if (choice !== "fight" && choice !== "negotiate" && choice !== "flee") {
    return NextResponse.json({ error: "choix invalide" }, { status: 400 });
  }

  const db = getDatabase();
  const rows = await db.sql<{
    id: string;
    fleet_id: string;
    name: string;
    code: string;
    path: Waypoint[] | null;
    departed_at: string | null;
    arrival_at: string | null;
    encounter_pending: boolean;
    encounter_at: string | null;
    encounter_win_chance: number | null;
    encounter_x: number | null;
    encounter_y: number | null;
    encounter_npc_ship_id: string | null;
    encounter_enemy_faction: string | null;
  }>`
    select id, fleet_id, name, code, path, departed_at, arrival_at, encounter_pending, encounter_at,
           encounter_win_chance, encounter_x, encounter_y, encounter_npc_ship_id, encounter_enemy_faction
    from ships
    where id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });
  if (!ship.encounter_pending || !ship.encounter_at || !ship.path || !ship.departed_at || !ship.arrival_at) {
    return NextResponse.json({ error: "aucune rencontre en cours" }, { status: 400 });
  }
  // la CSI ne négocie jamais : guerre totale contre la République
  if (choice === "negotiate" && ship.encounter_enemy_faction === "csi") {
    return NextResponse.json({ error: "la CSI ne négocie pas" }, { status: 400 });
  }

  const encounterAt = new Date(ship.encounter_at);
  if (Date.now() < encounterAt.getTime()) {
    return NextResponse.json({ error: "la rencontre n'a pas encore eu lieu" }, { status: 400 });
  }

  const frozenPos =
    ship.encounter_x != null && ship.encounter_y != null
      ? { x: ship.encounter_x, y: ship.encounter_y }
      : positionAt(ship.path, new Date(ship.departed_at), new Date(ship.arrival_at), encounterAt);

  // le vaisseau NPC croisé redevient libre de reprendre sa route — sauf
  // en cas de victoire au combat, où il est détruit (voir destroyNpc)
  async function releaseNpc() {
    if (!ship!.encounter_npc_ship_id) return;
    await db.sql`
      update ships
      set encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
          updated_at = now()
      where id = ${ship!.encounter_npc_ship_id}::uuid
    `;
  }

  // victoire au combat : le vaisseau NPC est détruit, retiré de la carte
  // — sa flotte n'est pas supprimée, elle réapparaîtra dans
  // NPC_RESPAWN_SECONDS (voir le tick dans GET /api/ships)
  async function destroyNpc() {
    if (!ship!.encounter_npc_ship_id) return;
    const [npc] = await db.sql<{ fleet_id: string }>`
      select fleet_id from ships where id = ${ship!.encounter_npc_ship_id}::uuid
    `;
    await db.sql`delete from ships where id = ${ship!.encounter_npc_ship_id}::uuid`;
    if (npc) {
      const respawnAt = new Date(Date.now() + NPC_RESPAWN_SECONDS * 1000).toISOString();
      await db.sql`
        update fleets set losses = losses + 1, respawn_at = ${respawnAt}, updated_at = now()
        where id = ${npc.fleet_id}::uuid
      `;
    }
  }

  async function resume(outcome: "won" | "negotiated") {
    // décale tout le calendrier du temps passé à décider : le trajet
    // reprend exactement là où il s'était figé, sans rien perdre.
    const pauseMs = Date.now() - encounterAt.getTime();
    const newDeparted = new Date(new Date(ship!.departed_at!).getTime() + pauseMs);
    const newArrival = new Date(new Date(ship!.arrival_at!).getTime() + pauseMs);

    const updated = await db.sql`
      update ships
      set departed_at = ${newDeparted.toISOString()}, arrival_at = ${newArrival.toISOString()},
          encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
          encounter_win_chance = null, encounter_enemy_faction = null, encounter_npc_ship_id = null,
          updated_at = now()
      where id = ${id}::uuid
      returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
                damaged, encounter_pending, encounter_at
    `;
    if (outcome === "won") {
      await db.sql`update fleets set kills = kills + 1, updated_at = now() where id = ${ship!.fleet_id}::uuid`;
    }
    return NextResponse.json({ ship: updated[0], outcome });
  }

  async function loseCombat() {
    // défaite : dégâts + repli forcé vers Coruscant depuis le point exact
    // de la rencontre
    const originPlanet = nearestPlanet(frozenPos.x, frozenPos.y);
    const retreatPath = shortestPath(originPlanet.name, "Coruscant");
    if (!retreatPath) {
      return NextResponse.json({ error: "aucune route de repli connue" }, { status: 500 });
    }
    const firstHop = retreatPath[0];
    const startsAtFirstHop = firstHop.x === frozenPos.x && firstHop.y === frozenPos.y;
    const waypoints: Waypoint[] = [
      frozenPos,
      ...(startsAtFirstHop ? retreatPath.slice(1) : retreatPath).map((p) => ({ x: p.x, y: p.y })),
    ];
    const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);
    const dest = waypoints[waypoints.length - 1];

    const updated = await db.sql`
      update ships
      set x = ${frozenPos.x}, y = ${frozenPos.y},
          dest_x = ${dest.x}, dest_y = ${dest.y}, dest_planet = 'Coruscant',
          path = ${JSON.stringify(waypoints)}::jsonb,
          departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
          damaged = true,
          encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
          encounter_win_chance = null, encounter_enemy_faction = null, encounter_npc_ship_id = null,
          updated_at = now()
      where id = ${id}::uuid
      returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
                damaged, encounter_pending, encounter_at
    `;
    await db.sql`update fleets set losses = losses + 1, updated_at = now() where id = ${ship!.fleet_id}::uuid`;
    return NextResponse.json({ ship: updated[0], outcome: "lost" });
  }

  if (choice === "flee") {
    await releaseNpc();
    // fuir réussit toujours, sans dégât : le vaisseau rebrousse chemin
    // vers la planète d'où il venait pour ce trajet
    const homePlanet = nearestPlanet(ship.path[0].x, ship.path[0].y);
    const retreatPath = shortestPath(
      nearestPlanet(frozenPos.x, frozenPos.y).name,
      homePlanet.name,
    );
    if (!retreatPath) {
      return NextResponse.json({ error: "aucune route de repli connue" }, { status: 500 });
    }
    const firstHop = retreatPath[0];
    const startsAtFirstHop = firstHop.x === frozenPos.x && firstHop.y === frozenPos.y;
    const waypoints: Waypoint[] = [
      frozenPos,
      ...(startsAtFirstHop ? retreatPath.slice(1) : retreatPath).map((p) => ({ x: p.x, y: p.y })),
    ];
    const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);
    const dest = waypoints[waypoints.length - 1];

    const updated = await db.sql`
      update ships
      set x = ${frozenPos.x}, y = ${frozenPos.y},
          dest_x = ${dest.x}, dest_y = ${dest.y}, dest_planet = ${homePlanet.name},
          path = ${JSON.stringify(waypoints)}::jsonb,
          departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
          encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
          encounter_win_chance = null, encounter_enemy_faction = null, encounter_npc_ship_id = null,
          updated_at = now()
      where id = ${id}::uuid
      returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
                damaged, encounter_pending, encounter_at
    `;
    return NextResponse.json({ ship: updated[0], outcome: "fled" });
  }

  if (choice === "negotiate") {
    if (rollNegotiationSuccess()) {
      await releaseNpc();
      return resume("negotiated");
    }
    // négociation ratée : combat, résolu comme "combattre"
    if (rollCombatWin(ship.encounter_win_chance ?? 50)) {
      await destroyNpc();
      return resume("won");
    }
    await releaseNpc();
    return loseCombat();
  }

  // choice === "fight"
  if (rollCombatWin(ship.encounter_win_chance ?? 50)) {
    await destroyNpc();
    return resume("won");
  }
  await releaseNpc();
  return loseCombat();
}
