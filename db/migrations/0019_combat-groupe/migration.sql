-- Nombre de vaisseaux de chaque côté au moment où une rencontre a été
-- déclenchée (transit/sol/chasse) — purement informatif, pour afficher
-- "N vaisseaux vs M vaisseaux" dans la popup de combat. Effacés à la
-- résolution comme les autres champs encounter_*.
alter table ships add column encounter_friendly_count smallint;
alter table ships add column encounter_enemy_count smallint;
