import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";

// Liste publique des flottes, pour les afficher sur la carte. Le code
// n'est jamais renvoyé ici (il faut le connaître pour agir sur une flotte).
export async function GET() {
  const db = getDatabase();
  const fleets = await db.sql`
    select id, name, faction, x, y, dest_x, dest_y, dest_planet, departed_at, arrival_at
    from fleets
    order by created_at asc
  `;
  return NextResponse.json({ fleets });
}
