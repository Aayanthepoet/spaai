// STUB — placeholder detail page.
//
// The original 1153-line page was built on getPropertyDetail() from the deleted
// distress module, and ~900 of those lines rendered comps/ARV, market intel,
// vision renders, auctions, contracts, the watchlist button, and the live
// source-record timeline. All of that was cut.
//
// The real detail page is rebuilt during the property -> school rename. Only the
// AI scoring section is carried over, because it depends solely on
// scoring.functions (which survives). Note that its SYSTEM_PROMPT still scores
// seller motivation and must be retargeted to booking likelihood in that step.

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { scoreProperty } from "@/lib/engines/scoring.functions";
import { ArrowLeft, Flame, Home, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/schools/$schoolId")({
  head: () => ({ meta: [{ title: "School detail — PropAI" }] }),
  component: SchoolDetailPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-2xl font-bold">Couldn't load school</h1>
        <p className="text-sm text-[var(--w55)]">{error.message}</p>
        <button
          className="text-cyan text-sm"
          onClick={() => { reset(); router.invalidate(); }}
        >Retry</button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">School not found.</div>,
});

function SchoolDetailPage() {
  const { schoolId } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["school-detail", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, address, city, state, zip, county, lead_score, notes")
        .eq("id", schoolId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="text-[var(--w55)]">Loading…</div>;
  if (error) return <div className="text-red-400">{(error as Error).message}</div>;
  if (!data) return <div className="p-6">School not found.</div>;

  return (
    <div className="space-y-6">
      <Link to="/app/schools" className="inline-flex items-center gap-1 text-xs text-[var(--w55)] hover:text-white">
        <ArrowLeft className="h-3 w-3" /> Back to schools
      </Link>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{data.address}</h1>
        <p className="text-[var(--w55)]">
          {[data.city, data.state, data.zip].filter(Boolean).join(", ")}
          {data.county ? ` · ${data.county}` : ""}
        </p>
      </header>

      <div className="border border-border rounded-lg p-6 text-sm text-[var(--w55)]">
        The full detail view is being rebuilt. It returns as the school detail page during
        the property → school conversion.
      </div>

      <AiLeadScoreSection
        schoolId={schoolId}
        leadScore={data.lead_score ?? null}
        notes={data.notes ?? null}
      />
    </div>
  );
}

function parseScoreNotes(notes: string | null): { rationale: string | null; signals: string[]; tier: string | null } {
  if (!notes) return { rationale: null, signals: [], tier: null };
  const m = notes.match(/Lead Score\s+\d+\s+\(([^)]+)\):\s*([^\n]+)(?:\nSignals:\s*(.+))?/);
  if (!m) return { rationale: null, signals: [], tier: null };
  return {
    tier: m[1] ?? null,
    rationale: m[2]?.trim() ?? null,
    signals: (m[3] ?? "").split(";").map((s) => s.trim()).filter(Boolean),
  };
}

function AiLeadScoreSection({
  schoolId, leadScore, notes,
}: { schoolId: string; leadScore: number | null; notes: string | null }) {
  const scoreFn = useServerFn(scoreProperty);
  const router = useRouter();
  const mut = useMutation({
    // `property_id` is still the server-fn input key — renamed in 3E with the schema.
    mutationFn: () => scoreFn({ data: { property_id: schoolId } }),
    onSuccess: () => router.invalidate(),
  });
  const live = mut.data ?? null;
  const parsed = parseScoreNotes(notes);
  const score = live?.score ?? leadScore ?? null;
  const tier = live?.tier ?? parsed.tier;
  const rationale = live?.rationale ?? parsed.rationale;
  const signals = live?.signals ?? parsed.signals;

  const tierClass =
    tier === "on_fire" ? "bg-red-500/15 text-red-300 border-red-500/30" :
    tier === "hot"     ? "bg-orange-500/15 text-orange-300 border-orange-500/30" :
    tier === "warm"    ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
    tier === "cold"    ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" :
                         "bg-white/5 text-[var(--w55)] border-border";

  return (
    <section className="border border-border rounded-lg">
      <header className="flex items-center justify-between gap-3 p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-400" />
          <h2 className="font-medium">AI lead scoring</h2>
          {tier && (
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider border ${tierClass}`}>
              {tier.replace("_", " ")}
            </span>
          )}
        </div>
        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-cyan ${mut.isPending ? "animate-spin" : ""}`} />
          {mut.isPending ? "Scoring…" : score == null ? "Run AI score" : "Re-score"}
        </button>
      </header>
      <div className="p-4 space-y-4">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-bold tabular-nums">{score ?? "—"}</span>
          <span className="text-sm text-[var(--w55)]">/ 100 motivation</span>
        </div>
        {rationale && <p className="text-sm">{rationale}</p>}
        {signals.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--w55)] mb-1">Key signals</p>
            <ul className="flex flex-wrap gap-2">
              {signals.map((s, i) => (
                <li key={i} className="inline-flex items-center rounded px-2 py-1 text-xs bg-white/5 border border-border">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {score == null && !mut.isPending && (
          <p className="text-sm text-[var(--w55)]">
            <Home className="inline h-3.5 w-3.5 mr-1 text-cyan" />
            Run the AI scorer to evaluate this record.
          </p>
        )}
        {mut.isError && <p className="text-xs text-red-400">{(mut.error as Error).message}</p>}
      </div>
    </section>
  );
}
