"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type * as NetlifyIdentity from "netlify-identity-widget";
import styles from "./AuthWidget.module.css";

declare global {
  interface Window {
    netlifyIdentity?: typeof NetlifyIdentity;
  }
}

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
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    function attach(identity: typeof NetlifyIdentity) {
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
        identity.off("init", onInit);
        identity.off("login", onLogin);
        identity.off("logout", onLogout);
      };
    }

    let detach: (() => void) | null = null;

    if (window.netlifyIdentity) {
      detach = attach(window.netlifyIdentity);
    } else {
      // the widget script (loaded via next/script) may still be fetching
      pollId = setInterval(() => {
        if (window.netlifyIdentity) {
          if (pollId) clearInterval(pollId);
          detach = attach(window.netlifyIdentity);
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      detach?.();
    };
  }, []);

  function openLogin() {
    setLoading(true);
    window.netlifyIdentity?.open("login");
    setLoading(false);
  }

  function logout() {
    window.netlifyIdentity?.logout();
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
      {(profile.role === "owner" || profile.role === "gm") && (
        <Link href="/admin" className={styles.adminLink}>
          Admin
        </Link>
      )}
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
