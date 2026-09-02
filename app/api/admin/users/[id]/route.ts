import { admin } from "@netlify/identity";
import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

const ROLES = ["owner", "gm", "player"] as const;
const FACTIONS = ["republique", "csi", "mandalore"] as const;

// Modifie le rôle et/ou la faction d'un compte.
// - role : Owner uniquement (changer qui est GM/Owner/Joueur).
// - faction : Owner ou Maître du Jeu (attribution d'un clan à un joueur).
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const { id } = await ctx.params;
  const actor = await getCurrentProfile();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const role = body?.role;
  const hasRole = role !== undefined;
  const hasFaction = "faction" in (body ?? {});
  const faction = body?.faction;

  if (!hasRole && !hasFaction) {
    return NextResponse.json({ error: "rien à modifier" }, { status: 400 });
  }

  if (hasRole) {
    if (actor.role !== "owner") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: "rôle invalide" }, { status: 400 });
    }
    if (id === actor.id && role !== "owner") {
      return NextResponse.json(
        { error: "impossible de retirer son propre rôle Owner" },
        { status: 400 },
      );
    }
  }

  if (hasFaction) {
    if (actor.role !== "owner" && actor.role !== "gm") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (faction !== null && !FACTIONS.includes(faction)) {
      return NextResponse.json({ error: "faction invalide" }, { status: 400 });
    }
  }

  const db = getDatabase();

  if (hasRole && hasFaction) {
    const rows = await db.sql`
      update profiles
      set role = ${role}, faction = ${faction}, requested_faction = null
      where id = ${id}::uuid
      returning id, email, role, faction, requested_faction
    `;
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ profile: rows[0] });
  }

  if (hasRole) {
    const rows = await db.sql`
      update profiles
      set role = ${role}
      where id = ${id}::uuid
      returning id, email, role, faction, requested_faction
    `;
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ profile: rows[0] });
  }

  const rows = await db.sql`
    update profiles
    set faction = ${faction}, requested_faction = null
    where id = ${id}::uuid
    returning id, email, role, faction, requested_faction
  `;
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ profile: rows[0] });
}

// Supprime un compte (Owner uniquement) : le retire d'Identity puis de la base.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const { id } = await ctx.params;
  const actor = await getCurrentProfile();
  if (!actor || actor.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (id === actor.id) {
    return NextResponse.json(
      { error: "impossible de supprimer son propre compte Owner" },
      { status: 400 },
    );
  }

  await admin.deleteUser(id).catch(() => null);

  const db = getDatabase();
  await db.sql`delete from profiles where id = ${id}::uuid`;

  return NextResponse.json({ deleted: true });
}
