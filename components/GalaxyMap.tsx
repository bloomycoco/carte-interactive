"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./GalaxyMap.module.css";
import {
  FACTION_META,
  MANUAL_ROUTES,
  PLANETS,
  WORLD_H,
  WORLD_W,
  ZONE_POLYGONS,
  type Faction,
  type Planet,
} from "@/lib/planets";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  const [hiddenFactions, setHiddenFactions] = useState<Set<Faction>>(new Set());
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const view = useRef({ scale: 0.5, offX: 0, offY: 0 });

  const routes = useMemo(() => {
    const NEIGHBOURS = 2;
    const drawn = new Set<string>();
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];

    for (const p of PLANETS) {
      const nearest = PLANETS.filter((o) => o !== p)
        .map((o) => ({ o, d: (o.x - p.x) ** 2 + (o.y - p.y) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, NEIGHBOURS);

      for (const { o } of nearest) {
        const key = [p.name, o.name].sort().join("|");
        if (drawn.has(key)) continue;
        drawn.add(key);
        lines.push({ x1: p.x, y1: p.y, x2: o.x, y2: o.y });
      }
    }
    return lines;
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
      if ((e.target as HTMLElement).closest(`.${styles.searchWrap}`)) return;
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
                <path className="fill" fill={`var(--${f === "csi" ? "separatist" : f})`} d={ZONE_POLYGONS[f]} />
                <path
                  className="line"
                  stroke={`var(--${f === "csi" ? "separatist" : f})`}
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
              {MANUAL_ROUTES.map(([x1, y1, x2, y2], i) => (
                <line
                  key={`manual-${i}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
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
            return (
              <div
                key={p.name}
                className={[
                  styles.planet,
                  p.capital ? styles.capital : "",
                  isDimmed ? styles.dimmed : "",
                  isActive ? styles.active : "",
                ].join(" ")}
                style={{
                  left: p.x,
                  top: p.y,
                  ["--dot-fill" as string]: meta.color,
                  ["--dot-ring" as string]: "rgba(10,10,20,0.9)",
                  ["--dot-glow" as string]: meta.color,
                  ["--pulse-delay" as string]: `${idx * 0.17}s`,
                }}
                onClick={() => setSelected(p)}
              >
                <div className={styles.dot} />
                <div className={styles.label}>{p.name}</div>
              </div>
            );
          })}
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
        </div>
      </div>

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

      <div className={`${styles.panel} ${selected ? styles.open : ""}`}>
        <button className={styles.panelClose} onClick={() => setSelected(null)}>
          ✕
        </button>
        {selected ? (
          <div>
            <div
              className={styles.panelFaction}
              style={{ ["--f" as string]: FACTION_META[selected.faction].color }}
            >
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
          </div>
        ) : (
          <div className={styles.panelEmpty}>
            Sélectionnez un système
            <br />
            pour afficher son dossier.
          </div>
        )}
      </div>
    </div>
  );
}
