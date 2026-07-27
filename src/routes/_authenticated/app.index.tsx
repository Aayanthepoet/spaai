import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DashboardAnalyticsWidget } from "@/components/app/DashboardAnalyticsWidget";
import { OptOutTrendsWidget } from "@/components/app/OptOutTrendsWidget";
import { ComplianceDigestWidget } from "@/components/app/ComplianceDigestWidget";



export const Route = createFileRoute("/_authenticated/app/")({
  head: () => ({ meta: [{ title: "Overview — PropAI" }] }),
  component: Overview,
});

const tiles = [
  { name: "Schools", to: "/app/schools", table: "properties" as const, color: "var(--cyan)" },
  { name: "School Staff", to: "/app/owners", table: "owners" as const, color: "var(--gold)" },
  { name: "Contacts", to: "/app/contacts", table: "contacts" as const, color: "var(--violet)" },
  { name: "Lead Lists", to: "/app/lead-lists", table: "lead_lists" as const, color: "var(--green)" },
  { name: "Campaigns", to: "/app/campaigns", table: "campaigns" as const, color: "var(--cyan)" },
  
];

function Overview() {
  const { user } = useAuth();
  const { t } = useTranslation();

  const { data: counts } = useQuery({
    queryKey: ["overview-counts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const results = await Promise.all(
        tiles.map((tile) =>
          supabase.from(tile.table).select("*", { count: "exact", head: true }).then((r) => r.count ?? 0),
        ),
      );
      return Object.fromEntries(tiles.map((tile, i) => [tile.table, results[i]])) as Record<string, number>;
    },
  });

  const tileLabel: Record<string, string> = {
    properties: t("sidebar.schools"),
    owners: t("sidebar.staff"),
    contacts: t("sidebar.contactsResolver"),
    lead_lists: t("sidebar.leadLists"),
    campaigns: t("sidebar.campaignsLanguage"),
  };

  return (
    <div>
      <div className="eyebrow inline-flex">
        <span className="eyebrow-dot" />
        {t("overview.eyebrow")}
      </div>
      <h1 className="h-display text-[clamp(32px,4.5vw,52px)] mt-4">
        {t("overview.titleA")} <span className="h-italic">{t("overview.titleB")}</span>
      </h1>
      <p className="text-[var(--w55)] mt-3 max-w-xl">
        <Trans
          i18nKey="overview.signedInAs"
          values={{ email: user?.email ?? "" }}
          components={{ b: <span className="text-white" /> }}
        />
      </p>

      <div className="mt-10">
        <DashboardAnalyticsWidget />
      </div>

      <div className="mt-6">
        <ComplianceDigestWidget />
      </div>

      <div className="mt-6">
        <OptOutTrendsWidget />
      </div>


      <div className="mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Link
          to="/app/agent"
          className="surface p-5 hover:border-cyan transition col-span-2 md:col-span-1"
          style={{ background: "var(--cyan-d)", borderColor: "var(--cyan-b)" }}
        >
          <div className="text-xs uppercase tracking-widest font-bold text-cyan">PropAI Agent</div>
          <div className="text-2xl font-bold mt-3">{t("overview.chat")}</div>
          <div className="text-xs text-[var(--w55)] mt-1">{t("overview.agentDesc")}</div>
        </Link>
        {tiles.map((tile) => (
          <Link key={tile.name} to={tile.to} className="surface p-5 hover:border-cyan transition">
            <div className="text-xs uppercase tracking-widest font-bold" style={{ color: tile.color }}>
              {tileLabel[tile.table] ?? tile.name}
            </div>
            <div className="text-3xl font-bold mt-3">{counts?.[tile.table] ?? "—"}</div>
            <div className="text-xs text-[var(--w45)] mt-1">{t("overview.records")}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
