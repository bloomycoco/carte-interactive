-- Boss galactique unique (Summa-verminoth) : apparaît via la page Owner
-- sur une planète aléatoire (jamais Coruscant), se balade partout sauf
-- Coruscant, et ne peut être combattu qu'en le prenant en chasse — les
-- chances sont toujours fixées à 30%, quelle que soit la force engagée.
-- Il faut hits_required (10) victoires pour l'abattre. Une seule ligne
-- "vivante" à la fois (alive = true) — l'historique des précédents
-- boss n'est pas supprimé, juste marqué mort.
create table boss (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  x real not null,
  y real not null,
  dest_x real,
  dest_y real,
  dest_planet text,
  path jsonb,
  departed_at timestamptz,
  arrival_at timestamptz,
  hits int not null default 0,
  hits_required int not null default 10,
  win_chance smallint not null default 30,
  alive boolean not null default true,
  -- planète que le Owner a ordonné au boss d'aller capturer (page de
  -- contrôle) : tant qu'elle est renseignée, le déplacement du boss vise
  -- directement cette planète au lieu d'un trajet aléatoire — une fois
  -- arrivé, elle est ajoutée à boss_hostile_planets et ce champ repasse
  -- à null (le boss reprend son vagabondage aléatoire).
  target_planet text,
  spawned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index boss_alive_idx on boss (alive) where alive = true;

-- Planètes capturées par le boss (verdissement "Hostile" sur la carte)
-- — reste ainsi jusqu'à libération manuelle par le Owner (page de
-- contrôle), indépendamment du sort du boss lui-même.
create table boss_hostile_planets (
  planet_name text primary key,
  captured_at timestamptz not null default now()
);

-- poursuite du boss (parallèle à chase_target_id, qui référence un
-- vaisseau NPC — le boss n'en est pas un) ; nul dès que la poursuite
-- s'arrête (abandon, rattrapage, ou mort du boss).
alter table ships add column chasing_boss_id uuid references boss(id) on delete set null;

-- élargit encounter_kind pour accepter 'boss' (combat contre le boss,
-- distinct de 'chase' car les chances y sont toujours fixées à 30%).
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'ships' and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%encounter_kind%';

  if constraint_name is not null then
    execute format('alter table ships drop constraint %I', constraint_name);
  end if;

  alter table ships add constraint ships_encounter_kind_check
    check (encounter_kind in ('transit', 'ground', 'chase', 'boss'));
end $$;
