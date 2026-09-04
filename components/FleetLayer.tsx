"use client";

import { FACTION_META } from "@/lib/planets";
import { currentPosition, isActionActive, type PublicShip, type UnlockedShip } from "@/lib/fleet-motion";
import { ACTION_LABEL } from "@/lib/planet-actions";
import styles from "./FleetLayer.module.css";

export default function FleetLayer({
  ships,
  unlockedShips,
  now,
  onSelectShip,
}: {
  ships: PublicShip[];
  unlockedShips: UnlockedShip[];
  now: number;
  onSelectShip?: (id: string) => void;
}) {
  return (
    <>
      {ships.map((s) => {
        const pos = currentPosition(s, now);
        const meta = FACTION_META[s.faction];
        const isMine = unlockedShips.some((u) => u.id === s.id);
        const label = s.category ? `${s.name} (${s.category})` : s.name;
        const busy = isActionActive(s, now);
        let status = s.dest_planet ? `${label} — en route vers ${s.dest_planet}` : `${label} — à quai`;
        if (pos.stuck) status = `${label} — flotte ennemie en vue !`;
        else if (busy) status = `${label} — ${ACTION_LABEL[s.action_type ?? "seized"]}`;
        else if (s.quest_type === "humanitarian")
          status += s.quest_phase === "fetching" ? " (chercher des vivres)" : " (ramener les vivres)";
        else if (s.damaged) status += " (endommagé)";
        else if (s.chase_target_id) status += " (en chasse)";
        else if (s.chasing_boss_id) status += " (en chasse du boss)";
        return (
          <div
            key={s.id}
            className={[
              styles.fleet,
              pos.traveling ? styles.traveling : "",
              isMine ? styles.mine : "",
              pos.stuck ? styles.stuck : "",
              busy ? styles.busy : "",
              s.damaged ? styles.damaged : "",
              styles.clickable,
            ].join(" ")}
            style={{
              left: pos.x,
              top: pos.y,
              ["--fleet-color" as string]: meta.color,
            }}
            title={status}
            data-ship-marker="true"
            onClick={() => onSelectShip?.(s.id)}
          >
            <div className={styles.icon} />
          </div>
        );
      })}
    </>
  );
}
