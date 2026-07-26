import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Send, Mail, MessageSquare, MapPin, Reply, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { listOutreach, sendOutreach, recordReply, listReachableOwners, listDncContactValues } from "@/lib/outreach/outreach.functions";

export const Route = createFileRoute("/_authenticated/app/outreach")({
  head: () => ({ meta: [{ title: "Outreach — PropAI" }] }),
  component: OutreachPage,
});

type Channel = "sms" | "email" | "mail";

const CHANNEL_META: Record<Channel, { label: string; icon: typeof Mail; color: string }> = {
  sms:   { label: "SMS",         icon: MessageSquare, color: "#06b6d4" },
  email: { label: "Email",       icon: Mail,          color: "#a855f7" },
  mail:  { label: "Direct mail", icon: MapPin,        color: "#f59e0b" },
};

const STATUS_META: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  queued:    { label: "Queued",    color: "#64748b", icon: Clock },
  sent:      { label: "Sent",      color: "#22c55e", icon: CheckCircle2 },
  delivered: { label: "Delivered", color: "#22c55e", icon: CheckCircle2 },
  failed:    { label: "Failed",    color: "#ef4444", icon: AlertCircle },
  replied:   { label: "Replied",   color: "#06b6d4", icon: Reply },
};

function OutreachPage() {
  const listFn = useServerFn(listOutreach);
  const [filter, setFilter] = useState<Channel | "all">("all");
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["outreach", filter],
    queryFn: () => listFn({ data: { channel: filter === "all" ? null : filter, limit: 200 } }),
  });

  const messages = data ?? [];
  const counts = messages.reduce(
    (acc, m) => {
      acc.total++;
      if (m.status === "sent" || m.status === "delivered") acc.sent++;
      if (m.status === "replied") acc.replied++;
      if (m.status === "failed") acc.failed++;
      return acc;
    },
    { total: 0, sent: 0, replied: 0, failed: 0 },
  );
  const replyRate = counts.sent > 0 ? Math.round((counts.replied / counts.sent) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Outreach</h1>
          <p className="text-[var(--w55)] text-sm mt-1">
            SMS, email, and direct-mail sends with reply tracking. Provider is currently mocked — webhook ready for Twilio / Resend / Lob.
          </p>
        </div>
        <SendMessageDialog onSent={() => qc.invalidateQueries({ queryKey: ["outreach"] })} />
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total messages" value={counts.total} />
        <Stat label="Sent" value={counts.sent} accent="emerald" />
        <Stat label="Replies" value={counts.replied} accent="cyan" />
        <Stat label="Reply rate" value={`${replyRate}%`} accent="cyan" />
      </section>

      <div className="flex gap-2 flex-wrap">
        {(["all", "sms", "email", "mail"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
              filter === c ? "bg-cyan/15 text-cyan border-cyan/40" : "border-border text-[var(--w55)] hover:bg-white/5"
            }`}
          >
            {c === "all" ? "All channels" : CHANNEL_META[c].label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-[var(--w55)]">Loading…</p>
      ) : messages.length === 0 ? (
        <div className="border border-border rounded-lg p-8 text-center text-sm text-[var(--w55)]">
          No outreach yet. Send your first message to start tracking replies.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-[rgba(255,255,255,.03)] text-left uppercase tracking-wider text-[var(--w55)]">
              <tr>
                <th className="px-4 py-2 font-normal">Channel</th>
                <th className="px-4 py-2 font-normal">Recipient</th>
                <th className="px-4 py-2 font-normal">Owner</th>
                <th className="px-4 py-2 font-normal">Subject / preview</th>
                <th className="px-4 py-2 font-normal">Status</th>
                <th className="px-4 py-2 font-normal">When</th>
                <th className="px-4 py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => {
                const ch = CHANNEL_META[m.channel as Channel];
                const st = STATUS_META[m.status] ?? STATUS_META.queued;
                const ChIcon = ch.icon;
                const StIcon = st.icon;
                const when = m.sent_at ?? m.created_at;
                return (
                  <tr key={m.id} className="border-t border-border align-top">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5" style={{ color: ch.color }}>
                        <ChIcon className="h-3.5 w-3.5" /> {ch.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px]">{m.to_value ?? "—"}</td>
                    <td className="px-4 py-2">{(m.owners as { full_name: string } | null)?.full_name ?? "—"}</td>
                    <td className="px-4 py-2 max-w-[280px]">
                      {m.subject && <div className="font-medium">{m.subject}</div>}
                      <div className="text-[var(--w55)] line-clamp-2">{m.body}</div>
                      {m.response && (
                        <div className="mt-1 text-cyan border-l-2 border-cyan/40 pl-2">
                          ↳ {m.response}
                        </div>
                      )}
                      {m.error && (
                        <div className="mt-1 text-red-400 text-[11px]">⚠ {m.error}</div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider border"
                        style={{ color: st.color, borderColor: `${st.color}55`, background: `${st.color}15` }}
                      >
                        <StIcon className="h-3 w-3" /> {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-[var(--w55)]">
                      {when ? new Date(when).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {m.status !== "replied" && m.direction === "outbound" && (
                        <SimulateReplyButton messageId={m.id} onDone={() => qc.invalidateQueries({ queryKey: ["outreach"] })} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: "emerald" | "cyan" }) {
  const color = accent === "emerald" ? "text-emerald-400" : accent === "cyan" ? "text-cyan" : "text-white";
  return (
    <div className="border border-border rounded-md p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--w55)]">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function SendMessageDialog({ onSent }: { onSent: () => void }) {
  const sendFn = useServerFn(sendOutreach);
  const reachableFn = useServerFn(listReachableOwners);
  const dncFn = useServerFn(listDncContactValues);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("sms");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [smsAck, setSmsAck] = useState(false);

  const { data: owners } = useQuery({
    queryKey: ["reachable-owners"],
    queryFn: () => reachableFn(),
    enabled: open,
  });

  const { data: dnc } = useQuery({
    queryKey: ["dnc-values"],
    queryFn: () => dncFn(),
    enabled: open,
  });

  const isDnc = (() => {
    if (channel === "mail" || !to.trim() || !dnc) return false;
    const v = to.trim().toLowerCase();
    if (channel === "sms") return dnc.phones.includes(v.replace(/[^0-9+]/g, ""));
    return dnc.emails.includes(v);
  })();

  const ownerList = owners ?? [];
  const selectedOwner = ownerId ? ownerList.find((o) => o.owner_id === ownerId) ?? null : null;
  const availableContacts = !selectedOwner
    ? []
    : channel === "sms"
      ? selectedOwner.phones
      : channel === "email"
        ? selectedOwner.emails
        : [];

  const mut = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          channel,
          to: to.trim(),
          subject: channel === "email" ? subject.trim() || null : null,
          body: body.trim(),
          owner_id: ownerId,
          contact_id: contactId,
        },
      }),
    onSuccess: () => {
      setOpen(false);
      setTo(""); setSubject(""); setBody("");
      setOwnerId(null); setContactId(null);
      onSent();
    },
    onError: (e: Error) => setErr(e.message),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-cyan text-black px-3 py-2 text-sm font-medium hover:bg-cyan/90"
      >
        <Send className="h-3.5 w-3.5" /> Send message
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          if (!to.trim() || !body.trim()) { setErr("Recipient and body are required."); return; }
          if (isDnc) { setErr("This recipient is flagged Do Not Contact. Remove the DNC flag in Contacts before sending."); return; }
          if (channel === "sms" && !smsAck) { setErr("Acknowledge TCPA consent before sending SMS."); return; }
          mut.mutate();
        }}
        className="bg-[#0a0f17] border border-border rounded-lg w-full max-w-lg p-5 space-y-4"
      >
        <h2 className="text-lg font-semibold">New outreach message</h2>

        {isDnc && (
          <div className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 text-red-200 text-xs rounded p-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Do Not Contact</div>
              <div className="opacity-80">This {channel === "sms" ? "number" : "email"} is on your DNC list. Sending and exporting are disabled. Re-enable via Contacts → Allow.</div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {(["sms", "email", "mail"] as const).map((c) => {
            const Icon = CHANNEL_META[c].icon;
            return (
              <button
                key={c}
                type="button"
                onClick={() => { setChannel(c); setContactId(null); setTo(""); if (c !== "sms") setSmsAck(false); }}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded border transition-colors ${
                  channel === c ? "bg-cyan/15 text-cyan border-cyan/40" : "border-border text-[var(--w55)] hover:bg-white/5"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {CHANNEL_META[c].label}
              </button>
            );
          })}
        </div>

        {channel === "sms" && (
          <div className="border border-amber-500/40 bg-amber-500/10 rounded p-3 space-y-2 text-[11px] text-amber-100">
            <div className="font-semibold uppercase tracking-wider text-amber-300">⚠ TCPA / cold-SMS warning</div>
            <p className="opacity-90">
              Property owners in PropAI have not opted in to receive texts. Cold SMS to non-consenting recipients can violate
              the TCPA, state laws, and carrier policy. Prefer email or direct mail for owner outreach. Only send SMS where
              you have prior express written consent from the recipient.
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={smsAck} onChange={(e) => setSmsAck(e.target.checked)} className="mt-0.5" />
              <span>I confirm I have prior express written consent from this recipient and accept full responsibility for TCPA/state/carrier compliance.</span>
            </label>
          </div>
        )}


        {(channel === "sms" || channel === "email") && (
          <div className="space-y-2 border border-border rounded p-3 bg-[rgba(255,255,255,.02)]">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] uppercase tracking-wider text-[var(--w55)]">
                Pick from skip-traced owners (optional)
              </label>
              <div className="flex items-center gap-2 text-[10px] text-[var(--w55)]">
                <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> Verified</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" /> Pending</span>
              </div>
            </div>
            <select
              value={ownerId ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                setOwnerId(id);
                setContactId(null);
                if (!id) setTo("");
              }}
              className="w-full px-3 py-2 bg-[rgba(255,255,255,.04)] border border-border rounded text-sm"
            >
              <option value="">— manual entry —</option>
              {(() => {
                const channelKey = channel === "sms" ? "phones" : "emails";
                return ownerList.map((o) => {
                  const count = o[channelKey].length;
                  const disabled = count === 0;
                  const suffix = disabled
                    ? ` — no ${channel === "sms" ? "phone" : "email"}`
                    : ` · ${count} ${channel === "sms" ? "phone" : "email"}${count > 1 ? "s" : ""}`;
                  return (
                    <option key={o.owner_id} value={o.owner_id} disabled={disabled}>
                      {o.full_name}{suffix}
                    </option>
                  );
                });
              })()}
            </select>

            {selectedOwner && availableContacts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {availableContacts.map((c) => {
                  const active = contactId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setContactId(c.id); setTo(c.value); }}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] rounded border font-mono transition-colors ${
                        active ? "bg-cyan/15 text-cyan border-cyan/40" : "border-border text-[var(--w55)] hover:bg-white/5"
                      }`}
                      title={c.is_verified ? "Verified contact" : "Unverified contact"}
                    >
                      {c.value}
                      {c.confidence != null && (
                        <span className="text-[9px] opacity-70">{c.confidence}%</span>
                      )}
                      {c.is_verified && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedOwner && availableContacts.length === 0 && (
              <p className="text-[11px] text-amber-300">
                No {channel === "sms" ? "phone numbers" : "emails"} on file for this owner. Try the
                other channel, or add a verified contact first.
              </p>
            )}
            {ownerList.length === 0 && (
              <p className="text-[11px] text-[var(--w55)]">
                No owners yet. Save a property to populate this list.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase tracking-wider text-[var(--w55)]">
            {channel === "sms" ? "Phone (E.164)" : channel === "email" ? "Email" : "Mailing address"}
          </label>
          <input
            value={to}
            onChange={(e) => { setTo(e.target.value); setContactId(null); }}
            placeholder={channel === "sms" ? "+15551234567" : channel === "email" ? "owner@example.com" : "123 Main St, Phila PA 19103"}
            className="w-full mt-1 px-3 py-2 bg-[rgba(255,255,255,.04)] border border-border rounded text-sm font-mono"
          />
        </div>

        {channel === "email" && (
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[var(--w55)]">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick question about your property"
              className="w-full mt-1 px-3 py-2 bg-[rgba(255,255,255,.04)] border border-border rounded text-sm"
            />
          </div>
        )}

        <div>
          <label className="text-[10px] uppercase tracking-wider text-[var(--w55)]">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Hi {{first_name}}, I saw your property at…"
            className="w-full mt-1 px-3 py-2 bg-[rgba(255,255,255,.04)] border border-border rounded text-sm"
          />
        </div>

        {err && <p className="text-red-400 text-xs">{err}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs rounded border border-border">
            Cancel
          </button>
          <button
            type="submit"
            disabled={mut.isPending || isDnc || (channel === "sms" && !smsAck)}
            title={isDnc ? "Recipient is flagged Do Not Contact" : channel === "sms" && !smsAck ? "Acknowledge TCPA consent to enable SMS send" : undefined}
            className="px-4 py-1.5 text-xs rounded bg-cyan text-black font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mut.isPending ? "Sending…" : isDnc ? "Blocked (DNC)" : channel === "sms" && !smsAck ? "Acknowledge consent" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SimulateReplyButton({ messageId, onDone }: { messageId: string; onDone: () => void }) {
  const replyFn = useServerFn(recordReply);
  const mut = useMutation({
    mutationFn: (text: string) => replyFn({ data: { message_id: messageId, response: text } }),
    onSuccess: () => onDone(),
  });
  const handle = () => {
    const text = window.prompt("Simulate inbound reply (mocks what a real provider webhook would post):");
    if (text && text.trim()) mut.mutate(text.trim());
  };
  return (
    <button
      type="button"
      onClick={handle}
      disabled={mut.isPending}
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--w55)] hover:text-cyan disabled:opacity-50"
      title="Simulate an inbound reply for this message"
    >
      <Reply className="h-3 w-3" /> Reply
    </button>
  );
}
