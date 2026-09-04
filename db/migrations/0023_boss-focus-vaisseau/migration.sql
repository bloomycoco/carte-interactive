-- Le Focus du boss cible un vaisseau précis, pas toute une flotte —
-- remplace target_fleet_id (jamais réellement utilisé en jeu) par
-- target_ship_id.
alter table boss drop column if exists target_fleet_id;
alter table boss add column target_ship_id uuid references ships(id) on delete set null;
