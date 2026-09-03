-- Un troisième type de rencontre : "chase" (le joueur prend délibérément
-- un NPC en chasse en cliquant dessus, plutôt que d'attendre un
-- croisement fortuit ou une rencontre au sol). Choix : Combattre /
-- Négocier (sauf CSI) / Fuir (replie vers Coruscant, comme "ground").
-- La contrainte CHECK sur encounter_kind doit accepter cette valeur en
-- plus de 'transit' et 'ground' — on retrouve son nom dynamiquement
-- plutôt que de le supposer, au cas où Postgres l'aurait nommée
-- autrement que la convention par défaut.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'ships' and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%encounter_kind%';

  if constraint_name is not null then
    execute format('alter table ships drop constraint %I', constraint_name);
  end if;

  alter table ships add constraint ships_encounter_kind_check
    check (encounter_kind in ('transit', 'ground', 'chase'));
end $$;
