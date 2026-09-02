"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./SessionWidget.module.css";

type Role = "owner" | "admin";

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin" };

export default function SessionWidget() {
  const [role, setRole] = useState<Role | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [formRole, setFormRole] = useState<Role>("admin");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session/me")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRole(data.role ?? null);
        setReady(true);
      })
      .catch(() => setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: formRole, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "échec de connexion");
        return;
      }
      setRole(data.role);
      setOpen(false);
      setCode("");
    } catch {
      setError("erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/session/logout", { method: "POST" });
    setRole(null);
  }

  if (!ready) return null;

  if (!role) {
    return (
      <div className={styles.wrap}>
        <button className={styles.pill} onClick={() => setOpen((v) => !v)}>
          Connexion
        </button>
        {open && (
          <form className={styles.loginForm} onSubmit={handleLogin}>
            <select value={formRole} onChange={(e) => setFormRole(e.target.value as Role)}>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <input
              type="password"
              placeholder="Code d'accès"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <button type="submit" disabled={loading || !code.trim()}>
              {loading ? "…" : "OK"}
            </button>
            {error && <div className={styles.formError}>{error}</div>}
          </form>
        )}
      </div>
    );
  }

  return (
    <div className={styles.userPill}>
      <Link href="/admin" className={styles.adminLink}>
        Admin
      </Link>
      <span className={styles.role} data-role={role}>
        {ROLE_LABEL[role]}
      </span>
      <button className={styles.logout} onClick={handleLogout} title="Déconnexion">
        ✕
      </button>
    </div>
  );
}
