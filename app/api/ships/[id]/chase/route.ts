import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { currentPosition, rollEncounterOdds } from "@/lib/fleets";
import { fleetStrength } from "@/lib/ship-classes";

// Prend un NPC en chasse : déclenche IMMÉDIATEMENT une rencontre entre
// ce vaisseau République et le NPC ciblé, où qu'ils se trouvent — pas
// besoin d'attendre un croisement fortuit. Résolue ensuite comme une
// rencontre normale (Combattre / Négocier / Fuir) via
// POST /api/ships/[id]/resolve-encounter. Accessible avec le code DU
// VAISSEAU.
export async function POST(request: Request, ctx: RouteContext<"/api/ships/[id]/chase">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: "cible requise" }, { status: 400 });

  const db = getDatabase();
  const rows = await db.sql<{
    id: string;
    fleet_id: string;
    code: string;
    faction: string;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    departed_at: string | null;
    arrival_at: string | null;
    damaged: boolean;
    encounter_pending: boolean;
    action_started_at: string | null;
    action_ends_at: string | null;
  }>`
    select s.id, s.fleet_id, s.code, f.faction, s.x, s.y, s.dest_x, s.dest_y,
           s.departed_at, s.arrival_at, s.damaged, s.encounter_pending,
           s.action_started_at, s.action_ends_at
    from ships s
    join fleets f on f.id = s.fleet_id
    where s.id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });
  if (ship.faction !== "republique") {
    return NextResponse.json({ error: "seule la République peut prendre un NPC en chasse" }, { status: 400 });
  }
  if (ship.damaged) {
    return NextResponse.json({ error: "vaisseau endommagé : doit d'abord rallier Coruscant" }, { status: 400 });
  }
  if (ship.encounter_pending) {
    return NextResponse.json({ error: "une rencontre en cours doit être résolue d'abord" }, { status: 400 });
  }
  const now = Date.now();
  if (
    ship.action_started_at &&
    ship.action_ends_at &&
    new Date(ship.action_started_at).getTime() <= now &&
    new Date(ship.action_ends_at).getTime() > now
  ) {
    return NextResponse.json({ error: "le vaisseau est immobilisé pour le moment" }, { status: 400 });
  }

  const targetRows = await db.sql<{
    id: string;
    fleet_id: string;
    faction: "republique" | "csi" | "mandalore" | "cartel";
    is_npc: boolean;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    departed_at: string | null;
    arrival_at: string | null;
    damaged: boolean;
    encounter_pending: boolean;
  }>`
    select s.id, s.fleet_id, f.faction, f.is_npc, s.x, s.y, s.dest_x, s.dest_y,
           s.departed_at, s.arrival_at, s.damaged, s.encounter_pending
    from ships s
    join fleets f on f.id = s.fleet_id
    where s.id = ${targetId}::uuid
  `;
  const target = targetRows[0];
  if (!target || !target.is_npc) {
    return NextResponse.json({ error: "cible invalide" }, { status: 400 });
  }
  if (target.damaged || target.encounter_pending) {
    return NextResponse.json({ error: "cette flotte n'est plus disponible" }, { status: 400 });
  }

  const pos = currentPosition(ship);
  const targetPos = currentPosition(target);

  const fleetShips = await db.sql<{ category: string | null }>`
    select category from ships where fleet_id = ${ship.fleet_id}::uuid
  `;
  const [fleetRow] = await db.sql<{ kills: number; losses: number }>`
    select kills, losses from fleets where id = ${ship.fleet_id}::uuid
  `;
  const strength = fleetStrength(fleetShips, fleetRow?.kills ?? 0, fleetRow?.losses ?? 0);
  const winChance = rollEncounterOdds(strength);
  const encounterAtIso = new Date(now).toISOString();

  const updated = await db.sql`
    update ships
    set encounter_pending = true, encounter_at = ${encounterAtIso}, encounter_win_chance = ${winChance},
        encounter_x = ${pos.x}, encounter_y = ${pos.y}, encounter_enemy_faction = ${target.faction},
        encounter_npc_ship_id = ${target.id}::uuid, encounter_kind = 'chase',
        updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
              damaged, encounter_pending, encounter_at, encounter_win_chance, encounter_enemy_faction
  `;
  await db.sql`
    update ships
    set encounter_pending = true, encounter_at = ${encounterAtIso},
        encounter_x = ${targetPos.x}, encounter_y = ${targetPos.y}, encounter_kind = 'chase',
        updated_at = now()
    where id = ${target.id}::uuid
  `;

  return NextResponse.json({ ship: updated[0] });
}
