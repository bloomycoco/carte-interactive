import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

// Liste des comptes (Owner et Maître du Jeu, pour gérer rôles/factions).
export async function GET() {
  const profile = await requireRole(["owner", "gm"]);
  if (!profile) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = getDatabase();
  const users = await db.sql`
    select id, email, role, faction, requested_faction, created_at
    from profiles
    order by created_at asc
  `;

  return NextResponse.json({ users });
}
