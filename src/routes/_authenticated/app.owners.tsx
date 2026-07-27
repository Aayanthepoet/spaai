import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listOwners, listOwnerContacts } from "@/lib/owners/owners.functions";
import { logAuditEvent } from "@/lib/audit/audit.functions";
import { ChevronDown, ChevronRight, Phone, Mail, Users, Loader2, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/owners")({
  head: () => ({ meta: [{ title: "School Staff — PropAI" }] }),
  component: OwnersPage,
  errorComponent: ({ error }) => <div className="p-6 text-red-400">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

type Owner = {
  id: string;
  full_name: string;
  entity_type: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  contact_count: number;
  properties: { address: string } | { address: string }[] | null;
};

function OwnersPage() {
  const fetchOwners = useServerFn(listOwners);
  const qc = useQueryClient();
  const fetchContacts = useServerFn(listOwnerContacts);

  const { data: owners, isLoading } = useQuery({
    queryKey: ["owners"],
    queryFn: () => fetchOwners(),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const ownerList = owners ?? [];
  const allSelected = ownerList.length > 0 && ownerList.every((o) => selected.has(o.id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => (prev.size === ownerList.length ? new Set() : new Set(ownerList.map((o) => o.id))));

  async function exportContacts(ids: string[]) {
    if (exporting || ids.length === 0) return;
    setExporting(true);
    try {
      const ownerById = new Map(ownerList.map((o) => [o.id, o]));
      const results = await Promise.all(
        ids.map(async (id) => ({
          id,
          rows: await fetchContacts({ data: { owner_id: id } }),
        })),
      );

      const csvRows: string[][] = [[
        "owner_id", "owner_name", "entity_type",
        "contact_type", "value", "confidence", "is_verified", "notes",
      ]];
      let count = 0;
      for (const { id, rows } of results) {
        const o = ownerById.get(id);
        if (!o) continue;
        for (const c of rows) {
          if (c.contact_type !== "phone" && c.contact_type !== "email") continue;
          if (c.do_not_contact) continue;
          csvRows.push([
            o.id,
            o.full_name,
            o.entity_type ?? "",
            c.contact_type,
            c.value,
            c.confidence != null ? String(c.confidence) : "",
            c.is_verified ? "true" : "false",
            c.notes ?? "",
          ]);
          count++;
        }
      }

      if (count === 0) {
        alert("No verified phone/email contacts to export for the selected owners.");
        return;
      }

      const csv = csvRows
        .map((row) => row.map((v) => {
          const s = String(v ?? "");
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(","))
        .join("\r\n");

      const filename = `owner-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Audit the export. Failure here must not block the download.
      try {
        await logAuditEvent({
          data: {
            action: "export.csv",
            resource_type: "owner_contacts",
            resource_ids: ids,
            record_count: count,
            metadata: {
              filename,
              owner_count: ids.length,
              owner_names: ids
                .map((id) => ownerById.get(id)?.full_name)
                .filter(Boolean)
                .slice(0, 25),
            },
          },
        });
        qc.invalidateQueries({ queryKey: ["audit-logs"] });
      } catch (e) {
        console.warn("audit log failed", e);
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h-display text-[clamp(28px,4vw,44px)]">School Staff</h1>
          <p className="text-[var(--w55)] text-sm mt-1">
            Principals, PTA leads, and wellness coordinators at your saved schools, and their known contacts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => exportContacts(Array.from(selected))}
            disabled={exporting || selected.size === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-white/5 disabled:opacity-50"
            title="Download verified phone & email contacts for the selected staff"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-cyan" />}
            Export CSV ({selected.size})
          </button>
        </div>
      </header>

      {isLoading && <p className="text-[var(--w55)] text-sm">Loading…</p>}

      {!isLoading && ownerList.length === 0 && (
        <div className="border border-border rounded-lg p-10 text-center">
          <Users className="mx-auto h-8 w-8 text-[var(--w55)]" />
          <p className="mt-3 text-sm text-[var(--w55)]">No staff yet. Save a school to seed this list.</p>
        </div>
      )}

      {ownerList.length > 0 && (
        <div className="surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--w55)] text-xs uppercase tracking-widest">
              <tr>
                <th className="p-4 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    aria-label="Select all staff"
                    className="accent-cyan"
                  />
                </th>
                <th className="p-4 w-8"></th>
                <th className="p-4">Staff</th>
                <th className="p-4">School</th>
                <th className="p-4">Mailing</th>
                <th className="p-4">Contacts</th>
              </tr>
            </thead>
            <tbody>
              {ownerList.map((o) => (
                <OwnerRow
                  key={o.id}
                  owner={o}
                  selected={selected.has(o.id)}
                  onToggle={() => toggleOne(o.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OwnerRow({
  owner,
  selected,
  onToggle,
}: {
  owner: Owner;
  selected: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fetchContacts = useServerFn(listOwnerContacts);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["owner-contacts", owner.id],
    queryFn: () => fetchContacts({ data: { owner_id: owner.id } }),
    enabled: open,
  });

  const prop = Array.isArray(owner.properties) ? owner.properties[0] : owner.properties;

  return (
    <>
      <tr className="border-t border-border hover:bg-[rgba(255,255,255,.02)]">
        <td className="p-4">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${owner.full_name}`}
            className="accent-cyan"
          />
        </td>
        <td className="p-4">
          <button onClick={() => setOpen((v) => !v)} className="text-[var(--w55)] hover:text-white">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="p-4">
          <div className="font-medium">{owner.full_name}</div>
          {owner.entity_type && <div className="text-[10px] uppercase tracking-wider text-[var(--w55)] mt-0.5">{owner.entity_type}</div>}
        </td>
        <td className="p-4 text-[var(--w55)]">{prop?.address ?? "—"}</td>
        <td className="p-4 text-[var(--w55)]">
          {[owner.mailing_city, owner.mailing_state, owner.mailing_zip].filter(Boolean).join(", ") || "—"}
        </td>
        <td className="p-4">
          <span className="text-cyan">{owner.contact_count}</span>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-[rgba(255,255,255,.02)]">
          <td colSpan={6} className="p-4">
            {isLoading && <p className="text-[var(--w55)] text-xs">Loading contacts…</p>}
            {!isLoading && contacts && contacts.length === 0 && (
              <p className="text-[var(--w55)] text-xs">No contacts yet.</p>
            )}
            {contacts && contacts.length > 0 && (
              <ul className="space-y-1.5">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 text-xs">
                    <ContactIcon type={c.contact_type} />
                    <span className="font-mono">{c.value}</span>
                    {typeof c.confidence === "number" && (
                      <span className="text-[var(--w55)]">conf {c.confidence}</span>
                    )}
                    {c.notes && <span className="text-[var(--w55)] truncate">{c.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ContactIcon({ type }: { type: string }) {
  if (type === "phone") return <Phone className="h-3.5 w-3.5 text-emerald-400" />;
  if (type === "email") return <Mail className="h-3.5 w-3.5 text-cyan" />;
  return <Users className="h-3.5 w-3.5 text-amber-400" />;
}
