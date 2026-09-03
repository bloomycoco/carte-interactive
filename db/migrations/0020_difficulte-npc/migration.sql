-- Multiplicateur de puissance par camp NPC, réglable depuis la page
-- Owner — permet de rééquilibrer la guerre à la volée (ex: freiner la
-- République si elle écrase tout le monde). 1.0 = aucun changement.
create table npc_difficulty (
  faction text primary key check (faction in ('csi', 'mandalore', 'cartel')),
  multiplier real not null default 1.0 check (multiplier > 0),
  updated_at timestamptz not null default now()
);

insert into npc_difficulty (faction, multiplier) values
  ('csi', 1.0),
  ('mandalore', 1.0),
  ('cartel', 1.0);
