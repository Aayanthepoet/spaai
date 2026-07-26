// Outreach server functions. Sends through pluggable provider (mock today),
// records every attempt to public.outreach_messages, and exposes list +
// reply-tracking helpers consumed by the Outreach UI and inbound webhook.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireActiveSubscription } from "@/lib/billing/require-subscription.server";
import { z } from "zod";

const Channel = z.enum(["sms", "email", "mail"]);

const SendInput = z.object({
  owner_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  campaign_id: z.string().uuid().nullable().optional(),
  channel: Channel,
  to: z.string().min(3),
  subject: z.string().max(200).optional().nullable(),
  body: z.string().min(1).max(8000),
});

export const sendOutreach = createServerFn({ method: "POST" })
  .middleware([requireActiveSubscription])
  .inputValidator((d: unknown) => SendInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 0a. DNC guard — block sends to any contact row marked do_not_contact,
    //     whether selected by contact_id or matched on raw to_value. Logged
    //     to outreach_messages with status='blocked' for the audit trail.
    const normalizedTo = data.to.trim().toLowerCase();
    let dncHit: { id: string; value: string } | null = null;
    if (data.contact_id) {
      const { data: c, error: cErr } = await supabase
        .from("contacts")
        .select("id, value, do_not_contact")
        .eq("id", data.contact_id)
        .maybeSingle();
      if (cErr) throw new Error(cErr.message);
      if (c?.do_not_contact) dncHit = { id: c.id, value: c.value };
    }
    if (!dncHit && (data.channel === "sms" || data.channel === "email")) {
      const { data: matches } = await supabase
        .from("contacts")
        .select("id, value")
        .eq("contact_type", data.channel === "sms" ? "phone" : "email")
        .eq("do_not_contact", true)
        .ilike("value", normalizedTo);
      if (matches && matches.length > 0) dncHit = { id: matches[0].id, value: matches[0].value };
    }
    if (dncHit) {
      await supabase.from("outreach_messages").insert({
        user_id: userId,
        owner_id: data.owner_id ?? null,
        contact_id: data.contact_id ?? dncHit.id,
        campaign_id: data.campaign_id ?? null,
        channel: data.channel,
        direction: "outbound",
        to_value: data.to,
        subject: data.subject ?? null,
        body: data.body,
        status: "blocked",
        error: "Contact is flagged Do Not Contact",
      });
      throw new Error(
        `Blocked: ${dncHit.value} is flagged Do Not Contact. Remove the DNC flag in Contacts to message them again.`,
      );
    }

    // 0b. Compliance gate — SMS sends to a suppressed phone number are
    //    blocked, logged, and never hit the provider. This is the hard
    //    enforcement of carrier-required STOP/UNSUBSCRIBE handling.
    if (data.channel === "sms") {
      const { data: suppressed, error: supErr } = await supabase.rpc(
        "is_phone_suppressed",
        { _phone: data.to },
      );
      if (supErr) throw new Error(supErr.message);
      if (suppressed) {
        await supabase.from("outreach_messages").insert({
          user_id: userId,
          owner_id: data.owner_id ?? null,
          contact_id: data.contact_id ?? null,
          campaign_id: data.campaign_id ?? null,
          channel: "sms",
          direction: "outbound",
          to_value: data.to,
          body: data.body,
          status: "blocked",
          error: "Recipient is on the SMS opt-out registry",
        });
        throw new Error(
          `Blocked: ${data.to} has opted out of SMS. Restore via the Opt-outs registry to message them again.`,
        );
      }
    }


    // 1. Insert a queued row so we always have an audit record even if the
    //    provider call throws.
    const { data: inserted, error: insErr } = await supabase
      .from("outreach_messages")
      .insert({
        user_id: userId,
        owner_id: data.owner_id ?? null,
        contact_id: data.contact_id ?? null,
        campaign_id: data.campaign_id ?? null,
        channel: data.channel,
        direction: "outbound",
        to_value: data.to,
        subject: data.subject ?? null,
        body: data.body,
        status: "queued",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    // 2. Dispatch via provider (mock).
    const { dispatch } = await import("./mock-providers.server");
    let result;
    try {
      result = await dispatch({
        channel: data.channel,
        to: data.to,
        subject: data.subject ?? null,
        body: data.body,
      });
    } catch (e) {
      await supabase
        .from("outreach_messages")
        .update({ status: "failed", error: (e as Error).message })
        .eq("id", inserted.id);
      throw e;
    }

    // 3. Patch the row with provider outcome.
    const { error: updErr } = await supabase
      .from("outreach_messages")
      .update({
        status: result.status,
        provider: result.provider,
        provider_message_id: result.providerMessageId,
        error: result.error ?? null,
        sent_at: result.status === "sent" ? new Date().toISOString() : null,
      })
      .eq("id", inserted.id);
    if (updErr) throw new Error(updErr.message);

    return { id: inserted.id, ...result };
  });

export const listOutreach = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      owner_id: z.string().uuid().nullable().optional(),
      channel: Channel.nullable().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("outreach_messages")
      .select("id, owner_id, contact_id, channel, direction, to_value, subject, body, status, response, sent_at, replied_at, error, provider, created_at, owners(full_name)")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.owner_id) q = q.eq("owner_id", data.owner_id);
    if (data.channel) q = q.eq("channel", data.channel);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      message_id: z.string().uuid(),
      response: z.string().min(1).max(8000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("outreach_messages")
      .update({ status: "replied", response: data.response, replied_at: now })
      .eq("id", data.message_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Owners with skip-traced phone/email contacts, used by the Send dialog so
// the SMS/email path picks from real verified numbers instead of free text.
export const listReachableOwners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Pull all owners so the dialog can also list owners that do not yet
    // have any phone/email rows.
    const { data: ownerRows, error: oErr } = await context.supabase
      .from("owners")
      .select("id, full_name")
      .order("full_name", { ascending: true })
      .limit(500);
    if (oErr) throw new Error(oErr.message);

    const ownerIds = (ownerRows ?? []).map((o) => o.id);
    let contacts: Array<{
      id: string; owner_id: string | null; contact_type: string; value: string;
      confidence: number | null; is_verified: boolean;
    }> = [];
    if (ownerIds.length) {
      const { data: cRows, error: cErr } = await context.supabase
        .from("contacts")
        .select("id, owner_id, contact_type, value, confidence, is_verified, do_not_contact")
        .in("owner_id", ownerIds)
        .in("contact_type", ["phone", "email"])
        .eq("do_not_contact", false)
        .order("confidence", { ascending: false })
        .limit(2000);
      if (cErr) throw new Error(cErr.message);
      contacts = (cRows ?? []).map((c) => ({
        id: c.id,
        owner_id: c.owner_id,
        contact_type: c.contact_type,
        value: c.value,
        confidence: c.confidence != null ? Number(c.confidence) : null,
        is_verified: c.is_verified,
      }));
    }

    type ContactEntry = { id: string; value: string; confidence: number | null; is_verified: boolean };
    return (ownerRows ?? []).map((o) => {
      const mine = contacts.filter((c) => c.owner_id === o.id);
      const phones: ContactEntry[] = mine
        .filter((c) => c.contact_type === "phone")
        .map(({ id, value, confidence, is_verified }) => ({ id, value, confidence, is_verified }));
      const emails: ContactEntry[] = mine
        .filter((c) => c.contact_type === "email")
        .map(({ id, value, confidence, is_verified }) => ({ id, value, confidence, is_verified }));
      return {
        owner_id: o.id,
        full_name: o.full_name,
        phones,
        emails,
      };
    });
  });

// Lightweight registry of contact values flagged Do Not Contact. Used by the
// Send dialog to disable the send/export action the moment the recipient
// matches a DNC entry — server still re-checks before dispatch.
export const listDncContactValues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("contacts")
      .select("contact_type, value")
      .eq("do_not_contact", true)
      .in("contact_type", ["phone", "email"])
      .limit(5000);
    if (error) throw new Error(error.message);
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (const r of data ?? []) {
      const v = (r.value ?? "").trim().toLowerCase();
      if (!v) continue;
      if (r.contact_type === "phone") phones.add(v.replace(/[^0-9+]/g, ""));
      else if (r.contact_type === "email") emails.add(v);
    }
    return { phones: Array.from(phones), emails: Array.from(emails) };
  });

