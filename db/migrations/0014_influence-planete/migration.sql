-- Suivi cosmétique de l'influence République / camp ennemi sur une
-- planète attaquée : progresse de +1 point (jamais plus) à chaque
-- attaque réussie sur cette planète, jamais autrement. N'affecte pas le
-- territoire réel (toujours celui de lib/planets.ts) — sert uniquement
-- à afficher une jauge au clic sur la planète et à teinter son point sur
-- la carte en bleu une fois la République majoritaire (> 50%).
create table planet_influence (
  planet_name text primary key,
  republic_pct smallint not null default 0 check (republic_pct between 0 and 100),
  updated_at timestamptz not null default now()
);
