"use client";

import { FACTION_META } from "@/lib/planets";
import { currentPosition, type PublicShip, type UnlockedShip } from "@/lib/fleet-motion";
import styles from "./FleetLayer.module.css";

export default function FleetLayer({
  ships,
  unlockedShips,
  now,
}: {
  ships: PublicShip[];
  unlockedShips: UnlockedShip[];
  now: number;
}) {
  return (
    <>
      {ships.map((s) => {
        const pos = currentPosition(s, now);
        const meta = FACTION_META[s.faction];
        const isMine = unlockedShips.some((u) => u.id === s.id);
        const label = s.category ? `${s.name} (${s.category})` : s.name;
        const status = s.dest_planet ? `${label} — en route vers ${s.dest_planet}` : `${label} — à quai`;
        return (
          <div
            key={s.id}
            className={`${styles.fleet} ${pos.traveling ? styles.traveling : ""} ${isMine ? styles.mine : ""}`}
            style={{
              left: pos.x,
              top: pos.y,
              ["--fleet-color" as string]: meta.color,
            }}
            title={status}
          >
            <div className={styles.icon} />
          </div>
        );
      })}
    </>
  );
}
