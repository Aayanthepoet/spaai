import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listScoredProperties,
  scoreAllUnscored,
  scoreProperty,
} from "@/lib/engines/scoring.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Flame, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/scoring")({
  head: () => ({ meta: [{ title: "Lead Scoring — PropAI" }] }),
  component: ScoringPage,
});

type Prop = {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  distress_type: string;
  equity: number | null;
  estimated_value: number | null;
  lead_score: number | null;
  notes: string | null;
  auction_date: string | null;
};

function tierFor(score: number | null) {
  if (score == null) return { label: "Unscored", cls: "bg-muted text-muted-foreground" };
  if (score >= 85) return { label: "🔥 On fire", cls: "bg-red-500/20 text-red-300 border-red-500/40" };
  if (score >= 65) return { label: "Hot", cls: "bg-orange-500/20 text-orange-300 border-orange-500/40" };
  if (score >= 40) return { label: "Warm", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
  return { label: "Cold", cls: "bg-sky-500/20 text-sky-300 border-sky-500/40" };
}

function ScoringPage() {
  const list = useServerFn(listScoredProperties);
  const scoreOne = useServerFn(scoreProperty);
  const scoreBatch = useServerFn(scoreAllUnscored);
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["scoring", "list"],
    queryFn: () => list(),
  });
  const properties = (data?.properties ?? []) as Prop[];
  const unscored = properties.filter((p) => p.lead_score == null).length;

  async function recalc(id: string) {
    setBusyId(id);
    try {
      const r = await scoreOne({ data: { property_id: id } });
      toast.success(`Scored ${r.score} (${r.tier})`);
      qc.invalidateQueries({ queryKey: ["scoring", "list"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  async function runBatch() {
    setBatchLoading(true);
    try {
      const r = await scoreBatch({ data: { limit: 10 } });
      toast.success(`Scored ${r.scored} propert${r.scored === 1 ? "y" : "ies"}`);
      qc.invalidateQueries({ queryKey: ["scoring", "list"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBatchLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow inline-flex"><span className="eyebrow-dot" />Lead Scoring Engine</div>
        <h1 className="h-display text-[clamp(28px,4vw,44px)] mt-4">
          Motivation <span className="h-italic">scores</span>
        </h1>
        <p className="text-[var(--w55)] mt-3 max-w-xl">
          AI rates each property 0–100 on seller motivation using equity, distress signals, vacancy,
          auction timing, and liens. Focus your outreach on the hottest leads first.
        </p>
      </div>

      <div className="surface p-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="text-sm text-[var(--w55)]">
          {properties.length} properties · {unscored} unscored
        </div>
        <Button onClick={runBatch} disabled={batchLoading || unscored === 0}>
          <Sparkles className="h-4 w-4 mr-1" />
          {batchLoading ? "Scoring…" : `Score next ${Math.min(10, unscored)} unscored`}
        </Button>
      </div>

      {isLoading ? (
        <div className="surface p-6 text-[var(--w55)]">Loading…</div>
      ) : properties.length === 0 ? (
        <div className="surface p-6 text-[var(--w55)]">
          No properties yet. Import some from the <Link to="/app/properties" className="underline">Properties</Link> page.
        </div>
      ) : (
        <div className="surface divide-y divide-border">
          {properties.map((p) => {
            const t = tierFor(p.lead_score);
            return (
              <div key={p.id} className="p-4 flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Link
                    to="/app/properties/$propertyId"
                    params={{ propertyId: p.id }}
                    className="font-medium hover:underline"
                  >
                    {p.address}
                  </Link>
                  <div className="text-xs text-[var(--w55)]">
                    {[p.city, p.state, p.zip].filter(Boolean).join(", ")} · {p.distress_type}
                    {p.equity != null && ` · ${p.equity}% equity`}
                    {p.auction_date && ` · auction ${new Date(p.auction_date).toLocaleDateString()}`}
                  </div>
                  {p.notes && (
                    <div className="text-xs text-[var(--w45)] mt-2 line-clamp-2">{p.notes}</div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-2xl font-semibold tabular-nums flex items-center gap-1">
                      {p.lead_score ?? "—"}
                      {p.lead_score != null && p.lead_score >= 85 && (
                        <Flame className="h-5 w-5 text-red-400" />
                      )}
                    </div>
                    <Badge variant="outline" className={t.cls}>{t.label}</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => recalc(p.id)}
                    disabled={busyId === p.id}
                  >
                    {busyId === p.id ? "Scoring…" : p.lead_score == null ? "Score" : "Recalc"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
