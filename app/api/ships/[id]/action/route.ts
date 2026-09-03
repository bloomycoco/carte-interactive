import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  currentPosition,
  pickHumanitarianQuestTarget,
  planTravelAlongPath,
  rollCombatWin,
  rollEncounterOdds,
  type Waypoint,
} from "@/lib/fleets";
import { nearestPlanet, shortestPath } from "@/lib/routes";
import { availablePlanetAction, type HumanitarianQuest } from "@/lib/planet-actions";
import { fleetStrength } from "@/lib/ship-classes";

// Déclenche une action volontaire à la surface de la planète où le
// vaisseau est actuellement arrêté :
// - aide humanitaire (monde neutre) : lance une quête en 3 étapes —
//   départ vers une planète tirée au sort (toujours lointaine),
//   récupération des vivres sur place, puis retour les livrer sur le
//   monde d'origine ;
// - attaquer la planète (monde d'un clan ennemi) : résolu immédiatement,
//   mais seulement si TOUTE la flotte (chaque vaisseau) est rassemblée
//   sur place — une victoire renforce la flotte (kills, comme un combat
//   gagné), un échec renforce TOUTES les flottes NPC de ce clan.
// Accessible avec le code DU VAISSEAU.
export async function POST(request: Request, ctx: RouteContext<"/api/ships/[id]/action">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const type = body?.type;

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });
  if (
    type !== "humanitarian" &&
    type !== "humanitarian_pickup" &&
    type !== "humanitarian_deliver" &&
    type !== "attack"
  ) {
    return NextResponse.json({ error: "action invalide" }, { status: 400 });
  }

  const db = getDatabase();
  const rows = await db.sql<{
    id: string;
    fleet_id: string;
    code: string;
    faction: string;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    departed_at: string | null;
    arrival_at: string | null;
    path: Waypoint[] | null;
    damaged: boolean;
    encounter_pending: boolean;
    action_ends_at: string | null;
    quest_type: "humanitarian" | null;
    quest_origin_planet: string | null;
    quest_target_planet: string | null;
    quest_phase: "fetching" | "returning" | null;
  }>`
    select s.id, s.fleet_id, s.code, f.faction, s.x, s.y, s.dest_x, s.dest_y, s.departed_at, s.arrival_at, s.path,
           s.damaged, s.encounter_pending, s.action_ends_at,
           s.quest_type, s.quest_origin_planet, s.quest_target_planet, s.quest_phase
    from ships s
    join fleets f on f.id = s.fleet_id
    where s.id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });

  const now = Date.now();
  if (ship.action_ends_at && new Date(ship.action_ends_at).getTime() > now) {
    return NextResponse.json({ error: "le vaisseau est déjà occupé" }, { status: 400 });
  }
  if (ship.encounter_pending) {
    return NextResponse.json({ error: "une rencontre en cours doit être résolue d'abord" }, { status: 400 });
  }

  const pos = currentPosition(ship);
  if (pos.traveling) {
    return NextResponse.json({ error: "le vaisseau doit être arrivé à destination" }, { status: 400 });
  }

  const planet = nearestPlanet(pos.x, pos.y);
  const quest: HumanitarianQuest =
    ship.quest_type === "humanitarian" && ship.quest_origin_planet && ship.quest_target_planet && ship.quest_phase
      ? { originPlanet: ship.quest_origin_planet, targetPlanet: ship.quest_target_planet, phase: ship.quest_phase }
      : null;
  const available = availablePlanetAction(planet.name, planet.faction, ship.faction as "republique" | "csi" | "mandalore", quest);
  if (available !== type) {
    return NextResponse.json(
      { error: `cette action n'est pas disponible sur ${planet.name}` },
      { status: 400 },
    );
  }

  if (type === "humanitarian") {
    // lance la quête : direction une planète lointaine tirée au sort
    const target = pickHumanitarianQuestTarget(planet);
    const routePath = shortestPath(planet.name, target.name);
    if (!routePath) {
      return NextResponse.json({ error: "aucune route connue vers cette destination" }, { status: 500 });
    }
    const firstHop = routePath[0];
    const startsAtFirstHop = firstHop.x === pos.x && firstHop.y === pos.y;
    const waypoints: Waypoint[] = [
      { x: pos.x, y: pos.y },
      ...(startsAtFirstHop ? routePath.slice(1) : routePath).map((p) => ({ x: p.x, y: p.y })),
    ];
    const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);

    const updated = await db.sql`
      update ships
      set dest_x = ${target.x}, dest_y = ${target.y}, dest_planet = ${target.name},
          path = ${JSON.stringify(waypoints)}::jsonb,
          departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
          quest_type = 'humanitarian', quest_origin_planet = ${planet.name},
          quest_target_planet = ${target.name}, quest_phase = 'fetching',
          updated_at = now()
      where id = ${id}::uuid
      returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
                damaged, encounter_pending, encounter_at, action_type, action_started_at, action_ends_at,
                quest_type, quest_origin_planet, quest_target_planet, quest_phase
    `;
    return NextResponse.json({ ok: true, type, planet: planet.name, target: target.name, ship: updated[0] });
  }

  if (type === "humanitarian_pickup") {
    // récupère les vivres, repart vers le monde d'origine de la quête
    const originName = ship.quest_origin_planet!;
    const routePath = shortestPath(planet.name, originName);
    if (!routePath) {
      return NextResponse.json({ error: "aucune route connue vers cette destination" }, { status: 500 });
    }
    const firstHop = routePath[0];
    const startsAtFirstHop = firstHop.x === pos.x && firstHop.y === pos.y;
    const waypoints: Waypoint[] = [
      { x: pos.x, y: pos.y },
      ...(startsAtFirstHop ? routePath.slice(1) : routePath).map((p) => ({ x: p.x, y: p.y })),
    ];
    const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);
    const dest = waypoints[waypoints.length - 1];

    const updated = await db.sql`
      update ships
      set dest_x = ${dest.x}, dest_y = ${dest.y}, dest_planet = ${originName},
          path = ${JSON.stringify(waypoints)}::jsonb,
          departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
          quest_phase = 'returning', updated_at = now()
      where id = ${id}::uuid
      returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
                damaged, encounter_pending, encounter_at, action_type, action_started_at, action_ends_at,
                quest_type, quest_origin_planet, quest_target_planet, quest_phase
    `;
    return NextResponse.json({ ok: true, type, planet: planet.name, origin: originName, ship: updated[0] });
  }

  if (type === "humanitarian_deliver") {
    // livraison : la quête est terminée
    const updated = await db.sql`
      update ships
      set quest_type = null, quest_origin_planet = null, quest_target_planet = null, quest_phase = null,
          updated_at = now()
      where id = ${id}::uuid
      returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
                damaged, encounter_pending, encounter_at, action_type, action_started_at, action_ends_at,
                quest_type, quest_origin_planet, quest_target_planet, quest_phase
    `;
    return NextResponse.json({ ok: true, type, planet: planet.name, ship: updated[0] });
  }

  // attaquer la planète : il faut TOUTE la flotte rassemblée sur place
  // (chaque vaisseau, idle, sur cette planète) — pas juste celui-ci.
  const fleetShips = await db.sql<{
    id: string;
    category: string | null;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    departed_at: string | null;
    arrival_at: string | null;
    path: Waypoint[] | null;
    damaged: boolean;
    encounter_pending: boolean;
  }>`
    select id, category, x, y, dest_x, dest_y, departed_at, arrival_at, path, damaged, encounter_pending
    from ships where fleet_id = ${ship.fleet_id}::uuid
  `;
  const allGathered = fleetShips.every((s) => {
    if (s.damaged || s.encounter_pending) return false;
    const sPos = currentPosition(s);
    if (sPos.traveling) return false;
    return nearestPlanet(sPos.x, sPos.y).name === planet.name;
  });
  if (!allGathered) {
    return NextResponse.json(
      { error: `toute la flotte doit être rassemblée sur ${planet.name} pour attaquer` },
      { status: 400 },
    );
  }

  const [fleetRow] = await db.sql<{ kills: number; losses: number }>`
    select kills, losses from fleets where id = ${ship.fleet_id}::uuid
  `;
  const strength = fleetStrength(fleetShips, fleetRow?.kills ?? 0, fleetRow?.losses ?? 0);
  const winChance = rollEncounterOdds(strength);
  const won = rollCombatWin(winChance);

  if (won) {
    await db.sql`update fleets set kills = kills + 1, updated_at = now() where id = ${ship.fleet_id}::uuid`;
  } else {
    // l'attaque échoue : tout le clan visé (pas juste une flotte) en
    // ressort plus fort
    await db.sql`
      update fleets set kills = kills + 1, updated_at = now()
      where is_npc = true and faction = ${planet.faction}
    `;
  }

  return NextResponse.json({ ok: true, type, planet: planet.name, outcome: won ? "won" : "lost", winChance });
}
