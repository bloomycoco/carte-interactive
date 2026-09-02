import { NextResponse } from "next/server";
import { getSessionRole } from "@/lib/session";

export async function GET() {
  const role = await getSessionRole();
  return NextResponse.json({ role });
}
