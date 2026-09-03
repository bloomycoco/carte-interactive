-- Deux niveaux de code : le code de FLOTTE donne accès (visibilité sur
-- ses vaisseaux et leur statut), le code de VAISSEAU donne le contrôle
-- (peut lui donner l'ordre de partir). Les deux sont indépendants : on
-- peut avoir l'un sans l'autre.

alter table fleets
  drop column if exists x,
  drop column if exists y,
  drop column if exists dest_x,
  drop column if exists dest_y,
  drop column if exists dest_planet,
  drop column if exists departed_at,
  drop column if exists arrival_at;

create table ships (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references fleets (id) on delete cascade,
  name text not null,
  code text not null unique,
  x double precision not null,
  y double precision not null,
  dest_x double precision,
  dest_y double precision,
  dest_planet text,
  departed_at timestamptz,
  arrival_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ships_fleet_idx on ships (fleet_id);
