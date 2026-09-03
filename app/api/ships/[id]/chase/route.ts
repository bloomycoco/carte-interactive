import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { currentPosition, planShipOrder, CHASE_SPEED_MULTIPLIER, type Faction, type Waypoint } from "@/lib/fleets";
import { nearestPlanet } from "@/lib/routes";
import { PLANETS } from "@/lib/planets";

// Prend un NPC en chasse : le vaisseau appelant se lance à sa poursuite
// (avec un léger boost de vitesse), vers la destination ACTUELLE de la
// cible — pas de rencontre immédiate. C'est le tick de GET /api/ships
// qui réoriente la poursuite si la cible change de cap, et déclenche la
// rencontre (Combattre/Négocier/Fuir) une fois assez proche pour la
// rattraper. Accessible avec le code DU VAISSEAU.
export async function POST(request: Request, ctx: RouteContext<"/api/ships/[id]/chase">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: "cible requise" }, { status: 400 });

  const db = getDatabase();
  const rows = await db.sql<{
    id: string;
    fleet_id: string;
    code: string;
    faction: Faction;
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
    return NextResponse.json({ error: "seule la République peut prendre un NPC en chasse" }, { status: 400 });
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

  const targetRows = await db.sql<{
    id: string;
    fleet_id: string;
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
    select s.id, s.fleet_id, f.faction, f.is_npc, s.x, s.y, s.dest_x, s.dest_y, s.dest_planet,
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

  const pos = currentPosition(ship);
  const targetPos = currentPosition(target);

  // vise la destination ACTUELLE de la cible (celle où elle se rend déjà,
  // ou la planète où elle est posée si elle est à quai) — le tick de
  // GET /api/ships réoriente ensuite si elle en change en cours de route
  const aimPlanetName =
    targetPos.traveling && target.dest_planet ? target.dest_planet : nearestPlanet(targetPos.x, targetPos.y).name;
  const aimPlanet = PLANETS.find((p) => p.name === aimPlanetName);
  if (!aimPlanet) {
    return NextResponse.json({ error: "impossible de localiser la cible" }, { status: 500 });
  }

  const originPlanet = nearestPlanet(pos.x, pos.y);
  const plan = planShipOrder(pos, originPlanet.name, aimPlanet, ship.faction, CHASE_SPEED_MULTIPLIER);
  if (!plan) {
    return NextResponse.json({ error: "aucune route connue vers cette cible" }, { status: 400 });
  }

  const updated = await db.sql`
    update ships
    set x = ${pos.x}, y = ${pos.y},
        dest_x = ${plan.destination.x}, dest_y = ${plan.destination.y}, dest_planet = ${plan.destination.name},
        path = ${JSON.stringify(plan.waypoints)}::jsonb,
        departed_at = ${plan.departedAt.toISOString()}, arrival_at = ${plan.arrivalAt.toISOString()},
        chase_target_id = ${target.id}::uuid,
        encounter_pending = false, encounter_at = null, encounter_win_chance = null,
        encounter_x = null, encounter_y = null, encounter_enemy_faction = null, encounter_kind = null,
        updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
              damaged, encounter_pending, chase_target_id
  `;

  return NextResponse.json({ ship: updated[0] });
}
