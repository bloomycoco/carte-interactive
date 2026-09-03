import { getDatabase } from "@/lib/db";
import { NextResponse } from "next/server";
import { currentPosition, planTravelAlongPath, rollCartelSeizure, type Waypoint } from "@/lib/fleets";
import { nearestPlanet, shortestPath } from "@/lib/routes";
import { PLANETS } from "@/lib/planets";
import { SEIZURE_DURATION_SECONDS } from "@/lib/planet-actions";

const CORUSCANT = PLANETS.find((p) => p.name === "Coruscant")!;
const NAL_HUTTA = PLANETS.find((p) => p.name === "Nal Hutta")!;

// Envoie un vaisseau vers une planète, en suivant le réseau de routes
// (jamais en ligne droite) — la durée dépend de la distance réelle par
// les routes. Croiser une flotte NPC en chemin déclenche une rencontre
// (voir le tick dans GET /api/ships), et arriver sur un monde du Cartel
// risque une saisie du vaisseau : il est alors détourné vers Nal Hutta
// (capitale du Cartel), peu importe la destination demandée. Accessible
// à quiconque connaît le code DU VAISSEAU (le code de sa flotte ne
// suffit pas).
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
    faction: string;
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
    select s.id, s.fleet_id, f.faction, s.name, s.code, s.x, s.y, s.dest_x, s.dest_y,
           s.departed_at, s.arrival_at, s.path, s.damaged,
           s.encounter_pending, s.encounter_at, s.action_type, s.action_started_at, s.action_ends_at
    from ships s
    join fleets f on f.id = s.fleet_id
    where s.id = ${id}::uuid
  `;
  const ship = rows[0];
  if (!ship) return NextResponse.json({ error: "vaisseau introuvable" }, { status: 404 });
  if (ship.code !== code) return NextResponse.json({ error: "code incorrect" }, { status: 403 });

  const now = Date.now();

  // une rencontre non résolue bloque tout nouvel ordre tant qu'elle
  // n'a pas été tranchée (combattre / négocier / fuir)
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

  let finalDestination = destination;
  let finalWaypoints = waypoints;
  let finalDepartedAt = departedAt;
  let finalArrivalAt = arrivalAt;
  let actionType: string | null = null;
  let actionStartedAt: string | null = null;
  let actionEndsAt: string | null = null;

  // arriver sur un monde du Cartel risque une saisie du vaisseau (50%),
  // tirée au sort dès maintenant : détourné vers Nal Hutta au lieu de sa
  // destination prévue, révélé dès le départ — sauf pour un vaisseau du
  // Cartel lui-même, chez lui
  if (destination.faction === "cartel" && ship.faction !== "cartel" && rollCartelSeizure()) {
    const seizurePath = shortestPath(originPlanet.name, NAL_HUTTA.name);
    if (seizurePath) {
      const seizureFirstHop = seizurePath[0];
      const seizureStartsAtFirstHop = seizureFirstHop.x === origin.x && seizureFirstHop.y === origin.y;
      const seizureWaypoints: Waypoint[] = [
        { x: origin.x, y: origin.y },
        ...(seizureStartsAtFirstHop ? seizurePath.slice(1) : seizurePath).map((p) => ({ x: p.x, y: p.y })),
      ];
      const seizureTravel = planTravelAlongPath(seizureWaypoints);
      finalDestination = NAL_HUTTA;
      finalWaypoints = seizureWaypoints;
      finalDepartedAt = seizureTravel.departedAt;
      finalArrivalAt = seizureTravel.arrivalAt;
      actionType = "seized";
      actionStartedAt = finalArrivalAt.toISOString();
      actionEndsAt = new Date(finalArrivalAt.getTime() + SEIZURE_DURATION_SECONDS * 1000).toISOString();
    }
  }

  const updated = await db.sql`
    update ships
    set x = ${origin.x}, y = ${origin.y},
        dest_x = ${finalDestination.x}, dest_y = ${finalDestination.y}, dest_planet = ${finalDestination.name},
        path = ${JSON.stringify(finalWaypoints)}::jsonb,
        departed_at = ${finalDepartedAt.toISOString()}, arrival_at = ${finalArrivalAt.toISOString()},
        damaged = ${repaired ? false : ship.damaged},
        encounter_pending = false, encounter_at = null, encounter_win_chance = null,
        encounter_x = null, encounter_y = null, encounter_enemy_faction = null,
        action_type = ${actionType}, action_started_at = ${actionStartedAt}, action_ends_at = ${actionEndsAt},
        updated_at = now()
    where id = ${id}::uuid
    returning id, name, x, y, dest_x, dest_y, dest_planet, path, departed_at, arrival_at,
              damaged, encounter_pending, encounter_at, encounter_win_chance,
              action_type, action_started_at, action_ends_at
  `;

  return NextResponse.json({ ship: updated[0] });
}
