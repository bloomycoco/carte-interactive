import { getIdentityConfig } from "@netlify/identity";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

// Invite un nouveau compte par email (Owner uniquement). @netlify/identity n'a
// pas de méthode admin.invite() typée, donc on appelle directement l'endpoint
// GoTrue avec le token opérateur. Pas encore testé en conditions réelles.
export async function POST(request: Request) {
  const profile = await requireRole(["owner"]);
  if (!profile) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "email requis" }, { status: 400 });
  }

  const config = getIdentityConfig();
  if (!config?.token) {
    return NextResponse.json(
      { error: "token opérateur Identity indisponible" },
      { status: 500 },
    );
  }

  const res = await fetch(`${config.url}/invite`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: "échec de l'invitation", detail: text },
      { status: res.status },
    );
  }

  const invited = await res.json();
  return NextResponse.json({ invited });
}
