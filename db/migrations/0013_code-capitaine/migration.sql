-- Un troisième type de code par flotte : le code Capitaine. Contrairement
-- au code de flotte (lecture seule) et au code de vaisseau (contrôle d'UN
-- seul navire), le code Capitaine donne un ordre de déplacement groupé à
-- TOUS les vaisseaux de la flotte en une fois (voir POST
-- /api/fleets/[id]/order). Les flottes existantes reçoivent un code
-- généré par le script de migration (fait en JS pour réutiliser
-- l'alphabet sans caractères ambigus du reste de l'appli).
alter table fleets add column captain_code text unique;
