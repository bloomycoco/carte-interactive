// Réseau de routes spatiales — calculé une seule fois au chargement à
// partir de PLANETS (jamais de coordonnées figées à part). Utilisé à la
// fois pour dessiner les lignes sur la carte et pour faire voyager les
// vaisseaux le long de ces routes (jamais en ligne droite à travers
// l'espace).

import { PLANETS, type Planet } from "./planets";

export type RouteEdge = { a: string; b: string };

const NEIGHBOURS = 2;

function computeNearestNeighbourEdges(): RouteEdge[] {
  const drawn = new Set<string>();
  const edges: RouteEdge[] = [];
  for (const p of PLANETS) {
    const nearest = PLANETS.filter((o) => o !== p)
      .map((o) => ({ o, d: (o.x - p.x) ** 2 + (o.y - p.y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, NEIGHBOURS);
    for (const { o } of nearest) {
      const key = [p.name, o.name].sort().join("|");
      if (drawn.has(key)) continue;
      drawn.add(key);
      edges.push({ a: p.name, b: o.name });
    }
  }
  return edges;
}

// Liaisons ajoutées à la main (par nom de planète, jamais par
// coordonnées — toujours recalculées depuis PLANETS). Bridge Mandalore,
// isolé du reste du réseau, à Ruusan.
const MANUAL_ROUTE_NAMES: [string, string][] = [["Zanbar", "Ruusan"]];

export const ROUTE_EDGES: RouteEdge[] = [
  ...computeNearestNeighbourEdges(),
  ...MANUAL_ROUTE_NAMES.map(([a, b]) => ({ a, b })),
];

const PLANET_BY_NAME = new Map(PLANETS.map((p) => [p.name, p]));

function dist(a: Planet, b: Planet) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const ADJACENCY = new Map<string, { name: string; dist: number }[]>();
for (const p of PLANETS) ADJACENCY.set(p.name, []);
for (const { a, b } of ROUTE_EDGES) {
  const pa = PLANET_BY_NAME.get(a);
  const pb = PLANET_BY_NAME.get(b);
  if (!pa || !pb) continue;
  const d = dist(pa, pb);
  ADJACENCY.get(a)?.push({ name: b, dist: d });
  ADJACENCY.get(b)?.push({ name: a, dist: d });
}

// Planète connue la plus proche d'un point (x,y) quelconque — sert de
// point d'entrée sur le réseau de routes pour une position hors-planète.
export function nearestPlanet(x: number, y: number): Planet {
  let best = PLANETS[0];
  let bestD = Infinity;
  for (const p of PLANETS) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// Plus court chemin (Dijkstra, graphe assez petit pour un O(n²) simple)
// entre deux planètes du réseau. `allowed`, si fourni, restreint le
// trajet à ne traverser QUE des planètes de cet ensemble (utilisé pour
// que les flottes NPC ne quittent jamais leur territoire, même en
// chemin — pas seulement à l'arrivée). Renvoie la liste ordonnée des
// planètes traversées (origine et destination incluses), ou null si
// injoignable.
export function shortestPath(
  fromName: string,
  toName: string,
  allowed?: Set<string>,
): Planet[] | null {
  const start = PLANET_BY_NAME.get(fromName);
  const end = PLANET_BY_NAME.get(toName);
  if (!start || !end) return null;
  if (allowed && (!allowed.has(fromName) || !allowed.has(toName))) return null;
  if (fromName === toName) return [start];

  const nodes = allowed ?? new Set(PLANETS.map((p) => p.name));
  const dists = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (const name of nodes) dists.set(name, Infinity);
  dists.set(fromName, 0);

  while (visited.size < nodes.size) {
    let u: string | null = null;
    let best = Infinity;
    for (const [name, d] of dists) {
      if (!visited.has(name) && d < best) {
        best = d;
        u = name;
      }
    }
    if (u === null || u === toName) break;
    visited.add(u);
    for (const { name: v, dist: w } of ADJACENCY.get(u) ?? []) {
      if (!nodes.has(v) || visited.has(v)) continue;
      const alt = best + w;
      if (alt < (dists.get(v) ?? Infinity)) {
        dists.set(v, alt);
        prev.set(v, u);
      }
    }
  }

  if ((dists.get(toName) ?? Infinity) === Infinity) return null;

  const path: string[] = [toName];
  let cur = toName;
  while (cur !== fromName) {
    const p = prev.get(cur);
    if (!p) return null;
    path.push(p);
    cur = p;
  }
  path.reverse();

  const planets = path.map((n) => PLANET_BY_NAME.get(n)).filter((p): p is Planet => !!p);
  return planets.length === path.length ? planets : null;
}

// Ensemble des planètes atteignables depuis `fromName` sans jamais
// quitter `allowed` (parcours en largeur, ne regarde que la
// connectivité — pas les distances).
export function reachableWithin(fromName: string, allowed: Set<string>): Set<string> {
  const visited = new Set<string>();
  if (!allowed.has(fromName)) return visited;
  visited.add(fromName);
  const queue = [fromName];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const { name: v } of ADJACENCY.get(cur) ?? []) {
      if (allowed.has(v) && !visited.has(v)) {
        visited.add(v);
        queue.push(v);
      }
    }
  }
  visited.delete(fromName);
  return visited;
}
