"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Building2,
  ExternalLink,
  Handshake,
  LoaderCircle,
  Mail,
  MapPin,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ExchangeOrganizationContextState } from "../data/useExchangeOrganizationContext";
import {
  requestOrganizationContact,
  requestOrganizationIntroduction,
  setOrganizationSaved,
} from "../data/organizationContextGateway";
import {
  exchangeWorkspaceActions,
  type ExchangeWorkspaceAction,
} from "../state/exchangeWorkspaceActions";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";
import type { ExchangeHistoryMode } from "../views/exchangeViewTypes";

function safeWebsite(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function createIdempotencyKey(prefix: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function safeActionError(): string {
  return "The request could not be completed in the current authorized context. Refresh your access and try again.";
}

export function ExchangeOrganizationContextDrawer({
  state,
  context,
  applyAction,
}: {
  state: ExchangeWorkspaceState;
  context: ExchangeOrganizationContextState;
  applyAction: (
    action: ExchangeWorkspaceAction,
    history?: ExchangeHistoryMode,
  ) => ExchangeWorkspaceState;
}) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState<"save" | "contact" | "introduction" | null>(null);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const perspective = context.perspective;
  const organization = perspective?.organization;
  const actorOrganizationId = state.actorOrganizationId;
  const subjectOrganizationId = state.subjectOrganizationId;
  const actionContextKey = `${actorOrganizationId ?? "individual"}\u0000${subjectOrganizationId ?? "none"}`;
  const actionContextKeyRef = useRef(actionContextKey);
  actionContextKeyRef.current = actionContextKey;

  useEffect(() => {
    setMessage("");
    setNotice(null);
    setSubmitting(null);
    setSaved(perspective?.saved ?? false);
  }, [actionContextKey, perspective?.saved]);

  const allowedActions = useMemo(
    () => new Set(perspective?.perspective.allowedActions ?? []),
    [perspective?.perspective.allowedActions],
  );
  const website = safeWebsite(organization?.website);
  const location = [organization?.city, organization?.state].filter(Boolean).join(", ");
  const tags = [
    ...(organization?.industries ?? []),
    ...(organization?.capabilityKeywords ?? []),
    ...(organization?.certifications ?? []),
  ].slice(0, 24);
  const requiredSaveAction = saved ? "unsave_organization" : "save_organization";
  const canSave = Boolean(
    actorOrganizationId
    && subjectOrganizationId
    && allowedActions.has(requiredSaveAction),
  );
  const canContact = Boolean(actorOrganizationId && subjectOrganizationId && allowedActions.has("request_contact"));
  const canIntroduce = Boolean(actorOrganizationId && subjectOrganizationId && allowedActions.has("request_introduction"));

  if (!state.organizationDrawerOpen || !subjectOrganizationId) return null;

  const submitSave = async () => {
    if (!actorOrganizationId || !subjectOrganizationId || !canSave) return;
    const requestContextKey = actionContextKey;
    const requestedSavedState = !saved;
    setSubmitting("save");
    setNotice(null);
    try {
      const result = await setOrganizationSaved({
        actorOrganizationId,
        organizationId: subjectOrganizationId,
        saved: requestedSavedState,
      });
      if (actionContextKeyRef.current !== requestContextKey) return;
      setSaved(result.saved);
      setNotice(result.saved ? "Organization saved for this actor." : "Organization removed from saved records.");
      context.refresh();
    } catch {
      if (actionContextKeyRef.current !== requestContextKey) return;
      setNotice(safeActionError());
    } finally {
      if (actionContextKeyRef.current === requestContextKey) setSubmitting(null);
    }
  };

  const submitContact = async (kind: "contact" | "introduction") => {
    if (!actorOrganizationId || !subjectOrganizationId || message.trim().length < 10) return;
    const requestContextKey = actionContextKey;
    setSubmitting(kind);
    setNotice(null);
    try {
      if (kind === "contact") {
        await requestOrganizationContact({
          actorOrganizationId,
          subjectOrganizationId,
          message: message.trim(),
          idempotencyKey: createIdempotencyKey("organization-contact"),
        });
        if (actionContextKeyRef.current !== requestContextKey) return;
        setNotice("Contact request submitted. Protected contact details were not disclosed.");
      } else {
        await requestOrganizationIntroduction({
          actorOrganizationId,
          subjectOrganizationId,
          message: message.trim(),
          idempotencyKey: createIdempotencyKey("organization-introduction"),
        });
        if (actionContextKeyRef.current !== requestContextKey) return;
        setNotice("Introduction request submitted without exposing the relationship path.");
      }
      setMessage("");
      context.refresh();
    } catch {
      if (actionContextKeyRef.current !== requestContextKey) return;
      setNotice(safeActionError());
    } finally {
      if (actionContextKeyRef.current === requestContextKey) setSubmitting(null);
    }
  };

  return (
    <aside
      className="absolute bottom-3 right-3 top-3 z-[1300] flex w-[min(94vw,26rem)] flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/90 shadow-2xl backdrop-blur-2xl"
      aria-label="Organization context drawer"
      data-exchange-organization-drawer
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-slate-200/80 bg-white/72 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-800">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-700">Active organization context</p>
          <h2 className="mt-1 truncate text-base font-black text-slate-950">
            {organization?.name ?? (context.perspectiveLoading ? "Resolving organization…" : "Organization unavailable")}
          </h2>
          {perspective ? (
            <p className="mt-1 text-xs font-semibold text-slate-500">{perspective.perspective.heading}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => applyAction(exchangeWorkspaceActions.setOrganizationDrawerOpen(false))}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-violet-500"
          aria-label="Close organization drawer and keep context"
          title="Close drawer and keep context"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {context.perspectiveLoading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm font-semibold text-slate-600" role="status">
            <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Verifying viewer-relative access…
          </div>
        ) : !perspective || !organization ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="status">
            No organization fields are available for this viewer and mode. The context ID remains selected, but private data is hidden.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wide">
              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-800">{perspective.subject.contextType.replaceAll("_", " ")}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{perspective.perspective.projectionLevel.replaceAll("_", " ")}</span>
              {perspective.subject.resourceProviderStatus === "approved" ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">Approved resource provider</span>
              ) : null}
            </div>

            <dl className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/90 p-4 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <dt className="font-semibold text-slate-600">Location</dt>
                <dd className="ml-auto max-w-[60%] text-right font-bold text-slate-900">{location || "Not published"}</dd>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <dt className="font-semibold text-slate-600">Claim status</dt>
                <dd className="ml-auto capitalize text-slate-900">{perspective.subject.claimedStatus.replaceAll("_", " ")}</dd>
              </div>
              <div className="flex items-start gap-2">
                <Handshake className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <dt className="font-semibold text-slate-600">Relationship</dt>
                <dd className="ml-auto capitalize text-slate-900">{perspective.relationship.type.replaceAll("_", " ")}</dd>
              </div>
            </dl>

            {organization.description ? (
              <div>
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">About</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{organization.description}</p>
              </div>
            ) : null}

            {tags.length ? (
              <div>
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Published capabilities</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">{tag}</span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
              {website ? (
                <a href={website} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-500">
                  Website <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              ) : null}
              {canSave ? (
                <button type="button" onClick={() => void submitSave()} disabled={submitting !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50">
                  <Bookmark className="h-4 w-4" aria-hidden="true" /> {saved ? "Unsave" : "Save"}
                </button>
              ) : null}
            </div>

            {canContact || canIntroduce ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                <label className="text-xs font-black uppercase tracking-wide text-slate-600" htmlFor="exchange-organization-request-message">Request message</label>
                <textarea
                  id="exchange-organization-request-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value.slice(0, 1_000))}
                  rows={4}
                  placeholder="Explain why you would like to connect."
                  className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {canContact ? (
                    <button type="button" onClick={() => void submitContact("contact")} disabled={submitting !== null || message.trim().length < 10} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-black text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-40">
                      <Mail className="h-4 w-4" aria-hidden="true" /> Request contact
                    </button>
                  ) : null}
                  {canIntroduce ? (
                    <button type="button" onClick={() => void submitContact("introduction")} disabled={submitting !== null || message.trim().length < 10} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-700 px-3 text-xs font-black text-white outline-none hover:bg-violet-600 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-40">
                      <Handshake className="h-4 w-4" aria-hidden="true" /> Request introduction
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {notice ? <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-950" role="status">{notice}</p> : null}
            <p className="rounded-xl border border-violet-100 bg-violet-50 p-3 text-[11px] leading-5 text-violet-950">
              Fields and actions on this panel are server-allowlisted for the current viewer, actor, subject, and mode. Relationship paths and protected contacts are never returned.
            </p>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-slate-200 bg-white/78 p-3">
        <button
          type="button"
          onClick={() => applyAction(exchangeWorkspaceActions.clearSubjectOrganization(), "push")}
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          Clear organization context
        </button>
      </footer>
    </aside>
  );
}
