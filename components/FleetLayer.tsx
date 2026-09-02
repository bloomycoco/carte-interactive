"use client";

import { FACTION_META } from "@/lib/planets";
import { currentPosition, type PublicFleet, type UnlockedFleet } from "@/lib/fleet-motion";
import styles from "./FleetLayer.module.css";

export default function FleetLayer({
  fleets,
  unlockedFleets,
  now,
}: {
  fleets: PublicFleet[];
  unlockedFleets: UnlockedFleet[];
  now: number;
}) {
  return (
    <>
      {fleets.map((f) => {
        const pos = currentPosition(f, now);
        const meta = FACTION_META[f.faction];
        const isMine = unlockedFleets.some((u) => u.id === f.id);
        const status = f.dest_planet
          ? `${f.name} — en route vers ${f.dest_planet}`
          : `${f.name} — à quai`;
        return (
          <div
            key={f.id}
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
