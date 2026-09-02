import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { currentPosition, planTravel } from "@/lib/fleets";

// Envoie un vaisseau vers une planète. Accessible à quiconque connaît le
// code DU VAISSEAU (le code de sa flotte ne suffit pas).
export async function POST(request: Request, ctx: RouteContext<"/api/ships/[id]/order">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const destPlanet = typeof body?.destPlanet === "string" ? body.destPlanet : "";
  const destX = Number(body?.destX);
  const destY = Number(body?.destY);

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });
  if (!destPlanet || !Number.isFinite(destX) || !Number.isFinite(destY)) {
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
  }>`
    select id, name, code, x, y, dest_x, dest_y, departed_at, arrival_at
    from ships
    where id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });

  const origin = currentPosition(ship);
  const { departedAt, arrivalAt } = planTravel(origin, { x: destX, y: destY });

  const updated = await db.sql`
    update ships
    set x = ${origin.x}, y = ${origin.y},
        dest_x = ${destX}, dest_y = ${destY}, dest_planet = ${destPlanet},
        departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
        updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, departed_at, arrival_at
  `;

  return NextResponse.json({ ship: updated[0] });
}
