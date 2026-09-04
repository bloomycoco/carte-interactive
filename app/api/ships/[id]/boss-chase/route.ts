import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { currentPosition, planShipOrder, CHASE_SPEED_MULTIPLIER, type Waypoint } from "@/lib/fleets";
import { nearestPlanet } from "@/lib/routes";
import { PLANETS } from "@/lib/planets";

// Prend le boss galactique en chasse : même principe que
// POST /api/ships/[id]/chase (vise sa destination actuelle, avec le
// même boost de vitesse), mais la cible est fixe (le seul boss vivant,
// pas de targetId à fournir). Le tick de GET /api/ships se charge du
// rattrapage et du combat, à chances toujours fixées.
export async function POST(request: Request, ctx: RouteContext<"/api/ships/[id]/boss-chase">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });

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
    action_started_at: string | null;
    action_ends_at: string | null;
  }>`
    select s.id, s.fleet_id, s.code, f.faction, s.x, s.y, s.dest_x, s.dest_y,
           s.departed_at, s.arrival_at, s.path, s.damaged, s.encounter_pending,
           s.action_started_at, s.action_ends_at
    from ships s
    join fleets f on f.id = s.fleet_id
    where s.id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });
  if (ship.faction !== "republique") {
    return NextResponse.json({ error: "seule la République peut prendre le boss en chasse" }, { status: 400 });
  }
  if (ship.damaged) {
    return NextResponse.json({ error: "vaisseau endommagé : doit d'abord rallier Kuat" }, { status: 400 });
  }
  if (ship.encounter_pending) {
    return NextResponse.json({ error: "une rencontre en cours doit être résolue d'abord" }, { status: 400 });
  }
  const now = Date.now();
  if (
    ship.action_started_at &&
    ship.action_ends_at &&
    new Date(ship.action_started_at).getTime() <= now &&
    new Date(ship.action_ends_at).getTime() > now
  ) {
    return NextResponse.json({ error: "le vaisseau est immobilisé pour le moment" }, { status: 400 });
  }

  const [boss] = await db.sql<{
    id: string;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    dest_planet: string | null;
    departed_at: string | null;
    arrival_at: string | null;
    path: Waypoint[] | null;
  }>`
    select id, x, y, dest_x, dest_y, dest_planet, departed_at, arrival_at, path
    from boss where alive = true order by spawned_at desc limit 1
  `;
  if (!boss) return NextResponse.json({ error: "aucun boss actif" }, { status: 404 });

  const bossPos = currentPosition(boss);
  const aimPlanetName =
    bossPos.traveling && boss.dest_planet ? boss.dest_planet : nearestPlanet(bossPos.x, bossPos.y).name;
  const aimPlanet = PLANETS.find((p) => p.name === aimPlanetName);
  if (!aimPlanet) {
    return NextResponse.json({ error: "impossible de localiser le boss" }, { status: 500 });
  }

  const pos = currentPosition(ship);
  const originPlanet = nearestPlanet(pos.x, pos.y);
  const plan = planShipOrder(pos, originPlanet.name, aimPlanet, "republique", CHASE_SPEED_MULTIPLIER);
  if (!plan) {
    return NextResponse.json({ error: "aucune route connue vers le boss" }, { status: 400 });
  }

  const updated = await db.sql`
    update ships
    set x = ${pos.x}, y = ${pos.y},
        dest_x = ${plan.destination.x}, dest_y = ${plan.destination.y}, dest_planet = ${plan.destination.name},
        path = ${JSON.stringify(plan.waypoints)}::jsonb,
        departed_at = ${plan.departedAt.toISOString()}, arrival_at = ${plan.arrivalAt.toISOString()},
        chasing_boss_id = ${boss.id}::uuid, chase_target_id = null,
        encounter_pending = false, encounter_at = null, encounter_win_chance = null,
        encounter_x = null, encounter_y = null, encounter_enemy_faction = null, encounter_kind = null,
        updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
              damaged, encounter_pending, chasing_boss_id
  `;

  return NextResponse.json({ ship: updated[0] });
}
