-- Rencontres aléatoires en cours de trajet (flotte ennemie croisée sur
-- la route) et dégâts consécutifs à une fuite ou une défaite.
alter table ships
  add column damaged boolean not null default false,
  add column encounter_pending boolean not null default false,
  add column encounter_at timestamptz,
  add column encounter_x double precision,
  add column encounter_y double precision;
