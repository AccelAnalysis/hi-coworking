"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import {
  getRfxFromFirestore,
  getProfileFromFirestore,
  createRfxResponseInFirestore,
} from "@/lib/firestore";
import { storage } from "@/lib/firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import type { RfxDoc, ProfileDoc, RequestedDocument, UploadedDocument } from "@hi/shared";
import {
  Loader2,
  ArrowLeft,
  MapPin,
  Calendar,
  Users,
  FileText,
  Shield,
  Upload,
  Check,
  AlertCircle,
  X,
  ExternalLink,
  DollarSign,
  Clock,
  Award,
  Briefcase,
} from "lucide-react";

export default function RfxDetailPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<AppShell><div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div></AppShell>}>
        <RfxDetailContent />
      </Suspense>
    </RequireAuth>
  );
}

function RfxDetailContent() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const rfxId = searchParams.get("id") ?? "";

  const [rfx, setRfx] = useState<RfxDoc | null>(null);
  const [profile, setProfile] = useState<ProfileDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResponseForm, setShowResponseForm] = useState(false);

  useEffect(() => {
    if (!rfxId || !user) return;
    let cancelled = false;

    async function fetchData() {
      try {
        const [rfxData, profileData] = await Promise.all([
          getRfxFromFirestore(rfxId),
          getProfileFromFirestore(user!.uid),
        ]);
        if (!cancelled) {
          setRfx(rfxData);
          setProfile(profileData);
        }
      } catch (err) {
        console.error("Failed to load RFx:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [rfxId, user]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (!rfx) {
    return (
      <AppShell>
        <div className="text-center py-20">
          <h2 className="text-xl font-bold text-slate-900 mb-2">RFx Not Found</h2>
          <p className="text-slate-500 mb-4">This opportunity may have been removed or is no longer available.</p>
          <Link href="/rfx" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            ← Back to RFx Marketplace
          </Link>
        </div>
      </AppShell>
    );
  }

  const isOwner = rfx.createdBy === user?.uid;
  const isPastDue = rfx.dueDate ? rfx.dueDate < Date.now() : false;
  const canSubmit = rfx.status === "open" && !isOwner && !isPastDue;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto">
        <Link
          href="/rfx"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to RFx Marketplace
        </Link>

        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 mb-3">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{rfx.title}</h1>
            <span
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                rfx.status === "open"
                  ? "bg-emerald-50 text-emerald-600"
                  : rfx.status === "awarded"
                  ? "bg-indigo-50 text-indigo-600"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {rfx.status}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
            {rfx.createdByName && (
              <span className="flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Posted by {rfx.createdByName}
              </span>
            )}
            {rfx.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {rfx.location}
              </span>
            )}
            {rfx.dueDate && (
              <span className={`flex items-center gap-1.5 ${isPastDue ? "text-red-500 font-medium" : ""}`}>
                <Calendar className="h-4 w-4" />
                {isPastDue ? "Closed" : "Due"} {new Date(rfx.dueDate).toLocaleDateString()}
              </span>
            )}
            {rfx.budget && (
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <DollarSign className="h-4 w-4" />
                {rfx.budget}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              {rfx.responseCount} response{rfx.responseCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <h2 className="font-bold text-slate-900 mb-3">Description</h2>
              <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{rfx.description}</p>
            </div>

            {rfx.evaluationCriteria.length > 0 && (
              <div className="p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <h2 className="font-bold text-slate-900 mb-4">Evaluation Criteria</h2>
                <div className="space-y-3">
                  {rfx.evaluationCriteria.map((c) => (
                    <div key={c.id} className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-slate-700">{c.label}</span>
                          <span className="text-sm font-bold text-slate-900">{c.weight}%</span>
                        </div>
                        {c.description && (
                          <p className="text-xs text-slate-400">{c.description}</p>
                        )}
                        <div className="h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                          <div
                            className="h-full bg-slate-300 rounded-full"
                            style={{ width: `${c.weight}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rfx.requestedDocuments.length > 0 && (
              <div className="p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <h2 className="font-bold text-slate-900 mb-3">Requested Documents</h2>
                <div className="space-y-2">
                  {rfx.requestedDocuments.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-sm p-3 rounded-lg bg-slate-50">
                      <div>
                        <span className="font-medium text-slate-700">{d.label}</span>
                        {d.description && (
                          <p className="text-xs text-slate-400 mt-0.5">{d.description}</p>
                        )}
                      </div>
                      {d.required && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 uppercase tracking-wide shrink-0">
                          Required
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rfx.naicsCodes && rfx.naicsCodes.length > 0 && (
              <div className="p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <h2 className="font-bold text-slate-900 mb-3">NAICS Codes</h2>
                <div className="flex flex-wrap gap-2">
                  {rfx.naicsCodes.map((code) => (
                    <span key={code} className="px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {canSubmit && !showResponseForm && (
              <div className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <h3 className="font-bold text-slate-900 mb-2">Interested?</h3>
                <p className="text-sm text-slate-500 mb-4">
                  Submit your bid and supporting documents to respond to this opportunity.
                </p>
                <button
                  onClick={() => setShowResponseForm(true)}
                  className="w-full rounded-full px-5 py-2.5 bg-slate-900 text-white text-sm font-medium shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all"
                >
                  Submit Response
                </button>
              </div>
            )}

            {isOwner && (
              <Link
                href={`/rfx/evaluate?id=${rfx.id}`}
                className="block p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:shadow-md transition-all group"
              >
                <h3 className="font-bold text-slate-900 mb-1 group-hover:text-indigo-600 transition-colors">
                  Evaluate Responses
                </h3>
                <p className="text-sm text-slate-500 mb-2">
                  {rfx.responseCount} response{rfx.responseCount !== 1 ? "s" : ""} received
                </p>
                <span className="text-sm font-medium text-indigo-600 flex items-center gap-1">
                  Open evaluation <ExternalLink className="h-3.5 w-3.5" />
                </span>
              </Link>
            )}

            {isPastDue && !isOwner && (
              <div className="p-5 rounded-xl bg-red-50 ring-1 ring-red-200">
                <h3 className="font-bold text-red-700 mb-1">Submissions Closed</h3>
                <p className="text-sm text-red-600">
                  The due date for this RFx has passed.
                </p>
              </div>
            )}

            <div className="p-5 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-sm text-slate-500 space-y-2">
              <div className="flex justify-between">
                <span>Posted</span>
                <span className="font-medium text-slate-700">
                  {new Date(rfx.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Responses</span>
                <span className="font-medium text-slate-700">{rfx.responseCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Criteria</span>
                <span className="font-medium text-slate-700">{rfx.evaluationCriteria.length}</span>
              </div>
              {rfx.template && (
                <div className="flex justify-between">
                  <span>Template</span>
                  <span className="font-medium text-slate-700 capitalize">
                    {rfx.template.replace(/-/g, " ")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {showResponseForm && rfx && user && (
          <div className="mt-8">
            <ResponseForm
              rfx={rfx}
              profile={profile}
              userId={user.uid}
              userName={user.displayName || user.email?.split("@")[0] || "Unknown"}
              onClose={() => setShowResponseForm(false)}
              onSuccess={() => {
                setShowResponseForm(false);
                setRfx((prev) => prev ? { ...prev, responseCount: prev.responseCount + 1 } : prev);
              }}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}

// --- Response Form ---

interface ResponseFormProps {
  rfx: RfxDoc;
  profile: ProfileDoc | null;
  userId: string;
  userName: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ResponseForm({ rfx, profile, userId, userName, onClose, onSuccess }: ResponseFormProps) {
  const [bidAmount, setBidAmount] = useState("");
  const [experience, setExperience] = useState("");
  const [timeline, setTimeline] = useState("");
  const [skills, setSkills] = useState("");
  const [pastPerformance, setPastPerformance] = useState("");
  const [credentials, setCredentials] = useState<string[]>(profile?.certifications || []);
  const [references, setReferences] = useState("");
  const [proposalText, setProposalText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [proposalUrl, setProposalUrl] = useState<string | null>(null);
  const [proposalFileName, setProposalFileName] = useState<string | null>(null);
  const [uploadingProposal, setUploadingProposal] = useState(false);
  const proposalFileRef = useRef<HTMLInputElement>(null);

  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocument[]>([]);
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  const docFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleProposalUpload = useCallback(
    async (file: File) => {
      setUploadingProposal(true);
      setError(null);
      try {
        const storageRef = ref(storage, `rfxProposals/${rfx.id}/${userId}/${file.name}`);
        const task = uploadBytesResumable(storageRef, file);
        await new Promise<void>((resolve, reject) => {
          task.on("state_changed", null, reject, async () => {
            const url = await getDownloadURL(task.snapshot.ref);
            setProposalUrl(url);
            setProposalFileName(file.name);
            resolve();
          });
        });
      } catch (err) {
        console.error("Upload error:", err);
        setError("Failed to upload proposal file.");
      } finally {
        setUploadingProposal(false);
      }
    },
    [rfx.id, userId]
  );

  const handleDocUpload = useCallback(
    async (file: File, reqDoc: RequestedDocument) => {
      setUploadingDocId(reqDoc.id);
      setError(null);
      try {
        const storageRef = ref(storage, `rfxDocuments/${rfx.id}/${userId}/${reqDoc.id}/${file.name}`);
        const task = uploadBytesResumable(storageRef, file);
        await new Promise<void>((resolve, reject) => {
          task.on("state_changed", null, reject, async () => {
            const url = await getDownloadURL(task.snapshot.ref);
            setUploadedDocs((prev) => {
              const filtered = prev.filter((d) => d.requestedDocId !== reqDoc.id);
              return [
                ...filtered,
                { requestedDocId: reqDoc.id, label: reqDoc.label, url, fileName: file.name },
              ];
            });
            resolve();
          });
        });
      } catch (err) {
        console.error("Upload error:", err);
        setError(`Failed to upload ${reqDoc.label}.`);
      } finally {
        setUploadingDocId(null);
      }
    },
    [rfx.id, userId]
  );

  const handleSubmit = async () => {
    setError(null);

    const missingRequired = rfx.requestedDocuments.filter(
      (d) => d.required && !uploadedDocs.find((u) => u.requestedDocId === d.id)
    );
    if (missingRequired.length > 0) {
      setError(`Missing required document(s): ${missingRequired.map((d) => d.label).join(", ")}`);
      return;
    }

    setSubmitting(true);
    try {
      await createRfxResponseInFirestore({
        rfxId: rfx.id,
        rfxOwnerUid: rfx.createdBy,
        respondentUid: userId,
        respondentName: userName,
        respondentBusinessName: profile?.businessName || undefined,
        bidAmount: bidAmount ? parseFloat(bidAmount) : undefined,
        experience: experience ? parseFloat(experience) : undefined,
        timeline: timeline ? parseFloat(timeline) : undefined,
        skills: skills || undefined,
        pastPerformance: pastPerformance || undefined,
        credentials: credentials.length > 0 ? credentials : undefined,
        references: references || undefined,
        proposalText: proposalText || undefined,
        proposalUrl: proposalUrl || undefined,
        uploadedDocuments: uploadedDocs,
      });
      onSuccess();
    } catch (err) {
      console.error("Failed to submit response:", err);
      setError("Failed to submit your response. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-900">Submit Your Response</h2>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      {profile?.businessName && (
        <div className="mb-6 p-3 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 flex items-center gap-2 text-sm text-emerald-700">
          <Shield className="h-4 w-4 shrink-0" />
          Responding as <span className="font-bold">{profile.businessName}</span>
          {profile.certifications && profile.certifications.length > 0 && (
            <span className="text-emerald-500">
              ({profile.certifications.join(", ")})
            </span>
          )}
        </div>
      )}

      <div className="space-y-5">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              <DollarSign className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />
              Bid Amount ($)
            </label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              className="w-full rounded-lg px-4 py-2.5 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              <Briefcase className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />
              Experience (years)
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              className="w-full rounded-lg px-4 py-2.5 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm"
              placeholder="0"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              <Clock className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />
              Timeline (weeks)
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={timeline}
              onChange={(e) => setTimeline(e.target.value)}
              className="w-full rounded-lg px-4 py-2.5 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm"
              placeholder="0"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">
            Skills & Technical Approach
          </label>
          <textarea
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            rows={3}
            className="w-full rounded-lg px-4 py-2.5 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm resize-none"
            placeholder="Describe your relevant skills and proposed technical approach…"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">
            Experience / Past Performance
          </label>
          <textarea
            value={pastPerformance}
            onChange={(e) => setPastPerformance(e.target.value)}
            rows={3}
            className="w-full rounded-lg px-4 py-2.5 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm resize-none"
            placeholder="Summarize relevant past performance and project history…"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">
            <Award className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />
            Credentials / Certifications
          </label>
          <input
            type="text"
            value={credentials.join(", ")}
            onChange={(e) =>
              setCredentials(
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
            className="w-full rounded-lg px-4 py-2.5 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm"
            placeholder="e.g. 8(a), WOSB, HUBZone"
          />
          <p className="text-xs text-slate-400 mt-1">Comma-separated. Auto-filled from your profile.</p>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">References</label>
          <textarea
            value={references}
            onChange={(e) => setReferences(e.target.value)}
            rows={3}
            className="w-full rounded-lg px-4 py-2.5 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm resize-none"
            placeholder="Provide contact information for relevant references…"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Proposal Summary</label>
          <textarea
            value={proposalText}
            onChange={(e) => setProposalText(e.target.value)}
            rows={4}
            className="w-full rounded-lg px-4 py-2.5 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm resize-none"
            placeholder="Describe your overall approach, qualifications, and value proposition…"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Proposal Document</label>
          <input
            ref={proposalFileRef}
            type="file"
            accept=".pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleProposalUpload(file);
            }}
          />
          {proposalFileName ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 ring-1 ring-emerald-200 text-sm">
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="font-medium text-emerald-700 truncate">{proposalFileName}</span>
              <button
                onClick={() => {
                  setProposalUrl(null);
                  setProposalFileName(null);
                }}
                className="ml-auto text-slate-400 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => proposalFileRef.current?.click()}
              disabled={uploadingProposal}
              className="w-full p-3 rounded-lg border-2 border-dashed border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-all text-sm font-medium flex items-center justify-center gap-2"
            >
              {uploadingProposal ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {uploadingProposal ? "Uploading…" : "Upload Proposal (PDF/Word)"}
            </button>
          )}
        </div>

        {rfx.requestedDocuments.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-3">Requested Documents</h3>
            <div className="space-y-3">
              {rfx.requestedDocuments.map((reqDoc) => {
                const uploaded = uploadedDocs.find((u) => u.requestedDocId === reqDoc.id);
                const isUploading = uploadingDocId === reqDoc.id;

                return (
                  <div key={reqDoc.id} className="p-3 rounded-lg bg-slate-50 ring-1 ring-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-sm font-medium text-slate-700">{reqDoc.label}</span>
                        {reqDoc.required && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-600 uppercase">
                            Required
                          </span>
                        )}
                      </div>
                    </div>
                    {reqDoc.description && (
                      <p className="text-xs text-slate-400 mb-2">{reqDoc.description}</p>
                    )}

                    <input
                      ref={(el) => { docFileRefs.current[reqDoc.id] = el; }}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleDocUpload(file, reqDoc);
                      }}
                    />

                    {uploaded ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span className="font-medium text-emerald-700 truncate">{uploaded.fileName}</span>
                        <button
                          onClick={() =>
                            setUploadedDocs((prev) => prev.filter((d) => d.requestedDocId !== reqDoc.id))
                          }
                          className="ml-auto text-slate-400 hover:text-red-500"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => docFileRefs.current[reqDoc.id]?.click()}
                        disabled={isUploading}
                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                      >
                        {isUploading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        {isUploading ? "Uploading…" : "Upload file"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-full px-6 py-2.5 bg-slate-900 text-white text-sm font-medium shadow-lg shadow-slate-900/20 hover:bg-slate-800 disabled:opacity-60 transition-all flex items-center gap-1.5"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Submit Response
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="rounded-full px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
