"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./GalaxyMap.module.css";
import SessionWidget from "./SessionWidget";
import FleetLayer from "./FleetLayer";
import {
  currentPosition,
  isActionActive,
  type PublicShip,
  type UnlockedCaptainFleet,
  type UnlockedFleet,
  type UnlockedShip,
} from "@/lib/fleet-motion";
import {
  FACTION_META,
  PLANETS,
  WORLD_H,
  WORLD_W,
  ZONE_POLYGONS,
  type Faction,
  type Planet,
} from "@/lib/planets";
import { ROUTE_EDGES, nearestPlanet } from "@/lib/routes";
import { availablePlanetAction, ACTION_LABEL, type PlanetAction } from "@/lib/planet-actions";

const UNLOCKED_FLEETS_KEY = "atlas_unlocked_fleets";
const UNLOCKED_SHIPS_KEY = "atlas_unlocked_ships";
const UNLOCKED_CAPTAINS_KEY = "atlas_unlocked_captains";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function minutesLeft(untilIso: string, now: number) {
  const ms = new Date(untilIso).getTime() - now;
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}min ${s}s`;
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export default function GalaxyMap() {
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<Planet | null>(null);
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [hiddenFactions, setHiddenFactions] = useState<Set<Faction>>(new Set());
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [ships, setShips] = useState<PublicShip[]>([]);
  // influence République cosmétique par planète (0-100), clé = nom de la
  // planète — voir POST /api/ships/[id]/action ("attack")
  const [planetInfluence, setPlanetInfluence] = useState<
    Record<string, { republicPct: number; csiAttackAt: string | null }>
  >({});
  const [unlockedFleets, setUnlockedFleets] = useState<UnlockedFleet[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(UNLOCKED_FLEETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [unlockedShips, setUnlockedShips] = useState<UnlockedShip[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(UNLOCKED_SHIPS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [unlockedCaptains, setUnlockedCaptains] = useState<UnlockedCaptainFleet[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(UNLOCKED_CAPTAINS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [fleetsOpen, setFleetsOpen] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  // nom de la planète pour laquelle le sélecteur de vaisseau est ouvert
  const [sendChooserFor, setSendChooserFor] = useState<string | null>(null);
  const [fleetNotice, setFleetNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const view = useRef({ scale: 0.5, offX: 0, offY: 0 });

  function persistUnlockedFleets(list: UnlockedFleet[]) {
    setUnlockedFleets(list);
    try {
      localStorage.setItem(UNLOCKED_FLEETS_KEY, JSON.stringify(list));
    } catch {
      // stockage indisponible : la session en mémoire suffit
    }
  }

  function persistUnlockedShips(list: UnlockedShip[]) {
    setUnlockedShips(list);
    try {
      localStorage.setItem(UNLOCKED_SHIPS_KEY, JSON.stringify(list));
    } catch {
      // stockage indisponible : la session en mémoire suffit
    }
  }

  function persistUnlockedCaptains(list: UnlockedCaptainFleet[]) {
    setUnlockedCaptains(list);
    try {
      localStorage.setItem(UNLOCKED_CAPTAINS_KEY, JSON.stringify(list));
    } catch {
      // stockage indisponible : la session en mémoire suffit
    }
  }

  // liste publique des vaisseaux (positions), interpolation en direct
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/ships");
        const data = await res.json();
        if (!cancelled && res.ok) {
          setShips(data.ships ?? []);
          setPlanetInfluence(data.planetInfluence ?? {});
        }
      } catch {
        // réseau indisponible : on retentera au prochain tick
      }
    }
    void poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // horloge pour l'interpolation visuelle des trajets en cours
  useEffect(() => {
    let raf: number;
    function tick() {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // un code peut être celui d'une flotte (accès en lecture à ses
  // vaisseaux), celui d'un Capitaine (ordre groupé pour toute la flotte),
  // ou celui d'un vaisseau (contrôle direct) — on essaie les trois.
  async function unlockAny(code: string) {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setUnlockError(null);

    try {
      const fleetRes = await fetch("/api/fleets/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      if (fleetRes.ok) {
        const data = await fleetRes.json();
        if (!unlockedFleets.some((u) => u.id === data.fleet.id)) {
          persistUnlockedFleets([
            ...unlockedFleets,
            {
              id: data.fleet.id,
              code: trimmed,
              name: data.fleet.name,
              faction: data.fleet.faction,
              kills: data.fleet.kills,
              losses: data.fleet.losses,
              strength: data.fleet.strength,
              ships: data.ships.map((s: { id: string; name: string; dest_planet: string | null }) => ({
                id: s.id,
                name: s.name,
                dest_planet: s.dest_planet,
              })),
            },
          ]);
        }
        setUnlockCode("");
        return;
      }

      const captainRes = await fetch("/api/fleets/captain-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      if (captainRes.ok) {
        const data = await captainRes.json();
        if (!unlockedCaptains.some((u) => u.id === data.fleet.id)) {
          persistUnlockedCaptains([
            ...unlockedCaptains,
            {
              id: data.fleet.id,
              code: trimmed,
              name: data.fleet.name,
              faction: data.fleet.faction,
              strength: data.fleet.strength,
            },
          ]);
        }
        setUnlockCode("");
        return;
      }

      const shipRes = await fetch("/api/ships/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      if (shipRes.ok) {
        const data = await shipRes.json();
        if (!unlockedShips.some((u) => u.id === data.ship.id)) {
          persistUnlockedShips([
            ...unlockedShips,
            {
              id: data.ship.id,
              code: trimmed,
              name: data.ship.name,
              faction: data.ship.faction,
              fleetName: data.ship.fleet_name,
            },
          ]);
        }
        setUnlockCode("");
        return;
      }

      setUnlockError("code inconnu");
    } catch {
      setUnlockError("erreur réseau");
    }
  }

  function forgetFleet(id: string) {
    persistUnlockedFleets(unlockedFleets.filter((u) => u.id !== id));
  }

  function forgetShip(id: string) {
    persistUnlockedShips(unlockedShips.filter((u) => u.id !== id));
  }

  function forgetCaptain(id: string) {
    persistUnlockedCaptains(unlockedCaptains.filter((u) => u.id !== id));
  }

  async function sendShipTo(shipId: string, planet: Planet) {
    const unlocked = unlockedShips.find((u) => u.id === shipId);
    if (!unlocked) return;
    try {
      const res = await fetch(`/api/ships/${shipId}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: unlocked.code, destPlanet: planet.name, destX: planet.x, destY: planet.y }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFleetNotice(data.error ?? "échec de l'ordre");
        return;
      }
      setShips((prev) => prev.map((s) => (s.id === shipId ? { ...s, ...data.ship } : s)));
      setFleetNotice(`${unlocked.name} en route vers ${planet.name}`);
      setSendChooserFor(null);
    } catch {
      setFleetNotice("erreur réseau");
    }
  }

  async function sendFleetTo(fleetId: string, planet: Planet) {
    const unlocked = unlockedCaptains.find((u) => u.id === fleetId);
    if (!unlocked) return;
    try {
      const res = await fetch(`/api/fleets/${fleetId}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: unlocked.code, destPlanet: planet.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFleetNotice(data.error ?? "échec de l'ordre");
        return;
      }
      const ordered = (
        data.results as { id: string; status: "ordered" | "skipped" }[]
      ).filter((r) => r.status === "ordered").length;
      const skipped = data.results.length - ordered;
      setFleetNotice(
        `${unlocked.name} : ${ordered} vaisseau(x) en route vers ${planet.name}` +
          (skipped > 0 ? `, ${skipped} occupé(s) ignoré(s)` : ""),
      );
      setSendChooserFor(null);
    } catch {
      setFleetNotice("erreur réseau");
    }
  }

  const [resolvingEncounter, setResolvingEncounter] = useState(false);
  const [attackResult, setAttackResult] = useState<
    { shipName: string; planet: string; outcome: "won" | "lost"; winChance: number } | null
  >(null);
  // popup "Attaquer ou Reconnaissance" avant de s'engager dans une
  // attaque de planète
  const [attackChoiceFor, setAttackChoiceFor] = useState<
    { shipId: string; shipName: string; planetName: string } | null
  >(null);
  const [reconResult, setReconResult] = useState<
    { winChance: number; fleetSize: number; minFleetSize: number } | null
  >(null);
  const [reconLoading, setReconLoading] = useState(false);

  async function runReconnaissance() {
    if (!attackChoiceFor) return;
    const unlocked = unlockedShips.find((u) => u.id === attackChoiceFor.shipId);
    if (!unlocked) return;
    setReconLoading(true);
    try {
      const res = await fetch(`/api/ships/${attackChoiceFor.shipId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: unlocked.code, type: "attack_preview" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFleetNotice(data.error ?? "échec de la reconnaissance");
        return;
      }
      setReconResult({ winChance: data.winChance, fleetSize: data.fleetSize, minFleetSize: data.minFleetSize });
    } catch {
      setFleetNotice("erreur réseau");
    } finally {
      setReconLoading(false);
    }
  }

  // chooser "Prendre en chasse" affiché sous la fiche d'un NPC sélectionné
  const [chasingNpc, setChasingNpc] = useState(false);

  async function chaseNpc(shipId: string, targetId: string) {
    const unlocked = unlockedShips.find((u) => u.id === shipId);
    if (!unlocked) return;
    setChasingNpc(true);
    try {
      const res = await fetch(`/api/ships/${shipId}/chase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: unlocked.code, targetId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFleetNotice(data.error ?? "échec de la prise en chasse");
        return;
      }
      if (data.ship) {
        setShips((prev) => prev.map((s) => (s.id === shipId ? { ...s, ...data.ship } : s)));
      }
      setSelectedShipId(null);
    } catch {
      setFleetNotice("erreur réseau");
    } finally {
      setChasingNpc(false);
    }
  }

  // envoie TOUTE une flotte (code Capitaine) en chasse du même NPC —
  // chaque vaisseau se réoriente et rattrape la cible indépendamment,
  // exactement comme une chasse individuelle
  async function chaseFleet(fleetId: string, targetId: string) {
    const unlocked = unlockedCaptains.find((u) => u.id === fleetId);
    if (!unlocked) return;
    setChasingNpc(true);
    try {
      const res = await fetch(`/api/fleets/${fleetId}/chase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: unlocked.code, targetId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFleetNotice(data.error ?? "échec de la prise en chasse");
        return;
      }
      const chasing = (data.results as { status: "chasing" | "skipped" }[]).filter(
        (r) => r.status === "chasing",
      ).length;
      const skipped = data.results.length - chasing;
      setFleetNotice(
        `${unlocked.name} : ${chasing} vaisseau(x) en chasse` + (skipped > 0 ? `, ${skipped} occupé(s) ignoré(s)` : ""),
      );
      setSelectedShipId(null);
    } catch {
      setFleetNotice("erreur réseau");
    } finally {
      setChasingNpc(false);
    }
  }

  // une flotte ennemie a été croisée par un vaisseau qu'on contrôle et
  // attend une décision (combattre / fuir)
  const encounterShip = ships.find(
    (s) =>
      unlockedShips.some((u) => u.id === s.id) &&
      s.encounter_pending &&
      s.encounter_at &&
      new Date(s.encounter_at).getTime() <= now,
  );

  async function resolveEncounter(shipId: string, choice: "fight" | "negotiate" | "flee" | "sneak") {
    const unlocked = unlockedShips.find((u) => u.id === shipId);
    if (!unlocked) return;
    setResolvingEncounter(true);
    try {
      const res = await fetch(`/api/ships/${shipId}/resolve-encounter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: unlocked.code, choice }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFleetNotice(data.error ?? "échec de la résolution");
        return;
      }
      setShips((prev) => prev.map((s) => (s.id === shipId ? { ...s, ...data.ship } : s)));
      const msg =
        data.outcome === "won"
          ? `${unlocked.name} a repoussé l'ennemi et poursuit sa route !`
          : data.outcome === "negotiated"
            ? `${unlocked.name} a négocié son passage et poursuit sa route.`
            : data.outcome === "sneaked"
              ? `${unlocked.name} est passé inaperçu.`
              : data.outcome === "fled"
                ? `${unlocked.name} a rebroussé chemin pour éviter le combat.`
                : `${unlocked.name} a perdu le combat — vaisseau endommagé, repli forcé vers Kuat.`;
      setFleetNotice(msg);
    } catch {
      setFleetNotice("erreur réseau");
    } finally {
      setResolvingEncounter(false);
    }
  }

  useEffect(() => {
    if (!fleetNotice) return;
    const id = setTimeout(() => setFleetNotice(null), 4000);
    return () => clearTimeout(id);
  }, [fleetNotice]);

  const [triggeringAction, setTriggeringAction] = useState<string | null>(null);

  // pour un vaisseau contrôlé, à l'arrêt : planète actuelle + action
  // disponible (aide humanitaire sur un monde neutre — ou une étape de
  // sa quête en cours —, attaquer la planète sur un monde ennemi) —
  // null si en trajet, occupé, ou sur un monde qui n'offre aucune action
  function idlePlanetAction(unlocked: UnlockedShip) {
    const live = ships.find((s) => s.id === unlocked.id);
    if (!live) return null;
    const pos = currentPosition(live, now);
    if (pos.traveling) return null;
    if (isActionActive(live, now)) return null;
    if (live.encounter_pending) return null;
    const planet = nearestPlanet(pos.x, pos.y);
    const quest =
      live.quest_type === "humanitarian" && live.quest_origin_planet && live.quest_target_planet && live.quest_phase
        ? { originPlanet: live.quest_origin_planet, targetPlanet: live.quest_target_planet, phase: live.quest_phase }
        : null;
    const action = availablePlanetAction(planet.name, planet.faction, unlocked.faction, quest);
    if (!action) return null;
    // attaquer engage toute la coalition République présente sur la
    // planète à l'instant (voir republicCoalitionAt côté serveur), pas
    // seulement ce vaisseau ni même sa propre flotte — le bouton est
    // donc disponible dès que CE vaisseau est là, sans exiger que toute
    // sa flotte le soit aussi (Reconnaissance révèle si la coalition
    // réunie est suffisante).
    return { planet, action };
  }

  async function triggerAction(shipId: string, type: PlanetAction) {
    const unlocked = unlockedShips.find((u) => u.id === shipId);
    if (!unlocked) return;
    setTriggeringAction(shipId);
    try {
      const res = await fetch(`/api/ships/${shipId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: unlocked.code, type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFleetNotice(data.error ?? "échec de l'action");
        return;
      }
      if (data.ship) {
        setShips((prev) => prev.map((s) => (s.id === shipId ? { ...s, ...data.ship } : s)));
      }
      if (type === "attack") {
        setAttackResult({
          shipName: unlocked.name,
          planet: data.planet,
          outcome: data.outcome,
          winChance: data.winChance,
        });
        return;
      }
      const msg =
        type === "humanitarian"
          ? `${unlocked.name} part chercher des vivres sur ${data.target} pour l'aide humanitaire à ${data.planet}.`
          : type === "humanitarian_pickup"
            ? `${unlocked.name} récupère les vivres et repart vers ${data.origin}.`
            : `${unlocked.name} livre l'aide humanitaire à ${data.planet}. Mission accomplie !`;
      setFleetNotice(msg);
    } catch {
      setFleetNotice("erreur réseau");
    } finally {
      setTriggeringAction(null);
    }
  }

  // aide humanitaire / livraison : déclenchées directement ; attaquer :
  // passe d'abord par le choix Reconnaissance / Attaquer
  function handlePlanetAction(shipId: string, shipName: string, action: PlanetAction, planetName: string) {
    if (action === "attack") {
      setReconResult(null);
      setAttackChoiceFor({ shipId, shipName, planetName });
      return;
    }
    void triggerAction(shipId, action);
  }

  const routes = useMemo(() => {
    const byName = new Map(PLANETS.map((p) => [p.name, p]));
    return ROUTE_EDGES.map(({ a, b }) => {
      const pa = byName.get(a);
      const pb = byName.get(b);
      if (!pa || !pb) return null;
      return { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y };
    }).filter((l): l is { x1: number; y1: number; x2: number; y2: number } => l !== null);
  }, []);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return null;
    return PLANETS.filter((p) => normalize(p.name).includes(q));
  }, [query]);

  // ---- starfield (drawn once) ----
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const W = cvs.width;
    const H = cvs.height;
    ctx.clearRect(0, 0, W, H);

    const core = ctx.createRadialGradient(W * 0.5, H * 0.5, 20, W * 0.5, H * 0.5, 1400);
    core.addColorStop(0, "rgba(120,110,190,0.14)");
    core.addColorStop(0.4, "rgba(70,60,120,0.06)");
    core.addColorStop(1, "rgba(10,10,20,0)");
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, W, H);

    const rand = mulberry32(1337);

    for (let i = 0; i < 2600; i++) {
      const x = rand() * W;
      const y = rand() * H;
      const r = rand() * 1.2 + 0.2;
      const a = rand() * 0.55 + 0.1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(243,236,217,${a.toFixed(2)})`;
      ctx.fill();
    }
    for (let j = 0; j < 130; j++) {
      const x = rand() * W;
      const y = rand() * H;
      ctx.beginPath();
      ctx.arc(x, y, rand() * 1.4 + 1, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.shadowBlur = 6;
      ctx.shadowColor = "rgba(200,200,255,0.8)";
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }, []);

  // ---- pan & zoom ----
  const apply = () => {
    const world = worldRef.current;
    if (!world) return;
    const { offX, offY, scale } = view.current;
    world.style.transform = `translate(${offX}px,${offY}px) scale(${scale})`;
  };

  const centerView = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const scale = Math.max(rect.width / WORLD_W, rect.height / WORLD_H, 0.34);
    view.current = {
      scale,
      offX: (rect.width - WORLD_W * scale) / 2,
      offY: (rect.height - WORLD_H * scale) / 2,
    };
    apply();
  };

  useEffect(() => {
    centerView();
    window.addEventListener("resize", centerView);
    return () => window.removeEventListener("resize", centerView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = stage!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { offX, offY, scale } = view.current;
      const wx = (mx - offX) / scale;
      const wy = (my - offY) / scale;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newScale = Math.min(2.6, Math.max(0.22, scale * factor));
      view.current = {
        scale: newScale,
        offX: mx - wx * newScale,
        offY: my - wy * newScale,
      };
      apply();
    }

    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement;
      if (
        target.closest(`.${styles.searchWrap}`) ||
        target.closest(`.${styles.planet}`) ||
        target.closest("[data-ship-marker]")
      )
        return;
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      setDragging(true);
      stage!.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      view.current.offX += dx;
      view.current.offY += dy;
      lastX = e.clientX;
      lastY = e.clientY;
      apply();
    }
    function endDrag() {
      isDragging = false;
      setDragging(false);
    }

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);

    return () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", endDrag);
      stage.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  // close search dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!searchWrapRef.current?.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function focusPlanet(p: Planet) {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const scale = 1.1;
    view.current = {
      scale,
      offX: rect.width / 2 - p.x * scale,
      offY: rect.height / 2 - p.y * scale,
    };
    apply();
    setSelected(p);
  }

  function toggleFaction(f: Faction) {
    setHiddenFactions((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  // fiche vaisseau affichée dans le panneau au clic
  const selectedShip = selectedShipId
    ? (ships.find((s) => s.id === selectedShipId && !s.is_npc) ?? null)
    : null;
  // fiche NPC affichée au clic — propose de le prendre en chasse
  const selectedNpc = selectedShipId
    ? (ships.find((s) => s.id === selectedShipId && s.is_npc) ?? null)
    : null;

  // tous les vaisseaux actuellement à quai sur la planète affichée dans
  // le panneau (n'importe quel camp, NPC compris) — simple liste
  // informative de ce qui s'y trouve en ce moment
  const shipsAtSelectedPlanet = selected
    ? ships.filter((s) => {
        const pos = currentPosition(s, now);
        if (pos.traveling) return false;
        return nearestPlanet(pos.x, pos.y).name === selected.name;
      })
    : [];

  // vaisseaux contrôlés, à l'arrêt sur la planète actuellement affichée
  // dans le panneau, avec une action disponible ici (aide humanitaire /
  // attaquer la planète). "Attaquer" engage toute la coalition
  // République présente sur la planète, toutes flottes confondues (voir
  // republicCoalitionAt côté serveur) : un seul bouton pour la planète,
  // pas un par vaisseau ni par flotte.
  const planetShipActions = selected
    ? (() => {
        const raw = unlockedShips
          .map((u) => {
            const info = idlePlanetAction(u);
            if (!info || info.planet.name !== selected.name) return null;
            return { ship: u, action: info.action };
          })
          .filter((v): v is { ship: UnlockedShip; action: PlanetAction } => v !== null);

        let seenAttack = false;
        return raw.filter(({ action }) => {
          if (action !== "attack") return true;
          if (seenAttack) return false;
          seenAttack = true;
          return true;
        });
      })()
    : [];

  return (
    <div className={styles.root}>
      <div
        ref={stageRef}
        className={`${styles.stage} ${dragging ? styles.dragging : ""}`}
      >
        <div
          ref={worldRef}
          className={styles.world}
          style={{ width: WORLD_W, height: WORLD_H }}
        >
          <canvas
            ref={canvasRef}
            className={styles.starfield}
            width={WORLD_W}
            height={WORLD_H}
          />
          <svg
            className={styles.zones}
            viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
            width={WORLD_W}
            height={WORLD_H}
          >
            <defs>
              <filter id="soften" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>
            {(Object.keys(ZONE_POLYGONS) as Faction[]).map((f) => (
              <g
                key={f}
                className={`${styles.zonePoly} ${hiddenFactions.has(f) ? styles.hidden : ""}`}
                filter="url(#soften)"
              >
                <path className={styles.fill} fill={FACTION_META[f].color} d={ZONE_POLYGONS[f]} />
                <path
                  className={styles.line}
                  stroke={FACTION_META[f].color}
                  d={ZONE_POLYGONS[f]}
                />
              </g>
            ))}
            <g>
              {routes.map((r, i) => (
                <line
                  key={i}
                  x1={r.x1}
                  y1={r.y1}
                  x2={r.x2}
                  y2={r.y2}
                  stroke="rgba(180,185,225,0.16)"
                  strokeWidth="1"
                />
              ))}
            </g>
          </svg>

          {PLANETS.map((p, idx) => {
            const meta = FACTION_META[p.faction];
            const isDimmed = matches !== null && !matches.includes(p);
            const isActive = selected?.name === p.name;
            // une planète ennemie où la République a pris le dessus (>
            // 50% d'influence, voir attaquer la planète) se teinte en bleu
            const contested = planetInfluence[p.name];
            const dotColor =
              contested != null && contested.republicPct > 50 ? FACTION_META.republique.color : meta.color;
            // une contre-attaque CSI en approche fait clignoter la
            // planète en rouge pour prévenir le joueur
            const csiAttackIncoming =
              contested?.csiAttackAt != null && new Date(contested.csiAttackAt).getTime() > now;
            return (
              <div
                key={p.name}
                className={[
                  styles.planet,
                  p.capital ? styles.capital : "",
                  isDimmed ? styles.dimmed : "",
                  isActive ? styles.active : "",
                  csiAttackIncoming ? styles.underAttack : "",
                ].join(" ")}
                style={{
                  left: p.x,
                  top: p.y,
                  ["--dot-fill" as string]: dotColor,
                  ["--dot-ring" as string]: "rgba(10,10,20,0.9)",
                  ["--dot-glow" as string]: dotColor,
                  ["--pulse-delay" as string]: `${idx * 0.17}s`,
                }}
                onClick={() => {
                  setSelected(p);
                  setSelectedShipId(null);
                }}
              >
                <div className={styles.dot} />
                <div className={styles.label}>{p.name}</div>
              </div>
            );
          })}

          <FleetLayer
            ships={ships}
            unlockedShips={unlockedShips}
            now={now}
            onSelectShip={(shipId) => {
              setSelectedShipId(shipId);
              setSelected(null);
            }}
          />
        </div>
      </div>

      <div className={styles.topbar}>
        <div className={styles.titleBlock}>
          <h1>Atlas Galactique</h1>
          <div className={styles.subtitle}>Ère des Guerres des Clones</div>
          <div ref={searchWrapRef} className={styles.searchWrap}>
            <input
              type="text"
              placeholder="Nom ou système…"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(e.target.value.trim().length > 0);
              }}
            />
            <div className={`${styles.searchResults} ${searchOpen ? styles.open : ""}`}>
              {matches && matches.length === 0 && (
                <div className={styles.empty}>Aucun système trouvé.</div>
              )}
              {matches?.map((p) => {
                const meta = FACTION_META[p.faction];
                return (
                  <div
                    key={p.name}
                    className={styles.row}
                    onClick={() => {
                      focusPlanet(p);
                      setSearchOpen(false);
                    }}
                  >
                    <span className={styles.swatch} style={{ background: meta.color }} />
                    {p.name}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className={styles.controls}>
          {(Object.keys(FACTION_META) as Faction[])
            .filter((f) => f !== "neutre")
            .map((f) => (
              <button
                key={f}
                className={`${styles.chip} ${hiddenFactions.has(f) ? styles.off : ""}`}
                style={{ ["--c" as string]: FACTION_META[f].color }}
                onClick={() => toggleFaction(f)}
              >
                <span className={styles.swatch} />
                {FACTION_META[f].label === "Confédération des Systèmes Indépendants"
                  ? "C.S.I."
                  : FACTION_META[f].label}
              </button>
            ))}
          <button className={styles.resetBtn} onClick={centerView}>
            Recentrer
          </button>

          <div className={styles.fleetsWrap}>
            <button
              className={`${styles.chip} ${fleetsOpen ? styles.chipActive : ""}`}
              onClick={() => setFleetsOpen((v) => !v)}
            >
              Mes Flottes
              {unlockedFleets.length + unlockedShips.length + unlockedCaptains.length > 0
                ? ` (${unlockedFleets.length + unlockedShips.length + unlockedCaptains.length})`
                : ""}
            </button>
            {fleetsOpen && (
              <div className={styles.fleetsDropdown}>
                {unlockedShips.length > 0 && (
                  <div className={styles.fleetsGroup}>
                    <div className={styles.fleetsGroupLabel}>Vaisseaux contrôlés</div>
                    {unlockedShips.map((u) => {
                      const live = ships.find((s) => s.id === u.id);
                      const pos = live ? currentPosition(live, now) : null;
                      const busyUntil = live && isActionActive(live, now) ? live.action_ends_at : null;
                      const available = !pos?.traveling && !busyUntil ? idlePlanetAction(u) : null;
                      return (
                        <div key={u.id} className={styles.fleetRow}>
                          <span className={styles.fleetName}>{u.name}</span>
                          <span className={styles.fleetStatus}>
                            {busyUntil
                              ? `${ACTION_LABEL[live!.action_type as "seized"]} (${minutesLeft(busyUntil, now)})`
                              : live?.dest_planet
                                ? `→ ${live.dest_planet}`
                                : "à quai"}
                            {pos?.traveling ? " (en transit)" : ""}
                            {live?.quest_type === "humanitarian"
                              ? live.quest_phase === "fetching"
                                ? " — vivres"
                                : " — retour vivres"
                              : ""}
                          </span>
                          {available && (
                            <button
                              className={styles.fleetActionBtn}
                              disabled={triggeringAction === u.id}
                              onClick={() => handlePlanetAction(u.id, u.name, available.action, available.planet.name)}
                            >
                              {ACTION_LABEL[available.action]}
                            </button>
                          )}
                          <button className={styles.fleetForget} onClick={() => forgetShip(u.id)}>
                            oublier
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {unlockedCaptains.length > 0 && (
                  <div className={styles.fleetsGroup}>
                    <div className={styles.fleetsGroupLabel}>Flottes (Capitaine)</div>
                    {unlockedCaptains.map((u) => (
                      <div key={u.id} className={styles.fleetRow}>
                        <span className={styles.fleetName}>⭐ {u.name}</span>
                        <span className={styles.fleetStatus}>⚔ {u.strength}</span>
                        <button className={styles.fleetForget} onClick={() => forgetCaptain(u.id)}>
                          oublier
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {unlockedFleets.length > 0 && (
                  <div className={styles.fleetsGroup}>
                    <div className={styles.fleetsGroupLabel}>Flottes (lecture seule)</div>
                    {unlockedFleets.map((u) => (
                      <div key={u.id} className={styles.fleetRow}>
                        <span className={styles.fleetName}>{u.name}</span>
                        <span className={styles.fleetStatus}>
                          {u.ships.length} vaisseau(x) · ⚔ {u.strength} · {u.kills}V-{u.losses}D
                        </span>
                        <button className={styles.fleetForget} onClick={() => forgetFleet(u.id)}>
                          oublier
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {unlockedFleets.length === 0 && unlockedShips.length === 0 && unlockedCaptains.length === 0 && (
                  <div className={styles.fleetsEmpty}>Rien de déverrouillé pour le moment.</div>
                )}
                <form
                  className={styles.fleetUnlockForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    unlockAny(unlockCode);
                  }}
                >
                  <input
                    placeholder="Code de flotte ou de vaisseau"
                    value={unlockCode}
                    onChange={(e) => setUnlockCode(e.target.value)}
                  />
                  <button type="submit">Déverrouiller</button>
                </form>
                {unlockError && <div className={styles.fleetError}>{unlockError}</div>}
              </div>
            )}
          </div>

          <SessionWidget />
        </div>
      </div>

      {fleetNotice && <div className={styles.fleetToast}>{fleetNotice}</div>}

      {encounterShip && (
        <div className={styles.encounterOverlay}>
          <div className={styles.encounterModal}>
            <div className={styles.encounterTitle}>
              {encounterShip.encounter_kind === "ground"
                ? "Flotte ennemie sur la planète"
                : encounterShip.encounter_kind === "chase"
                  ? "Prise en chasse !"
                  : "Flotte ennemie en approche"}
            </div>
            <p className={styles.encounterText}>
              <strong>{encounterShip.name}</strong>{" "}
              {encounterShip.encounter_kind === "ground"
                ? "partage la planète avec une"
                : encounterShip.encounter_kind === "chase"
                  ? "rattrape une"
                  : "croise une"}
              {encounterShip.encounter_enemy_faction
                ? ` flotte ${FACTION_META[encounterShip.encounter_enemy_faction].label}`
                : " flotte ennemie"}
              {encounterShip.encounter_kind === "transit" && encounterShip.dest_planet
                ? ` sur la route vers ${encounterShip.dest_planet}`
                : ""}
              . Que fait l&apos;équipage ?
            </p>
            {encounterShip.encounter_friendly_count != null && encounterShip.encounter_enemy_count != null && (
              <p className={styles.encounterOdds}>
                {encounterShip.encounter_friendly_count} vaisseau{encounterShip.encounter_friendly_count > 1 ? "x" : ""} contre{" "}
                {encounterShip.encounter_enemy_count} vaisseau{encounterShip.encounter_enemy_count > 1 ? "x" : ""}
              </p>
            )}
            {encounterShip.encounter_win_chance != null && (
              <p className={styles.encounterOdds}>
                Chances de victoire au combat : <strong>{encounterShip.encounter_win_chance}%</strong>
              </p>
            )}
            {encounterShip.encounter_kind === "ground" && encounterShip.encounter_at && (
              <p className={styles.encounterOdds}>
                Sans décision d&apos;ici{" "}
                <strong>
                  {Math.max(
                    0,
                    30 - Math.floor((now - new Date(encounterShip.encounter_at).getTime()) / 1000),
                  )}
                  s
                </strong>
                , la CSI attaque la première — avec l&apos;avantage.
              </p>
            )}
            <div className={styles.encounterActions}>
              <button
                className={styles.encounterFight}
                disabled={resolvingEncounter}
                onClick={() => resolveEncounter(encounterShip.id, "fight")}
              >
                Combattre{encounterShip.encounter_win_chance != null ? ` (${encounterShip.encounter_win_chance}%)` : ""}
              </button>
              {encounterShip.encounter_kind === "ground" ? (
                <button
                  className={styles.encounterNegotiate}
                  disabled={resolvingEncounter}
                  onClick={() => resolveEncounter(encounterShip.id, "sneak")}
                >
                  Tenter de passer inaperçu
                </button>
              ) : (
                encounterShip.encounter_enemy_faction !== "csi" && (
                  <button
                    className={styles.encounterNegotiate}
                    disabled={resolvingEncounter}
                    onClick={() => resolveEncounter(encounterShip.id, "negotiate")}
                  >
                    Négocier le passage
                  </button>
                )
              )}
              <button
                className={styles.encounterFlee}
                disabled={resolvingEncounter}
                onClick={() => resolveEncounter(encounterShip.id, "flee")}
              >
                Fuir
              </button>
            </div>
            <p className={styles.encounterHint}>
              {encounterShip.encounter_kind === "ground"
                ? "Passer inaperçu réussit presque toujours (sinon, combat). "
                : encounterShip.encounter_enemy_faction === "csi"
                  ? "La CSI ne négocie pas. "
                  : "Négocier réussit presque toujours (sinon, combat). "}
              Fuir est sans risque mais{" "}
              {encounterShip.encounter_kind === "ground" || encounterShip.encounter_kind === "chase"
                ? "replie le vaisseau vers Kuat."
                : "annule le trajet et ramène le vaisseau d'où il venait."}{" "}
              Combattre et perdre endommage le vaisseau et le force à rallier Kuat.
            </p>
          </div>
        </div>
      )}

      {attackChoiceFor && (
        <div className={styles.encounterOverlay}>
          <div className={styles.encounterModal}>
            <div className={styles.encounterTitle}>Attaque de {attackChoiceFor.planetName}</div>
            <p className={styles.encounterText}>
              <strong>{attackChoiceFor.shipName}</strong> et sa flotte sont prêts à l&apos;assaut. Envoyer une
              reconnaissance pour évaluer les chances, ou attaquer directement ?
            </p>
            {reconResult && (
              <p className={styles.encounterOdds}>
                {reconResult.fleetSize < reconResult.minFleetSize
                  ? `Flotte trop réduite (${reconResult.fleetSize}/${reconResult.minFleetSize} vaisseaux min.) — l'attaque échouera à coup sûr.`
                  : `Chances de victoire estimées : ${reconResult.winChance}%`}
              </p>
            )}
            <div className={styles.encounterActions}>
              <button className={styles.encounterNegotiate} disabled={reconLoading} onClick={runReconnaissance}>
                {reconLoading ? "Reconnaissance…" : "🔭 Reconnaissance"}
              </button>
              <button
                className={styles.encounterFight}
                disabled={triggeringAction === attackChoiceFor.shipId}
                onClick={() => {
                  const { shipId } = attackChoiceFor;
                  setAttackChoiceFor(null);
                  void triggerAction(shipId, "attack");
                }}
              >
                ⚔ Attaquer
              </button>
              <button className={styles.encounterFlee} onClick={() => setAttackChoiceFor(null)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {attackResult && (
        <div className={styles.encounterOverlay}>
          <div
            className={`${styles.encounterModal} ${styles.attackModal} ${
              attackResult.outcome === "won" ? styles.won : ""
            }`}
          >
            <div className={`${styles.encounterTitle} ${styles.attackTitle} ${attackResult.outcome === "won" ? styles.won : ""}`}>
              {attackResult.outcome === "won" ? "Victoire !" : "Attaque repoussée"}
            </div>
            <p className={styles.encounterText}>
              <strong>{attackResult.shipName}</strong> lance l&apos;assaut sur {attackResult.planet}
              {" — "}
              {attackResult.outcome === "won"
                ? "l'attaque réussit ! La flotte gagne en puissance."
                : "l'attaque échoue. L'ennemi en ressort renforcé."}
            </p>
            <p className={styles.encounterOdds}>
              Chances de victoire annoncées : <strong>{attackResult.winChance}%</strong>
            </p>
            <button className={styles.attackClose} onClick={() => setAttackResult(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}

      <div className={styles.hint}>molette pour zoomer · glisser pour naviguer · clic sur un système</div>
      <div className={styles.legend}>
        {(Object.keys(FACTION_META) as Faction[]).map((f) => (
          <span key={f} className={styles.item}>
            <span className={styles.swatch} style={{ background: FACTION_META[f].color }} />
            {FACTION_META[f].label === "Confédération des Systèmes Indépendants"
              ? "C.S.I."
              : FACTION_META[f].label}
          </span>
        ))}
      </div>

      <div className={`${styles.panel} ${selected || selectedShip || selectedNpc ? styles.open : ""}`}>
        <button
          className={styles.panelClose}
          onClick={() => {
            setSelected(null);
            setSelectedShipId(null);
          }}
        >
          ✕
        </button>
        {selectedShip ? (
          <div>
            <div
              className={styles.panelFaction}
              style={{ ["--f" as string]: FACTION_META[selectedShip.faction].color }}
            >
              <span className={styles.swatch} />
              {FACTION_META[selectedShip.faction].label}
            </div>
            <h2>{selectedShip.name}</h2>
            <div className={styles.system}>{selectedShip.category ?? "Type inconnu"}</div>
            <div className={styles.coords}>
              <div>
                DERNIÈRE PLANÈTE{" "}
                <b>{nearestPlanet(selectedShip.x, selectedShip.y).name}</b>
              </div>
              {selectedShip.damaged && (
                <div>
                  ÉTAT <b>endommagé</b>
                </div>
              )}
            </div>
          </div>
        ) : selectedNpc ? (
          <div>
            <div
              className={styles.panelFaction}
              style={{ ["--f" as string]: FACTION_META[selectedNpc.faction].color }}
            >
              <span className={styles.swatch} />
              {FACTION_META[selectedNpc.faction].label}
            </div>
            <h2>{selectedNpc.name}</h2>
            <div className={styles.system}>{selectedNpc.category ?? "Type inconnu"}</div>
            <div className={styles.coords}>
              <div>
                DERNIÈRE PLANÈTE{" "}
                <b>{nearestPlanet(selectedNpc.x, selectedNpc.y).name}</b>
              </div>
            </div>
            <div className={styles.panelActions}>
              {unlockedCaptains.map((u) => (
                <button
                  key={u.id}
                  className={styles.actionBtn}
                  disabled={chasingNpc}
                  onClick={() => chaseFleet(u.id, selectedNpc.id)}
                >
                  ⚔ Toute la flotte en chasse — {u.name}
                </button>
              ))}
              {unlockedShips.length > 0 ? (
                unlockedShips.map((u) => (
                  <button
                    key={u.id}
                    className={styles.actionBtn}
                    disabled={chasingNpc}
                    onClick={() => chaseNpc(u.id, selectedNpc.id)}
                  >
                    ⚔ Prendre en chasse — {u.name}
                  </button>
                ))
              ) : unlockedCaptains.length === 0 ? (
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnDisabled}`}
                  disabled
                  title="Déverrouille un vaisseau ou une flotte (bouton « Mes Flottes ») pour le prendre en chasse"
                >
                  Prendre en chasse
                </button>
              ) : null}
            </div>
          </div>
        ) : selected ? (
          <div style={{ ["--f" as string]: FACTION_META[selected.faction].color }}>
            <div className={styles.panelFaction}>
              <span className={styles.swatch} />
              {FACTION_META[selected.faction].label}
            </div>
            <h2>{selected.name}</h2>
            <div className={styles.system}>{selected.system}</div>
            <div className={styles.blurb}>{selected.blurb}</div>
            <div className={styles.coords}>
              <div>
                SECT.X <b>{selected.x}</b>
              </div>
              <div>
                SECT.Y <b>{selected.y}</b>
              </div>
            </div>
            {(selected.faction === "csi" || selected.faction === "mandalore") && (
              <div className={styles.influenceGauge}>
                <div className={styles.influenceLabel}>
                  <span>République {planetInfluence[selected.name]?.republicPct ?? 0}%</span>
                  <span>
                    {FACTION_META[selected.faction].label} {100 - (planetInfluence[selected.name]?.republicPct ?? 0)}%
                  </span>
                </div>
                <div className={styles.influenceBar}>
                  <div
                    className={styles.influenceFillRepublic}
                    style={{ width: `${planetInfluence[selected.name]?.republicPct ?? 0}%` }}
                  />
                </div>
                {planetInfluence[selected.name]?.csiAttackAt &&
                  new Date(planetInfluence[selected.name]!.csiAttackAt!).getTime() > now && (
                    <div className={styles.influenceWarning}>
                      ⚠ Contre-attaque CSI dans{" "}
                      {Math.max(
                        0,
                        Math.floor(
                          (new Date(planetInfluence[selected.name]!.csiAttackAt!).getTime() - now) / 1000,
                        ),
                      )}
                      s
                    </div>
                  )}
              </div>
            )}
            {shipsAtSelectedPlanet.length > 0 && (
              <div className={styles.planetShips}>
                <div className={styles.planetShipsLabel}>
                  Vaisseaux présents ({shipsAtSelectedPlanet.length})
                </div>
                {shipsAtSelectedPlanet.map((s) => (
                  <div key={s.id} className={styles.planetShipRow}>
                    <span
                      className={styles.swatch}
                      style={{ background: FACTION_META[s.faction].color }}
                    />
                    <span className={styles.planetShipName}>{s.name}</span>
                    <span className={styles.planetShipType}>{s.category ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.panelActions}>
              <a
                className={styles.actionBtn}
                href={`https://starwars.fandom.com/wiki/${encodeURIComponent(selected.name.replace(/ /g, "_"))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Lien ↗
              </a>
              {unlockedShips.length > 0 || unlockedCaptains.length > 0 ? (
                <div className={styles.sendWrap}>
                  <button
                    className={styles.actionBtn}
                    onClick={() =>
                      setSendChooserFor((cur) => (cur === selected.name ? null : selected.name))
                    }
                  >
                    Envoyer Vaisseau
                  </button>
                  {sendChooserFor === selected.name && (
                    <div className={styles.sendChooser}>
                      {unlockedCaptains.map((u) => (
                        <button
                          key={u.id}
                          className={styles.sendChooserRow}
                          onClick={() => selected && sendFleetTo(u.id, selected)}
                        >
                          ⭐ Toute la flotte : {u.name}
                        </button>
                      ))}
                      {unlockedShips.map((u) => (
                        <button
                          key={u.id}
                          className={styles.sendChooserRow}
                          onClick={() => selected && sendShipTo(u.id, selected)}
                        >
                          {u.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  className={`${styles.actionBtn} ${styles.actionBtnDisabled}`}
                  disabled
                  title="Déverrouille un vaisseau ou un code Capitaine (bouton « Mes Flottes ») pour donner des ordres"
                >
                  Envoyer Vaisseau
                </button>
              )}
              {planetShipActions.map(({ ship, action }) => (
                <button
                  key={ship.id}
                  className={styles.actionBtn}
                  disabled={triggeringAction === ship.id}
                  onClick={() => handlePlanetAction(ship.id, ship.name, action, selected.name)}
                >
                  {ACTION_LABEL[action]}
                  {action !== "attack" && unlockedShips.length > 1 ? ` — ${ship.name}` : ""}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.panelEmpty}>
            Sélectionnez un système ou un vaisseau
            <br />
            pour afficher son dossier.
          </div>
        )}
      </div>
    </div>
  );
}
