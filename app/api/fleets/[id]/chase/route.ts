import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { currentPosition, planShipOrder, CHASE_SPEED_MULTIPLIER, type Faction, type Waypoint } from "@/lib/fleets";
import { nearestPlanet } from "@/lib/routes";
import { PLANETS } from "@/lib/planets";

// Envoie TOUTE la flotte en chasse d'un même NPC — accessible avec le
// code CAPITAINE (comme POST /api/fleets/[id]/order). Chaque vaisseau
// se dirige, avec le même boost de vitesse que la chasse individuelle,
// vers la destination actuelle de la cible ; un vaisseau déjà occupé
// (rencontre en cours, action de surface, endommagé) est simplement
// ignoré plutôt que de faire échouer tout l'ordre. Le tick de
// GET /api/ships se charge ensuite de rattraper la cible pour chacun,
// exactement comme une chasse individuelle.
export async function POST(request: Request, ctx: RouteContext<"/api/fleets/[id]/chase">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: "cible requise" }, { status: 400 });

  const db = getDatabase();
  const fleetRows = await db.sql<{ id: string; name: string; faction: Faction; captain_code: string | null }>`
    select id, name, faction, captain_code from fleets where id = ${id}::uuid
  `;
  const fleet = fleetRows[0];
  if (!fleet) return NextResponse.json({ error: "flotte introuvable" }, { status: 404 });
  if (!fleet.captain_code || fleet.captain_code !== code) {
    return NextResponse.json({ error: "code incorrect" }, { status: 403 });
  }
  if (fleet.faction !== "republique") {
    return NextResponse.json({ error: "seule la République peut prendre un NPC en chasse" }, { status: 400 });
  }

  const targetRows = await db.sql<{
    id: string;
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
  }>`
    select s.id, f.faction, f.is_npc, s.x, s.y, s.dest_x, s.dest_y, s.dest_planet,
           s.departed_at, s.arrival_at, s.path, s.damaged, s.encounter_pending
    from ships s
    join fleets f on f.id = s.fleet_id
    where s.id = ${targetId}::uuid
  `;
  const target = targetRows[0];
  if (!target || !target.is_npc) {
    return NextResponse.json({ error: "cible invalide" }, { status: 400 });
  }
  if (target.damaged || target.encounter_pending) {
    return NextResponse.json({ error: "cette flotte n'est plus disponible" }, { status: 400 });
  }

  const targetPos = currentPosition(target);
  const aimPlanetName =
    targetPos.traveling && target.dest_planet ? target.dest_planet : nearestPlanet(targetPos.x, targetPos.y).name;
  const aimPlanet = PLANETS.find((p) => p.name === aimPlanetName);
  if (!aimPlanet) {
    return NextResponse.json({ error: "impossible de localiser la cible" }, { status: 500 });
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
    action_started_at: string | null;
    action_ends_at: string | null;
  }>`
    select id, name, x, y, dest_x, dest_y, departed_at, arrival_at, path, damaged, encounter_pending,
           action_started_at, action_ends_at
    from ships
    where fleet_id = ${id}::uuid
  `;

  const now = Date.now();
  const results: { id: string; name: string; status: "chasing" | "skipped"; reason?: string }[] = [];

  for (const ship of ships) {
    if (ship.id === target.id) {
      results.push({ id: ship.id, name: ship.name, status: "skipped", reason: "cible elle-même" });
      continue;
    }
    if (ship.damaged) {
      results.push({ id: ship.id, name: ship.name, status: "skipped", reason: "endommagé" });
      continue;
    }
    if (ship.encounter_pending) {
      results.push({ id: ship.id, name: ship.name, status: "skipped", reason: "rencontre en cours" });
      continue;
    }
    if (
      ship.action_started_at &&
      ship.action_ends_at &&
      new Date(ship.action_started_at).getTime() <= now &&
      new Date(ship.action_ends_at).getTime() > now
    ) {
      results.push({ id: ship.id, name: ship.name, status: "skipped", reason: "immobilisé" });
      continue;
    }

    const pos = currentPosition(ship);
    const originPlanet = nearestPlanet(pos.x, pos.y);
    const plan = planShipOrder(pos, originPlanet.name, aimPlanet, fleet.faction, CHASE_SPEED_MULTIPLIER);
    if (!plan) {
      results.push({ id: ship.id, name: ship.name, status: "skipped", reason: "aucune route connue" });
      continue;
    }

    await db.sql`
      update ships
      set x = ${pos.x}, y = ${pos.y},
          dest_x = ${plan.destination.x}, dest_y = ${plan.destination.y}, dest_planet = ${plan.destination.name},
          path = ${JSON.stringify(plan.waypoints)}::jsonb,
          departed_at = ${plan.departedAt.toISOString()}, arrival_at = ${plan.arrivalAt.toISOString()},
          chase_target_id = ${target.id}::uuid,
          encounter_pending = false, encounter_at = null, encounter_win_chance = null,
          encounter_x = null, encounter_y = null, encounter_enemy_faction = null, encounter_kind = null,
          updated_at = now()
      where id = ${ship.id}::uuid
    `;
    results.push({ id: ship.id, name: ship.name, status: "chasing" });
  }

  return NextResponse.json({ fleetName: fleet.name, results });
}
