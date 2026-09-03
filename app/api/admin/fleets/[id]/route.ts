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
  const regenerateCaptainCode = body.regenerateCaptainCode === true;
  const explicitCaptainCode =
    typeof body.captainCode === "string" ? body.captainCode.trim().toUpperCase() : undefined;

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
  if (regenerateCaptainCode || explicitCaptainCode) {
    const newCaptainCode = explicitCaptainCode || generateCode();
    try {
      await db.sql`update fleets set captain_code = ${newCaptainCode}, updated_at = now() where id = ${id}::uuid`;
    } catch {
      return NextResponse.json({ error: "ce code Capitaine existe déjà" }, { status: 409 });
    }
  }

  const rows = await db.sql`
    select id, name, faction, code, captain_code, created_at, updated_at from fleets where id = ${id}::uuid
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
  // les vaisseaux NPC croisés par ceux de cette flotte, s'il y en a, ne
  // doivent pas rester figés pour toujours une fois leurs adversaires
  // supprimés avec la flotte
  const linked = await db.sql<{ encounter_npc_ship_id: string }>`
    select encounter_npc_ship_id from ships
    where fleet_id = ${id}::uuid and encounter_npc_ship_id is not null
  `;
  for (const { encounter_npc_ship_id } of linked) {
    await db.sql`
      update ships
      set encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
          updated_at = now()
      where id = ${encounter_npc_ship_id}::uuid
    `;
  }
  await db.sql`delete from fleets where id = ${id}::uuid`;
  return NextResponse.json({ deleted: true });
}
