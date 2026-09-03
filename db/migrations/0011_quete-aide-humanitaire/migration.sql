-- L'aide humanitaire sur un monde neutre n'est plus instantanée : elle
-- envoie le vaisseau chercher des vivres sur une planète tirée au sort
-- (toujours lointaine), puis les ramener sur le monde d'origine.
alter table ships
  add column quest_type text check (quest_type in ('humanitarian')),
  add column quest_origin_planet text,
  add column quest_target_planet text,
  add column quest_phase text check (quest_phase in ('fetching', 'returning'));
