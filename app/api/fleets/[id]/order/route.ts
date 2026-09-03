import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { currentPosition, planShipOrder, shipOrderBlockReason, type Faction, type Waypoint } from "@/lib/fleets";
import { nearestPlanet } from "@/lib/routes";
import { PLANETS } from "@/lib/planets";

const KUAT = PLANETS.find((p) => p.name === "Kuat")!;

// Envoie TOUS les vaisseaux d'une flotte vers la même planète en un seul
// ordre — accessible avec le code CAPITAINE de la flotte (distinct du
// code de flotte, lecture seule, et du code de chaque vaisseau, qui
// contrôle un seul navire). Chaque vaisseau suit sa propre route depuis
// sa position actuelle (même logique que l'ordre individuel, y compris
// le risque de saisie par le Cartel) ; un vaisseau déjà occupé (rencontre
// en cours, action de surface, endommagé) est simplement ignoré plutôt
// que de faire échouer tout l'ordre.
export async function POST(request: Request, ctx: RouteContext<"/api/fleets/[id]/order">) {
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
  const fleetRows = await db.sql<{ id: string; name: string; faction: Faction; captain_code: string | null }>`
    select id, name, faction, captain_code from fleets where id = ${id}::uuid
  `;
  const fleet = fleetRows[0];
  if (!fleet) return NextResponse.json({ error: "flotte introuvable" }, { status: 404 });
  if (!fleet.captain_code || fleet.captain_code !== code) {
    return NextResponse.json({ error: "code incorrect" }, { status: 403 });
  }

  const ships = await db.sql<{
    id: string;
    name: string;
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
    select id, name, x, y, dest_x, dest_y, departed_at, arrival_at, path, damaged,
           encounter_pending, encounter_at, action_type, action_started_at, action_ends_at
    from ships
    where fleet_id = ${id}::uuid
  `;

  const results: { id: string; name: string; status: "ordered" | "skipped"; reason?: string; destPlanet?: string }[] =
    [];

  for (const ship of ships) {
    const origin = currentPosition(ship);
    const blockReason = shipOrderBlockReason(ship, origin, destination.name);
    if (blockReason) {
      results.push({ id: ship.id, name: ship.name, status: "skipped", reason: blockReason });
      continue;
    }

    const originPlanet = nearestPlanet(origin.x, origin.y);
    const plan = planShipOrder(origin, originPlanet.name, destination, fleet.faction);
    if (!plan) {
      results.push({ id: ship.id, name: ship.name, status: "skipped", reason: "aucune route connue" });
      continue;
    }

    const idleAtKuat = !origin.traveling && Math.abs(origin.x - KUAT.x) < 1 && Math.abs(origin.y - KUAT.y) < 1;
    const repaired = ship.damaged && idleAtKuat;

    await db.sql`
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
      where id = ${ship.id}::uuid
    `;
    results.push({ id: ship.id, name: ship.name, status: "ordered", destPlanet: plan.destination.name });
  }

  return NextResponse.json({ fleetName: fleet.name, results });
}
