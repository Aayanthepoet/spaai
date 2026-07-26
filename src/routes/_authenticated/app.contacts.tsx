import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { resolveOwnerContacts } from "@/lib/engines/contacts.functions";
import { setContactDoNotContact } from "@/lib/owners/owners.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/contacts")({
  head: () => ({ meta: [{ title: "Contacts — PropAI Contact Resolver" }] }),
  component: ContactsPage,
});

function ContactsPage() {
  const resolve = useServerFn(resolveOwnerContacts);
  const toggleDnc = useServerFn(setContactDoNotContact);
  const [pending, setPending] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function onToggleDnc(contactId: string, next: boolean) {
    setTogglingId(contactId);
    try {
      await toggleDnc({ data: { contact_id: contactId, do_not_contact: next } });
      toast.success(next ? "Marked Do Not Contact" : "Re-enabled for outreach");
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setTogglingId(null);
    }
  }

  const { data: owners, refetch } = useQuery({
    queryKey: ["owners-with-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owners")
        .select("id, full_name, entity_type, mailing_address, property_id, contacts(id, contact_type, value, confidence, notes, do_not_contact)")
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });

  async function runAi(ownerId: string) {
    setPending(ownerId);
    try {
      const res = await resolve({ data: { owner_id: ownerId } });
      toast.warning(`Generated ${res.resolved} SAMPLE candidate(s) — DO NOT CONTACT (unverified AI guesses)`);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow inline-flex"><span className="eyebrow-dot" />Contact Resolver</div>
        <h1 className="h-display text-[clamp(28px,4vw,44px)] mt-4">Resolved <span className="h-italic">contacts</span></h1>
        <p className="text-[var(--w55)] mt-3 max-w-xl">Resolve phones and emails from your owner records. Output below is AI-generated sample data for UI testing only.</p>
      </div>

      <div className="surface p-4 border border-amber-400/40 bg-amber-400/10">
        <div className="flex items-start gap-3">
          <div className="text-amber-300 font-semibold text-sm">⚠ Sample data only — do not contact</div>
        </div>
        <p className="text-xs text-[var(--w70)] mt-2 max-w-2xl">
          Any phones or emails produced by <em>AI resolve</em> are <strong>LLM-guessed</strong>, automatically prefixed with <code className="font-mono">[SAMPLE — NOT VERIFIED]</code>, and forced to <strong>Do Not Contact</strong> so outreach and exports cannot dial or email them.
        </p>
      </div>


      <div className="space-y-3">
        {(owners ?? []).length === 0 && (
          <div className="surface p-6 text-sm text-[var(--w55)]">No owners yet. Add owners from the Properties page.</div>
        )}
        {(owners ?? []).map((o) => {
          const isPending = pending === o.id;
          return (
            <div key={o.id} className="surface p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="space-y-1">
                  <div className="font-semibold flex items-center gap-2">
                    {o.full_name ?? "Unknown owner"}
                  </div>
                  <div className="text-xs text-[var(--w55)]">{o.entity_type ?? "individual"} · {o.mailing_address ?? ""}</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => runAi(o.id)} title="LLM-guessed candidates — DNC enforced">
                    {isPending ? "Resolving…" : "Generate sample (AI guess)"}
                  </Button>
                </div>
              </div>
              {o.contacts && o.contacts.length > 0 && (
                <div className="mt-3 grid sm:grid-cols-2 gap-2">
                  {o.contacts.map((c) => {
                    const isSkip = typeof c.notes === "string" && c.notes.startsWith("Skip trace");
                    const dnc = Boolean(c.do_not_contact);
                    const isSample = typeof c.value === "string" && c.value.startsWith("[SAMPLE");
                    const isToggling = togglingId === c.id;
                    return (
                      <div
                        key={c.id}
                        className={`text-xs flex items-center gap-2 border rounded p-2 ${isSample ? "border-amber-400/40 bg-amber-400/5" : "border-border"} ${dnc ? "opacity-70" : ""}`}
                      >
                        <Badge variant="outline">{c.contact_type}</Badge>
                        {isSample && (
                          <Badge className="text-[10px] bg-amber-500/20 text-amber-200 border border-amber-400/40" title="Fabricated sample — do not contact">SAMPLE</Badge>
                        )}
                        <span className={`font-mono truncate ${dnc ? "line-through" : ""}`}>{c.value}</span>
                        <span className="ml-auto flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px]">{isSkip ? "skip-trace" : "AI"}</Badge>
                          <span className="text-[var(--w55)]">{c.confidence ?? 0}%</span>
                          <Button
                            size="sm"
                            variant={dnc ? "destructive" : "ghost"}
                            className="h-6 px-2 text-[10px]"
                            disabled={isToggling || isSample}
                            onClick={() => onToggleDnc(c.id, !dnc)}
                            title={isSample ? "Sample data is locked to Do Not Contact" : dnc ? "Allow outreach again" : "Exclude from outreach & exports"}
                          >
                            {isToggling ? "…" : isSample ? "DNC (locked)" : dnc ? "DNC" : "Allow"}
                          </Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

