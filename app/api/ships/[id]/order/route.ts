import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  currentPosition,
  planTravelAlongPath,
  maybeScheduleEncounter,
  rollEncounterOdds,
  rollCartelSeizure,
  type Waypoint,
} from "@/lib/fleets";
import { nearestPlanet, shortestPath } from "@/lib/routes";
import { PLANETS } from "@/lib/planets";
import { fleetStrength } from "@/lib/ship-classes";
import { SEIZURE_DURATION_SECONDS } from "@/lib/planet-actions";

const CORUSCANT = PLANETS.find((p) => p.name === "Coruscant")!;

// Envoie un vaisseau vers une planète, en suivant le réseau de routes
// (jamais en ligne droite) — la durée dépend de la distance réelle par
// les routes, une rencontre aléatoire peut survenir en chemin, et
// arriver sur un monde du Cartel risque une saisie du vaisseau.
// Accessible à quiconque connaît le code DU VAISSEAU (le code de sa
// flotte ne suffit pas).
export async function POST(request: Request, ctx: RouteContext<"/api/ships/[id]/order">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const destPlanet = typeof body?.destPlanet === "string" ? body.destPlanet : "";

  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });

  const destination = PLANETS.find((p) => p.name === destPlanet);
  if (!destination) {
    return NextResponse.json({ error: "destination invalide" }, { status: 400 });
  }

  const db = getDatabase();
  const rows = await db.sql<{
    id: string;
    fleet_id: string;
    name: string;
    code: string;
    x: number;
    y: number;
    dest_x: number | null;
    dest_y: number | null;
    departed_at: string | null;
    arrival_at: string | null;
    path: Waypoint[] | null;
    damaged: boolean;
    encounter_pending: boolean;
    encounter_at: string | null;
    action_type: "influence" | "seized" | null;
    action_started_at: string | null;
    action_ends_at: string | null;
  }>`
    select id, fleet_id, name, code, x, y, dest_x, dest_y, departed_at, arrival_at, path, damaged,
           encounter_pending, encounter_at, action_type, action_started_at, action_ends_at
    from ships
    where id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });

  const now = Date.now();

  // une rencontre non résolue bloque tout nouvel ordre tant qu'elle
  // n'a pas été tranchée (combattre / fuir)
  if (ship.encounter_pending && ship.encounter_at && new Date(ship.encounter_at).getTime() <= now) {
    return NextResponse.json(
      { error: "une rencontre en cours doit être résolue avant de repartir" },
      { status: 400 },
    );
  }

  // occupé (propagation d'influence ou saisie par le Cartel) : immobilisé
  // — seulement une fois l'action réellement commencée (une saisie
  // programmée pour l'arrivée ne bloque rien avant que le vaisseau y soit)
  if (
    ship.action_ends_at &&
    ship.action_started_at &&
    new Date(ship.action_started_at).getTime() <= now &&
    new Date(ship.action_ends_at).getTime() > now
  ) {
    return NextResponse.json({ error: "le vaisseau est immobilisé pour le moment" }, { status: 400 });
  }

  const origin = currentPosition(ship);
  const idleAtCoruscant =
    !origin.traveling && Math.abs(origin.x - CORUSCANT.x) < 1 && Math.abs(origin.y - CORUSCANT.y) < 1;

  // un vaisseau endommagé doit d'abord rallier Coruscant pour réparation
  if (ship.damaged && !idleAtCoruscant && destination.name !== "Coruscant") {
    return NextResponse.json(
      { error: "vaisseau endommagé : il doit d'abord rejoindre Coruscant pour réparation" },
      { status: 400 },
    );
  }
  const repaired = ship.damaged && idleAtCoruscant;

  const originPlanet = nearestPlanet(origin.x, origin.y);
  const routePath = shortestPath(originPlanet.name, destination.name);
  if (!routePath) {
    return NextResponse.json({ error: "aucune route connue vers cette destination" }, { status: 400 });
  }

  // évite un point de départ en double quand l'origine coïncide déjà
  // avec la première planète du chemin (cas le plus courant)
  const firstHop = routePath[0];
  const startsAtFirstHop = firstHop.x === origin.x && firstHop.y === origin.y;
  const waypoints: Waypoint[] = [
    { x: origin.x, y: origin.y },
    ...(startsAtFirstHop ? routePath.slice(1) : routePath).map((p) => ({ x: p.x, y: p.y })),
  ];
  const { departedAt, arrivalAt } = planTravelAlongPath(waypoints);

  // pas de rencontre sur un trajet de repli forcé vers Coruscant
  const encounter = ship.damaged && !repaired ? null : maybeScheduleEncounter(departedAt, arrivalAt);

  // si une rencontre est programmée, calcule les chances de victoire dès
  // maintenant (force de la flotte au moment du départ), pour pouvoir
  // les annoncer au joueur dès qu'il atteindra le point de rencontre
  let winChance: number | null = null;
  if (encounter) {
    const [fleetRow] = await db.sql<{ kills: number; losses: number }>`
      select kills, losses from fleets where id = ${ship.fleet_id}::uuid
    `;
    const fleetShips = await db.sql<{ category: string | null }>`
      select category from ships where fleet_id = ${ship.fleet_id}::uuid
    `;
    const strength = fleetStrength(fleetShips, fleetRow?.kills ?? 0, fleetRow?.losses ?? 0);
    winChance = rollEncounterOdds(strength);
  }

  // arriver sur un monde du Cartel risque une saisie du vaisseau (50%),
  // tirée au sort dès maintenant et révélée à l'arrivée
  let actionType: string | null = null;
  let actionStartedAt: string | null = null;
  let actionEndsAt: string | null = null;
  if (destination.faction === "cartel" && rollCartelSeizure()) {
    actionType = "seized";
    actionStartedAt = arrivalAt.toISOString();
    actionEndsAt = new Date(arrivalAt.getTime() + SEIZURE_DURATION_SECONDS * 1000).toISOString();
  }

  const updated = await db.sql`
    update ships
    set x = ${origin.x}, y = ${origin.y},
        dest_x = ${destination.x}, dest_y = ${destination.y}, dest_planet = ${destination.name},
        path = ${JSON.stringify(waypoints)}::jsonb,
        departed_at = ${departedAt.toISOString()}, arrival_at = ${arrivalAt.toISOString()},
        damaged = ${repaired ? false : ship.damaged},
        encounter_pending = ${!!encounter},
        encounter_at = ${encounter ? encounter.encounterAt.toISOString() : null},
        encounter_win_chance = ${winChance},
        encounter_x = null, encounter_y = null,
        action_type = ${actionType}, action_started_at = ${actionStartedAt}, action_ends_at = ${actionEndsAt},
        updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
              damaged, encounter_pending, encounter_at, encounter_win_chance,
              action_type, action_started_at, action_ends_at
  `;

  return NextResponse.json({ ship: updated[0] });
}
