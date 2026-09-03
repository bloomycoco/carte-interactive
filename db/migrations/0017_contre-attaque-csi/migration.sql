-- Le CSI tente de reprendre les planètes qu'il a perdues (> 50%
-- d'influence République) : une attaque est d'abord annoncée
-- (csi_attack_at = quand elle résout, clignote rouge sur la carte
-- pendant ce délai) puis résolue plus tard dans le tick — une victoire
-- CSI reprend 10 points d'influence d'un coup (voir POST
-- /api/ships/[id]/action pour le gain République symétrique, bien plus
-- lent : +1 point par victoire).
alter table planet_influence add column csi_attack_at timestamptz;
