import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { createSession, hashCode, type SessionRole } from "@/lib/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const role = body?.role as SessionRole | undefined;
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "rôle invalide" }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "code requis" }, { status: 400 });
  }

  const db = getDatabase();
  const rows = await db.sql`
    select code_hash from access_codes where role = ${role}
  `;
  const row = rows[0];
  if (!row || row.code_hash !== hashCode(code)) {
    return NextResponse.json({ error: "code incorrect" }, { status: 401 });
  }

  await createSession(role);
  return NextResponse.json({ role });
}
