-- Retrait complet du boss galactique (Summa-verminoth) : la fonctionnalité
-- est abandonnée. Supprime chasing_boss_id, les tables boss et
-- boss_hostile_planets, et ramène encounter_kind à ses trois valeurs
-- d'origine (transit/ground/chase), sans 'boss'.
alter table ships drop column if exists chasing_boss_id;

drop table if exists boss_hostile_planets;
drop table if exists boss;

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
