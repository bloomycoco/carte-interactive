"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./AdminDashboard.module.css";

type Role = "owner" | "gm" | "player";
type Faction = "republique" | "csi" | "mandalore";

type UserRow = {
  id: string;
  email: string;
  role: Role;
  faction: Faction | null;
  requested_faction: Faction | null;
  created_at: string;
};

type FleetRow = {
  id: string;
  name: string;
  faction: Faction;
  owner_profile_id: string | null;
  owner_email: string | null;
  x: number;
  y: number;
  current_planet: string | null;
  created_at: string;
  updated_at: string;
};

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", gm: "Maître du Jeu", player: "Joueur" };
const FACTION_LABEL: Record<Faction, string> = {
  republique: "République",
  csi: "CSI",
  mandalore: "Mandalore",
};

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `erreur ${res.status}`);
  return data;
}

export default function AdminDashboard({ role, selfId }: { role: Role; selfId: string }) {
  const isOwner = role === "owner";

  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [fleets, setFleets] = useState<FleetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const [fleetName, setFleetName] = useState("");
  const [fleetFaction, setFleetFaction] = useState<Faction>("republique");
  const [fleetX, setFleetX] = useState("2000");
  const [fleetY, setFleetY] = useState("1500");
  const [creatingFleet, setCreatingFleet] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const data = await jsonOrThrow(await fetch("/api/admin/users"));
      setUsers(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadFleets = useCallback(async () => {
    try {
      const data = await jsonOrThrow(await fetch("/api/admin/fleets"));
      setFleets(data.fleets);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    async function run() {
      await Promise.all([loadUsers(), loadFleets()]);
    }
    void run();
  }, [loadUsers, loadFleets]);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInviting(true);
    try {
      await jsonOrThrow(
        await fetch("/api/admin/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteEmail.trim() }),
        }),
      );
      flash(`Invitation envoyée à ${inviteEmail.trim()}`);
      setInviteEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviting(false);
    }
  }

  async function setUserRole(id: string, newRole: Role) {
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/users/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        }),
      );
      setUsers((prev) => prev?.map((u) => (u.id === id ? { ...u, ...data.profile } : u)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function setUserFaction(id: string, faction: Faction | null) {
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/users/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ faction }),
        }),
      );
      setUsers((prev) => prev?.map((u) => (u.id === id ? { ...u, ...data.profile } : u)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteUser(id: string) {
    if (!confirm("Supprimer définitivement ce compte ?")) return;
    setError(null);
    try {
      await jsonOrThrow(await fetch(`/api/admin/users/${id}`, { method: "DELETE" }));
      setUsers((prev) => prev?.filter((u) => u.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCreateFleet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatingFleet(true);
    try {
      const data = await jsonOrThrow(
        await fetch("/api/admin/fleets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fleetName.trim(),
            faction: fleetFaction,
            x: Number(fleetX),
            y: Number(fleetY),
          }),
        }),
      );
      setFleets((prev) => (prev ? [...prev, { ...data.fleet, owner_email: null }] : [data.fleet]));
      setFleetName("");
      flash(`Flotte "${data.fleet.name}" créée`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingFleet(false);
    }
  }

  async function assignFleet(id: string, ownerProfileId: string | null) {
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/fleets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner_profile_id: ownerProfileId }),
        }),
      );
      setFleets(
        (prev) =>
          prev?.map((f) =>
            f.id === id
              ? {
                  ...f,
                  owner_profile_id: data.fleet.owner_profile_id,
                  owner_email: users?.find((u) => u.id === data.fleet.owner_profile_id)?.email ?? null,
                }
              : f,
          ) ?? null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteFleet(id: string) {
    if (!confirm("Supprimer cette flotte ?")) return;
    setError(null);
    try {
      await jsonOrThrow(await fetch(`/api/admin/fleets/${id}`, { method: "DELETE" }));
      setFleets((prev) => prev?.filter((f) => f.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pendingRequests = users?.filter((u) => u.requested_faction) ?? [];

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h1>Atlas Galactique — Administration</h1>
          <p className={styles.sub}>
            Connecté en tant que <strong>{ROLE_LABEL[role]}</strong>
          </p>
        </div>
        <Link href="/" className={styles.backLink}>
          ← Retour à la carte
        </Link>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}

      {pendingRequests.length > 0 && (
        <section className={styles.section}>
          <h2>Demandes de clan en attente</h2>
          <ul className={styles.pendingList}>
            {pendingRequests.map((u) => (
              <li key={u.id}>
                <span className={styles.email}>{u.email}</span>
                <span> demande </span>
                <span className={styles.factionTag} data-faction={u.requested_faction ?? undefined}>
                  {u.requested_faction ? FACTION_LABEL[u.requested_faction] : ""}
                </span>
                <button
                  className={styles.smallBtn}
                  onClick={() => u.requested_faction && setUserFaction(u.id, u.requested_faction)}
                >
                  Valider
                </button>
                <button className={styles.smallBtnGhost} onClick={() => setUserFaction(u.id, null)}>
                  Refuser
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isOwner && (
        <section className={styles.section}>
          <h2>Inviter un compte</h2>
          <p className={styles.hint}>
            L&apos;inscription est en mode &quot;invitation uniquement&quot; : envoie une invitation par
            email, la personne choisit son mot de passe en l&apos;acceptant. Non testé en conditions
            réelles pour le moment.
          </p>
          <form className={styles.inlineForm} onSubmit={handleInvite}>
            <input
              type="email"
              required
              placeholder="email@exemple.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <button type="submit" disabled={inviting}>
              {inviting ? "Envoi…" : "Inviter"}
            </button>
          </form>
        </section>
      )}

      <section className={styles.section}>
        <h2>Comptes</h2>
        {!users ? (
          <p className={styles.hint}>Chargement…</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Rôle</th>
                  <th>Clan</th>
                  {isOwner && <th></th>}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className={styles.email}>{u.email}</td>
                    <td>
                      {isOwner ? (
                        <select
                          value={u.role}
                          onChange={(e) => setUserRole(u.id, e.target.value as Role)}
                        >
                          <option value="owner">Owner</option>
                          <option value="gm">Maître du Jeu</option>
                          <option value="player">Joueur</option>
                        </select>
                      ) : (
                        <span data-role={u.role} className={styles.roleTag}>
                          {ROLE_LABEL[u.role]}
                        </span>
                      )}
                    </td>
                    <td>
                      <select
                        value={u.faction ?? ""}
                        onChange={(e) =>
                          setUserFaction(u.id, (e.target.value || null) as Faction | null)
                        }
                      >
                        <option value="">—</option>
                        <option value="republique">République</option>
                        <option value="csi">CSI</option>
                        <option value="mandalore">Mandalore</option>
                      </select>
                    </td>
                    {isOwner && (
                      <td>
                        {u.id !== selfId && (
                          <button className={styles.smallBtnGhost} onClick={() => deleteUser(u.id)}>
                            Supprimer
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isOwner && (
        <section className={styles.section}>
          <h2>Créer une flotte</h2>
          <form className={styles.inlineForm} onSubmit={handleCreateFleet}>
            <input
              required
              placeholder="Nom de la flotte"
              value={fleetName}
              onChange={(e) => setFleetName(e.target.value)}
            />
            <select value={fleetFaction} onChange={(e) => setFleetFaction(e.target.value as Faction)}>
              <option value="republique">République</option>
              <option value="csi">CSI</option>
              <option value="mandalore">Mandalore</option>
            </select>
            <input
              type="number"
              placeholder="x"
              value={fleetX}
              onChange={(e) => setFleetX(e.target.value)}
              className={styles.coordInput}
            />
            <input
              type="number"
              placeholder="y"
              value={fleetY}
              onChange={(e) => setFleetY(e.target.value)}
              className={styles.coordInput}
            />
            <button type="submit" disabled={creatingFleet}>
              {creatingFleet ? "Création…" : "Créer"}
            </button>
          </form>
        </section>
      )}

      <section className={styles.section}>
        <h2>Flottes</h2>
        {!fleets ? (
          <p className={styles.hint}>Chargement…</p>
        ) : fleets.length === 0 ? (
          <p className={styles.hint}>Aucune flotte pour le moment.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Clan</th>
                  <th>Assignée à</th>
                  <th>Position</th>
                  {isOwner && <th></th>}
                </tr>
              </thead>
              <tbody>
                {fleets.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td>
                      <span data-faction={f.faction} className={styles.factionTag}>
                        {FACTION_LABEL[f.faction]}
                      </span>
                    </td>
                    <td>
                      <select
                        value={f.owner_profile_id ?? ""}
                        onChange={(e) => assignFleet(f.id, e.target.value || null)}
                      >
                        <option value="">— non assignée —</option>
                        {users
                          ?.filter((u) => u.role === "player" && u.faction === f.faction)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.email}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className={styles.coords}>
                      {Math.round(f.x)}, {Math.round(f.y)}
                    </td>
                    {isOwner && (
                      <td>
                        <button className={styles.smallBtnGhost} onClick={() => deleteFleet(f.id)}>
                          Supprimer
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
