"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { powerNowScoreDocId } from "@/lib/powerNowScore";
import { useAuth } from "@/lib/authContext";
import { EmailLinkSignIn, PlaceholderBanner, PowerNowFrame, SignOutButton, callableMessage } from "../ui";

type Criterion = { id: string; label: string; max: number };
type Pitcher = { id: string; name: string; company: string };
type Night = { id: string; label: string; locked: boolean };

export default function ScorePage() {
  const { user } = useAuth();
  const [isJudge, setIsJudge] = useState<boolean | null>(null);
  const [nights, setNights] = useState<Night[]>([]);
  const [nightId, setNightId] = useState("");
  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [placeholder, setPlaceholder] = useState(false);
  const [notice, setNotice] = useState("");
  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});
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
        const data = item.data() as { label?: string; locked?: boolean };
        return { id: item.id, label: data.label || item.id, locked: data.locked === true };
      });
      setNights(next);
      setNightId((current) => current || next[0]?.id || "");
    });
    const unsubCriteria = onSnapshot(doc(db, "powerNowCriteria", "current"), (snap) => {
      const data = snap.data() as { placeholder?: boolean; notice?: string; items?: Criterion[] } | undefined;
      setCriteria(Array.isArray(data?.items) ? data.items : []);
      setPlaceholder(data?.placeholder === true);
      setNotice(typeof data?.notice === "string" ? data.notice : "");
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
      const loaded: Record<string, Record<string, number>> = {};
      for (const pitcher of next) {
        const scoreSnap = await getDoc(doc(db, "powerNowScores", powerNowScoreDocId(nightId, pitcher.id, user.uid)));
        const points = scoreSnap.data()?.points as Array<{ criterionId: string; value: number }> | undefined;
        loaded[pitcher.id] = {};
        for (const point of points ?? []) loaded[pitcher.id][point.criterionId] = point.value;
      }
      setScores(loaded);
    });
    return () => unsub();
  }, [isJudge, nightId, user]);

  async function save(pitcherId: string) {
    if (!user) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const points = criteria.map((criterion) => ({
        criterionId: criterion.id,
        value: scores[pitcherId]?.[criterion.id] ?? 0,
      }));
      if (points.some((point) => point.value < 1)) {
        setError("Score every criterion before saving.");
        return;
      }
      await setDoc(doc(db, "powerNowScores", powerNowScoreDocId(nightId, pitcherId, user.uid)), {
        nightId,
        pitcherId,
        judgeUid: user.uid,
        points,
        updatedAt: serverTimestamp(),
      });
      setStatus("Score saved. You can edit it until an admin locks the night.");
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
      lede="Sign in with the email an admin added. You score each selected pitcher once, and you can edit that score until the night is locked."
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
              {night?.locked ? <p className="pn-note">This night is locked. Scores can no longer be edited.</p> : null}
              {pitchers.length === 0 ? <p className="pn-note">No selected pitchers for this night.</p> : pitchers.map((pitcher) => (
                <form key={pitcher.id} onSubmit={(event) => { event.preventDefault(); void save(pitcher.id); }}>
                  <h2>{pitcher.name}{pitcher.company ? `, ${pitcher.company}` : ""}</h2>
                  {criteria.map((criterion) => (
                    <fieldset className="pn-field" key={criterion.id}>
                      <legend>{criterion.label}</legend>
                      <span className="pn-help">Score from 1 to {criterion.max}.</span>
                      <div className="pn-scale">
                        {Array.from({ length: criterion.max }, (_, index) => index + 1).map((value) => (
                          <label className="pn-scale-option" key={value}>
                            <input
                              type="radio"
                              name={`${pitcher.id}-${criterion.id}`}
                              value={value}
                              checked={scores[pitcher.id]?.[criterion.id] === value}
                              onChange={() => setScores((current) => ({
                                ...current,
                                [pitcher.id]: { ...current[pitcher.id], [criterion.id]: value },
                              }))}
                            />
                            <span>{value}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <div className="pn-actions">
                    <button className="pn-btn pn-btn-primary" type="submit" disabled={busy || night?.locked}>
                      Save score
                    </button>
                  </div>
                </form>
              ))}
            </>
          )}
          {error ? <p className="pn-alert" role="alert">{error}</p> : null}
          {status ? <p className="pn-status" role="status">{status}</p> : null}
        </>
      ) : null}
    </PowerNowFrame>
  );
}
