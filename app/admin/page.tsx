import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import AdminDashboard from "@/components/AdminDashboard";

// La page dépend des cookies Identity (rôle du visiteur) : jamais de cache statique.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/");
  }
  if (profile.role !== "owner" && profile.role !== "gm") {
    redirect("/");
  }

  return <AdminDashboard role={profile.role} selfId={profile.id} />;
}
