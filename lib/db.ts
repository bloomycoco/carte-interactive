import { neon } from "@neondatabase/serverless";

let client: ReturnType<typeof neon> | null = null;

function sqlTag<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL manquant");
    client = neon(url);
  }
  return client(strings, ...values) as unknown as Promise<T[]>;
}

// Même forme que @netlify/database's getDatabase().sql, pour ne pas avoir
// à toucher les routes qui l'utilisent.
export function getDatabase() {
  return { sql: sqlTag };
}
