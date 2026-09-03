import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { currentPosition, type Waypoint } from "@/lib/fleets";

// Annule le trajet (ou l'action/saisie) en cours d'un vaisseau : il se
// fige à sa position actuelle et redevient libre (Owner et Admin).
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
    path: Waypoint[] | null;
    encounter_pending: boolean;
    encounter_at: string | null;
  }>`
    select x, y, dest_x, dest_y, departed_at, arrival_at, path, encounter_pending, encounter_at
    from ships where id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });

  const pos = currentPosition(ship);

  const updated = await db.sql`
    update ships
    set x = ${pos.x}, y = ${pos.y}, dest_x = null, dest_y = null, dest_planet = null,
        path = null, departed_at = null, arrival_at = null,
        encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
        action_type = null, action_started_at = null, action_ends_at = null,
        updated_at = now()
    where id = ${id}::uuid
    returning id, fleet_id, name, category, code, x, y, dest_x, dest_y, dest_planet,
              departed_at, arrival_at, damaged, encounter_pending, action_type, action_started_at,
              action_ends_at, created_at, updated_at
  `;

  return NextResponse.json({ ship: updated[0] });
}
