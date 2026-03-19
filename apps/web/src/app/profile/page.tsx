"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import {
  getProfileFromFirestore,
  saveProfileToFirestore,
  computeProfileCompleteness,
} from "@/lib/firestore";
import {
  enrichmentLinkFn,
  enrichmentSearchFn,
  type EnrichmentCandidate,
  verificationSubmitFn,
} from "@/lib/functions";
import { ReadinessMeter } from "@/components/profile/ReadinessMeter";
import { storage } from "@/lib/firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import Image from "next/image";
import { computeReadinessTier, type ProfileDoc } from "@hi/shared";
import {
  Loader2,
  Check,
  ChevronRight,
  ChevronLeft,
  Building2,
  FileText,
  Shield,
  Upload,
  X,
  Globe,
  Linkedin,
  Award,
  AlertCircle,
  Camera,
  Users,
  Search,
  ShieldCheck,
  Video,
  Lock,
} from "lucide-react";

const STEPS = [
  { id: "business", label: "Business Info", icon: Building2 },
  { id: "procurement", label: "Procurement", icon: Shield },
  { id: "documents", label: "Documents", icon: FileText },
] as const;

const CERTIFICATION_OPTIONS = [
  "8(a)",
  "WOSB",
  "EDWOSB",
  "HUBZone",
  "SDVOSB",
  "VOSB",
  "MBE",
  "WBE",
  "DBE",
  "SDB",
  "LGBTBE",
];

type FormData = {
  businessName: string;
  bio: string;
  website: string;
  linkedin: string;
  naicsCodes: string;
  certifications: string[];
  uei: string;
  duns: string;
  cageCode: string;
};

type VerificationUploadType =
  | "business_license"
  | "ein_letter"
  | "utility_bill"
  | "government_id"
  | "other";

interface VerificationUploadDoc {
  type: VerificationUploadType;
  label: string;
  storagePath: string;
  downloadUrl: string;
}

const EXPECTED_ATTESTATION = "I confirm I am authorized to represent this company.";

const VERIFICATION_DOC_LABELS: Record<VerificationUploadType, string> = {
  business_license: "Business license / registration proof",
  ein_letter: "EIN letter (SS-4 confirmation)",
  utility_bill: "Utility bill matching business address (optional)",
  government_id: "Government ID for authorized representative (optional)",
  other: "Other supporting documentation",
};

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}

function ProfileContent() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Partial<ProfileDoc> | null>(null);
  const [form, setForm] = useState<FormData>({
    businessName: "",
    bio: "",
    website: "",
    linkedin: "",
    naicsCodes: "",
    certifications: [],
    uei: "",
    duns: "",
    cageCode: "",
  });

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [capStatementUrl, setCapStatementUrl] = useState<string | null>(null);
  const [capStatementName, setCapStatementName] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<ProfileDoc["verificationStatus"]>("none");
  const [verificationNote, setVerificationNote] = useState("");
  const [searchingMatches, setSearchingMatches] = useState(false);
  const [linkingMatch, setLinkingMatch] = useState(false);
  const [submittingVerification, setSubmittingVerification] = useState(false);
  const [enrichmentCandidates, setEnrichmentCandidates] = useState<EnrichmentCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<EnrichmentCandidate | null>(null);
  const [attestationText, setAttestationText] = useState("");
  const [attestationAuthorized, setAttestationAuthorized] = useState(false);
  const [attestationConsequences, setAttestationConsequences] = useState(false);
  const [verificationDocs, setVerificationDocs] = useState<Record<VerificationUploadType, VerificationUploadDoc | null>>({
    business_license: null,
    ein_letter: null,
    utility_bill: null,
    government_id: null,
    other: null,
  });
  const [uploadingVerificationType, setUploadingVerificationType] = useState<VerificationUploadType | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoIntroUrl, setVideoIntroUrl] = useState<string | null>(null);
  const [videoIntroPosterUrl, setVideoIntroPosterUrl] = useState<string | null>(null);
  const [videoIntroStatus, setVideoIntroStatus] = useState<"processing" | "ready" | "failed" | null>(null);
  const capFileRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const verificationFileRefs = useRef<Record<VerificationUploadType, HTMLInputElement | null>>({
    business_license: null,
    ein_letter: null,
    utility_bill: null,
    government_id: null,
    other: null,
  });

  // Load existing profile
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const existing = await getProfileFromFirestore(user.uid);
        if (existing) {
          setProfile(existing);
          setForm({
            businessName: existing.businessName || "",
            bio: existing.bio || "",
            website: existing.website || "",
            linkedin: existing.linkedin || "",
            naicsCodes: existing.naicsCodes?.join(", ") || "",
            certifications: existing.certifications || [],
            uei: existing.uei || "",
            duns: existing.duns || "",
            cageCode: existing.cageCode || "",
          });
          setCapStatementUrl(existing.capabilityStatementUrl || null);
          setPhotoUrl(existing.photoUrl || null);
          setPublished(existing.published ?? false);
          setVerificationStatus(existing.verificationStatus || "none");
          setVerificationNote(existing.verificationRejectionReason || "");
          setVideoIntroUrl(existing.videoIntroUrl || null);
          setVideoIntroPosterUrl(existing.videoIntroPosterUrl || null);
          setVideoIntroStatus(existing.videoIntroStatus || null);
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const updateField = useCallback(
    <K extends keyof FormData>(field: K, value: FormData[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setSaved(false);
    },
    []
  );

  const toggleCert = useCallback((cert: string) => {
    setForm((prev) => ({
      ...prev,
      certifications: prev.certifications.includes(cert)
        ? prev.certifications.filter((c) => c !== cert)
        : [...prev.certifications, cert],
    }));
    setSaved(false);
  }, []);

  // Build the profile doc for saving / scoring
  const buildProfileData = useCallback((): Partial<ProfileDoc> => {
    const naicsCodes = form.naicsCodes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const data: Partial<ProfileDoc> = {
      businessName: form.businessName || undefined,
      bio: form.bio || undefined,
      website: form.website || undefined,
      linkedin: form.linkedin || undefined,
      naicsCodes: naicsCodes.length > 0 ? naicsCodes : undefined,
      certifications:
        form.certifications.length > 0 ? form.certifications : undefined,
      uei: form.uei || undefined,
      duns: form.duns || undefined,
      cageCode: form.cageCode || undefined,
      capabilityStatementUrl: capStatementUrl || undefined,
      photoUrl: photoUrl || undefined,
      videoIntroUrl: videoIntroUrl || undefined,
      videoIntroPosterUrl: videoIntroPosterUrl || undefined,
      videoIntroStatus: videoIntroStatus || undefined,
      verificationStatus,
      published,
    };

    data.profileCompletenessScore = computeProfileCompleteness(data);
    data.readinessTier = computeReadinessTier(data);
    return data;
  }, [
    capStatementUrl,
    form,
    photoUrl,
    published,
    verificationStatus,
    videoIntroPosterUrl,
    videoIntroStatus,
    videoIntroUrl,
  ]);

  const computedProfileData = buildProfileData();
  const completeness = computeProfileCompleteness(computedProfileData);
  const readinessTier = computeReadinessTier({
    ...(profile || {}),
    ...computedProfileData,
    verificationStatus,
  });
  const procReady = readinessTier === "procurement_ready";

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const data = buildProfileData();
      await saveProfileToFirestore(user.uid, data);
      setProfile(data);
      setSaved(true);
    } catch (err) {
      console.error("Failed to save profile:", err);
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Capability statement upload
  const handleCapUpload = async (file: File) => {
    if (!user) return;
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowed.includes(file.type)) {
      setError("Please upload a PDF or Word document.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    const storageRef = ref(
      storage,
      `capabilityStatements/${user.uid}/${file.name}`
    );
    const task = uploadBytesResumable(storageRef, file);

    task.on(
      "state_changed",
      (snapshot) => {
        setUploadProgress(
          Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
        );
      },
      (err) => {
        console.error("Upload error:", err);
        setError("Upload failed. Please try again.");
        setUploading(false);
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        setCapStatementUrl(url);
        setCapStatementName(file.name);
        setUploading(false);
        setSaved(false);
      }
    );
  };

  const handleSearchMatches = async () => {
    setError(null);
    if (!form.businessName.trim()) {
      setError("Business name is required to search for entity matches.");
      return;
    }

    setSearchingMatches(true);
    try {
      const { data } = await enrichmentSearchFn({
        businessName: form.businessName.trim(),
        city: undefined,
        state: undefined,
        uei: form.uei || undefined,
        cage: form.cageCode || undefined,
        duns: form.duns || undefined,
      });

      setEnrichmentCandidates(data.candidates || []);
      setSelectedCandidate((data.candidates || [])[0] || null);
    } catch (err) {
      console.error("Failed to search enrichment matches", err);
      setError("Unable to search entity matches right now. Please try again.");
    } finally {
      setSearchingMatches(false);
    }
  };

  const handleLinkSelectedMatch = async () => {
    setError(null);
    if (!selectedCandidate) {
      setError("Select a company match before linking.");
      return;
    }
    if (attestationText.trim() !== EXPECTED_ATTESTATION) {
      setError("Type the attestation message exactly to continue.");
      return;
    }
    if (!attestationAuthorized || !attestationConsequences) {
      setError("You must acknowledge both attestation checkboxes.");
      return;
    }

    setLinkingMatch(true);
    try {
      await enrichmentLinkFn({
        matchId: selectedCandidate.matchId,
        selectedCandidate: selectedCandidate as unknown as Record<string, unknown>,
        attestationText: attestationText.trim(),
        acknowledgedConsequences: attestationConsequences,
      });

      setProfile((prev) => ({
        ...(prev || {}),
        enrichmentMatchId: selectedCandidate.matchId,
        enrichmentData: selectedCandidate,
        attestationText: EXPECTED_ATTESTATION,
        attestationAcknowledgedConsequences: true,
        attestationTimestamp: Date.now(),
      }));
      setSaved(false);
    } catch (err) {
      console.error("Failed to link selected enrichment match", err);
      setError("Failed to link selected match. Please try again.");
    } finally {
      setLinkingMatch(false);
    }
  };

  const uploadVerificationDocument = async (type: VerificationUploadType, file: File) => {
    if (!user) return;
    if (file.size > 15 * 1024 * 1024) {
      setError("Verification document must be under 15 MB.");
      return;
    }

    setUploadingVerificationType(type);
    setError(null);

    try {
      const safeName = file.name.replace(/\s+/g, "_");
      const storagePath = `verificationDocs/${user.uid}/${type}/${Date.now()}_${safeName}`;
      const storageRef = ref(storage, storagePath);
      const task = uploadBytesResumable(storageRef, file);

      await new Promise<void>((resolve, reject) => {
        task.on("state_changed", undefined, reject, () => resolve());
      });

      const downloadUrl = await getDownloadURL(task.snapshot.ref);
      setVerificationDocs((prev) => ({
        ...prev,
        [type]: {
          type,
          label: VERIFICATION_DOC_LABELS[type],
          storagePath,
          downloadUrl,
        },
      }));
      setSaved(false);
    } catch (err) {
      console.error("Failed to upload verification document", err);
      setError("Verification upload failed. Please try again.");
    } finally {
      setUploadingVerificationType(null);
    }
  };

  const handleSubmitVerification = async () => {
    setError(null);
    const docs = Object.values(verificationDocs).filter(Boolean) as VerificationUploadDoc[];
    const hasBusinessLicense = Boolean(verificationDocs.business_license);
    const hasEinLetter = Boolean(verificationDocs.ein_letter);

    if (!hasBusinessLicense || !hasEinLetter) {
      setError("Business license and EIN letter are required to submit verification.");
      return;
    }

    setSubmittingVerification(true);
    try {
      await verificationSubmitFn({ documents: docs });
      setVerificationStatus("pending");
      setVerificationNote("");
      setProfile((prev) => ({
        ...(prev || {}),
        verificationStatus: "pending",
        verificationSubmittedAt: Date.now(),
      }));
      setSaved(false);
    } catch (err) {
      console.error("Failed to submit verification docs", err);
      setError("Unable to submit verification package right now.");
    } finally {
      setSubmittingVerification(false);
    }
  };

  const handleVideoUpload = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith("video/")) {
      setError("Please upload a valid video file.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError("Video file must be under 100 MB.");
      return;
    }

    setVideoUploading(true);
    setVideoIntroStatus("processing");
    setError(null);

    try {
      const safeName = file.name.replace(/\s+/g, "_");
      const storagePath = `profileVideos/${user.uid}/raw/${Date.now()}_${safeName}`;
      const storageRef = ref(storage, storagePath);
      const task = uploadBytesResumable(storageRef, file);

      await new Promise<void>((resolve, reject) => {
        task.on("state_changed", undefined, reject, () => resolve());
      });

      const url = await getDownloadURL(task.snapshot.ref);
      setVideoIntroUrl(url);
      setVideoIntroPosterUrl(photoUrl);
      setVideoIntroStatus("ready");
      setSaved(false);
    } catch (err) {
      console.error("Video upload failed", err);
      setVideoIntroStatus("failed");
      setError("Video upload failed. Please try again.");
    } finally {
      setVideoUploading(false);
    }
  };

  // Profile photo upload
  const handlePhotoUpload = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5 MB.");
      return;
    }

    setPhotoUploading(true);
    setError(null);

    const storageRef = ref(
      storage,
      `profilePhotos/${user.uid}/${file.name}`
    );
    const task = uploadBytesResumable(storageRef, file);

    task.on(
      "state_changed",
      () => {},
      (err) => {
        console.error("Photo upload error:", err);
        setError("Photo upload failed.");
        setPhotoUploading(false);
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        setPhotoUrl(url);
        setPhotoUploading(false);
        setSaved(false);
      }
    );
  };

  if (!user) return null;

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
              Business Profile
            </h1>
            <p className="text-slate-500 mt-1">
              Complete your profile to unlock procurement opportunities.
            </p>
          </div>

          {/* Procurement-Ready badge */}
          {procReady ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-200">
              <Shield className="h-3.5 w-3.5" />
              Procurement-Ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide bg-slate-100 text-slate-500 border border-slate-200">
              {completeness}% Complete
            </span>
          )}
        </div>

        <ReadinessMeter
          completeness={completeness}
          readinessTier={readinessTier}
          verificationStatus={verificationStatus}
        />

        {/* Verification + Enrichment */}
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Company Verification</h2>
              <p className="mt-1 text-xs text-slate-500">
                Link your entity record, attest authority, and submit documents to unlock transactions.
              </p>
            </div>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              verificationStatus === "verified"
                ? "bg-emerald-100 text-emerald-800"
                : verificationStatus === "pending"
                ? "bg-amber-100 text-amber-800"
                : verificationStatus === "rejected"
                ? "bg-red-100 text-red-800"
                : "bg-slate-100 text-slate-600"
            }`}>
              {verificationStatus === "verified" ? <ShieldCheck className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {verificationStatus}
            </span>
          </div>

          {verificationStatus === "rejected" && verificationNote ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Action required: {verificationNote}
            </p>
          ) : null}

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">1) Search + match</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={handleSearchMatches}
                  disabled={searchingMatches}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {searchingMatches ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Search candidate matches
                </button>
                <p className="text-xs text-slate-500">
                  Uses secure server-side SAM.gov + USAspending enrichment.
                </p>
              </div>

              {enrichmentCandidates.length > 0 && (
                <div className="mt-3 max-h-44 space-y-2 overflow-auto">
                  {enrichmentCandidates.map((candidate) => (
                    <button
                      key={candidate.matchId}
                      onClick={() => setSelectedCandidate(candidate)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                        selectedCandidate?.matchId === candidate.matchId
                          ? "border-slate-900 bg-slate-50"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <p className="font-semibold text-slate-800">{candidate.legalName}</p>
                      <p className="text-slate-500">
                        {(candidate.city || "Unknown city")}, {(candidate.state || "Unknown state")} · Score {candidate.confidenceScore}
                      </p>
                      <p className="text-slate-400">{candidate.matchReason}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">2) Attestation + link selected match</h3>
              <input
                type="text"
                value={attestationText}
                onChange={(e) => setAttestationText(e.target.value)}
                placeholder={EXPECTED_ATTESTATION}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-transparent focus:ring-2 focus:ring-slate-900"
              />
              <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={attestationAuthorized} onChange={(e) => setAttestationAuthorized(e.target.checked)} className="mt-0.5" />
                I certify this information is mine or I am an authorized representative.
              </label>
              <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={attestationConsequences} onChange={(e) => setAttestationConsequences(e.target.checked)} className="mt-0.5" />
                I understand false representation may result in permanent suspension.
              </label>
              <button
                onClick={handleLinkSelectedMatch}
                disabled={linkingMatch}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {linkingMatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Link selected company
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">3) Upload verification documents</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(VERIFICATION_DOC_LABELS) as VerificationUploadType[]).map((docType) => {
                  const fileMeta = verificationDocs[docType];
                  const isUploadingThis = uploadingVerificationType === docType;
                  return (
                    <div key={docType} className="rounded-lg border border-slate-200 p-2">
                      <p className="mb-1 text-[11px] font-semibold text-slate-700">{VERIFICATION_DOC_LABELS[docType]}</p>
                      {fileMeta ? (
                        <p className="truncate text-[11px] text-emerald-700">Uploaded</p>
                      ) : (
                        <p className="text-[11px] text-slate-500">Not uploaded</p>
                      )}
                      <button
                        onClick={() => verificationFileRefs.current[docType]?.click()}
                        disabled={Boolean(uploadingVerificationType)}
                        className="mt-1 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {isUploadingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                        {isUploadingThis ? "Uploading..." : "Upload"}
                      </button>
                      <input
                        ref={(el) => {
                          verificationFileRefs.current[docType] = el;
                        }}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadVerificationDocument(docType, f);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <button
                onClick={handleSubmitVerification}
                disabled={submittingVerification}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {submittingVerification ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Submit verification package
              </button>
            </div>
          </div>
        </div>

        {/* Video intro */}
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Video Intro</h2>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {videoIntroStatus || "not uploaded"}
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Upload a short intro (max 30 seconds recommended) for profile credibility.
          </p>

          <button
            onClick={() => videoFileRef.current?.click()}
            disabled={videoUploading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {videoUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
            {videoUploading ? "Uploading video..." : "Upload intro video"}
          </button>
          <input
            ref={videoFileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleVideoUpload(f);
            }}
          />

          {videoIntroUrl ? (
            <div className="mt-3 rounded-lg border border-slate-200 p-2">
              <video
                src={videoIntroUrl}
                poster={videoIntroPosterUrl || undefined}
                controls
                preload="metadata"
                className="h-auto w-full rounded-md"
              />
            </div>
          ) : null}
        </div>

        {/* Step navigation */}
        <div className="flex gap-1 mb-8 bg-slate-100 rounded-xl p-1">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setStep(i)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  step === i
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 p-3 mb-6 rounded-xl bg-red-50 text-red-700 text-sm border border-red-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Step content */}
        <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 p-6 md:p-8">
          {step === 0 && (
            <StepBusiness
              form={form}
              updateField={updateField}
              photoUrl={photoUrl}
              photoUploading={photoUploading}
              photoFileRef={photoFileRef}
              onPhotoUpload={handlePhotoUpload}
            />
          )}
          {step === 1 && (
            <StepProcurement
              form={form}
              updateField={updateField}
              toggleCert={toggleCert}
            />
          )}
          {step === 2 && (
            <StepDocuments
              capStatementUrl={capStatementUrl}
              capStatementName={capStatementName}
              uploading={uploading}
              uploadProgress={uploadProgress}
              capFileRef={capFileRef}
              onCapUpload={handleCapUpload}
              onRemoveCap={() => {
                setCapStatementUrl(null);
                setCapStatementName(null);
                setSaved(false);
              }}
            />
          )}
        </div>

        {/* Publish toggle (PR-07) */}
        <div className="mt-6 p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              Make Profile Public
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              When enabled, your profile appears in the Member Directory for other members to discover.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={published}
            onClick={() => { setPublished(!published); setSaved(false); }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
              published ? "bg-emerald-500" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                published ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* Navigation + Save */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-3">
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-600 font-medium">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 bg-slate-900 text-white text-sm font-medium shadow-lg shadow-slate-900/20 hover:bg-slate-800 disabled:opacity-60 transition-all"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save Profile
            </button>

            {step < STEPS.length - 1 && (
              <button
                onClick={() => setStep(step + 1)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// --- Step 1: Business Info ---

function StepBusiness({
  form,
  updateField,
  photoUrl,
  photoUploading,
  photoFileRef,
  onPhotoUpload,
}: {
  form: FormData;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  photoUrl: string | null;
  photoUploading: boolean;
  photoFileRef: React.RefObject<HTMLInputElement | null>;
  onPhotoUpload: (file: File) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          Business Information
        </h2>
        <p className="text-sm text-slate-500">
          Tell us about your business so other members and procurement officers
          can find you.
        </p>
      </div>

      {/* Photo */}
      <div className="flex items-center gap-5">
        <div className="relative h-20 w-20 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden ring-2 ring-slate-200">
          {photoUrl ? (
            <Image
              src={photoUrl}
              alt="Profile"
              fill
              className="object-cover"
            />
          ) : (
            <Camera className="h-6 w-6 text-slate-400" />
          )}
          {photoUploading && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
            </div>
          )}
        </div>
        <div>
          <button
            onClick={() => photoFileRef.current?.click()}
            disabled={photoUploading}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
          >
            {photoUrl ? "Change photo" : "Upload photo"}
          </button>
          <p className="text-xs text-slate-400 mt-0.5">JPG, PNG · Max 5 MB</p>
          <input
            ref={photoFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPhotoUpload(f);
            }}
          />
        </div>
      </div>

      {/* Business Name */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Business Name *
        </label>
        <input
          type="text"
          value={form.businessName}
          onChange={(e) => updateField("businessName", e.target.value)}
          placeholder="Acme Consulting LLC"
          className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
        />
      </div>

      {/* Bio */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Business Description
        </label>
        <textarea
          rows={4}
          value={form.bio}
          onChange={(e) => updateField("bio", e.target.value)}
          placeholder="Brief overview of your business, services, and expertise..."
          className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all resize-none"
        />
        <p className="text-xs text-slate-400 mt-1">
          {form.bio.length}/500 characters
        </p>
      </div>

      {/* Website + LinkedIn */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            <Globe className="h-3.5 w-3.5 inline mr-1" />
            Website
          </label>
          <input
            type="url"
            value={form.website}
            onChange={(e) => updateField("website", e.target.value)}
            placeholder="https://example.com"
            className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            <Linkedin className="h-3.5 w-3.5 inline mr-1" />
            LinkedIn
          </label>
          <input
            type="url"
            value={form.linkedin}
            onChange={(e) => updateField("linkedin", e.target.value)}
            placeholder="https://linkedin.com/in/yourname"
            className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
          />
        </div>
      </div>
    </div>
  );
}

// --- Step 2: Procurement Details ---

function StepProcurement({
  form,
  updateField,
  toggleCert,
}: {
  form: FormData;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  toggleCert: (cert: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          Procurement Details
        </h2>
        <p className="text-sm text-slate-500">
          Add your government contracting identifiers and certifications to
          appear in RFx matching.
        </p>
      </div>

      {/* NAICS Codes */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          NAICS Codes
        </label>
        <input
          type="text"
          value={form.naicsCodes}
          onChange={(e) => updateField("naicsCodes", e.target.value)}
          placeholder="541511, 541512, 541519"
          className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
        />
        <p className="text-xs text-slate-400 mt-1">
          Comma-separated codes.{" "}
          <a
            href="https://www.census.gov/naics/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-500 hover:underline"
          >
            Look up codes
          </a>
        </p>
      </div>

      {/* Certifications */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Certifications
        </label>
        <div className="flex flex-wrap gap-2">
          {CERTIFICATION_OPTIONS.map((cert) => {
            const active = form.certifications.includes(cert);
            return (
              <button
                key={cert}
                onClick={() => toggleCert(cert)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  active
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                {active && <Check className="h-3 w-3 inline mr-1" />}
                {cert}
              </button>
            );
          })}
        </div>
      </div>

      {/* UEI / DUNS / CAGE */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            UEI
          </label>
          <input
            type="text"
            value={form.uei}
            onChange={(e) => updateField("uei", e.target.value)}
            placeholder="12-char UEI"
            className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
          />
          <p className="text-xs text-slate-400 mt-1">Unique Entity ID (SAM.gov)</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            DUNS
          </label>
          <input
            type="text"
            value={form.duns}
            onChange={(e) => updateField("duns", e.target.value)}
            placeholder="9-digit DUNS"
            className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            CAGE Code
          </label>
          <input
            type="text"
            value={form.cageCode}
            onChange={(e) => updateField("cageCode", e.target.value)}
            placeholder="5-char code"
            className="w-full rounded-lg px-4 py-3 border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
          />
        </div>
      </div>
    </div>
  );
}

// --- Step 3: Documents ---

function StepDocuments({
  capStatementUrl,
  capStatementName,
  uploading,
  uploadProgress,
  capFileRef,
  onCapUpload,
  onRemoveCap,
}: {
  capStatementUrl: string | null;
  capStatementName: string | null;
  uploading: boolean;
  uploadProgress: number;
  capFileRef: React.RefObject<HTMLInputElement | null>;
  onCapUpload: (file: File) => void;
  onRemoveCap: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          Capability Statement
        </h2>
        <p className="text-sm text-slate-500">
          Upload your capability statement to share with RFx issuers and
          procurement officers. This is a key document for winning contracts.
        </p>
      </div>

      {capStatementUrl ? (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
          <FileText className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-900 truncate">
              {capStatementName || "Capability Statement"}
            </p>
            <a
              href={capStatementUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-600 hover:underline"
            >
              View document
            </a>
          </div>
          <button
            onClick={onRemoveCap}
            className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : uploading ? (
        <div className="p-6 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
            <span className="text-sm font-medium text-slate-700">
              Uploading... {uploadProgress}%
            </span>
          </div>
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-slate-600 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      ) : (
        <button
          onClick={() => capFileRef.current?.click()}
          className="w-full p-8 rounded-xl border-2 border-dashed border-slate-200 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50 transition-all group"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-full bg-white shadow-sm ring-1 ring-slate-200 group-hover:shadow-md transition-all">
              <Upload className="h-6 w-6 text-slate-400 group-hover:text-slate-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-700">
                Click to upload your capability statement
              </p>
              <p className="text-xs text-slate-400 mt-1">
                PDF or Word · Max 10 MB
              </p>
            </div>
          </div>
        </button>
      )}

      <input
        ref={capFileRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onCapUpload(f);
        }}
      />

      {/* Tips */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-2">
          <Award className="h-4 w-4 text-emerald-600" />
          Tips for a strong capability statement
        </h3>
        <ul className="text-xs text-slate-500 space-y-1.5">
          <li className="flex items-start gap-2">
            <Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
            Include your core competencies and differentiators
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
            List past performance with contract values and agencies
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
            Highlight all certifications and socioeconomic designations
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
            Keep it to 1-2 pages for maximum impact
          </li>
        </ul>
      </div>
    </div>
  );
}
