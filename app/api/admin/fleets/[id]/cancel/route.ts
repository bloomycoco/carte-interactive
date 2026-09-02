import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { currentPosition } from "@/lib/fleets";

// Annule le trajet en cours d'une flotte : elle se fige à sa position
// actuelle (Owner et Admin — "peut retirer une action").
export async function POST(_request: Request, ctx: RouteContext<"/api/admin/fleets/[id]/cancel">) {
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
    select x, y, dest_x, dest_y, departed_at, arrival_at from fleets where id = ${id}::uuid
  `;
  const fleet = rows[0];
  if (!fleet) return NextResponse.json({ error: "flotte introuvable" }, { status: 404 });

  const pos = currentPosition(fleet);

  const updated = await db.sql`
    update fleets
    set x = ${pos.x}, y = ${pos.y}, dest_x = null, dest_y = null, dest_planet = null,
        departed_at = null, arrival_at = null, updated_at = now()
    where id = ${id}::uuid
    returning id, name, faction, code, x, y, dest_x, dest_y, dest_planet,
              departed_at, arrival_at, created_at, updated_at
  `;

  return NextResponse.json({ fleet: updated[0] });
}
