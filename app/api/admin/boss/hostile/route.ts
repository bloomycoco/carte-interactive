import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";

// Libère une planète capturée par le boss ("Hostile" → redevient sa
// couleur normale sur la carte) — indépendant du sort du boss lui-même.
export async function DELETE(request: Request) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const planetName = typeof body?.planetName === "string" ? body.planetName : "";
  if (!planetName) return NextResponse.json({ error: "planetName requis" }, { status: 400 });

  const db = getDatabase();
  await db.sql`delete from boss_hostile_planets where planet_name = ${planetName}`;
  return NextResponse.json({ ok: true });
}
