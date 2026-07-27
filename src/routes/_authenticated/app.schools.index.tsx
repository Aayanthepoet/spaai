import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyModule } from "@/components/app/EmptyModule";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, MapPin, DollarSign, Home, X, SlidersHorizontal } from "lucide-react";
import { ImportLeadsDialog } from "@/components/schools/ImportLeadsDialog";

type DistressFilter = "all" | "preforeclosure" | "reo" | "auction" | "tax_lien" | "tax_delinquent" | "fsbo_stale" | "vacant" | "absentee";
type ScoreFilter = "all" | "hot" | "warm" | "cold";
type PriceFilter = "all" | "u250" | "250_500" | "500_1m" | "o1m";

const DISTRESS_CHIPS: { value: DistressFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "preforeclosure", label: "Pre-foreclosure" },
  { value: "reo", label: "REO" },
  { value: "auction", label: "Auction" },
  { value: "tax_lien", label: "Tax Lien" },
  { value: "vacant", label: "Vacant" },
  { value: "absentee", label: "Absentee" },
];
const SCORE_CHIPS: { value: ScoreFilter; label: string }[] = [
  { value: "all", label: "Any score" },
  { value: "hot", label: "Hot 80+" },
  { value: "warm", label: "Warm 50-79" },
  { value: "cold", label: "Cold <50" },
];
const PRICE_CHIPS: { value: PriceFilter; label: string }[] = [
  { value: "all", label: "Any price" },
  { value: "u250", label: "< $250k" },
  { value: "250_500", label: "$250k–500k" },
  { value: "500_1m", label: "$500k–1M" },
  { value: "o1m", label: "$1M+" },
];

export const Route = createFileRoute("/_authenticated/app/schools/")({
  head: () => ({ meta: [{ title: "Schools — PropAI" }] }),
  component: PropertiesPage,
});

function PropertiesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsLoading] = useState(false);

  // Form states
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [leadScore, setLeadScore] = useState("50");
  const [isPreforeclosure, setIsPreforeclosure] = useState(false);
  const [isVacant, setIsVacant] = useState(false);
  const [isAbsentee, setIsAbsentee] = useState(false);
  const [distressType, setDistressType] = useState<string>("none");

  // Filter state
  const [searchText, setSearchText] = useState("");
  const [locationText, setLocationText] = useState("");
  const [distressFilter, setDistressFilter] = useState<DistressFilter>("all");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");

  const { data: allData, isLoading } = useQuery({
    queryKey: ["properties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, address, city, state, zip, estimated_value, lead_score, distress_type, is_preforeclosure, is_vacant, is_absentee")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const data = (allData ?? []).filter((p) => {
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      const hay = `${p.address ?? ""} ${p.city ?? ""} ${p.state ?? ""} ${p.zip ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (locationText.trim()) {
      const q = locationText.toLowerCase();
      const hay = `${p.city ?? ""} ${p.state ?? ""} ${p.zip ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (distressFilter !== "all") {
      if (distressFilter === "vacant" && !p.is_vacant && p.distress_type !== "vacant") return false;
      if (distressFilter === "absentee" && !p.is_absentee && p.distress_type !== "absentee") return false;
      if (distressFilter === "preforeclosure" && !p.is_preforeclosure && p.distress_type !== "preforeclosure") return false;
      if (!["vacant","absentee","preforeclosure"].includes(distressFilter) && p.distress_type !== distressFilter) return false;
    }
    if (scoreFilter !== "all") {
      const s = p.lead_score ?? -1;
      if (scoreFilter === "hot" && s < 80) return false;
      if (scoreFilter === "warm" && (s < 50 || s >= 80)) return false;
      if (scoreFilter === "cold" && s >= 50) return false;
    }
    if (priceFilter !== "all") {
      const v = Number(p.estimated_value ?? 0);
      if (priceFilter === "u250" && !(v > 0 && v < 250000)) return false;
      if (priceFilter === "250_500" && !(v >= 250000 && v < 500000)) return false;
      if (priceFilter === "500_1m" && !(v >= 500000 && v < 1000000)) return false;
      if (priceFilter === "o1m" && v < 1000000) return false;
    }
    return true;
  });

  const activeFilterCount =
    (distressFilter !== "all" ? 1 : 0) +
    (scoreFilter !== "all" ? 1 : 0) +
    (priceFilter !== "all" ? 1 : 0) +
    (locationText.trim() ? 1 : 0);

  const clearFilters = () => {
    setSearchText("");
    setLocationText("");
    setDistressFilter("all");
    setScoreFilter("all");
    setPriceFilter("all");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) {
      toast.error("Address is required");
      return;
    }

    setIsLoading(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error("You must be authenticated to add properties.");
      }

      const { error } = await supabase.from("properties").insert({
        user_id: userData.user.id,
        address: address.trim(),
        city: city.trim() || null,
        state: state.trim().toUpperCase() || null,
        zip: zip.trim() || null,
        estimated_value: estimatedValue ? parseFloat(estimatedValue) : null,
        lead_score: leadScore ? parseInt(leadScore, 10) : null,
        is_preforeclosure: isPreforeclosure,
        is_vacant: isVacant,
        is_absentee: isAbsentee,
        distress_type: (distressType as any) || "none",
      });

      if (error) throw error;

      toast.success("Property record added successfully!");
      setIsOpen(false);
      
      // Reset form fields
      setAddress("");
      setCity("");
      setState("");
      setZip("");
      setEstimatedValue("");
      setLeadScore("50");
      setIsPreforeclosure(false);
      setIsVacant(false);
      setIsAbsentee(false);
      setDistressType("none");

      // Invalidate query to refresh table
      queryClient.invalidateQueries({ queryKey: ["properties"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to add property record");
    } finally {
      setIsLoading(false);
    }
  };

  const createDialog = (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Property
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] border-border bg-[var(--bg)] text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Home className="text-cyan w-5 h-5" /> Add Property Record
          </DialogTitle>
          <DialogDescription className="text-sm text-[var(--w55)]">
            Create a custom property profile to track value, distress status, and outreach.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-1">
            <Label htmlFor="address">Street Address *</Label>
            <Input
              id="address"
              placeholder="e.g. 123 Main St"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="bg-[var(--s1)] border-border text-white"
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1 col-span-1">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                placeholder="e.g. Albany"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="bg-[var(--s1)] border-border text-white"
              />
            </div>
            <div className="space-y-1 col-span-1">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                placeholder="e.g. NY"
                maxLength={2}
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="bg-[var(--s1)] border-border text-white"
              />
            </div>
            <div className="space-y-1 col-span-1">
              <Label htmlFor="zip">ZIP Code</Label>
              <Input
                id="zip"
                placeholder="e.g. 12203"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className="bg-[var(--s1)] border-border text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="value" className="flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-gold" /> Estimated Value
              </Label>
              <Input
                id="value"
                type="number"
                placeholder="e.g. 350000"
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                className="bg-[var(--s1)] border-border text-white"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="score">Lead Score (0-100)</Label>
              <Input
                id="score"
                type="number"
                min="0"
                max="100"
                value={leadScore}
                onChange={(e) => setLeadScore(e.target.value)}
                className="bg-[var(--s1)] border-border text-white"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="distress">Distress Type</Label>
            <Select value={distressType} onValueChange={setDistressType}>
              <SelectTrigger className="bg-[var(--s1)] border-border text-white">
                <SelectValue placeholder="Select distress status" />
              </SelectTrigger>
              <SelectContent className="bg-[var(--bg)] border-border text-white">
                <SelectItem value="none">None / Healthy</SelectItem>
                <SelectItem value="preforeclosure">Pre-foreclosure</SelectItem>
                <SelectItem value="reo">REO / Bank-Owned</SelectItem>
                <SelectItem value="auction">Scheduled Auction</SelectItem>
                <SelectItem value="tax_lien">Tax Lien</SelectItem>
                <SelectItem value="tax_delinquent">Tax Delinquent</SelectItem>
                <SelectItem value="fsbo_stale">Stale FSBO</SelectItem>
                <SelectItem value="vacant">Vacant</SelectItem>
                <SelectItem value="absentee">Absentee Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">Pre-foreclosure</Label>
                <p className="text-xs text-[var(--w35)]">Has an active Notice of Default (NOD)</p>
              </div>
              <Switch checked={isPreforeclosure} onCheckedChange={setIsPreforeclosure} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">Vacant Property</Label>
                <p className="text-xs text-[var(--w35)]">Registered as vacant or high utility signal</p>
              </div>
              <Switch checked={isVacant} onCheckedChange={setIsVacant} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">Absentee Owner</Label>
                <p className="text-xs text-[var(--w35)]">Owner address differs from property address</p>
              </div>
              <Switch checked={isAbsentee} onCheckedChange={setIsAbsentee} />
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsOpen(false)}
              className="hover:bg-[rgba(255,255,255,0.05)] text-white"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="btn-primary">
              {isSubmitting ? "Adding..." : "Add Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  if (isLoading) return <div className="text-[var(--w55)] p-8">Loading schools…</div>;

  if (!allData?.length) {
    return (
      <EmptyModule
        eyebrow="Schools"
        title={<>School <span className="h-italic">intelligence</span></>}
        description="Your school list with district, enrollment, and AI booking-likelihood scoring."
        cta={
          <div className="flex flex-wrap items-center justify-center gap-4">
            <ImportLeadsDialog />
            {createDialog}
          </div>
        }
      />
    );
  }

  const Chip = <T extends string>({
    active, onClick, children,
  }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition whitespace-nowrap ${
        active
          ? "bg-cyan/15 border-cyan/60 text-cyan"
          : "bg-white/5 border-border text-[var(--w65)] hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
        <div>
          <div className="eyebrow inline-flex">
            <span className="eyebrow-dot" /> Schools
          </div>
          <h1 className="h-display text-[clamp(28px,4vw,44px)] mt-2">Workspace</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ImportLeadsDialog />
          {createDialog}
        </div>
      </div>
      <div className="-mt-4 mb-4 text-xs text-[var(--w55)]">
        Importing your own list?{" "}
        <a href="/sample-leads.csv" download className="text-cyan underline">Download sample CSV template</a>
      </div>

      {/* Search + filters */}
      <div className="surface p-4 mb-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--w45)]" />
            <Input
              placeholder="Search address, city, ZIP…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-9 bg-[var(--s1)] border-border text-white"
            />
          </div>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--w45)]" />
            <Input
              placeholder="Filter by city, state, or ZIP"
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              className="pl-9 bg-[var(--s1)] border-border text-white"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[var(--w45)] uppercase tracking-widest mr-1">
            <SlidersHorizontal className="w-3 h-3" /> Distress
          </div>
          {DISTRESS_CHIPS.map((c) => (
            <Chip key={c.value} active={distressFilter === c.value} onClick={() => setDistressFilter(c.value)}>
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[var(--w45)] uppercase tracking-widest mr-1">
            <DollarSign className="w-3 h-3" /> Price
          </div>
          {PRICE_CHIPS.map((c) => (
            <Chip key={c.value} active={priceFilter === c.value} onClick={() => setPriceFilter(c.value)}>
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[var(--w45)] uppercase tracking-widest mr-1">
            Score
          </div>
          {SCORE_CHIPS.map((c) => (
            <Chip key={c.value} active={scoreFilter === c.value} onClick={() => setScoreFilter(c.value)}>
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="flex items-center justify-between pt-1 text-xs text-[var(--w55)]">
          <span>
            Showing <span className="text-white font-semibold">{data.length}</span> of {allData.length} schools
            {activeFilterCount > 0 && <span className="ml-2 text-cyan">· {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} active</span>}
          </span>
          {(activeFilterCount > 0 || searchText) && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-[var(--w65)] hover:text-white transition"
            >
              <X className="w-3 h-3" /> Clear all
            </button>
          )}
        </div>
      </div>

      <div className="surface overflow-hidden">
        {data.length === 0 ? (
          <div className="p-12 text-center text-[var(--w55)]">
            <Home className="w-8 h-8 mx-auto mb-3 text-[var(--w35)]" />
            <p className="text-sm">No schools match your filters.</p>
            <button onClick={clearFilters} className="mt-3 text-cyan text-xs hover:underline">
              Clear all filters
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--w55)] text-xs uppercase tracking-widest bg-[rgba(0,0,0,0.1)]">
              <tr>
                <th className="p-4">Address</th>
                <th className="p-4">Location</th>
                <th className="p-4">Distress</th>
                <th className="p-4">Value</th>
                <th className="p-4">Score</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate({ to: "/app/schools/$schoolId", params: { schoolId: p.id } })}
                  className="border-t border-border hover:bg-[rgba(255,255,255,.02)] transition-colors cursor-pointer"
                >
                  <td className="p-4">
                    <Link
                      to="/app/schools/$schoolId"
                      params={{ schoolId: p.id }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-cyan hover:underline font-medium"
                    >
                      {p.address}
                    </Link>
                  </td>
                  <td className="p-4 text-[var(--w65)]">
                    {p.city ? `${p.city}, ${p.state || ""} ${p.zip || ""}` : "—"}
                  </td>
                  <td className="p-4">
                    {p.distress_type && p.distress_type !== "none" ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {String(p.distress_type).replace(/_/g, " ")}
                      </span>
                    ) : <span className="text-[var(--w35)]">—</span>}
                  </td>
                  <td className="p-4">
                    {p.estimated_value ? `$${Number(p.estimated_value).toLocaleString()}` : "—"}
                  </td>
                  <td className="p-4">
                    {p.lead_score !== null ? (
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold font-mono ${
                        p.lead_score >= 80 ? "text-cyan bg-cyan-d/20" : p.lead_score >= 50 ? "text-gold bg-gold/10" : "text-[var(--w45)] bg-white/5"
                      }`}>
                        {p.lead_score}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}