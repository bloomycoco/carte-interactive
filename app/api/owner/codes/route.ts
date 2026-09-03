import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { hashCode, requireRole } from "@/lib/session";

// Change le code Owner et/ou Admin (Owner uniquement).
export async function PATCH(request: Request) {
  const role = await requireRole(["owner"]);
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const ownerCode = typeof body?.ownerCode === "string" ? body.ownerCode.trim() : "";
  const adminCode = typeof body?.adminCode === "string" ? body.adminCode.trim() : "";

  if (!ownerCode && !adminCode) {
    return NextResponse.json({ error: "aucun code fourni" }, { status: 400 });
  }

  const db = getDatabase();

  if (ownerCode) {
    if (ownerCode.length < 4) {
      return NextResponse.json({ error: "code Owner trop court (4 caractères min.)" }, { status: 400 });
    }
    await db.sql`
      update access_codes set code_hash = ${hashCode(ownerCode)}, updated_at = now()
      where role = 'owner'
    `;
  }
  if (adminCode) {
    if (adminCode.length < 4) {
      return NextResponse.json({ error: "code Admin trop court (4 caractères min.)" }, { status: 400 });
    }
    await db.sql`
      update access_codes set code_hash = ${hashCode(adminCode)}, updated_at = now()
      where role = 'admin'
    `;
  }

  return NextResponse.json({ ok: true });
}
