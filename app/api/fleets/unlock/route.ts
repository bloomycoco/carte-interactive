import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";

// Le code de FLOTTE donne un accès en LECTURE : la liste de ses vaisseaux
// et leur statut, mais pas leur code — donc pas le contrôle. Il faut le
// code de chaque vaisseau pour lui donner des ordres.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });

  const db = getDatabase();
  const fleets = await db.sql`
    select id, name, faction from fleets where code = ${code}
  `;
  const fleet = fleets[0];
  if (!fleet) return NextResponse.json({ error: "code inconnu" }, { status: 404 });

  const ships = await db.sql`
    select id, name, category, x, y, dest_x, dest_y, dest_planet, departed_at, arrival_at, path,
           damaged, encounter_pending, encounter_at
    from ships
    where fleet_id = ${fleet.id}::uuid
    order by created_at asc
  `;

  return NextResponse.json({ fleet, ships });
}
