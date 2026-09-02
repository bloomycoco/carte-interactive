import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { currentPosition, planTravelAlongPath, type Waypoint } from "@/lib/fleets";
import { nearestPlanet, shortestPath } from "@/lib/routes";
import { PLANETS } from "@/lib/planets";

// Envoie un vaisseau vers une planète, en suivant le réseau de routes
// (jamais en ligne droite) — la durée dépend de la distance réelle par
// les routes. Accessible à quiconque connaît le code DU VAISSEAU (le
// code de sa flotte ne suffit pas).
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
    name: string;
    code: string;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    departed_at: string | null;
    arrival_at: string | null;
    path: Waypoint[] | null;
  }>`
    select id, name, code, x, y, dest_x, dest_y, departed_at, arrival_at, path
    from ships
    where id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });

  const origin = currentPosition(ship);
  const originPlanet = nearestPlanet(origin.x, origin.y);
  const routePath = shortestPath(originPlanet.name, destination.name);
  if (!routePath) {
    return NextResponse.json({ error: "aucune route connue vers cette destination" }, { status: 400 });
  }

  const waypoints: Waypoint[] = [
    { x: origin.x, y: origin.y },
    ...routePath.map((p) => ({ x: p.x, y: p.y })),
  ];
  const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);

  const updated = await db.sql`
    update ships
    set x = ${origin.x}, y = ${origin.y},
        dest_x = ${destination.x}, dest_y = ${destination.y}, dest_planet = ${destination.name},
        path = ${JSON.stringify(waypoints)}::jsonb,
        departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
        updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at
  `;

  return NextResponse.json({ ship: updated[0] });
}
