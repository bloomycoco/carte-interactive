-- Abandon du système de comptes Netlify Identity : plus de création de
-- compte, juste des codes d'accès partagés (Owner / Admin) et un code par
-- flotte (les joueurs contrôlent une flotte s'ils en connaissent le code).

drop table if exists fleets;
drop table if exists profiles;

-- Codes d'accès Owner / Admin. Le code est haché (SHA-256 + pepper
-- applicatif), jamais stocké en clair.
create table access_codes (
  role text primary key check (role in ('owner', 'admin')),
  code_hash text not null,
  updated_at timestamptz not null default now()
);

-- Flottes : pas de propriétaire de compte, juste un code partagé.
-- Position au repos (x, y) + éventuel trajet en cours (dest_x/dest_y/
-- dest_planet/departed_at/arrival_at) : tant que dest_x n'est pas nul,
-- la flotte est "en transit" et sa position affichée est interpolée entre
-- (x, y) et (dest_x, dest_y) selon l'heure actuelle.
create table fleets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  faction text not null check (faction in ('republique', 'csi', 'mandalore')),
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

create index fleets_faction_idx on fleets (faction);
