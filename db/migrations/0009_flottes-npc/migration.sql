-- Flottes NPC (CSI / Mandalore / Cartel) : créées par l'Owner, se
-- baladent seules entre les planètes de leur propre clan (voir le tick
-- dans GET /api/ships). Les joueurs ne peuvent plus créer que des
-- flottes République.
alter table fleets add column is_npc boolean not null default false;

alter table fleets drop constraint if exists fleets_faction_check;
alter table fleets add constraint fleets_faction_check
  check (faction in ('republique', 'csi', 'mandalore', 'cartel'));

-- Nom du clan croisé, pour l'affichage ("vous croisez une flotte du
-- Cartel !") — snapshot texte, survit même si le vaisseau NPC croisé
-- est ensuite supprimé.
alter table ships add column encounter_enemy_faction text;
