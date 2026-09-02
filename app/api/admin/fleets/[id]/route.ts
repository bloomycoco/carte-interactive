import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { generateFleetCode, type Faction } from "@/lib/fleets";

const FACTIONS = ["republique", "csi", "mandalore"] as const;

// Modifie une flotte : nom, faction, position, ou code d'accès
// (Owner uniquement — "peut tout faire").
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/fleets/[id]">) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "corps invalide" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const faction = body.faction as Faction | undefined;
  const hasCoords = body.x !== undefined && body.y !== undefined;
  const x = Number(body.x);
  const y = Number(body.y);
  const regenerateCode = body.regenerateCode === true;
  const explicitCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : undefined;

  const db = getDatabase();

  if (name !== undefined) {
    await db.sql`update fleets set name = ${name}, updated_at = now() where id = ${id}::uuid`;
  }
  if (faction !== undefined) {
    if (!FACTIONS.includes(faction)) {
      return NextResponse.json({ error: "faction invalide" }, { status: 400 });
    }
    await db.sql`update fleets set faction = ${faction}, updated_at = now() where id = ${id}::uuid`;
  }
  if (hasCoords) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return NextResponse.json({ error: "coordonnées invalides" }, { status: 400 });
    }
    // Repositionner "à quai" annule aussi tout trajet en cours.
    await db.sql`
      update fleets
      set x = ${x}, y = ${y}, dest_x = null, dest_y = null, dest_planet = null,
          departed_at = null, arrival_at = null, updated_at = now()
      where id = ${id}::uuid
    `;
  }
  if (regenerateCode || explicitCode) {
    const newCode = explicitCode || generateFleetCode();
    try {
      await db.sql`update fleets set code = ${newCode}, updated_at = now() where id = ${id}::uuid`;
    } catch {
      return NextResponse.json({ error: "ce code de flotte existe déjà" }, { status: 409 });
    }
  }

  const rows = await db.sql`
    select id, name, faction, code, x, y, dest_x, dest_y, dest_planet,
           departed_at, arrival_at, created_at, updated_at
    from fleets
    where id = ${id}::uuid
  `;
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ fleet: rows[0] });
}

// Supprime une flotte (Owner uniquement).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/fleets/[id]">) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const db = getDatabase();
  await db.sql`delete from fleets where id = ${id}::uuid`;
  return NextResponse.json({ deleted: true });
}
