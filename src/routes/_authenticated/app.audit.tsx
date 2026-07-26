import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ScrollText, Download, Send, FileText, Loader2, Lock } from "lucide-react";
import { listAuditEvents, logAuditEvent, exportAuditEvents, getMyAuditPermissions } from "@/lib/audit/audit.functions";

export const Route = createFileRoute("/_authenticated/app/audit")({
  head: () => ({ meta: [{ title: "Audit Log — PropAI" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    action: typeof search.action === "string" ? search.action : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
  component: AuditPage,
  errorComponent: ({ error }) => <div className="p-6 text-red-400">{error.message}</div>,
});

const ACTION_META: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  "export.csv": { label: "CSV Export", icon: Download, color: "text-cyan" },
  "outreach.send": { label: "Outreach sent", icon: Send, color: "text-purple-400" },
};

function toIsoStart(d: string | null) {
  if (!d) return null;
  return new Date(`${d}T00:00:00.000Z`).toISOString();
}
function toIsoEnd(d: string | null) {
  if (!d) return null;
  return new Date(`${d}T23:59:59.999Z`).toISOString();
}

function AuditPage() {
  const listFn = useServerFn(listAuditEvents);
  const logFn = useServerFn(logAuditEvent);
  const exportFn = useServerFn(exportAuditEvents);
  const permsFn = useServerFn(getMyAuditPermissions);
  const qc = useQueryClient();

  const search = Route.useSearch();
  const [filter, setFilter] = useState<string>(search.action ?? "all");
  const [from, setFrom] = useState<string>(search.from ?? ""); // yyyy-mm-dd
  const [to, setTo] = useState<string>(search.to ?? "");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data: perms } = useQuery({
    queryKey: ["audit-permissions"],
    queryFn: () => permsFn(),
    staleTime: 60_000,
  });
  const canExport = perms?.canExport ?? false;
  const allowedRoles = perms?.allowedRoles ?? ["admin"];

  const queryInput = useMemo(
    () => ({
      action: filter === "all" ? null : filter,
      from: toIsoStart(from || null),
      to: toIsoEnd(to || null),
      limit: 500,
    }),
    [filter, from, to],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", queryInput],
    queryFn: () => listFn({ data: queryInput }),
  });

  const rows = data ?? [];

  async function exportCsv() {
    if (exporting) return;
    if (!canExport) {
      setExportError(`Access denied. Audit log export requires one of: ${allowedRoles.join(", ")}.`);
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      // Server re-checks the role and enforces the row cap.
      const { rows: serverRows, matched, limit } = await exportFn({ data: queryInput });

      if (serverRows.length === 0) {
        setExportError("No audit events match the current filters.");
        return;
      }

      const header = [
        "created_at", "action", "resource_type", "record_count",
        "resource_count", "filename", "owner_names", "user_id", "id",
      ];
      const csvRows: string[][] = [header];
      for (const r of serverRows) {
        const md = (r.metadata ?? {}) as Record<string, unknown>;
        const filename = typeof md.filename === "string" ? md.filename : "";
        const ownerNames = Array.isArray(md.owner_names) ? (md.owner_names as string[]).join("; ") : "";
        csvRows.push([
          new Date(r.created_at).toISOString(),
          r.action,
          r.resource_type,
          String(r.record_count),
          String((r.resource_ids ?? []).length),
          filename,
          ownerNames,
          r.user_id,
          r.id,
        ]);
      }

      const csv = csvRows
        .map((row) => row.map((v) => {
          const s = String(v ?? "");
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(","))
        .join("\r\n");

      const stamp = new Date().toISOString().slice(0, 10);
      const parts = [`audit-log-${stamp}`];
      if (filter !== "all") parts.push(filter.replace(/\./g, "-"));
      if (from) parts.push(`from-${from}`);
      if (to) parts.push(`to-${to}`);
      const filename = `${parts.join("_")}.csv`;

      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      try {
        await logFn({
          data: {
            action: "export.csv",
            resource_type: "audit_logs",
            resource_ids: [],
            record_count: serverRows.length,
            metadata: {
              filename,
              matched_total: matched,
              row_limit: limit,
              filters: { action: filter, from: from || null, to: to || null },
            },
          },
        });
        qc.invalidateQueries({ queryKey: ["audit-logs"] });
      } catch (e) {
        console.warn("audit log failed", e);
      }
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h-display text-[clamp(28px,4vw,44px)]">Audit log</h1>
          <p className="text-[var(--w55)] text-sm mt-1">
            Every export, skip trace, and outreach send — who, what, when, and how many records.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={exportCsv}
            disabled={exporting || rows.length === 0 || !canExport}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50 ${
              canExport
                ? "bg-cyan text-black hover:bg-cyan/90 disabled:bg-cyan/40"
                : "border border-border text-[var(--w55)] cursor-not-allowed"
            }`}
            title={
              canExport
                ? "Download the current filtered audit log as CSV"
                : `Access denied. Requires role: ${allowedRoles.join(", ")}`
            }
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : canExport ? (
              <Download className="h-3.5 w-3.5" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            {canExport ? `Export CSV (${rows.length})` : "Export restricted"}
          </button>
          {canExport && perms?.exportRowLimit && (
            <p className="text-[10px] text-[var(--w55)]">
              Max {perms.exportRowLimit.toLocaleString()} rows per export
            </p>
          )}
          {!canExport && perms && (
            <p className="text-[10px] text-[var(--w55)]">
              Admin role required to download
            </p>
          )}
          {exportError && (
            <p className="text-[10px] text-red-400 max-w-[320px] text-right">{exportError}</p>
          )}
        </div>
      </header>

      {!canExport && perms && (
        <div className="flex items-start gap-3 rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-xs">
          <Lock className="h-4 w-4 text-amber-300 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-amber-200">Audit log export is restricted</p>
            <p className="text-amber-200/70 mt-0.5">
              You can view audit events, but CSV download requires one of these roles: <span className="font-mono">{allowedRoles.join(", ")}</span>. Ask a workspace admin if you need access.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2 flex-wrap">
          {[
            { k: "all", label: "All actions" },
            { k: "export.csv", label: "Exports" },
            { k: "outreach.send", label: "Outreach" },
          ].map((opt) => (
            <button
              key={opt.k}
              onClick={() => setFilter(opt.k)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                filter === opt.k ? "bg-cyan/15 text-cyan border-cyan/40" : "border-border text-[var(--w55)] hover:bg-white/5"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--w55)]">From</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1.5 bg-[rgba(255,255,255,.04)] border border-border rounded text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--w55)]">To</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1.5 bg-[rgba(255,255,255,.04)] border border-border rounded text-xs"
            />
          </label>
          {(from || to) && (
            <button
              onClick={() => { setFrom(""); setTo(""); }}
              className="text-[11px] text-[var(--w55)] hover:text-white px-2 py-1.5"
            >
              Clear dates
            </button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-[var(--w55)] text-sm">Loading…</p>}

      {!isLoading && rows.length === 0 && (
        <div className="border border-border rounded-lg p-10 text-center">
          <ScrollText className="mx-auto h-8 w-8 text-[var(--w55)]" />
          <p className="mt-3 text-sm text-[var(--w55)]">No audit events match the current filters.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--w55)] text-xs uppercase tracking-widest">
              <tr>
                <th className="p-4">When</th>
                <th className="p-4">Action</th>
                <th className="p-4">Resource</th>
                <th className="p-4 text-right">Records</th>
                <th className="p-4">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = ACTION_META[r.action] ?? { label: r.action, icon: FileText, color: "text-white" };
                const Icon = meta.icon;
                const md = (r.metadata ?? {}) as Record<string, unknown>;
                const filename = typeof md.filename === "string" ? md.filename : null;
                const ownerNames = Array.isArray(md.owner_names) ? (md.owner_names as string[]) : [];
                const resourceCount = (r.resource_ids ?? []).length;
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="p-4 text-[var(--w55)] whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1.5 ${meta.color}`}>
                        <Icon className="h-3.5 w-3.5" />
                        <span className="font-medium">{meta.label}</span>
                      </span>
                    </td>
                    <td className="p-4">
                      <div>{r.resource_type}</div>
                      {resourceCount > 0 && (
                        <div className="text-[10px] text-[var(--w55)] mt-0.5">{resourceCount} owner{resourceCount === 1 ? "" : "s"}</div>
                      )}
                    </td>
                    <td className="p-4 text-right tabular-nums">
                      <span className="text-cyan font-medium">{r.record_count}</span>
                    </td>
                    <td className="p-4 text-[var(--w55)] text-xs">
                      {filename && <div className="font-mono">{filename}</div>}
                      {ownerNames.length > 0 && (
                        <div className="truncate max-w-[420px]">
                          {ownerNames.slice(0, 3).join(", ")}
                          {ownerNames.length > 3 && ` +${ownerNames.length - 3} more`}
                        </div>
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
