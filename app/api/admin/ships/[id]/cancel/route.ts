import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { currentPosition } from "@/lib/fleets";

// Annule le trajet en cours d'un vaisseau : il se fige à sa position
// actuelle (Owner et Admin).
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/ships/[id]/cancel">) {
  const role = await requireRole(["owner", "admin"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const db = getDatabase();
  const rows = await db.sql<{
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    departed_at: string | null;
    arrival_at: string | null;
  }>`
    select x, y, dest_x, dest_y, departed_at, arrival_at from ships where id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });

  const pos = currentPosition(ship);

  const updated = await db.sql`
    update ships
    set x = ${pos.x}, y = ${pos.y}, dest_x = null, dest_y = null, dest_planet = null,
        departed_at = null, arrival_at = null, updated_at = now()
    where id = ${id}::uuid
    returning id, fleet_id, name, code, x, y, dest_x, dest_y, dest_planet,
              departed_at, arrival_at, created_at, updated_at
  `;

  return NextResponse.json({ ship: updated[0] });
}
