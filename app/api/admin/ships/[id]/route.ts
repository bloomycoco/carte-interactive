import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { generateCode } from "@/lib/fleets";

// Modifie un vaisseau : nom, position, ou code d'accès (Owner uniquement).
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/ships/[id]">) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "corps invalide" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const hasCategory = "category" in body;
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;
  const hasCoords = body.x !== undefined && body.y !== undefined;
  const x = Number(body.x);
  const y = Number(body.y);
  const regenerateCode = body.regenerateCode === true;
  const explicitCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : undefined;

  const db = getDatabase();

  if (name !== undefined) {
    await db.sql`update ships set name = ${name}, updated_at = now() where id = ${id}::uuid`;
  }
  if (hasCategory) {
    await db.sql`update ships set category = ${category}, updated_at = now() where id = ${id}::uuid`;
  }
  if (hasCoords) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return NextResponse.json({ error: "coordonnées invalides" }, { status: 400 });
    }
    // le vaisseau NPC croisé, s'il y en a un, ne doit pas rester figé pour
    // toujours si CE vaisseau-ci est téléporté au lieu de résoudre sa
    // rencontre normalement
    const [current] = await db.sql<{ encounter_npc_ship_id: string | null }>`
      select encounter_npc_ship_id from ships where id = ${id}::uuid
    `;
    if (current?.encounter_npc_ship_id) {
      await db.sql`
        update ships
        set encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
            updated_at = now()
        where id = ${current.encounter_npc_ship_id}::uuid
      `;
    }
    // Téléporter annule tout trajet en cours et répare le vaisseau
    // (échappatoire Owner à un vaisseau endommagé ou bloqué).
    await db.sql`
      update ships
      set x = ${x}, y = ${y}, dest_x = null, dest_y = null, dest_planet = null,
          path = null, departed_at = null, arrival_at = null, damaged = false,
          encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
          encounter_win_chance = null, encounter_enemy_faction = null, encounter_npc_ship_id = null,
          action_type = null, action_started_at = null, action_ends_at = null,
          quest_type = null, quest_origin_planet = null, quest_target_planet = null, quest_phase = null,
          updated_at = now()
      where id = ${id}::uuid
    `;
  }
  if (regenerateCode || explicitCode) {
    const newCode = explicitCode || generateCode();
    try {
      await db.sql`update ships set code = ${newCode}, updated_at = now() where id = ${id}::uuid`;
    } catch {
      return NextResponse.json({ error: "ce code de vaisseau existe déjà" }, { status: 409 });
    }
  }

  const rows = await db.sql`
    select id, fleet_id, name, category, code, x, y, dest_x, dest_y, dest_planet,
           departed_at, arrival_at, damaged, encounter_pending, action_type, action_started_at,
           action_ends_at, created_at, updated_at
    from ships
    where id = ${id}::uuid
  `;
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ship: rows[0] });
}

// Supprime un vaisseau (Owner uniquement).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/ships/[id]">) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  const db = getDatabase();
  const [current] = await db.sql<{ encounter_npc_ship_id: string | null }>`
    select encounter_npc_ship_id from ships where id = ${id}::uuid
  `;
  if (current?.encounter_npc_ship_id) {
    await db.sql`
      update ships
      set encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
          updated_at = now()
      where id = ${current.encounter_npc_ship_id}::uuid
    `;
  }
  await db.sql`delete from ships where id = ${id}::uuid`;
  return NextResponse.json({ deleted: true });
}
