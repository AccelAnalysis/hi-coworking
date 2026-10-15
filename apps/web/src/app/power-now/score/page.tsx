"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  powerNowScoreDocId,
  readPowerNowCriteria,
  type PowerNowCriterion,
} from "@/lib/powerNowScore";
import { useAuth } from "@/lib/authContext";
import { EmailLinkSignIn, PlaceholderBanner, PowerNowFrame, SignOutButton, callableMessage } from "../ui";

type Pitcher = { id: string; name: string; company: string };
type Night = { id: string; label: string; locked: boolean; lockAt: Date | null };
type Draft = {
  values: Record<string, number>;
  recused: boolean;
  founderStrength: string;
  founderNextStep: string;
  privateComment: string;
  submitted: boolean;
};

const EMPTY_DRAFT: Draft = {
  values: {},
  recused: false,
  founderStrength: "",
  founderNextStep: "",
  privateComment: "",
  submitted: false,
};
const COMMENT_MAX = 2000;

export default function ScorePage() {
  const { user } = useAuth();
  const [isJudge, setIsJudge] = useState<boolean | null>(null);
  const [nights, setNights] = useState<Night[]>([]);
  const [nightId, setNightId] = useState("");
  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [criteria, setCriteria] = useState<PowerNowCriterion[]>([]);
  const [placeholder, setPlaceholder] = useState(false);
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsJudge(null);
      return;
    }
    const unsub = onSnapshot(doc(db, "powerNowJudges", user.uid), (snap) => {
      setIsJudge(snap.exists() && snap.data()?.active === true);
    }, () => setIsJudge(false));
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!isJudge) return;
    const unsubNights = onSnapshot(collection(db, "powerNowNights"), (snap) => {
      const next = snap.docs.map((item) => {
        const data = item.data() as { label?: string; locked?: boolean; lockAt?: { toDate?: () => Date } | string };
        const lockAt = data.lockAt && typeof data.lockAt === "object" && typeof data.lockAt.toDate === "function"
          ? data.lockAt.toDate()
          : typeof data.lockAt === "string" ? new Date(data.lockAt) : null;
        return { id: item.id, label: data.label || item.id, locked: data.locked === true, lockAt };
      });
      setNights(next);
      setNightId((current) => current || next[0]?.id || "");
    });
    const unsubCriteria = onSnapshot(doc(db, "powerNowCriteria", "current"), (snap) => {
      const published = readPowerNowCriteria(snap.data());
      setCriteria(published.items);
      setPlaceholder(published.placeholder);
      setNotice(published.notice);
    });
    return () => {
      unsubNights();
      unsubCriteria();
    };
  }, [isJudge]);

  useEffect(() => {
    if (!isJudge || !nightId || !user) return;
    const unsub = onSnapshot(collection(db, "powerNowNights", nightId, "pitchers"), async (snap) => {
      const next = snap.docs
        .filter((item) => item.data().selected === true)
        .map((item) => {
          const data = item.data() as { name?: string; company?: string };
          return { id: item.id, name: data.name || item.id, company: data.company || "" };
        });
      setPitchers(next);
      const loaded: Record<string, Draft> = {};
      for (const pitcher of next) {
        const scoreId = powerNowScoreDocId(nightId, pitcher.id, user.uid);
        try {
          const [scoreSnap, privateSnap] = await Promise.all([
            getDoc(doc(db, "powerNowScores", scoreId)),
            getDoc(doc(db, "powerNowPrivateComments", scoreId)),
          ]);
        const data = scoreSnap.data() as {
          points?: Array<{ criterionId: string; value: number }>;
          recused?: boolean;
          founderStrength?: string;
          founderNextStep?: string;
          submitted?: boolean;
        } | undefined;
        const values: Record<string, number> = {};
        for (const point of data?.points ?? []) values[point.criterionId] = point.value;
        loaded[pitcher.id] = {
          values,
          recused: data?.recused === true,
          founderStrength: typeof data?.founderStrength === "string" ? data.founderStrength : "",
          founderNextStep: typeof data?.founderNextStep === "string" ? data.founderNextStep : "",
          privateComment: typeof privateSnap.data()?.comment === "string" ? privateSnap.data()?.comment as string : "",
          submitted: data?.submitted === true,
        };
        } catch {
          loaded[pitcher.id] = { ...EMPTY_DRAFT };
        }
      }
      setDrafts(loaded);
    });
    return () => unsub();
  }, [isJudge, nightId, user]);

  function updateDraft(pitcherId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [pitcherId]: { ...(current[pitcherId] ?? EMPTY_DRAFT), ...patch },
    }));
  }

  async function save(pitcherId: string) {
    if (!user) return;
    const draft = drafts[pitcherId] ?? EMPTY_DRAFT;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const strength = draft.founderStrength.trim();
      const nextStep = draft.founderNextStep.trim();
      const privateNote = draft.privateComment.trim();
      if (strength.length > COMMENT_MAX || nextStep.length > COMMENT_MAX || privateNote.length > COMMENT_MAX) {
        setError("Each comment must be 2000 characters or fewer.");
        return;
      }
      const points = draft.recused
        ? []
        : criteria.map((criterion) => ({
          criterionId: criterion.id,
          value: draft.values[criterion.id] ?? 0,
        }));
      if (!draft.recused && points.some((point) => point.value < 1)) {
        setError("Score every criterion, or recuse yourself from this pitcher.");
        return;
      }
      if (!draft.recused && (!strength || !nextStep)) {
        setError("Add a strength and a next step for the founder before submitting.");
        return;
      }
      const scoreId = powerNowScoreDocId(nightId, pitcherId, user.uid);
      const batch = writeBatch(db);
      batch.set(doc(db, "powerNowScores", scoreId), {
        nightId,
        pitcherId,
        judgeUid: user.uid,
        recused: draft.recused,
        submitted: true,
        points,
        founderStrength: strength,
        founderNextStep: nextStep,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, "powerNowPrivateComments", scoreId), {
        nightId,
        pitcherId,
        judgeUid: user.uid,
        comment: privateNote,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setStatus(draft.recused
        ? "Recusal submitted. It is locked."
        : "Score submitted. It is locked.");
    } catch (caught) {
      setError(callableMessage(caught, "The score could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const night = nights.find((item) => item.id === nightId);

  return (
    <PowerNowFrame
      title="Scoring"
      lede="Sign in with the email an admin added. Submit one score for each selected pitcher. A submitted score stays locked."
    >
      <EmailLinkSignIn
        path="/power-now/score"
        intro="Use your own email link. There is no shared sign-in link."
      />
      {user && isJudge === null ? <p className="pn-note">Loading.</p> : null}
      {user && isJudge === false ? <p className="pn-alert" role="alert">This email is not an active judge.</p> : null}
      {user && isJudge ? (
        <>
          <SignOutButton />
          {placeholder ? <PlaceholderBanner notice={notice} /> : null}
          {criteria.length === 0 ? <p className="pn-note">The rubric has not been published yet.</p> : (
            <>
              <div className="pn-field">
                <label htmlFor="score-night">Pitch night</label>
                <select id="score-night" value={nightId} onChange={(event) => setNightId(event.target.value)}>
                  {nights.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}{item.locked ? " (locked)" : ""}</option>
                  ))}
                </select>
              </div>
              {night?.locked || (night?.lockAt && night.lockAt.getTime() <= Date.now()) ? <p className="pn-note">Scoring is locked.</p> : null}
              {night?.lockAt && !night.locked ? (
                <p className="pn-help">Scoring locks at {night.lockAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" })}.</p>
              ) : null}
              {pitchers.length === 0 ? <p className="pn-note">No selected pitchers for this night.</p> : pitchers.map((pitcher) => {
                const draft = drafts[pitcher.id] ?? EMPTY_DRAFT;
                const locked = Boolean(night?.locked || draft.submitted || (night?.lockAt && night.lockAt.getTime() <= Date.now()));
                return (
                  <form key={pitcher.id} onSubmit={(event) => { event.preventDefault(); void save(pitcher.id); }}>
                    <h2>{pitcher.name}{pitcher.company ? `, ${pitcher.company}` : ""}</h2>
                    {draft.submitted ? <p className="pn-note">Submitted. This score is locked.</p> : null}
                    <div className="pn-field">
                      <label className="pn-check" htmlFor={`${pitcher.id}-recuse`}>
                        <input
                          id={`${pitcher.id}-recuse`}
                          type="checkbox"
                          checked={draft.recused}
                          disabled={locked}
                          onChange={(event) => updateDraft(pitcher.id, { recused: event.target.checked })}
                        />
                        <span>I am recusing myself from this pitcher</span>
                      </label>
                      <span className="pn-help">A recusal saves no scores and is left out of the totals.</span>
                    </div>
                    {criteria.map((criterion) => (
                      <fieldset className="pn-field" key={criterion.id}>
                        <legend>{criterion.code ? `${criterion.code}. ${criterion.label}` : criterion.label}</legend>
                        {criterion.prompt ? <p>{criterion.prompt}</p> : null}
                        {criterion.weight > 0 ? <span className="pn-help">Weight {criterion.weight}%.</span> : null}
                        {criterion.anchors.length > 0 ? (
                          <ul className="pn-anchors">
                            {criterion.anchors.map((anchor) => (
                              <li key={anchor.score}>{anchor.score}: {anchor.text}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="pn-help">Score from 1 to {criterion.max}.</span>
                        )}
                        <div className="pn-scale" role="radiogroup" aria-label={`${criterion.label} score`}>
                          {Array.from({ length: criterion.max }, (_, index) => index + 1).map((value) => (
                            <label className="pn-scale-option" key={value}>
                              <input
                                type="radio"
                                name={`${pitcher.id}-${criterion.id}`}
                                value={value}
                                checked={!draft.recused && draft.values[criterion.id] === value}
                                disabled={draft.recused || locked}
                                onChange={() => updateDraft(pitcher.id, {
                                  values: { ...draft.values, [criterion.id]: value },
                                })}
                              />
                              <span>{value}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                    <div className="pn-field">
                      <label htmlFor={`${pitcher.id}-strength`}>Strength for the founder</label>
                      <span className="pn-help">Required, unless you recuse yourself. Jonathan reviews this before a founder can see it.</span>
                      <textarea
                        id={`${pitcher.id}-strength`}
                        value={draft.founderStrength}
                        maxLength={COMMENT_MAX}
                        required={!draft.recused}
                        disabled={locked}
                        onChange={(event) => updateDraft(pitcher.id, { founderStrength: event.target.value })}
                      />
                    </div>
                    <div className="pn-field">
                      <label htmlFor={`${pitcher.id}-next`}>Next step for the founder</label>
                      <span className="pn-help">Required, unless you recuse yourself. Jonathan reviews this before a founder can see it.</span>
                      <textarea
                        id={`${pitcher.id}-next`}
                        value={draft.founderNextStep}
                        maxLength={COMMENT_MAX}
                        required={!draft.recused}
                        disabled={locked}
                        onChange={(event) => updateDraft(pitcher.id, { founderNextStep: event.target.value })}
                      />
                    </div>
                    <div className="pn-field">
                      <label htmlFor={`${pitcher.id}-private`}>Private note for Jonathan</label>
                      <span className="pn-help">Only Jonathan can read this. Hosts and other judges cannot.</span>
                      <textarea
                        id={`${pitcher.id}-private`}
                        value={draft.privateComment}
                        maxLength={COMMENT_MAX}
                        disabled={locked}
                        onChange={(event) => updateDraft(pitcher.id, { privateComment: event.target.value })}
                      />
                    </div>
                    <div className="pn-actions">
                      <button className="pn-btn pn-btn-primary" type="submit" disabled={busy || locked}>
                        {draft.recused ? "Submit recusal" : "Submit score"}
                      </button>
                    </div>
                  </form>
                );
              })}
            </>
          )}
          {error ? <p className="pn-alert" role="alert">{error}</p> : null}
          {status ? <p className="pn-status" role="status">{status}</p> : null}
        </>
      ) : null}
    </PowerNowFrame>
  );
}
