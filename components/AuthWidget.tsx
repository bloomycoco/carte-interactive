"use client";

import { useEffect, useRef, useState } from "react";
import type * as NetlifyIdentity from "netlify-identity-widget";
import styles from "./AuthWidget.module.css";

type Profile = {
  id: string;
  email: string;
  role: "owner" | "gm" | "player";
  faction: "republique" | "csi" | "mandalore" | null;
  requested_faction: "republique" | "csi" | "mandalore" | null;
};

const ROLE_LABEL: Record<Profile["role"], string> = {
  owner: "Owner",
  gm: "Maître du Jeu",
  player: "Joueur",
};

export default function AuthWidget() {
  const identityRef = useRef<typeof NetlifyIdentity | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);

  async function refreshProfile() {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) {
        setProfile(null);
        return;
      }
      const data = await res.json();
      setProfile(data.profile ?? null);
    } catch {
      setProfile(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const identity = require("netlify-identity-widget") as typeof NetlifyIdentity;
    identityRef.current = identity;

    const onLogin = () => {
      identity.close();
      refreshProfile();
    };
    const onLogout = () => setProfile(null);
    const onInit = (user: NetlifyIdentity.User | null) => {
      if (cancelled) return;
      setReady(true);
      if (user) refreshProfile();
    };

    identity.on("init", onInit);
    identity.on("login", onLogin);
    identity.on("logout", onLogout);
    identity.init();

    return () => {
      cancelled = true;
      identity.off("init", onInit);
      identity.off("login", onLogin);
      identity.off("logout", onLogout);
    };
  }, []);

  function openLogin() {
    setLoading(true);
    identityRef.current?.open("login");
    setLoading(false);
  }

  function logout() {
    identityRef.current?.logout();
  }

  if (!ready) return null;

  if (!profile) {
    return (
      <button className={styles.pill} onClick={openLogin} disabled={loading}>
        Se connecter
      </button>
    );
  }

  return (
    <div className={styles.userPill}>
      <span className={styles.role} data-role={profile.role}>
        {ROLE_LABEL[profile.role]}
      </span>
      <span className={styles.email}>{profile.email}</span>
      <button className={styles.logout} onClick={logout} title="Déconnexion">
        ✕
      </button>
    </div>
  );
}
