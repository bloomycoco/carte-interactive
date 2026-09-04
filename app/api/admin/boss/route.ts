import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { BOSS_NAME, BOSS_HITS_REQUIRED, BOSS_WIN_CHANCE, isValidBossTarget, pickBossSpawnPlanet } from "@/lib/fleets";

// Statut du boss galactique (Owner/Admin) — vivant ou non, position,
// progression, planètes capturées ("Hostile", verdies sur la carte).
export async function GET() {
  const role = await requireRole(["owner", "admin"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = getDatabase();
  const [boss] = await db.sql<{
    id: string;
    name: string;
    x: number;
    y: number;
    dest_planet: string | null;
    hits: number;
    hits_required: number;
    target_planet: string | null;
    spawned_at: string;
  }>`
    select id, name, x, y, dest_planet, hits, hits_required, target_planet, spawned_at
    from boss where alive = true order by spawned_at desc limit 1
  `;
  const hostileRows = await db.sql<{ planet_name: string; captured_at: string }>`
    select planet_name, captured_at from boss_hostile_planets order by captured_at desc
  `;
  return NextResponse.json({ boss: boss ?? null, hostilePlanets: hostileRows });
}

// Fait apparaître le boss sur une planète aléatoire (jamais Coruscant) —
// refusé s'il en existe déjà un vivant (un seul boss à la fois).
export async function POST() {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = getDatabase();
  const [existing] = await db.sql<{ id: string }>`select id from boss where alive = true limit 1`;
  if (existing) {
    return NextResponse.json({ error: "un boss est déjà actif" }, { status: 409 });
  }

  const spawnPlanet = pickBossSpawnPlanet();
  const [created] = await db.sql<{ id: string; name: string; x: number; y: number }>`
    insert into boss (name, x, y, hits_required, win_chance)
    values (${BOSS_NAME}, ${spawnPlanet.x}, ${spawnPlanet.y}, ${BOSS_HITS_REQUIRED}, ${BOSS_WIN_CHANCE})
    returning id, name, x, y
  `;
  return NextResponse.json({ boss: created, spawnPlanet: spawnPlanet.name });
}

// Ordonne au boss de capturer une planète précise (targetPlanet) ou
// annule la directive en cours (targetPlanet: null, reprend un
// vagabondage aléatoire).
export async function PATCH(request: Request) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const targetPlanet = body?.targetPlanet;
  if (targetPlanet !== null && typeof targetPlanet !== "string") {
    return NextResponse.json({ error: "targetPlanet requis (ou null)" }, { status: 400 });
  }
  if (targetPlanet !== null && !isValidBossTarget(targetPlanet)) {
    return NextResponse.json({ error: "planète invalide (jamais Coruscant)" }, { status: 400 });
  }

  const db = getDatabase();
  const [boss] = await db.sql<{ id: string }>`select id from boss where alive = true limit 1`;
  if (!boss) return NextResponse.json({ error: "aucun boss actif" }, { status: 404 });

  await db.sql`update boss set target_planet = ${targetPlanet}, updated_at = now() where id = ${boss.id}::uuid`;
  return NextResponse.json({ ok: true, targetPlanet });
}

// Fait disparaître le boss actif (nettoyage / fin de partie manuelle) —
// libère aussi tous les vaisseaux qui le prenaient en chasse.
export async function DELETE() {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = getDatabase();
  const [boss] = await db.sql<{ id: string }>`select id from boss where alive = true limit 1`;
  if (!boss) return NextResponse.json({ error: "aucun boss actif" }, { status: 404 });

  await db.sql`update boss set alive = false, updated_at = now() where id = ${boss.id}::uuid`;
  await db.sql`
    update ships
    set chasing_boss_id = null, updated_at = now()
    where chasing_boss_id = ${boss.id}::uuid
  `;
  await db.sql`
    update ships
    set encounter_pending = false, encounter_at = null, encounter_x = null, encounter_y = null,
        encounter_win_chance = null, encounter_kind = null, updated_at = now()
    where encounter_kind = 'boss'
  `;
  // sans boss, plus personne ne contrôle les planètes qu'il avait
  // capturées — elles redeviennent normales (plus de "Hostile" vert)
  await db.sql`delete from boss_hostile_planets`;
  return NextResponse.json({ ok: true });
}
