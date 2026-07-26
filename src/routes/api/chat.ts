import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT = `You are PropAI Agent, an assistant for a real-estate investor inside the PropAI app.

You have read access to the user's private workspace via tools:
- list_properties: browse the user's saved properties (with lead scores and distress flags)
- get_property: full details for one property including its owner(s) and contact info
- workspace_summary: top-line counts (properties, owners, contacts) for the user's workspace

Use tools proactively when the user asks about their data — don't guess. Call workspace_summary first when the user asks something open-ended ("what's going on", "give me an overview").

When summarizing properties:
- group by distress signal (preforeclosure / vacant / absentee) and equity
- highlight the highest-scoring opportunities
- be concise; use markdown bullet lists

When drafting outreach:
- adapt tone to the channel (SMS = short, email = warm, letter = personal)
- weave in concrete facts pulled via tools
- offer 2-3 variations
- never invent owner names, phone numbers, or details that aren't in the data

TASK MODE:
When the user asks for a plan, checklist, next steps, "what should I do", or the message is prefixed with [TASK MODE], you MUST call the create_task_plan tool. Group into sections like "Contacts to call", "Outreach drafts", "Follow-ups", "Research". Each task is one concrete action. After calling the tool, give a one-sentence summary — do not repeat the list as prose.

EMPTY RESULTS ≠ PERMISSION ERRORS:
- Tools return data scoped to the signed-in user via RLS. An empty array (e.g. count: 0, properties: []) means the user simply has no records yet — NOT that you lack permission.
- Never tell the user you have a "permission error", "authorization issue", or "can't access" their data unless a tool response actually contains an \`error\` field. If you see \`error\`, quote it verbatim.
- If the workspace is empty, say so plainly and suggest concrete next steps (e.g. "add a property", "import a lead list").`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabasePublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
        const lovableKey = process.env.LOVABLE_API_KEY;
        if (!supabaseUrl || !supabasePublishable) return new Response("Server misconfigured", { status: 500 });
        if (!lovableKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const supabase = createClient<Database>(supabaseUrl, supabasePublishable, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        if (userError || !userData.user) return new Response("Unauthorized", { status: 401 });

        // Subscription guard — 402 (no sub) / 403 (status not active/trialing). Admins pass.
        const { requireActiveSubscriptionApi } = await import("@/lib/billing/require-subscription.server");
        const subBlocked = await requireActiveSubscriptionApi(supabase, userData.user.id);
        if (subBlocked) return subBlocked;

        // Cap request body to 1MB before JSON parse.
        const cl = Number(request.headers.get("content-length") ?? "0");
        if (cl > 1_000_000) return new Response("Payload too large", { status: 413 });
        const body = (await request.json()) as { messages?: unknown; threadId?: unknown };
        if (!Array.isArray(body.messages)) return new Response("Messages required", { status: 400 });
        const threadId = typeof body.threadId === "string" ? body.threadId : "";
        if (!threadId) return new Response("threadId required", { status: 400 });

        // Verify the thread belongs to this user
        const { data: thread, error: threadErr } = await supabase
          .from("chat_threads")
          .select("id, title")
          .eq("id", threadId)
          .eq("user_id", userData.user.id)
          .maybeSingle();
        if (threadErr || !thread) return new Response("Thread not found", { status: 404 });

        const userId = userData.user.id;
        const incoming = body.messages as UIMessage[];
        const lastUserMsg = [...incoming].reverse().find((m) => m.role === "user");

        const gateway = createLovableAiGatewayProvider(lovableKey);
        const model = gateway("google/gemini-3-flash-preview");

        const tools = {
          list_properties: tool({
            description: "List the user's saved properties. Returns up to 50 most recent, with lead score and distress flags.",
            inputSchema: z.object({
              min_score: z.number().min(0).max(100).optional().describe("Only return properties with lead_score >= this"),
              distress_only: z.boolean().optional().describe("Only return preforeclosure, vacant, or absentee properties"),
            }),
            execute: async ({ min_score, distress_only }) => {
              let q = supabase
                .from("properties")
                .select("id, address, city, state, zip, estimated_value, equity, lead_score, is_preforeclosure, is_vacant, is_absentee")
                .order("lead_score", { ascending: false, nullsFirst: false })
                .limit(50);
              if (typeof min_score === "number") q = q.gte("lead_score", min_score);
              if (distress_only) q = q.or("is_preforeclosure.eq.true,is_vacant.eq.true,is_absentee.eq.true");
              const { data, error } = await q;
              if (error) return { error: error.message };
              return { count: data?.length ?? 0, properties: data ?? [] };
            },
          }),
          get_property: tool({
            description: "Get full details for one property including linked owners and their contacts.",
            inputSchema: z.object({ property_id: z.string().uuid() }),
            execute: async ({ property_id }) => {
              const { data: property, error } = await supabase
                .from("properties").select("*").eq("id", property_id).maybeSingle();
              if (error) return { error: error.message };
              if (!property) return { error: "Property not found" };
              const { data: owners } = await supabase
                .from("owners").select("id, full_name, entity_type, mailing_address").eq("property_id", property_id);
              const ownerIds = (owners ?? []).map(o => o.id);
              const { data: contacts } = ownerIds.length
                ? await supabase.from("contacts")
                    .select("id, owner_id, contact_type, value, confidence, do_not_contact")
                    .in("owner_id", ownerIds)
                : { data: [] };
              return { property, owners: owners ?? [], contacts: contacts ?? [] };
            },
          }),
          workspace_summary: tool({
            description: "High-level counts for the user's workspace: total properties, owners, and contacts.",
            inputSchema: z.object({}),
            execute: async () => {
              const [propsRes, ownersRes, contactsRes] = await Promise.all([
                supabase.from("properties").select("id", { count: "exact", head: true }),
                supabase.from("owners").select("id", { count: "exact", head: true }),
                supabase.from("contacts").select("id", { count: "exact", head: true }),
              ]);
              return {
                properties_total: propsRes.count ?? 0,
                owners_total: ownersRes.count ?? 0,
                contacts_total: contactsRes.count ?? 0,
              };
            },
          }),
          create_task_plan: tool({
            description: "Return a structured, actionable checklist for the user. Use when the user asks for a plan, next steps, or task mode. Group tasks into clear sections (e.g. 'Contacts to call', 'Outreach drafts', 'Follow-ups', 'Research'). Each task is one concrete action.",
            inputSchema: z.object({
              title: z.string().describe("Short title for this plan, e.g. 'Today's outreach plan'"),
              sections: z.array(z.object({
                name: z.string().describe("Section heading, e.g. 'Contacts to call'"),
                tasks: z.array(z.object({
                  label: z.string().describe("One concrete action, imperative voice"),
                  detail: z.string().optional().describe("Optional supporting context: phone number, draft snippet, due date, etc."),
                  priority: z.enum(["high", "medium", "low"]).optional(),
                })).min(1),
              })).min(1),
            }),
            execute: async (plan) => plan,
          }),
        };

        // Persist the latest user message (only the last one — earlier ones are already saved)
        if (lastUserMsg) {
          await supabase.from("chat_messages").insert({
            thread_id: threadId,
            user_id: userId,
            message_id: lastUserMsg.id,
            role: "user",
            parts: lastUserMsg.parts as unknown as Json,
          });

          // Auto-title the thread from the first user message if still default
          if (thread.title === "New chat") {
            const firstText = lastUserMsg.parts.find(
              (p): p is { type: "text"; text: string } => p.type === "text",
            )?.text;
            if (firstText) {
              const title = firstText.replace(/^\[TASK MODE\]\s*/i, "").slice(0, 60);
              await supabase.from("chat_threads").update({ title }).eq("id", threadId);
            }
          }
        }

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(incoming),
          tools,
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: incoming,
          onFinish: async ({ messages: finished }) => {
            // Persist any new assistant messages produced this turn
            const startIndex = incoming.length;
            const newOnes = finished.slice(startIndex);
            if (newOnes.length === 0) return;
            const rows = newOnes.map((m) => ({
              thread_id: threadId,
              user_id: userId,
              message_id: m.id,
              role: m.role,
              parts: m.parts as unknown as Json,
            }));
            const { error } = await supabase.from("chat_messages").insert(rows);
            if (error) console.error("[chat] failed to persist assistant messages", error);
            await supabase
              .from("chat_threads")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", threadId);
          },
        });
      },
    },
  },
});

