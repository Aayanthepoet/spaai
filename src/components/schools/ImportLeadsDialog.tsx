import { useState, useMemo, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileText, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { parseCsv } from "@/lib/csv/parse";
import { TARGET_FIELDS, autoDetectMapping, type TargetField } from "@/lib/csv/mapping";
import { importLeadsCsv } from "@/lib/csv/import-csv.functions";

type Step = "upload" | "map" | "result";

const NONE = "__none__";

export function ImportLeadsDialog() {
  const queryClient = useQueryClient();
  const importFn = useServerFn(importLeadsCsv);
  const fileInput = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<TargetField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof importLeadsCsv>> | null>(null);

  const reset = () => {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setResult(null);
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const onFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("CSV must be under 5 MB");
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.rows.length === 0) {
      toast.error("CSV has no data rows");
      return;
    }
    if (parsed.rows.length > 5000) {
      toast.error(`CSV has ${parsed.rows.length} rows; max 5,000 per upload`);
      return;
    }
    setFileName(file.name);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(autoDetectMapping(parsed.headers));
    setStep("map");
  };

  const previewRows = useMemo(() => rows.slice(0, 5), [rows]);

  const canImport = useMemo(() => {
    if (!mapping.address) return false;
    if (!mapping.zip && !(mapping.city && mapping.state)) return false;
    return true;
  }, [mapping]);

  const runImport = async () => {
    setBusy(true);
    try {
      const cleanMap = Object.fromEntries(
        Object.entries(mapping).filter(([, v]) => !!v),
      ) as Record<TargetField, string>;
      const res = await importFn({ data: { rows, mapping: cleanMap } });
      setResult(res);
      setStep("result");
      if (res.imported + res.updated > 0) {
        toast.success(`Imported ${res.imported} new, updated ${res.updated}`);
        queryClient.invalidateQueries({ queryKey: ["properties"] });
      } else {
        toast.error("No rows were imported");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadErrorReport = () => {
    if (!result?.errors.length) return;
    const csv = ["row,reason", ...result.errors.map((e) => `${e.row},"${e.reason.replace(/"/g, '""')}"`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="border-border text-white hover:bg-[rgba(255,255,255,0.05)] flex items-center gap-2">
          <Upload className="w-4 h-4 text-cyan" /> Import Leads (CSV)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-hidden flex flex-col border-border bg-[var(--bg)] text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <FileText className="text-cyan w-5 h-5" /> Import leads from CSV
          </DialogTitle>
          <DialogDescription className="text-sm text-[var(--w55)]">
            Upload your foreclosure / REO / distress list. Same list re-uploaded updates instead of duplicating.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
          {step === "upload" && (
            <div className="py-6 space-y-4">
              <label
                className="block border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:bg-white/5"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) void onFile(f);
                }}
              >
                <Upload className="w-8 h-8 text-cyan mx-auto mb-3" />
                <div className="font-semibold">Drop a .csv file here, or click to choose</div>
                <div className="text-xs text-[var(--w45)] mt-1">Max 5 MB · 5,000 rows</div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                  }}
                />
              </label>
              <p className="text-xs text-[var(--w55)]">
                Not sure what format?{" "}
                <a href="/sample-leads.csv" download className="text-cyan underline">Download sample CSV template</a>
              </p>
            </div>
          )}

          {step === "map" && (
            <div className="py-2 space-y-4">
              <div className="text-sm text-[var(--w65)]">
                <span className="text-white font-medium">{fileName}</span> · {rows.length} rows · {headers.length} columns
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {TARGET_FIELDS.map((field) => (
                  <div key={field.value} className="space-y-1">
                    <Label className="text-xs">
                      {field.label}{field.required && <span className="text-red-400"> *</span>}
                    </Label>
                    <Select
                      value={mapping[field.value] ?? NONE}
                      onValueChange={(v) =>
                        setMapping((m) => ({ ...m, [field.value]: v === NONE ? undefined : v }))
                      }
                    >
                      <SelectTrigger className="bg-[var(--s1)] border-border text-white h-9">
                        <SelectValue placeholder="— skip —" />
                      </SelectTrigger>
                      <SelectContent className="bg-[var(--bg)] border-border text-white max-h-64">
                        <SelectItem value={NONE}>— skip —</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {!canImport && (
                <div className="text-xs text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Map at minimum: Address, and (ZIP) or (City + State).
                </div>
              )}

              <div>
                <div className="text-xs uppercase tracking-widest text-[var(--w45)] mb-2">Preview (first 5)</div>
                <div className="overflow-x-auto border border-border rounded">
                  <table className="text-xs w-full">
                    <thead className="bg-white/5">
                      <tr>
                        {headers.map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i} className="border-t border-border">
                          {headers.map((h) => (
                            <td key={h} className="px-2 py-1.5 whitespace-nowrap text-[var(--w65)]">
                              {r[h] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === "result" && result && (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-5 h-5" />
                <div className="font-semibold">Import complete</div>
              </div>
              <div className="grid grid-cols-4 gap-3 text-center">
                <Stat label="Total" value={result.total} />
                <Stat label="Imported" value={result.imported} tone="ok" />
                <Stat label="Updated" value={result.updated} tone="ok" />
                <Stat label="Skipped" value={result.skipped} tone={result.skipped ? "warn" : undefined} />
              </div>

              {result.errors.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase tracking-widest text-[var(--w45)]">
                      Errors ({result.errors.length})
                    </div>
                    <Button size="sm" variant="ghost" onClick={downloadErrorReport} className="text-cyan">
                      <Download className="w-3.5 h-3.5 mr-1" /> Download error report
                    </Button>
                  </div>
                  <div className="border border-border rounded max-h-60 overflow-y-auto">
                    <table className="text-xs w-full">
                      <thead className="bg-white/5 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left w-16">Row</th>
                          <th className="px-2 py-1.5 text-left">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.errors.map((e, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1.5 text-[var(--w65)]">{e.row}</td>
                            <td className="px-2 py-1.5 text-[var(--w65)]">{e.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t border-border">
          {step === "upload" && (
            <Button variant="ghost" onClick={() => setOpen(false)} className="text-white">Cancel</Button>
          )}
          {step === "map" && (
            <>
              <Button variant="ghost" onClick={reset} className="text-white">Back</Button>
              <Button className="btn-primary" disabled={!canImport || busy} onClick={runImport}>
                {busy ? "Importing…" : `Import ${rows.length} rows`}
              </Button>
            </>
          )}
          {step === "result" && (
            <>
              <Button variant="ghost" onClick={reset} className="text-white">Import another</Button>
              <Button className="btn-primary" onClick={() => setOpen(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color =
    tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-white";
  return (
    <div className="surface p-3">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-[var(--w45)] mt-1">{label}</div>
    </div>
  );
}
