import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

const FACTIONS = ["republique", "csi", "mandalore"] as const;

// Un joueur demande un clan (CSI / République / Mandalorien). Reste en
// attente jusqu'à validation par un Maître du Jeu ou l'Owner.
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const faction = body?.faction;
  if (!FACTIONS.includes(faction)) {
    return NextResponse.json({ error: "faction invalide" }, { status: 400 });
  }

  const db = getDatabase();
  const rows = await db.sql`
    update profiles
    set requested_faction = ${faction}
    where id = ${profile.id}::uuid
    returning id, email, role, faction, requested_faction
  `;

  return NextResponse.json({ profile: rows[0] });
}
