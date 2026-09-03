-- Référence, sur le vaisseau République en rencontre, le vaisseau NPC
-- croisé — pour pouvoir le libérer une fois la rencontre résolue (le
-- vaisseau NPC est lui aussi figé pendant ce temps, via son propre
-- encounter_pending/encounter_at).
alter table ships add column encounter_npc_ship_id uuid references ships (id) on delete set null;
