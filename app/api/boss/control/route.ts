import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  BOSS_NAME,
  BOSS_HITS_REQUIRED,
  BOSS_WIN_CHANCE,
  isValidBossTarget,
  pickBossSpawnPlanet,
} from "@/lib/fleets";

// Contrôle du boss galactique, gardé par un code secret (BOSS_CONTROL_
// CODE, variable d'environnement — jamais exposé au client, jamais
// commité) plutôt que par le rôle Owner : n'importe qui connaît ce code
// peut agir, indépendamment de toute session. Saisi comme un code de
// flotte/vaisseau normal dans "Mes Flottes" (voir unlockAny côté
// client), il révèle deux actions : Spawn/Despawn et Focus (cibler une
// planète à capturer OU un vaisseau précis à traquer — mutuellement
// exclusifs).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const secret = process.env.BOSS_CONTROL_CODE;
  if (!secret || !code || code !== secret) {
    return NextResponse.json({ error: "code incorrect" }, { status: 403 });
  }

  const action = body?.action;
  const db = getDatabase();

  if (action === "check") {
    const [boss] = await db.sql<{ id: string }>`select id from boss where alive = true limit 1`;
    return NextResponse.json({ ok: true, bossAlive: !!boss });
  }

  if (action === "spawn") {
    const [existing] = await db.sql<{ id: string }>`select id from boss where alive = true limit 1`;
    if (existing) return NextResponse.json({ error: "un boss est déjà actif" }, { status: 409 });
    const spawnPlanet = pickBossSpawnPlanet();
    const [created] = await db.sql<{ id: string; name: string; x: number; y: number }>`
      insert into boss (name, x, y, hits_required, win_chance)
      values (${BOSS_NAME}, ${spawnPlanet.x}, ${spawnPlanet.y}, ${BOSS_HITS_REQUIRED}, ${BOSS_WIN_CHANCE})
      returning id, name, x, y
    `;
    return NextResponse.json({ ok: true, boss: created, spawnPlanet: spawnPlanet.name });
  }

  if (action === "despawn") {
    const [boss] = await db.sql<{ id: string }>`select id from boss where alive = true limit 1`;
    if (!boss) return NextResponse.json({ error: "aucun boss actif" }, { status: 404 });
    await db.sql`update boss set alive = false, updated_at = now() where id = ${boss.id}::uuid`;
    await db.sql`update ships set chasing_boss_id = null, updated_at = now() where chasing_boss_id = ${boss.id}::uuid`;
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

  if (action === "focus-planet") {
    const targetPlanet = typeof body?.planetName === "string" ? body.planetName : "";
    if (!targetPlanet || !isValidBossTarget(targetPlanet)) {
      return NextResponse.json({ error: "planète invalide (jamais Coruscant)" }, { status: 400 });
    }
    const [boss] = await db.sql<{ id: string }>`select id from boss where alive = true limit 1`;
    if (!boss) return NextResponse.json({ error: "aucun boss actif" }, { status: 404 });
    await db.sql`
      update boss set target_planet = ${targetPlanet}, target_ship_id = null, updated_at = now()
      where id = ${boss.id}::uuid
    `;
    return NextResponse.json({ ok: true, targetPlanet });
  }

  if (action === "focus-ship") {
    const query = typeof body?.shipQuery === "string" ? body.shipQuery.trim() : "";
    if (!query) return NextResponse.json({ error: "nom ou code de vaisseau requis" }, { status: 400 });
    const [boss] = await db.sql<{ id: string }>`select id from boss where alive = true limit 1`;
    if (!boss) return NextResponse.json({ error: "aucun boss actif" }, { status: 404 });
    const [ship] = await db.sql<{ id: string; name: string }>`
      select s.id, s.name from ships s
      join fleets f on f.id = s.fleet_id
      where f.faction = 'republique' and f.is_npc = false
        and (upper(s.name) = upper(${query}) or upper(s.code) = upper(${query}))
      limit 1
    `;
    if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
    await db.sql`
      update boss set target_ship_id = ${ship.id}::uuid, target_planet = null, updated_at = now()
      where id = ${boss.id}::uuid
    `;
    return NextResponse.json({ ok: true, targetShip: ship.name });
  }

  if (action === "clear-focus") {
    const [boss] = await db.sql<{ id: string }>`select id from boss where alive = true limit 1`;
    if (!boss) return NextResponse.json({ error: "aucun boss actif" }, { status: 404 });
    await db.sql`
      update boss set target_planet = null, target_ship_id = null, updated_at = now()
      where id = ${boss.id}::uuid
    `;
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "action invalide" }, { status: 400 });
}
