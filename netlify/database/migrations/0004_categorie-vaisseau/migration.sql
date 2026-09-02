-- Classe/catégorie du vaisseau (ex: Venator, Providence, Kom'rk...),
-- libre (pas de contrainte check : la liste proposée à la création vit
-- côté application et peut évoluer sans migration).
alter table ships add column category text;
