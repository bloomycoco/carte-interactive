import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";

// Le code de VAISSEAU donne le contrôle direct, sans passer par le code
// de la flotte (un capitaine peut avoir uniquement le code de son navire).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });

  const db = getDatabase();
  const rows = await db.sql`
    select s.id, s.name, f.faction, f.name as fleet_name,
           s.x, s.y, s.dest_x, s.dest_y, s.dest_planet, s.departed_at, s.arrival_at
    from ships s
    join fleets f on f.id = s.fleet_id
    where s.code = ${code}
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "code inconnu" }, { status: 404 });

  return NextResponse.json({ ship });
}
