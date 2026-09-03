import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { generateCode } from "@/lib/fleets";

// Modifie une flotte : nom ou code d'accès (Owner uniquement).
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/fleets/[id]">) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "corps invalide" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const regenerateCode = body.regenerateCode === true;
  const explicitCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : undefined;

  const db = getDatabase();

  if (name !== undefined) {
    await db.sql`update fleets set name = ${name}, updated_at = now() where id = ${id}::uuid`;
  }
  if (regenerateCode || explicitCode) {
    const newCode = explicitCode || generateCode();
    try {
      await db.sql`update fleets set code = ${newCode}, updated_at = now() where id = ${id}::uuid`;
    } catch {
      return NextResponse.json({ error: "ce code de flotte existe déjà" }, { status: 409 });
    }
  }

  const rows = await db.sql`
    select id, name, faction, code, created_at, updated_at from fleets where id = ${id}::uuid
  `;
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ fleet: rows[0] });
}

// Supprime une flotte et tous ses vaisseaux (Owner uniquement).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/fleets/[id]">) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const db = getDatabase();
  await db.sql`delete from fleets where id = ${id}::uuid`;
  return NextResponse.json({ deleted: true });
}
