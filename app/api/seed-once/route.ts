import { getDatabase } from "@netlify/database";
import { NextResponse } from "next/server";
import { hashCode } from "@/lib/session";

// Route temporaire à usage unique pour amorcer access_codes en production
// (netlify database connect cible la base "dev" locale, pas la prod — pas
// d'autre moyen simple d'écrire directement dans la vraie base depuis la
// CLI). Protégée par SESSION_SECRET lui-même. À supprimer après usage.
export async function POST(request: Request) {
  const key = request.headers.get("x-seed-key");
  if (!key || key !== process.env.SESSION_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ownerCode = typeof body?.ownerCode === "string" ? body.ownerCode.trim() : "";
  const adminCode = typeof body?.adminCode === "string" ? body.adminCode.trim() : "";
  if (!ownerCode || !adminCode) {
    return NextResponse.json({ error: "ownerCode et adminCode requis" }, { status: 400 });
  }

  const db = getDatabase();
  await db.sql`
    insert into access_codes (role, code_hash) values
      ('owner', ${hashCode(ownerCode)}),
      ('admin', ${hashCode(adminCode)})
    on conflict (role) do update set code_hash = excluded.code_hash, updated_at = now()
  `;

  return NextResponse.json({ ok: true });
}
