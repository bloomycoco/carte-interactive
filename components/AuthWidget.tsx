"use client";

import { useEffect, useState } from "react";
import type { User } from "netlify-identity-widget";
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
    let identity: typeof import("netlify-identity-widget");
    const onLogin = () => {
      identity.close();
      refreshProfile();
    };
    const onLogout = () => setProfile(null);
    const onInit = (user: User | null) => {
      if (user) refreshProfile();
    };

    import("netlify-identity-widget").then((mod) => {
      identity = mod;
      identity.init();
      setReady(true);

      identity.on("login", onLogin);
      identity.on("logout", onLogout);
      identity.on("init", onInit);
    });

    return () => {
      if (!identity) return;
      identity.off("login", onLogin);
      identity.off("logout", onLogout);
      identity.off("init", onInit);
    };
  }, []);

  async function openLogin() {
    setLoading(true);
    const identity = await import("netlify-identity-widget");
    identity.open("login");
    setLoading(false);
  }

  async function logout() {
    const identity = await import("netlify-identity-widget");
    identity.logout();
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
