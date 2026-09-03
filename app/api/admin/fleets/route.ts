import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { generateCode, type Faction } from "@/lib/fleets";
import { fleetStrength } from "@/lib/ship-classes";

const FACTIONS = ["republique", "csi", "mandalore"] as const;

// Liste des flottes AVEC leur code et leurs vaisseaux (codes inclus)
// (Owner et Admin uniquement).
export async function GET() {
  const role = await requireRole(["owner", "admin"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = getDatabase();
  const fleets = await db.sql<{
    id: string;
    name: string;
    faction: Faction;
    code: string;
    kills: number;
    losses: number;
    created_at: string;
    updated_at: string;
  }>`
    select id, name, faction, code, kills, losses, created_at, updated_at
    from fleets order by created_at asc
  `;
  const ships = await db.sql<{
    id: string;
    fleet_id: string;
    name: string;
    category: string | null;
    code: string;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    dest_planet: string | null;
    departed_at: string | null;
    arrival_at: string | null;
    damaged: boolean;
    encounter_pending: boolean;
    action_type: string | null;
    action_started_at: string | null;
    action_ends_at: string | null;
    created_at: string;
    updated_at: string;
  }>`
    select id, fleet_id, name, category, code, x, y, dest_x, dest_y, dest_planet,
           departed_at, arrival_at, damaged, encounter_pending, action_type, action_started_at,
           action_ends_at, created_at, updated_at
    from ships
    order by created_at asc
  `;

  const withShips = fleets.map((f) => {
    const fleetShips = ships.filter((s) => s.fleet_id === f.id);
    return { ...f, strength: Math.round(fleetStrength(fleetShips, f.kills, f.losses)), ships: fleetShips };
  });

  return NextResponse.json({ fleets: withShips });
}

// Crée une flotte (Owner uniquement). Génère un code si aucun n'est fourni.
export async function POST(request: Request) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const faction = body?.faction as Faction | undefined;
  const code =
    typeof body?.code === "string" && body.code.trim()
      ? body.code.trim().toUpperCase()
      : generateCode();

  if (!name) return NextResponse.json({ error: "nom requis" }, { status: 400 });
  if (!faction || !FACTIONS.includes(faction)) {
    return NextResponse.json({ error: "faction invalide" }, { status: 400 });
  }

  const db = getDatabase();
  try {
    const rows = await db.sql`
      insert into fleets (name, faction, code)
      values (${name}, ${faction}, ${code})
      returning id, name, faction, code, kills, losses, created_at, updated_at
    `;
    return NextResponse.json({ fleet: { ...rows[0], strength: fleetStrength([], 0, 0), ships: [] } });
  } catch {
    return NextResponse.json({ error: "ce code de flotte existe déjà" }, { status: 409 });
  }
}
