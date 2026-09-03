-- Chemin suivi par un trajet en cours (liste ordonnée de points, départ
-- réel puis planètes traversées via le réseau de routes, destination
-- incluse). Permet de faire voyager les vaisseaux le long des routes
-- plutôt qu'en ligne droite.
alter table ships add column path jsonb;
