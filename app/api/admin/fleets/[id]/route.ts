import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

// Modifie une flotte : attribution à un joueur, déplacement, renommage
// (Owner et Maître du Jeu — l'"attribution" du spec).
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/fleets/[id]">) {
  const { id } = await ctx.params;
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "owner" && profile.role !== "gm")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }

  const fields: string[] = [];
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const hasOwner = "owner_profile_id" in body;
  const ownerProfileId = body.owner_profile_id as string | null | undefined;
  const hasCoords = body.x !== undefined && body.y !== undefined;
  const x = Number(body.x);
  const y = Number(body.y);
  const hasPlanet = "current_planet" in body;
  const currentPlanet = body.current_planet as string | null | undefined;

  const db = getDatabase();

  if (name !== undefined) fields.push("name");
  if (hasOwner) fields.push("owner_profile_id");
  if (hasCoords) fields.push("coords");
  if (hasPlanet) fields.push("current_planet");

  if (fields.length === 0) {
    return NextResponse.json({ error: "rien à modifier" }, { status: 400 });
  }

  // On applique les changements un par un pour rester simple avec le
  // tagged-template SQL (pas de construction dynamique de requête).
  if (name !== undefined) {
    await db.sql`update fleets set name = ${name}, updated_at = now() where id = ${id}::uuid`;
  }
  if (hasOwner) {
    await db.sql`update fleets set owner_profile_id = ${ownerProfileId}::uuid, updated_at = now() where id = ${id}::uuid`;
  }
  if (hasCoords) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return NextResponse.json({ error: "coordonnées invalides" }, { status: 400 });
    }
    await db.sql`update fleets set x = ${x}, y = ${y}, updated_at = now() where id = ${id}::uuid`;
  }
  if (hasPlanet) {
    await db.sql`update fleets set current_planet = ${currentPlanet}, updated_at = now() where id = ${id}::uuid`;
  }

  const rows = await db.sql`
    select id, name, faction, owner_profile_id, x, y, current_planet, created_at, updated_at
    from fleets
    where id = ${id}::uuid
  `;
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ fleet: rows[0] });
}

// Supprime une flotte (Owner uniquement).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/fleets/[id]">) {
  const { id } = await ctx.params;
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = getDatabase();
  await db.sql`delete from fleets where id = ${id}::uuid`;

  return NextResponse.json({ deleted: true });
}
