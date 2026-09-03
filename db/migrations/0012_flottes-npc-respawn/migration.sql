-- Chaque camp NPC (CSI, Mandalore, Cartel) garde toujours 3 flottes sur
-- la carte : une flotte détruite au combat n'est pas supprimée, elle
-- reste sans vaisseau avec une date de réapparition (respawn_at), et se
-- voit redonner un vaisseau une fois ce délai écoulé (voir le tick dans
-- GET /api/ships).
alter table fleets add column respawn_at timestamptz;
