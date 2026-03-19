"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { getUserActiveRfxCount } from "@/lib/firestore";
import { listReleasedTerritoriesFn, publishRfx } from "@/lib/functions";
import { checkMonetizationLimit } from "@/lib/monetization";
import {
  RFX_TEMPLATES,
  type EvaluationCriterion,
  type RequestedDocument,
  type RfxTemplate,
  type TerritoryDoc,
} from "@hi/shared";
import {
  Loader2,
  ChevronRight,
  ChevronLeft,
  Check,
  Plus,
  Trash2,
  FileText,
  ClipboardList,
  Eye,
  AlertCircle,
  GripVertical,
  Coins,
} from "lucide-react";

const STEPS = [
  { id: "template", label: "Template", icon: ClipboardList },
  { id: "customize", label: "Customize", icon: FileText },
  { id: "criteria", label: "Criteria & Docs", icon: GripVertical },
  { id: "review", label: "Review & Publish", icon: Eye },
] as const;

type FormData = {
  title: string;
  description: string;
  naicsCodes: string;
  location: string;
  territoryFips: string;
  geoLat: string;
  geoLng: string;
  dueDate: string;
  budget: string;
  memberOnly: boolean;
};

export default function CreateRfxPage() {
  return (
    <RequireAuth>
      <CreateRfxContent />
    </RequireAuth>
  );
}

function CreateRfxContent() {
  const router = useRouter();
  const { user, userDoc } = useAuth();
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<RfxTemplate | null>(null);
  const [activeRfxCount, setActiveRfxCount] = useState<number | null>(null);
  const [territories, setTerritories] = useState<TerritoryDoc[]>([]);
  const [showCreditConfirm, setShowCreditConfirm] = useState<{ cost: number; remainingLimit?: number } | null>(null);
  
  useEffect(() => {
    if (user) {
      getUserActiveRfxCount(user.uid).then(setActiveRfxCount).catch(console.error);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    listReleasedTerritoriesFn({})
      .then((res) => {
        const released = res.data.released || [];
        const scheduled = res.data.scheduled || [];
        const merged = [...released, ...scheduled].sort((a, b) => a.name.localeCompare(b.name));
        setTerritories(merged);
      })
      .catch((err) => {
        console.error("Failed to load territories:", err);
      });
  }, [user]);

  const [form, setForm] = useState<FormData>({
    title: "",
    description: "",
    naicsCodes: "",
    location: "",
    territoryFips: "",
    geoLat: "",
    geoLng: "",
    dueDate: "",
    budget: "",
    memberOnly: false,
  });
  const [criteria, setCriteria] = useState<EvaluationCriterion[]>([]);
  const [requestedDocs, setRequestedDocs] = useState<RequestedDocument[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback(
    <K extends keyof FormData>(field: K, value: FormData[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  // --- Template Selection ---
  const handleSelectTemplate = (template: RfxTemplate) => {
    setSelectedTemplate(template);
    setForm((prev) => ({
      ...prev,
      title: template.defaultTitle,
      description: template.defaultDescription,
      naicsCodes: template.suggestedNaics.join(", "),
    }));
    setCriteria(template.defaultCriteria.map((c) => ({ ...c })));
    setRequestedDocs(template.defaultDocuments.map((d) => ({ ...d })));
    setStep(1);
  };

  const handleCustomStart = () => {
    setSelectedTemplate(null);
    setCriteria([
      { id: "price", label: "Price", weight: 25, direction: "lower_is_better", description: "Proposed cost" },
      { id: "experience", label: "Experience / Past Performance", weight: 25, direction: "higher_is_better", description: "Years and depth of relevant experience" },
      { id: "skills", label: "Skills & Technical Approach", weight: 20, direction: "higher_is_better", description: "Relevant skills and methodology" },
      { id: "credentials", label: "Credentials / Certifications", weight: 15, direction: "higher_is_better", description: "Relevant certifications" },
      { id: "references", label: "References", weight: 15, direction: "higher_is_better", description: "Quality and relevance of references" },
    ]);
    setRequestedDocs([]);
    setStep(1);
  };

  // --- Criteria Management ---
  const updateCriterion = (index: number, updates: Partial<EvaluationCriterion>) => {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, ...updates } : c)));
  };

  const addCriterion = () => {
    setCriteria((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        label: "",
        weight: 0,
        direction: "higher_is_better" as const,
        description: "",
      },
    ]);
  };

  const removeCriterion = (index: number) => {
    setCriteria((prev) => prev.filter((_, i) => i !== index));
  };

  // --- Requested Documents Management ---
  const addRequestedDoc = () => {
    setRequestedDocs((prev) => [
      ...prev,
      { id: `doc-${Date.now()}`, label: "", required: false, description: "" },
    ]);
  };

  const updateRequestedDoc = (index: number, updates: Partial<RequestedDocument>) => {
    setRequestedDocs((prev) => prev.map((d, i) => (i === index ? { ...d, ...updates } : d)));
  };

  const removeRequestedDoc = (index: number) => {
    setRequestedDocs((prev) => prev.filter((_, i) => i !== index));
  };

  // --- Validation ---
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  const criteriaValid =
    criteria.length > 0 &&
    criteria.every((c) => c.label.trim() !== "") &&
    totalWeight === 100;

  const hasValidGeoInputs =
    form.territoryFips.trim() !== "" &&
    Number.isFinite(Number(form.geoLat)) &&
    Number.isFinite(Number(form.geoLng));

  const canAdvance = (s: number): boolean => {
    if (s === 1) return form.title.trim() !== "" && form.description.trim() !== "" && hasValidGeoInputs;
    if (s === 2) return criteriaValid;
    return true;
  };

  const handleTerritorySelect = (fips: string) => {
    const territory = territories.find((t) => t.fips === fips);
    setForm((prev) => ({
      ...prev,
      territoryFips: fips,
      location: territory ? `${territory.name}, ${territory.state}` : prev.location,
      geoLat: territory?.centroid ? String(territory.centroid.lat) : prev.geoLat,
      geoLng: territory?.centroid ? String(territory.centroid.lng) : prev.geoLng,
    }));
  };

  // --- Publish ---
  const handlePublishClick = async () => {
    if (!user || activeRfxCount === null) return;
    
    // Check monetization limits
    const check = checkMonetizationLimit(userDoc, "rfx_publish", { currentCount: activeRfxCount });
    
    if (!check.allowed) {
      setError(check.reason || "You have reached your limit for active RFx posts.");
      return;
    }
    
    if (check.usingCredits) {
      setShowCreditConfirm({ cost: check.cost });
    } else {
      // Free/Included
      await executePublish();
    }
  };

  const executePublish = async () => {
    if (!user) return;
    setPublishing(true);
    setError(null);
    setShowCreditConfirm(null);

    try {
      const naicsCodes = form.naicsCodes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Use Cloud Function for transactional publish + credit deduction
      const { data } = await publishRfx({
        title: form.title.trim(),
        description: form.description.trim(),
        naicsCodes: naicsCodes.length > 0 ? naicsCodes : undefined,
        location: form.location.trim() || undefined,
        territoryFips: form.territoryFips.trim(),
        geoLat: Number(form.geoLat),
        geoLng: Number(form.geoLng),
        dueDate: form.dueDate ? new Date(form.dueDate).getTime() : undefined,
        budget: form.budget.trim() || undefined,
        memberOnly: form.memberOnly,
        status: "open",
        createdBy: user.uid,
        createdByName: user.displayName || user.email?.split("@")[0] || "Unknown",
        template: selectedTemplate?.id,
        evaluationCriteria: criteria,
        requestedDocuments: requestedDocs.filter((d) => d.label.trim() !== ""),
        adminApprovalStatus: "approved",
      });

      router.push(`/rfx/detail?id=${data.id}`);
    } catch (err: unknown) {
      console.error("Failed to publish RFx:", err);
      // Extract cloud function error message if available
      const msg = (err as Error)?.message || "Failed to publish. Please try again.";
      setError(msg);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        {/* Credit Confirmation Modal */}
        {showCreditConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 mb-4 text-amber-600">
                <div className="p-2 bg-amber-100 rounded-full">
                  <Coins className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Confirm Credit Usage</h3>
              </div>
              
              <p className="text-slate-600 mb-6">
                You have reached your included limit for active RFx posts. 
                Publishing this RFx will use <strong>{showCreditConfirm.cost} credits</strong> from your balance.
              </p>
              
              <div className="bg-slate-50 rounded-xl p-4 mb-6 flex items-center justify-between">
                <span className="text-sm text-slate-500">Your Balance</span>
                <span className="text-sm font-bold text-slate-900">{userDoc?.credits || 0} Credits</span>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowCreditConfirm(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={executePublish}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-700 shadow-sm shadow-amber-200"
                >
                  Confirm & Pay
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <div key={s.id} className="flex items-center gap-2">
                {i > 0 && (
                  <div className={`h-px w-8 ${isDone ? "bg-emerald-400" : "bg-slate-200"}`} />
                )}
                <button
                  onClick={() => {
                    if (isDone) setStep(i);
                  }}
                  disabled={!isDone && !isActive}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-slate-900 text-white"
                      : isDone
                      ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Step 0: Template Selection */}
        {step === 0 && (
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">Create New RFx</h1>
            <p className="text-slate-500 mb-8">Choose a template to get started, or build from scratch.</p>

            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {RFX_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTemplate(t)}
                  className="text-left p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:shadow-md hover:-translate-y-0.5 transition-all group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {t.name}
                    </h3>
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 transition-colors mt-0.5" />
                  </div>
                  <p className="text-sm text-slate-500 mb-3">{t.description}</p>
                  <div className="flex flex-wrap gap-1">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 uppercase tracking-wide">
                      {t.category}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-600 uppercase tracking-wide">
                      {t.defaultCriteria.length} criteria
                    </span>
                    {t.defaultDocuments.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-600 uppercase tracking-wide">
                        {t.defaultDocuments.length} doc{t.defaultDocuments.length > 1 ? "s" : ""} requested
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={handleCustomStart}
              className="w-full p-4 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-all text-sm font-medium"
            >
              <Plus className="h-4 w-4 inline mr-1.5 -mt-0.5" />
              Start from Scratch (Custom RFx)
            </button>
          </div>
        )}

        {/* Step 1: Customize */}
        {step === 1 && (
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">Customize Your RFx</h1>
            <p className="text-slate-500 mb-8">Edit the details to match your specific requirements.</p>

            <div className="space-y-5">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                  placeholder="Request for Proposal — ..."
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Description *</label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  rows={5}
                  className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all resize-none"
                  placeholder="Describe your requirements in detail..."
                />
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">Budget Range</label>
                  <input
                    type="text"
                    value={form.budget}
                    onChange={(e) => updateField("budget", e.target.value)}
                    className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                    placeholder="e.g. $10k–$50k"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">Due Date</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => updateField("dueDate", e.target.value)}
                    className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">County / Territory *</label>
                  <select
                    value={form.territoryFips}
                    onChange={(e) => handleTerritorySelect(e.target.value)}
                    className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                  >
                    <option value="">Select territory</option>
                    {territories.map((territory) => (
                      <option key={territory.fips} value={territory.fips}>
                        {territory.name}, {territory.state} ({territory.fips})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">Display Location</label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={(e) => updateField("location", e.target.value)}
                    className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                    placeholder="e.g. Washington, DC"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">Latitude *</label>
                  <input
                    type="number"
                    step="any"
                    value={form.geoLat}
                    onChange={(e) => updateField("geoLat", e.target.value)}
                    className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                    placeholder="36.93"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">Longitude *</label>
                  <input
                    type="number"
                    step="any"
                    value={form.geoLng}
                    onChange={(e) => updateField("geoLng", e.target.value)}
                    className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                    placeholder="-76.52"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">NAICS Codes</label>
                  <input
                    type="text"
                    value={form.naicsCodes}
                    onChange={(e) => updateField("naicsCodes", e.target.value)}
                    className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                    placeholder="e.g. 541511, 541512"
                  />
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.memberOnly}
                  onChange={(e) => updateField("memberOnly", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span className="text-sm text-slate-700">Members only (hide from external vendors)</span>
              </label>
            </div>
          </div>
        )}

        {/* Step 2: Criteria & Documents */}
        {step === 2 && (
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">
              Evaluation Criteria & Documents
            </h1>
            <p className="text-slate-500 mb-8">
              Define how bids will be scored. Weights must total 100%.
            </p>

            {/* Criteria */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900">Evaluation Criteria</h2>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold px-2 py-1 rounded-full ${
                      totalWeight === 100
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {totalWeight}% / 100%
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {criteria.map((c, i) => (
                  <div
                    key={c.id}
                    className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 grid md:grid-cols-12 gap-3">
                        <div className="md:col-span-4">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                            Criterion Name *
                          </label>
                          <input
                            type="text"
                            value={c.label}
                            onChange={(e) => updateCriterion(i, { label: e.target.value })}
                            className="w-full rounded-lg px-3 py-2 text-sm border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                            placeholder="e.g. Technical Skills"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                            Weight %
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={c.weight}
                            onChange={(e) =>
                              updateCriterion(i, {
                                weight: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)),
                              })
                            }
                            className="w-full rounded-lg px-3 py-2 text-sm border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                            Scoring Direction
                          </label>
                          <select
                            value={c.direction}
                            onChange={(e) =>
                              updateCriterion(i, {
                                direction: e.target.value as "lower_is_better" | "higher_is_better",
                              })
                            }
                            className="w-full rounded-lg px-3 py-2 text-sm border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                          >
                            <option value="higher_is_better">Higher is better</option>
                            <option value="lower_is_better">Lower is better</option>
                          </select>
                        </div>
                        <div className="md:col-span-3">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                            Description
                          </label>
                          <input
                            type="text"
                            value={c.description || ""}
                            onChange={(e) => updateCriterion(i, { description: e.target.value })}
                            className="w-full rounded-lg px-3 py-2 text-sm border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                            placeholder="Guidance for vendors"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => removeCriterion(i)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors mt-5"
                        title="Remove criterion"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={addCriterion}
                className="mt-3 w-full p-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-all text-sm font-medium"
              >
                <Plus className="h-4 w-4 inline mr-1 -mt-0.5" />
                Add Custom Criterion
              </button>

              {totalWeight !== 100 && criteria.length > 0 && (
                <div className="mt-3 flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>Weights must total exactly 100%. Currently at {totalWeight}%.</span>
                </div>
              )}
            </div>

            {/* Requested Documents */}
            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-4">Requested Documents</h2>
              <p className="text-sm text-slate-500 mb-4">
                Specify documents vendors should upload with their response.
              </p>

              <div className="space-y-3">
                {requestedDocs.map((d, i) => (
                  <div
                    key={d.id}
                    className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 grid md:grid-cols-12 gap-3">
                        <div className="md:col-span-4">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                            Document Name *
                          </label>
                          <input
                            type="text"
                            value={d.label}
                            onChange={(e) => updateRequestedDoc(i, { label: e.target.value })}
                            className="w-full rounded-lg px-3 py-2 text-sm border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                            placeholder="e.g. Proof of Insurance"
                          />
                        </div>
                        <div className="md:col-span-5">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                            Instructions
                          </label>
                          <input
                            type="text"
                            value={d.description || ""}
                            onChange={(e) => updateRequestedDoc(i, { description: e.target.value })}
                            className="w-full rounded-lg px-3 py-2 text-sm border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                            placeholder="Describe what to upload"
                          />
                        </div>
                        <div className="md:col-span-3 flex items-end pb-1">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={d.required}
                              onChange={(e) => updateRequestedDoc(i, { required: e.target.checked })}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                            />
                            <span className="text-sm text-slate-600">Required</span>
                          </label>
                        </div>
                      </div>
                      <button
                        onClick={() => removeRequestedDoc(i)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors mt-5"
                        title="Remove document"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={addRequestedDoc}
                className="mt-3 w-full p-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-all text-sm font-medium"
              >
                <Plus className="h-4 w-4 inline mr-1 -mt-0.5" />
                Add Document Request
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Publish */}
        {step === 3 && (
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">Review & Publish</h1>
            <p className="text-slate-500 mb-8">Confirm your RFx details before publishing.</p>

            <div className="space-y-6">
              {/* Summary card */}
              <div className="p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xl font-bold text-slate-900 mb-1">{form.title}</h2>
                {selectedTemplate && (
                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 uppercase tracking-wide mb-3">
                    {selectedTemplate.name}
                  </span>
                )}
                <p className="text-sm text-slate-600 whitespace-pre-wrap mb-4">{form.description}</p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  {form.budget && (
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide font-semibold">Budget</div>
                      <div className="font-bold text-slate-900">{form.budget}</div>
                    </div>
                  )}
                  {form.dueDate && (
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide font-semibold">Due Date</div>
                      <div className="font-bold text-slate-900">
                        {new Date(form.dueDate).toLocaleDateString()}
                      </div>
                    </div>
                  )}
                  {form.location && (
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide font-semibold">Location</div>
                      <div className="font-bold text-slate-900">{form.location}</div>
                    </div>
                  )}
                  {form.territoryFips && (
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide font-semibold">Territory FIPS</div>
                      <div className="font-bold text-slate-900">{form.territoryFips}</div>
                    </div>
                  )}
                  {form.geoLat && form.geoLng && (
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide font-semibold">Coordinates</div>
                      <div className="font-bold text-slate-900">
                        {Number(form.geoLat).toFixed(5)}, {Number(form.geoLng).toFixed(5)}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-slate-400 text-xs uppercase tracking-wide font-semibold">Visibility</div>
                    <div className="font-bold text-slate-900">
                      {form.memberOnly ? "Members Only" : "Public"}
                    </div>
                  </div>
                </div>

                {form.naicsCodes && (
                  <div className="mt-4">
                    <div className="text-slate-400 text-xs uppercase tracking-wide font-semibold mb-1">NAICS Codes</div>
                    <div className="flex flex-wrap gap-1">
                      {form.naicsCodes.split(",").map((code) => (
                        <span
                          key={code.trim()}
                          className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600"
                        >
                          {code.trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Criteria summary */}
              <div className="p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <h3 className="font-bold text-slate-900 mb-3">Evaluation Criteria ({criteria.length})</h3>
                <div className="space-y-2">
                  {criteria.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700">{c.label}</span>
                        <span className="text-[10px] text-slate-400 uppercase">
                          ({c.direction === "lower_is_better" ? "lower wins" : "higher wins"})
                        </span>
                      </div>
                      <span className="font-bold text-slate-900">{c.weight}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Documents summary */}
              {requestedDocs.length > 0 && (
                <div className="p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                  <h3 className="font-bold text-slate-900 mb-3">
                    Requested Documents ({requestedDocs.filter((d) => d.label.trim()).length})
                  </h3>
                  <div className="space-y-2">
                    {requestedDocs
                      .filter((d) => d.label.trim())
                      .map((d) => (
                        <div key={d.id} className="flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{d.label}</span>
                          {d.required && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 uppercase tracking-wide">
                              Required
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        {step > 0 && (
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
            <button
              onClick={() => setStep((s) => s - 1)}
              className="rounded-full px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-all flex items-center gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>

            {step < 3 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canAdvance(step)}
                className="rounded-full px-6 py-2.5 text-sm font-medium bg-slate-900 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handlePublishClick}
                disabled={publishing}
                className="rounded-full px-6 py-2.5 text-sm font-medium bg-slate-900 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800 disabled:opacity-60 transition-all flex items-center gap-1.5"
              >
                {publishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Publishing…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Publish RFx
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
