// Owner + contact read/write server functions.
//
// Extracted verbatim from the former src/lib/skiptrace/skiptrace.functions.ts
// during the SpaAI cut. The skip-trace provider and its runSkipTrace entry
// point were removed (school staff directories are public), but these three
// functions are plain owner/contact CRUD with no skip-trace dependency and are
// consumed by app.owners.tsx and app.contacts.tsx.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listOwners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("owners")
      .select("id, full_name, entity_type, mailing_city, mailing_state, mailing_zip, property_id, skip_trace_status, skip_trace_last_run_at, properties(address)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // Count contacts per owner so the UI can show "5 contacts" badges.
    const ids = (data ?? []).map((o) => o.id);
    let counts: Record<string, number> = {};
    if (ids.length) {
      const { data: contactRows } = await context.supabase
        .from("contacts")
        .select("owner_id")
        .in("owner_id", ids);
      counts = (contactRows ?? []).reduce((acc, r) => {
        const k = r.owner_id as string;
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
    }

    return (data ?? []).map((o) => ({ ...o, contact_count: counts[o.id] ?? 0 }));
  });

export const listOwnerContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ owner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("contacts")
      .select("id, contact_type, value, confidence, notes, is_verified, do_not_contact, created_at")
      .eq("owner_id", data.owner_id)
      .order("confidence", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const setContactDoNotContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ contact_id: z.string().uuid(), do_not_contact: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("contacts")
      .update({ do_not_contact: data.do_not_contact } as never)
      .eq("id", data.contact_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
