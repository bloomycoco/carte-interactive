import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { fleetStrength } from "@/lib/ship-classes";

// Le code CAPITAINE donne le droit d'envoyer TOUTE la flotte quelque
// part en un ordre (voir POST /api/fleets/[id]/order) — distinct du code
// de flotte (lecture seule) et du code de chaque vaisseau (contrôle
// individuel).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });

  const db = getDatabase();
  const fleets = await db.sql<{
    id: string;
    name: string;
    faction: string;
    kills: number;
    losses: number;
  }>`
    select id, name, faction, kills, losses from fleets where captain_code = ${code}
  `;
  const fleet = fleets[0];
  if (!fleet) return NextResponse.json({ error: "code inconnu" }, { status: 404 });

  const ships = await db.sql<{
    id: string;
    name: string;
    category: string | null;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    dest_planet: string | null;
    departed_at: string | null;
    arrival_at: string | null;
    path: unknown;
    damaged: boolean;
    encounter_pending: boolean;
    encounter_at: string | null;
    action_type: string | null;
    action_started_at: string | null;
    action_ends_at: string | null;
  }>`
    select id, name, category, x, y, dest_x, dest_y, dest_planet, departed_at, arrival_at, path,
           damaged, encounter_pending, encounter_at, action_type, action_started_at, action_ends_at
    from ships
    where fleet_id = ${fleet.id}::uuid
    order by created_at asc
  `;

  const strength = Math.round(fleetStrength(ships, fleet.kills, fleet.losses));

  return NextResponse.json({ fleet: { ...fleet, strength }, ships });
}
