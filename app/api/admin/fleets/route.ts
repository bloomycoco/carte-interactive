import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { generateFleetCode, type Faction } from "@/lib/fleets";

const FACTIONS = ["republique", "csi", "mandalore"] as const;

// Liste des flottes AVEC leur code (Owner et Admin uniquement).
export async function GET() {
  const role = await requireRole(["owner", "admin"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = getDatabase();
  const fleets = await db.sql`
    select id, name, faction, code, x, y, dest_x, dest_y, dest_planet,
           departed_at, arrival_at, created_at, updated_at
    from fleets
    order by created_at asc
  `;
  return NextResponse.json({ fleets });
}

// Crée une flotte (Owner uniquement). Génère un code si aucun n'est fourni.
export async function POST(request: Request) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const faction = body?.faction as Faction | undefined;
  const x = Number(body?.x);
  const y = Number(body?.y);
  const code =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim().toUpperCase()
      : generateFleetCode();

  if (!name) return NextResponse.json({ error: "nom requis" }, { status: 400 });
  if (!faction || !FACTIONS.includes(faction)) {
    return NextResponse.json({ error: "faction invalide" }, { status: 400 });
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "coordonnées invalides" }, { status: 400 });
  }

  const db = getDatabase();
  try {
    const rows = await db.sql`
      insert into fleets (name, faction, code, x, y)
      values (${name}, ${faction}, ${code}, ${x}, ${y})
      returning id, name, faction, code, x, y, dest_x, dest_y, dest_planet,
                departed_at, arrival_at, created_at, updated_at
    `;
    return NextResponse.json({ fleet: rows[0] });
  } catch {
    return NextResponse.json({ error: "ce code de flotte existe déjà" }, { status: 409 });
  }
}
