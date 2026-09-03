-- Actions à la surface d'une planète : aide humanitaire (mondes
-- neutres, instantané), propagation d'influence (mondes ennemis, 15 min,
-- immobilise le vaisseau), saisie par le Cartel (mondes du Cartel, 20
-- min, déclenchée automatiquement à 50% de chances à l'arrivée).
alter table ships
  add column action_type text check (action_type in ('influence', 'seized')),
  add column action_started_at timestamptz,
  add column action_ends_at timestamptz;
