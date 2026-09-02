import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { planTravelAlongPath, positionAt, rollCombatWin, type Waypoint } from "@/lib/fleets";
import { nearestPlanet, shortestPath } from "@/lib/routes";

// Résout une rencontre en cours : combattre (chance de victoire) ou fuir
// (dégâts garantis). En cas de fuite ou de défaite, le vaisseau est
// endommagé et forcé de rejoindre Coruscant depuis sa position actuelle.
// En cas de victoire, le trajet reprend simplement là où il en était.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/ships/[id]/resolve-encounter">,
) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const choice = body?.choice;

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });
  if (choice !== "fight" && choice !== "flee") {
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
  }>`
    select id, fleet_id, name, code, path, departed_at, arrival_at, encounter_pending, encounter_at,
           encounter_win_chance
    from ships
    where id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });
  if (!ship.encounter_pending || !ship.encounter_at || !ship.path || !ship.departed_at || !ship.arrival_at) {
    return NextResponse.json({ error: "aucune rencontre en cours" }, { status: 400 });
  }

  const encounterAt = new Date(ship.encounter_at);
  if (Date.now() < encounterAt.getTime()) {
    return NextResponse.json({ error: "la rencontre n'a pas encore eu lieu" }, { status: 400 });
  }

  const won = choice === "fight" && rollCombatWin(ship.encounter_win_chance ?? 50);

  if (won) {
    // décale tout le calendrier du temps passé à décider : le trajet
    // reprend exactement là où il s'était figé, sans rien perdre.
    const pauseMs = Date.now() - encounterAt.getTime();
    const newDeparted = new Date(new Date(ship.departed_at).getTime() + pauseMs);
    const newArrival = new Date(new Date(ship.arrival_at).getTime() + pauseMs);

    const updated = await db.sql`
      update ships
      set departed_at = ${newDeparted.toISOString()}, arrival_at = ${newArrival.toISOString()},
          encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
          encounter_win_chance = null,
          updated_at = now()
      where id = ${id}::uuid
      returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
                damaged, encounter_pending, encounter_at
    `;
    await db.sql`update fleets set kills = kills + 1, updated_at = now() where id = ${ship.fleet_id}::uuid`;
    return NextResponse.json({ ship: updated[0], outcome: "won" });
  }

  // fui, ou combat perdu : dégâts + repli forcé vers Coruscant depuis
  // le point exact de la rencontre
  const pos = positionAt(ship.path, new Date(ship.departed_at), new Date(ship.arrival_at), encounterAt);
  const originPlanet = nearestPlanet(pos.x, pos.y);
  const retreatPath = shortestPath(originPlanet.name, "Coruscant");
  if (!retreatPath) {
    return NextResponse.json({ error: "aucune route de repli connue" }, { status: 500 });
  }
  const firstHop = retreatPath[0];
  const startsAtFirstHop = firstHop.x === pos.x && firstHop.y === pos.y;
  const waypoints: Waypoint[] = [
    { x: pos.x, y: pos.y },
    ...(startsAtFirstHop ? retreatPath.slice(1) : retreatPath).map((p) => ({ x: p.x, y: p.y })),
  ];
  const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);
  const dest = waypoints[waypoints.length - 1];

  const updated = await db.sql`
    update ships
    set x = ${pos.x}, y = ${pos.y},
        dest_x = ${dest.x}, dest_y = ${dest.y}, dest_planet = 'Coruscant',
        path = ${JSON.stringify(waypoints)}::jsonb,
        departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
        damaged = true,
        encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
        encounter_win_chance = null,
        updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
              damaged, encounter_pending, encounter_at
  `;
  await db.sql`update fleets set losses = losses + 1, updated_at = now() where id = ${ship.fleet_id}::uuid`;

  return NextResponse.json({ ship: updated[0], outcome: choice === "flee" ? "fled" : "lost" });
}
