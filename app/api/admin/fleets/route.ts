import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

const FACTIONS = ["republique", "csi", "mandalore"] as const;

// Liste des flottes (Owner et Maître du Jeu).
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "owner" && profile.role !== "gm")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = getDatabase();
  const fleets = await db.sql`
    select f.id, f.name, f.faction, f.owner_profile_id, f.x, f.y,
           f.current_planet, f.created_at, f.updated_at, p.email as owner_email
    from fleets f
    left join profiles p on p.id = f.owner_profile_id
    order by f.created_at asc
  `;

  return NextResponse.json({ fleets });
}

// Crée une flotte (Owner uniquement).
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const faction = body?.faction;
  const x = Number(body?.x);
  const y = Number(body?.y);

  if (!name) {
    return NextResponse.json({ error: "nom requis" }, { status: 400 });
  }
  if (!FACTIONS.includes(faction)) {
    return NextResponse.json({ error: "faction invalide" }, { status: 400 });
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "coordonnées invalides" }, { status: 400 });
  }

  const db = getDatabase();
  const rows = await db.sql`
    insert into fleets (name, faction, x, y)
    values (${name}, ${faction}, ${x}, ${y})
    returning id, name, faction, owner_profile_id, x, y, current_planet, created_at, updated_at
  `;

  return NextResponse.json({ fleet: rows[0] });
}
