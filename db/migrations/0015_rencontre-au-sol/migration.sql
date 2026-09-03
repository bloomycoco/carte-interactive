-- Distingue une rencontre "en transit" (croisement en plein vol, choix
-- Combattre/Négocier/Fuir) d'une rencontre "au sol" (une flotte CSI et
-- une flotte République posées sur la même planète, choix
-- Combattre/Tenter de passer inaperçu/Fuir) — voir le tick dans
-- GET /api/ships et POST /api/ships/[id]/resolve-encounter.
alter table ships add column encounter_kind text check (encounter_kind in ('transit', 'ground'));
