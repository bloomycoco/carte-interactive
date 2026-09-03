import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  generateCode,
  pickNpcFleetFlavor,
  pickNpcSpawnPlanet,
  NPC_FACTIONS,
  NPC_FLEET_TARGET_COUNT,
} from "@/lib/fleets";

// Force la réapparition immédiate de toute flotte NPC sans vaisseau
// (au lieu d'attendre son délai de respawn normal), et complète chaque
// camp jusqu'à NPC_FLEET_TARGET_COUNT s'il en manque (Owner uniquement).
export async function POST() {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = getDatabase();
  let spawned = 0;

  for (const faction of NPC_FACTIONS) {
    const emptyFleets = await db.sql<{ id: string; name: string }>`
      select f.id, f.name
      from fleets f
      left join ships s on s.fleet_id = f.id
      where f.is_npc = true and f.faction = ${faction}
      group by f.id, f.name
      having count(s.id) = 0
    `;
    for (const fleet of emptyFleets) {
      const { category } = pickNpcFleetFlavor(faction);
      const spawnPlanet = pickNpcSpawnPlanet(faction);
      await db.sql`
        insert into ships (fleet_id, name, category, code, x, y)
        values (${fleet.id}::uuid, ${fleet.name}, ${category}, ${generateCode()}, ${spawnPlanet.x}, ${spawnPlanet.y})
      `;
      await db.sql`update fleets set respawn_at = null, updated_at = now() where id = ${fleet.id}::uuid`;
      spawned++;
    }

    const [{ count }] = await db.sql<{ count: string }>`
      select count(*)::text as count from fleets where is_npc = true and faction = ${faction}
    `;
    const missing = NPC_FLEET_TARGET_COUNT - Number(count);
    for (let i = 0; i < missing; i++) {
      const { name, category } = pickNpcFleetFlavor(faction);
      const [newFleet] = await db.sql<{ id: string }>`
        insert into fleets (name, faction, code, is_npc)
        values (${name}, ${faction}, ${generateCode()}, true)
        returning id
      `;
      const spawnPlanet = pickNpcSpawnPlanet(faction);
      await db.sql`
        insert into ships (fleet_id, name, category, code, x, y)
        values (${newFleet.id}::uuid, ${name}, ${category}, ${generateCode()}, ${spawnPlanet.x}, ${spawnPlanet.y})
      `;
      spawned++;
    }
  }

  return NextResponse.json({ ok: true, spawned });
}
