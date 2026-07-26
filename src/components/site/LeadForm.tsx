// Public contact / inquiry form.
//
// Stubbed during the SpaAI cut: the lead-funnel fields (company, target city,
// state, ZIP) are gone, along with the qualification framing. What remains is a
// plain "get in touch" form. The SMS consent checkbox and its disclosure text are
// deliberately unchanged — that is the TCPA record, not funnel machinery.

import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

const schema = z.object({
  full_name: z.string().trim().min(1, "Required").max(120),
  email: z.string().trim().email("Invalid email").max(255),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a valid phone number")
    .max(20)
    .regex(/^[+()\-\s\d]+$/, "Enter a valid phone number"),
  message: z.string().trim().max(2000).optional(),
  sms_opt_in: z.literal("on", {
    errorMap: () => ({ message: "You must agree to receive text messages to continue" }),
  }),
});

export function LeadForm({ source = "landing" }: { source?: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = schema.safeParse({
      full_name: fd.get("full_name"),
      email: fd.get("email"),
      phone: fd.get("phone"),
      message: fd.get("message") || undefined,
      sms_opt_in: fd.get("sms_opt_in"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your inputs");
      return;
    }
    setLoading(true);
    const { sms_opt_in, ...rest } = parsed.data;
    // Honeypot value — should always be empty for real users.
    const honeypot = (fd.get("website") as string | null) ?? "";

    const resp = await fetch("/api/public/lead-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rest, sms_opt_in: true, source, website: honeypot }),
    });
    setLoading(false);
    if (!resp.ok) {
      if (resp.status === 429) {
        toast.error("Too many submissions from your network. Try again later.");
      } else {
        toast.error("Couldn't submit. Try again.");
      }
      return;
    }
    setDone(true);
    toast.success("Thanks! We'll be in touch within 24 hours.");
  }

  if (done) {
    return (
      <div className="surface p-8 text-center">
        <div className="text-cyan text-3xl mb-2">✓</div>
        <div className="font-semibold">Message received.</div>
        <div className="text-sm text-[var(--w55)] mt-1">We'll get back to you within 24 hours.</div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="surface p-7 space-y-4">
      {/* Honeypot — off-screen, hidden from AT and autofill. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", top: "-9999px", width: 1, height: 1, overflow: "hidden" }}
      >
        <label aria-hidden="true">
          Website (leave blank)
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <input name="full_name" required placeholder="Full name" className="bg-[var(--s1)] border border-border rounded-md px-4 py-3 text-sm w-full focus:outline-none focus:border-cyan" />
        <input name="email" type="email" required placeholder="Email" className="bg-[var(--s1)] border border-border rounded-md px-4 py-3 text-sm w-full focus:outline-none focus:border-cyan" />
      </div>
      <input name="phone" type="tel" required placeholder="Mobile phone (e.g. +1 555 123 4567)" className="bg-[var(--s1)] border border-border rounded-md px-4 py-3 text-sm w-full focus:outline-none focus:border-cyan" />
      <textarea name="message" rows={4} placeholder="How can we help?" className="bg-[var(--s1)] border border-border rounded-md px-4 py-3 text-sm w-full focus:outline-none focus:border-cyan resize-none" />

      <label className="flex gap-3 items-start text-[12px] leading-[1.55] text-[var(--w55)] cursor-pointer select-none">
        <input
          type="checkbox"
          name="sms_opt_in"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--cyan)] cursor-pointer"
        />
        <span>
          By checking this box, I agree to receive recurring text messages from <span className="text-white font-semibold">PropAI</span> (by AI Network Agency) at the phone number provided, including informational and promotional messages sent via automated technology. Consent is not a condition of purchase. Message &amp; data rates may apply. Message frequency varies. Reply <span className="font-mono text-white">STOP</span> to opt out or <span className="font-mono text-white">HELP</span> for help. See our{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-cyan underline">Privacy Policy</a> and{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-cyan underline">Terms &amp; Conditions</a>.
        </span>
      </label>

      <button disabled={loading} className="btn-primary w-full disabled:opacity-60">
        {loading ? "Sending…" : "Get in touch →"}
      </button>
      <p className="text-[11px] text-[var(--w35)] text-center">We respond within 24 hours.</p>
    </form>
  );
}
