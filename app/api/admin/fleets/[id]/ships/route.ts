import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { generateCode } from "@/lib/fleets";

// Crée un vaisseau dans une flotte (Owner uniquement).
export async function POST(request: Request, ctx: RouteContext<"/api/admin/fleets/[id]/ships">) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const x = Number(body?.x);
  const y = Number(body?.y);
  const code =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim().toUpperCase()
      : generateCode();

  if (!name) return NextResponse.json({ error: "nom requis" }, { status: 400 });
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "coordonnées invalides" }, { status: 400 });
  }

  const db = getDatabase();
  const fleetRows = await db.sql`select id from fleets where id = ${id}::uuid`;
  if (!fleetRows[0]) return NextResponse.json({ error: "flotte introuvable" }, { status: 404 });

  try {
    const rows = await db.sql`
      insert into ships (fleet_id, name, code, x, y)
      values (${id}::uuid, ${name}, ${code}, ${x}, ${y})
      returning id, fleet_id, name, code, x, y, dest_x, dest_y, dest_planet,
                departed_at, arrival_at, created_at, updated_at
    `;
    return NextResponse.json({ ship: rows[0] });
  } catch {
    return NextResponse.json({ error: "ce code de vaisseau existe déjà" }, { status: 409 });
  }
}
