import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";

// Multiplicateur de puissance par camp NPC (Owner uniquement) — permet
// de rééquilibrer la guerre à la volée, ex: freiner la République si
// elle écrase tout le monde. Appliqué à la force de ce camp dans tous
// les combats (rencontres, contre-attaques, attaques de planète).
export async function GET() {
  const role = await requireRole(["owner", "admin"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = getDatabase();
  const rows = await db.sql<{ faction: string; multiplier: number }>`
    select faction, multiplier from npc_difficulty
  `;
  return NextResponse.json({ difficulty: rows });
}

export async function PATCH(request: Request) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const faction = body?.faction;
  const multiplier = Number(body?.multiplier);

  if (faction !== "csi" && faction !== "mandalore" && faction !== "cartel") {
    return NextResponse.json({ error: "camp invalide" }, { status: 400 });
  }
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) {
    return NextResponse.json({ error: "multiplicateur invalide (0 à 10)" }, { status: 400 });
  }

  const db = getDatabase();
  await db.sql`
    update npc_difficulty set multiplier = ${multiplier}, updated_at = now() where faction = ${faction}
  `;
  return NextResponse.json({ faction, multiplier });
}
