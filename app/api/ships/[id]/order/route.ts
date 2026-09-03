import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { currentPosition, planShipOrder, shipOrderBlockReason, type Faction, type Waypoint } from "@/lib/fleets";
import { nearestPlanet } from "@/lib/routes";
import { PLANETS } from "@/lib/planets";

const CORUSCANT = PLANETS.find((p) => p.name === "Coruscant")!;

// Envoie un vaisseau vers une planète, en suivant le réseau de routes
// (jamais en ligne droite) — la durée dépend de la distance réelle par
// les routes. Croiser une flotte NPC en chemin déclenche une rencontre
// (voir le tick dans GET /api/ships), et arriver sur un monde du Cartel
// risque une saisie du vaisseau : il est alors détourné vers Nal Hutta
// (capitale du Cartel), peu importe la destination demandée. Accessible
// à quiconque connaît le code DU VAISSEAU (le code de sa flotte ne
// suffit pas) — voir POST /api/fleets/[id]/order pour l'ordre groupé au
// code Capitaine.
export async function POST(request: Request, ctx: RouteContext<"/api/ships/[id]/order">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const destPlanet = typeof body?.destPlanet === "string" ? body.destPlanet : "";

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });

  const destination = PLANETS.find((p) => p.name === destPlanet);
  if (!destination) {
    return NextResponse.json({ error: "destination invalide" }, { status: 400 });
  }

  const db = getDatabase();
  const rows = await db.sql<{
    id: string;
    fleet_id: string;
    faction: string;
    name: string;
    code: string;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    departed_at: string | null;
    arrival_at: string | null;
    path: Waypoint[] | null;
    damaged: boolean;
    encounter_pending: boolean;
    encounter_at: string | null;
    action_type: "seized" | null;
    action_started_at: string | null;
    action_ends_at: string | null;
  }>`
    select s.id, s.fleet_id, f.faction, s.name, s.code, s.x, s.y, s.dest_x, s.dest_y,
           s.departed_at, s.arrival_at, s.path, s.damaged,
           s.encounter_pending, s.encounter_at, s.action_type, s.action_started_at, s.action_ends_at
    from ships s
    join fleets f on f.id = s.fleet_id
    where s.id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });

  const origin = currentPosition(ship);
  const blockReason = shipOrderBlockReason(ship, origin, destination.name);
  if (blockReason) return NextResponse.json({ error: blockReason }, { status: 400 });

  const idleAtCoruscant =
    !origin.traveling && Math.abs(origin.x - CORUSCANT.x) < 1 && Math.abs(origin.y - CORUSCANT.y) < 1;
  const repaired = ship.damaged && idleAtCoruscant;

  const originPlanet = nearestPlanet(origin.x, origin.y);
  const plan = planShipOrder(origin, originPlanet.name, destination, ship.faction as Faction);
  if (!plan) {
    return NextResponse.json({ error: "aucune route connue vers cette destination" }, { status: 400 });
  }

  const updated = await db.sql`
    update ships
    set x = ${origin.x}, y = ${origin.y},
        dest_x = ${plan.destination.x}, dest_y = ${plan.destination.y}, dest_planet = ${plan.destination.name},
        path = ${JSON.stringify(plan.waypoints)}::jsonb,
        departed_at = ${plan.departedAt.toISOString()}, arrival_at = ${plan.arrivalAt.toISOString()},
        damaged = ${repaired ? false : ship.damaged},
        encounter_pending = false, encounter_at = null, encounter_win_chance = null,
        encounter_x = null, encounter_y = null, encounter_enemy_faction = null,
        action_type = ${plan.actionType}, action_started_at = ${plan.actionStartedAt}, action_ends_at = ${plan.actionEndsAt},
        updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
              damaged, encounter_pending, encounter_at, encounter_win_chance,
              action_type, action_started_at, action_ends_at
  `;

  return NextResponse.json({ ship: updated[0] });
}
