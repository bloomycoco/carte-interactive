"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PLANETS } from "@/lib/planets";
import { SHIP_CLASSES } from "@/lib/ship-classes";
import styles from "./AdminDashboard.module.css";

type Role = "owner" | "admin";
type Faction = "republique" | "csi" | "mandalore" | "cartel";
type NpcFaction = "csi" | "mandalore" | "cartel";

type ShipRow = {
  id: string;
  fleet_id: string;
  name: string;
  category: string | null;
  code: string;
  x: number;
  y: number;
  dest_x: number | null;
  dest_y: number | null;
  dest_planet: string | null;
  departed_at: string | null;
  arrival_at: string | null;
  damaged: boolean;
  encounter_pending: boolean;
  action_type: "influence" | "seized" | null;
  action_started_at: string | null;
  action_ends_at: string | null;
};

type FleetRow = {
  id: string;
  name: string;
  faction: Faction;
  is_npc: boolean;
  code: string;
  kills: number;
  losses: number;
  strength: number;
  ships: ShipRow[];
};

const FACTION_LABEL: Record<Faction, string> = {
  republique: "République",
  csi: "CSI",
  mandalore: "Mandalore",
  cartel: "Cartel",
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
  const [creatingFleet, setCreatingFleet] = useState(false);

  const [npcFleetName, setNpcFleetName] = useState("");
  const [npcFleetFaction, setNpcFleetFaction] = useState<NpcFaction>("csi");
  const [creatingNpcFleet, setCreatingNpcFleet] = useState(false);

  const [shipDrafts, setShipDrafts] = useState<
    Record<string, { name: string; planet: string; category: string }>
  >({});
  const [creatingShipFor, setCreatingShipFor] = useState<string | null>(null);

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

  function draftFor(fleetId: string, faction: Faction) {
    return (
      shipDrafts[fleetId] ?? {
        name: "",
        planet: PLANETS[0]?.name ?? "",
        category: SHIP_CLASSES[faction][0] ?? "",
      }
    );
  }

  function setDraft(
    fleetId: string,
    faction: Faction,
    patch: Partial<{ name: string; planet: string; category: string }>,
  ) {
    setShipDrafts((prev) => ({ ...prev, [fleetId]: { ...draftFor(fleetId, faction), ...patch } }));
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
          body: JSON.stringify({ name: fleetName.trim(), faction: "republique" }),
        }),
      );
      setFleets((prev) => (prev ? [...prev, data.fleet] : [data.fleet]));
      setFleetName("");
      flash(`Flotte "${data.fleet.name}" créée — code ${data.fleet.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingFleet(false);
    }
  }

  async function handleCreateNpcFleet(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatingNpcFleet(true);
    try {
      const data = await jsonOrThrow(
        await fetch("/api/admin/fleets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: npcFleetName.trim(), faction: npcFleetFaction, isNpc: true }),
        }),
      );
      setFleets((prev) => (prev ? [...prev, data.fleet] : [data.fleet]));
      setNpcFleetName("");
      flash(`Flotte NPC "${data.fleet.name}" créée`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingNpcFleet(false);
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
      setFleets((prev) => prev?.map((f) => (f.id === id ? { ...f, ...data.fleet } : f)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function regenerateFleetCode(id: string) {
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/fleets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regenerateCode: true }),
        }),
      );
      setFleets((prev) => prev?.map((f) => (f.id === id ? { ...f, ...data.fleet } : f)) ?? null);
      flash(`Nouveau code de flotte : ${data.fleet.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteFleet(id: string) {
    if (!confirm("Supprimer cette flotte et TOUS ses vaisseaux ?")) return;
    setError(null);
    try {
      await jsonOrThrow(await fetch(`/api/admin/fleets/${id}`, { method: "DELETE" }));
      setFleets((prev) => prev?.filter((f) => f.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCreateShip(fleetId: string, faction: Faction, e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatingShipFor(fleetId);
    try {
      const draft = draftFor(fleetId, faction);
      const planet = PLANETS.find((p) => p.name === draft.planet);
      const data = await jsonOrThrow(
        await fetch(`/api/admin/fleets/${fleetId}/ships`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name.trim(),
            category: draft.category,
            x: planet?.x ?? 0,
            y: planet?.y ?? 0,
          }),
        }),
      );
      setFleets(
        (prev) =>
          prev?.map((f) => (f.id === fleetId ? { ...f, ships: [...f.ships, data.ship] } : f)) ?? null,
      );
      setDraft(fleetId, faction, { name: "" });
      flash(`Vaisseau "${data.ship.name}" créé — code ${data.ship.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingShipFor(null);
    }
  }

  function updateShipInState(fleetId: string, ship: ShipRow) {
    setFleets(
      (prev) =>
        prev?.map((f) =>
          f.id === fleetId ? { ...f, ships: f.ships.map((s) => (s.id === ship.id ? ship : s)) } : f,
        ) ?? null,
    );
  }

  async function renameShip(fleetId: string, id: string, current: string) {
    const name = prompt("Nouveau nom du vaisseau :", current);
    if (!name || !name.trim() || name === current) return;
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/ships/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        }),
      );
      updateShipInState(fleetId, data.ship);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function setShipCategory(fleetId: string, id: string, category: string) {
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/ships/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category }),
        }),
      );
      updateShipInState(fleetId, data.ship);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function regenerateShipCode(fleetId: string, id: string) {
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/ships/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regenerateCode: true }),
        }),
      );
      updateShipInState(fleetId, data.ship);
      flash(`Nouveau code de vaisseau : ${data.ship.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function teleportShip(fleetId: string, id: string) {
    const planetName = prompt("Téléporter le vaisseau sur quelle planète ? (nom exact)");
    if (!planetName) return;
    const planet = PLANETS.find((p) => p.name.toLowerCase() === planetName.trim().toLowerCase());
    if (!planet) {
      setError(`Planète "${planetName}" introuvable`);
      return;
    }
    setError(null);
    try {
      const data = await jsonOrThrow(
        await fetch(`/api/admin/ships/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: planet.x, y: planet.y }),
        }),
      );
      updateShipInState(fleetId, data.ship);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function cancelShipOrder(fleetId: string, id: string) {
    setError(null);
    try {
      const data = await jsonOrThrow(await fetch(`/api/admin/ships/${id}/cancel`, { method: "POST" }));
      updateShipInState(fleetId, data.ship);
      flash("Trajet annulé");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteShip(fleetId: string, id: string) {
    if (!confirm("Supprimer définitivement ce vaisseau ?")) return;
    setError(null);
    try {
      await jsonOrThrow(await fetch(`/api/admin/ships/${id}`, { method: "DELETE" }));
      setFleets(
        (prev) =>
          prev?.map((f) => (f.id === fleetId ? { ...f, ships: f.ships.filter((s) => s.id !== id) } : f)) ??
          null,
      );
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

      <section className={styles.section}>
        <h2>Comment ça marche</h2>
        <p className={styles.hint}>
          Le code de <strong>flotte</strong> donne un accès en lecture : ses vaisseaux et leur statut,
          mais pas le contrôle. Le code de <strong>vaisseau</strong> donne le contrôle direct de ce
          vaisseau (peut recevoir des ordres). Un joueur peut avoir l&apos;un, l&apos;autre, ou les deux.
        </p>
      </section>

      {isOwner && (
        <section className={styles.section}>
          <h2>Créer une flotte République</h2>
          <p className={styles.hint}>
            Seule la République peut être jouée. Les autres clans n&apos;existent que comme flottes
            NPC (ci-dessous).
          </p>
          <form className={styles.inlineForm} onSubmit={handleCreateFleet}>
            <input
              required
              placeholder="Nom de la flotte"
              value={fleetName}
              onChange={(e) => setFleetName(e.target.value)}
            />
            <button type="submit" disabled={creatingFleet}>
              {creatingFleet ? "Création…" : "Créer"}
            </button>
          </form>
        </section>
      )}

      {isOwner && (
        <section className={styles.section}>
          <h2>Créer une flotte NPC</h2>
          <p className={styles.hint}>
            Se balade seule entre les planètes de son propre clan, sans jamais quitter son
            territoire. Une flotte République qui en croise une en route déclenche une vraie
            rencontre.
          </p>
          <form className={styles.inlineForm} onSubmit={handleCreateNpcFleet}>
            <input
              required
              placeholder="Nom de la flotte NPC"
              value={npcFleetName}
              onChange={(e) => setNpcFleetName(e.target.value)}
            />
            <select value={npcFleetFaction} onChange={(e) => setNpcFleetFaction(e.target.value as NpcFaction)}>
              <option value="csi">CSI</option>
              <option value="mandalore">Mandalore</option>
              <option value="cartel">Cartel</option>
            </select>
            <button type="submit" disabled={creatingNpcFleet}>
              {creatingNpcFleet ? "Création…" : "Créer"}
            </button>
          </form>
        </section>
      )}

      <section className={styles.section}>
        <h2>Flottes &amp; vaisseaux</h2>
        {!fleets ? (
          <p className={styles.hint}>Chargement…</p>
        ) : fleets.length === 0 ? (
          <p className={styles.hint}>Aucune flotte pour le moment.</p>
        ) : (
          <div className={styles.fleetList}>
            {fleets.map((f) => (
              <div key={f.id} className={styles.fleetBlock}>
                <div className={styles.fleetHead}>
                  <span data-faction={f.faction} className={styles.factionTag}>
                    {FACTION_LABEL[f.faction]}
                  </span>
                  {f.is_npc && (
                    <span className={styles.npcTag} title="Flotte NPC : se balade seule sur son territoire">
                      NPC
                    </span>
                  )}
                  <span className={styles.fleetTitle}>{f.name}</span>
                  <span className={styles.code}>{f.code}</span>
                  {!f.is_npc && (
                    <span className={styles.kdaTag} title="Force de la flotte (vaisseaux + expérience de combat)">
                      ⚔ {f.strength} · {f.kills}V-{f.losses}D
                    </span>
                  )}
                  {isOwner && (
                    <div className={styles.actions}>
                      <button className={styles.smallBtnGhost} onClick={() => renameFleet(f.id, f.name)}>
                        Renommer
                      </button>
                      <button className={styles.smallBtnGhost} onClick={() => regenerateFleetCode(f.id)}>
                        Nouveau code
                      </button>
                      <button className={styles.smallBtnGhost} onClick={() => deleteFleet(f.id)}>
                        Supprimer
                      </button>
                    </div>
                  )}
                </div>

                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Vaisseau</th>
                        <th>Catégorie</th>
                        <th>Code</th>
                        <th>Statut</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.ships.length === 0 && (
                        <tr>
                          <td colSpan={5} className={styles.hint}>
                            Aucun vaisseau dans cette flotte.
                          </td>
                        </tr>
                      )}
                      {f.ships.map((s) => {
                        const traveling = !!s.dest_planet;
                        const eta = traveling ? etaLabel(s.arrival_at) : null;
                        const busy =
                          !!s.action_started_at &&
                          !!s.action_ends_at &&
                          new Date(s.action_started_at).getTime() <= Date.now() &&
                          new Date(s.action_ends_at).getTime() > Date.now();
                        const actionEta = busy ? etaLabel(s.action_ends_at) : null;
                        return (
                          <tr key={s.id}>
                            <td>{s.name}</td>
                            <td>
                              {isOwner ? (
                                <select
                                  value={s.category ?? ""}
                                  onChange={(e) => setShipCategory(f.id, s.id, e.target.value)}
                                >
                                  <option value="">—</option>
                                  {SHIP_CLASSES[f.faction].map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                (s.category ?? "—")
                              )}
                            </td>
                            <td className={styles.code}>{s.code}</td>
                            <td className={styles.status}>
                              {s.encounter_pending ? (
                                <span className={styles.encounterTag}>⚠ rencontre en cours</span>
                              ) : busy ? (
                                <span className={styles.encounterTag}>
                                  {s.action_type === "seized" ? "🔒 saisi par le Cartel" : "🤝 propage l'influence"}
                                  {actionEta && <span className={styles.eta}> ({actionEta})</span>}
                                </span>
                              ) : traveling ? (
                                <>
                                  en transit → {s.dest_planet}
                                  {eta && <span className={styles.eta}> ({eta})</span>}
                                  {s.action_type === "seized" && (
                                    <span className={styles.damagedTag}> · ⏳ saisie programmée à l&apos;arrivée</span>
                                  )}
                                </>
                              ) : (
                                "à quai"
                              )}
                              {s.damaged && <span className={styles.damagedTag}> · endommagé</span>}
                            </td>
                            <td className={styles.actions}>
                              {traveling && (
                                <button
                                  className={styles.smallBtn}
                                  onClick={() => cancelShipOrder(f.id, s.id)}
                                >
                                  Annuler
                                </button>
                              )}
                              {isOwner && (
                                <>
                                  <button
                                    className={styles.smallBtnGhost}
                                    onClick={() => renameShip(f.id, s.id, s.name)}
                                  >
                                    Renommer
                                  </button>
                                  <button
                                    className={styles.smallBtnGhost}
                                    onClick={() => teleportShip(f.id, s.id)}
                                  >
                                    Téléporter
                                  </button>
                                  <button
                                    className={styles.smallBtnGhost}
                                    onClick={() => regenerateShipCode(f.id, s.id)}
                                  >
                                    Nouveau code
                                  </button>
                                  <button
                                    className={styles.smallBtnGhost}
                                    onClick={() => deleteShip(f.id, s.id)}
                                  >
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

                {isOwner && (
                  <form
                    className={styles.inlineForm}
                    onSubmit={(e) => handleCreateShip(f.id, f.faction, e)}
                  >
                    <input
                      required
                      placeholder="Nom du vaisseau"
                      value={draftFor(f.id, f.faction).name}
                      onChange={(e) => setDraft(f.id, f.faction, { name: e.target.value })}
                    />
                    <select
                      value={draftFor(f.id, f.faction).category}
                      onChange={(e) => setDraft(f.id, f.faction, { category: e.target.value })}
                    >
                      {SHIP_CLASSES[f.faction].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <select
                      value={draftFor(f.id, f.faction).planet}
                      onChange={(e) => setDraft(f.id, f.faction, { planet: e.target.value })}
                    >
                      {PLANETS.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={creatingShipFor === f.id}>
                      {creatingShipFor === f.id ? "Création…" : "+ Vaisseau"}
                    </button>
                  </form>
                )}
              </div>
            ))}
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
