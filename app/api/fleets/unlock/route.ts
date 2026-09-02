import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";

// Un joueur "déverrouille" une flotte avec son code. On renvoie son
// identité mais jamais le code lui-même (déjà connu de l'appelant) :
// le navigateur le garde en mémoire locale pour les futurs ordres.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) {
    return NextResponse.json({ error: "code requis" }, { status: 400 });
  }

  const db = getDatabase();
  const rows = await db.sql`
    select id, name, faction, x, y, dest_x, dest_y, dest_planet, departed_at, arrival_at
    from fleets
    where code = ${code}
  `;
  const fleet = rows[0];
  if (!fleet) {
    return NextResponse.json({ error: "code inconnu" }, { status: 404 });
  }

  return NextResponse.json({ fleet });
}
