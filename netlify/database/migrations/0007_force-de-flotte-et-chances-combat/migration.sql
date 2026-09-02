-- Historique de combat par flotte (façon KDA) : une flotte qui gagne
-- beaucoup de combats devient plus forte (voir lib/ship-classes.ts).
alter table fleets
  add column kills integer not null default 0,
  add column losses integer not null default 0;

-- % de chances de victoire annoncé au joueur au moment de la rencontre,
-- pour que le combat se résolve selon ce qui lui a été montré.
alter table ships add column encounter_win_chance integer;
