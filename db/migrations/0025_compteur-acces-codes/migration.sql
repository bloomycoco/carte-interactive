-- Suivi anonyme des appareils ayant déverrouillé un code (flotte,
-- Capitaine, ou vaisseau) — aucun compte joueur n'existe, juste un
-- identifiant généré et mémorisé côté navigateur (localStorage),
-- envoyé à chaque déverrouillage. Sert uniquement à afficher un
-- compteur d'appareils distincts sur la page Owner/Admin.
create table if not exists code_access (
  kind text not null check (kind in ('fleet', 'captain', 'ship')),
  target_id uuid not null,
  device_id text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (kind, target_id, device_id)
);

create index if not exists code_access_target_idx on code_access (kind, target_id);
