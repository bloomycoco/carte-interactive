-- Poursuite en cours : le vaisseau chasseur vise ce vaisseau (NPC) tant
-- que la rencontre n'a pas été déclenchée par le rattrapage (voir le
-- tick dans GET /api/ships). Nul dès que la poursuite s'arrête, que ce
-- soit par abandon (cible indisponible) ou par capture.
alter table ships add column chase_target_id uuid references ships(id) on delete set null;
