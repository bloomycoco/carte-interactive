import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { currentPosition, type Waypoint } from "@/lib/fleets";
import { nearestPlanet } from "@/lib/routes";
import { availablePlanetAction, INFLUENCE_DURATION_SECONDS } from "@/lib/planet-actions";

// Déclenche une action volontaire à la surface de la planète où le
// vaisseau est actuellement arrêté : aide humanitaire (monde neutre,
// instantané) ou propagation d'influence (monde d'un clan ennemi,
// immobilise le vaisseau 15 min). Accessible avec le code DU VAISSEAU.
export async function POST(request: Request, ctx: RouteContext<"/api/ships/[id]/action">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const type = body?.type;

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });
  if (type !== "humanitarian" && type !== "influence") {
    return NextResponse.json({ error: "action invalide" }, { status: 400 });
  }

  const db = getDatabase();
  const rows = await db.sql<{
    id: string;
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
  }>`
    select s.id, s.code, f.faction, s.x, s.y, s.dest_x, s.dest_y, s.departed_at, s.arrival_at, s.path,
           s.damaged, s.encounter_pending, s.action_ends_at
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
  const available = availablePlanetAction(planet.faction, ship.faction as "republique" | "csi" | "mandalore");
  if (available !== type) {
    return NextResponse.json(
      { error: `cette action n'est pas disponible sur ${planet.name}` },
      { status: 400 },
    );
  }

  if (type === "humanitarian") {
    return NextResponse.json({ ok: true, type, planet: planet.name });
  }

  // propagation d'influence : immobilise le vaisseau 15 minutes
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + INFLUENCE_DURATION_SECONDS * 1000);

  const updated = await db.sql`
    update ships
    set action_type = 'influence', action_started_at = ${startedAt.toISOString()},
        action_ends_at = ${endsAt.toISOString()}, updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
              damaged, encounter_pending, encounter_at, action_type, action_started_at, action_ends_at
  `;

  return NextResponse.json({ ok: true, type, planet: planet.name, ship: updated[0] });
}
