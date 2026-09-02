import { getUser } from "@netlify/identity";
import { getDatabase } from "@netlify/database";

export type Role = "owner" | "gm" | "player";
export type Faction = "republique" | "csi" | "mandalore";

export type Profile = {
  id: string;
  email: string;
  role: Role;
  faction: Faction | null;
  requested_faction: Faction | null;
};

/**
 * Renvoie le profil (rôle inclus) de l'utilisateur Identity actuellement
 * authentifié, ou null si personne n'est connecté. Le rôle vient de la
 * base (source de vérité), pas du JWT qui peut être périmé.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const user = await getUser();
  if (!user) return null;

  const db = getDatabase();
  const rows = await db.sql<Profile>`
    select id, email, role, faction, requested_faction
    from profiles
    where id = ${user.id}::uuid
  `;

  return rows[0] ?? null;
}

/**
 * Vérifie que l'utilisateur connecté a l'un des rôles autorisés.
 * Renvoie le profil si ok, ou null sinon (à l'appelant de répondre 401/403).
 */
export async function requireRole(allowed: Role[]): Promise<Profile | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (!allowed.includes(profile.role)) return null;
  return profile;
}
