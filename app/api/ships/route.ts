import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";

// Liste publique de tous les vaisseaux, pour les afficher sur la carte.
// Ni le code du vaisseau ni celui de sa flotte ne sont renvoyés ici.
export async function GET() {
  const db = getDatabase();
  const ships = await db.sql`
    select s.id, s.name, s.category, f.faction, s.x, s.y, s.dest_x, s.dest_y, s.dest_planet,
           s.departed_at, s.arrival_at
    from ships s
    join fleets f on f.id = s.fleet_id
    order by s.created_at asc
  `;
  return NextResponse.json({ ships });
}
