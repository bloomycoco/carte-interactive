-- Le boss peut aussi être ciblé sur une FLOTTE précise à traquer (en
-- plus d'une planète à capturer, voir target_planet) — il fonce sur le
-- vaisseau le plus proche de cette flotte et endommage (renvoie sur
-- Kuat) tout ce qu'il rattrape. Mutuellement exclusif avec
-- target_planet : en fixer un vide l'autre (voir POST /api/boss/control).
alter table boss add column target_fleet_id uuid references fleets(id) on delete set null;
