import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/session";
import AdminDashboard from "@/components/AdminDashboard";

// Dépend du cookie de session : jamais de cache statique.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const role = await getSessionRole();
  if (!role) redirect("/");

  return <AdminDashboard role={role} />;
}
