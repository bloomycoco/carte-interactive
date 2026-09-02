import { getUser } from "@netlify/identity";
import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";

export async function GET() {
  const user = await getUser();

  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const db = getDatabase();

  const rows = await db.sql`
    select id, email, role, faction, requested_faction
    from profiles
    where id = ${user.id}::uuid
  `;

  let profile = rows[0];

  // filet de sécurité : si le hook d'inscription n'a pas créé la ligne
  // (ex: compte créé avant la mise en place du système), on la crée ici.
  if (!profile) {
    const isOwner =
      (user.email ?? "").toLowerCase() === (process.env.OWNER_EMAIL ?? "").toLowerCase();
    const role = isOwner ? "owner" : "player";

    const inserted = await db.sql`
      insert into profiles (id, email, role)
      values (${user.id}::uuid, ${user.email}, ${role})
      on conflict (id) do update set email = excluded.email
      returning id, email, role, faction, requested_faction
    `;
    profile = inserted[0];
  }

  return NextResponse.json({ authenticated: true, profile });
}
