"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PLANETS } from "@/lib/planets";
import styles from "./AdminDashboard.module.css";

type Role = "owner" | "admin";
type Faction = "republique" | "csi" | "mandalore";

type FleetRow = {
  id: string;
  name: string;
  faction: Faction;
  code: string;
  x: number;
  y: number;
  dest_x: number | null;
  dest_y: number | null;
  dest_planet: string | null;
  departed_at: string | null;
  arrival_at: string | null;
  created_at: string;
  updated_at: string;
};

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

function etaLabel(arrivalAt: string | null) {
  if (!arrivalAt) return null;
  const ms = new Date(arrivalAt).getTime() - Date.now();
  if (ms <= 0) return "arrivée imminente";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}min ${s % 60}s`;
}

export default function AdminDashboard({ role }: { role: Role }) {
  const isOwner = role === "owner";

  const [fleets, setFleets] = useState<FleetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  const [fleetName, setFleetName] = useState("");
  const [fleetFaction, setFleetFaction] = useState<Faction>("republique");
  const [fleetPlanet, setFleetPlanet] = useState(PLANETS[0]?.name ?? "");
  const [fleetCode, setFleetCode] = useState("");
  const [creatingFleet, setCreatingFleet] = useState(false);

  const [ownerCode, setOwnerCode] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [savingCodes, setSavingCodes] = useState(false);

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
      await loadFleets();
    }
    void run();
  }, [loadFleets]);

  // rafraîchit les compte-à-rebours ETA affichés
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  async function handleCreateFleet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatingFleet(true);
    try {
      const planet = PLANETS.find((p) => p.name === fleetPlanet);
      const data = await jsonOrThrow(
        await fetch("/api/admin/fleets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fleetName.trim(),
            faction: fleetFaction,
            x: planet?.x ?? 0,
            y: planet?.y ?? 0,
            code: fleetCode.trim() || undefined,
          }),
        }),
      );
      setFleets((prev) => (prev ? [...prev, data.fleet] : [data.fleet]));
      setFleetName("");
      setFleetCode("");
      flash(`Flotte "${data.fleet.name}" créée — code ${data.fleet.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingFleet(false);
    }
  }

  async function regenerateCode(id: string) {
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/fleets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regenerateCode: true }),
        }),
      );
      setFleets((prev) => prev?.map((f) => (f.id === id ? data.fleet : f)) ?? null);
      flash(`Nouveau code : ${data.fleet.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function renameFleet(id: string, current: string) {
    const name = prompt("Nouveau nom de la flotte :", current);
    if (!name || !name.trim() || name === current) return;
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/fleets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        }),
      );
      setFleets((prev) => prev?.map((f) => (f.id === id ? data.fleet : f)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function teleportFleet(id: string) {
    const planetName = prompt(
      "Téléporter la flotte sur quelle planète ? (nom exact, annule le trajet en cours)",
    );
    if (!planetName) return;
    const planet = PLANETS.find((p) => p.name.toLowerCase() === planetName.trim().toLowerCase());
    if (!planet) {
      setError(`Planète "${planetName}" introuvable`);
      return;
    }
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/fleets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: planet.x, y: planet.y }),
        }),
      );
      setFleets((prev) => prev?.map((f) => (f.id === id ? data.fleet : f)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function cancelOrder(id: string) {
    setError(null);
    try {
      const data = await jsonOrThrow(await fetch(`/api/admin/fleets/${id}/cancel`, { method: "POST" }));
      setFleets((prev) => prev?.map((f) => (f.id === id ? data.fleet : f)) ?? null);
      flash("Trajet annulé");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteFleet(id: string) {
    if (!confirm("Supprimer définitivement cette flotte ?")) return;
    setError(null);
    try {
      await jsonOrThrow(await fetch(`/api/admin/fleets/${id}`, { method: "DELETE" }));
      setFleets((prev) => prev?.filter((f) => f.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSaveCodes(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavingCodes(true);
    try {
      await jsonOrThrow(
        await fetch("/api/owner/codes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerCode: ownerCode.trim() || undefined,
            adminCode: adminCode.trim() || undefined,
          }),
        }),
      );
      flash("Code(s) mis à jour");
      setOwnerCode("");
      setAdminCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingCodes(false);
    }
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h1>Atlas Galactique — Administration</h1>
          <p className={styles.sub}>
            Connecté en tant que <strong>{role === "owner" ? "Owner" : "Admin"}</strong>
          </p>
        </div>
        <Link href="/" className={styles.backLink}>
          ← Retour à la carte
        </Link>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}

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
            <select value={fleetPlanet} onChange={(e) => setFleetPlanet(e.target.value)}>
              {PLANETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Code (auto si vide)"
              value={fleetCode}
              onChange={(e) => setFleetCode(e.target.value.toUpperCase())}
              className={styles.codeInput}
            />
            <button type="submit" disabled={creatingFleet}>
              {creatingFleet ? "Création…" : "Créer"}
            </button>
          </form>
        </section>
      )}

      <section className={styles.section}>
        <h2>Flottes</h2>
        <p className={styles.hint}>
          Le code donne le contrôle d&apos;une flotte à qui le connaît — communique-le aux joueurs
          concernés.
        </p>
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
                  <th>Code</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fleets.map((f) => {
                  const traveling = !!f.dest_planet;
                  const eta = traveling ? etaLabel(f.arrival_at) : null;
                  return (
                    <tr key={f.id}>
                      <td>{f.name}</td>
                      <td>
                        <span data-faction={f.faction} className={styles.factionTag}>
                          {FACTION_LABEL[f.faction]}
                        </span>
                      </td>
                      <td className={styles.code}>{f.code}</td>
                      <td className={styles.status}>
                        {traveling ? (
                          <>
                            en transit → {f.dest_planet}
                            {eta && <span className={styles.eta}> ({eta})</span>}
                          </>
                        ) : (
                          "à quai"
                        )}
                      </td>
                      <td className={styles.actions}>
                        {traveling && (
                          <button className={styles.smallBtn} onClick={() => cancelOrder(f.id)}>
                            Annuler
                          </button>
                        )}
                        {isOwner && (
                          <>
                            <button className={styles.smallBtnGhost} onClick={() => renameFleet(f.id, f.name)}>
                              Renommer
                            </button>
                            <button className={styles.smallBtnGhost} onClick={() => teleportFleet(f.id)}>
                              Téléporter
                            </button>
                            <button className={styles.smallBtnGhost} onClick={() => regenerateCode(f.id)}>
                              Nouveau code
                            </button>
                            <button className={styles.smallBtnGhost} onClick={() => deleteFleet(f.id)}>
                              Supprimer
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isOwner && (
        <section className={styles.section}>
          <h2>Codes d&apos;accès</h2>
          <p className={styles.hint}>
            Change le code Owner et/ou le code Admin. Laisse un champ vide pour ne pas le modifier.
          </p>
          <form className={styles.inlineForm} onSubmit={handleSaveCodes}>
            <input
              type="text"
              placeholder="Nouveau code Owner"
              value={ownerCode}
              onChange={(e) => setOwnerCode(e.target.value)}
            />
            <input
              type="text"
              placeholder="Nouveau code Admin"
              value={adminCode}
              onChange={(e) => setAdminCode(e.target.value)}
            />
            <button type="submit" disabled={savingCodes || (!ownerCode.trim() && !adminCode.trim())}>
              {savingCodes ? "…" : "Enregistrer"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
