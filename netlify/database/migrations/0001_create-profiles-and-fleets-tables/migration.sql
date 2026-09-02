-- Comptes : un profil par utilisateur Netlify Identity.
-- id = l'id du user Netlify Identity (sub du JWT), pas de FK Postgres possible
-- puisque les comptes vivent dans Identity, pas dans cette base.
create table if not exists profiles (
  id uuid primary key,
  email text not null,
  role text not null default 'player' check (role in ('owner', 'gm', 'player')),
  faction text check (faction in ('republique', 'csi', 'mandalore')),
  requested_faction text check (requested_faction in ('republique', 'csi', 'mandalore')),
  created_at timestamptz not null default now()
);

-- Flottes : appartiennent à une faction, éventuellement assignées à un joueur,
-- positionnées librement sur la carte (coordonnées du système de l'Atlas Galactique).
create table if not exists fleets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  faction text not null check (faction in ('republique', 'csi', 'mandalore')),
  owner_profile_id uuid references profiles (id) on delete set null,
  x double precision not null,
  y double precision not null,
  current_planet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fleets_faction_idx on fleets (faction);
create index if not exists fleets_owner_idx on fleets (owner_profile_id);
