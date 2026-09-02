import type { UserSignupEvent } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

const handler = {
  async userSignup(event: UserSignupEvent) {
    const email = event.user.email ?? "";
    const isOwner = email.toLowerCase() === (process.env.OWNER_EMAIL ?? "").toLowerCase();
    const role = isOwner ? "owner" : "player";

    if (event.user.id) {
      const db = getDatabase();
      await db.sql`
        insert into profiles (id, email, role)
        values (${event.user.id}::uuid, ${email}, ${role})
        on conflict (id) do nothing
      `;
    }

    return {
      user: {
        ...event.user,
        appMetadata: {
          ...event.user.appMetadata,
          roles: [role],
        },
      },
    };
  },
};

export default handler;
