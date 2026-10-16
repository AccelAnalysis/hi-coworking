"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { readPowerNowCriteria, type PowerNowCriteriaDoc, type PowerNowCriterion } from "@/lib/powerNowScore";
import { useAuth } from "@/lib/authContext";
import { EmailLinkSignIn, PlaceholderBanner, PowerNowFrame, SignOutButton } from "../ui";
import { CriteriaReadout } from "../criteriaView";

export default function RubricPage() {
  const { user, loading } = useAuth();
  const [isPitcher, setIsPitcher] = useState<boolean | null>(null);
  const [criteria, setCriteria] = useState<PowerNowCriterion[]>([]);
  const [rubric, setRubric] = useState<Pick<PowerNowCriteriaDoc, "placeholder" | "notice" | "pitcherQuestions">>({
    placeholder: false,
    notice: "",
    pitcherQuestions: [],
  });
  const [missing, setMissing] = useState(false);
  const [released, setReleased] = useState<Array<{ judge: string; strength: string; nextStep: string }>>([]);

  useEffect(() => {
    if (!user) {
      setIsPitcher(null);
      return;
    }
    const unsub = onSnapshot(doc(db, "powerNowPitchers", user.uid), (snap) => {
      setIsPitcher(snap.exists() && snap.data()?.active === true);
    }, () => setIsPitcher(false));
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!isPitcher || !user) {
      setReleased([]);
      return;
    }
    const unsubCriteria = onSnapshot(doc(db, "powerNowCriteria", "current"), (snap) => {
      if (!snap.exists()) {
        setMissing(true);
        setCriteria([]);
        return;
      }
      const published = readPowerNowCriteria(snap.data());
      setMissing(false);
      setCriteria(published.items);
      setRubric(published);
    }, () => setMissing(true));
    const unsubNotes = onSnapshot(doc(db, "powerNowReleasedNotes", user.uid), (snap) => {
      const comments = snap.data()?.comments;
      setReleased(Array.isArray(comments) ? comments.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { judge?: unknown; strength?: unknown; nextStep?: unknown };
        return [{
          judge: typeof row.judge === "string" ? row.judge : "Judge",
          strength: typeof row.strength === "string" ? row.strength : "",
          nextStep: typeof row.nextStep === "string" ? row.nextStep : "",
        }];
      }) : []);
    }, () => setReleased([]));
    return () => {
      unsubCriteria();
      unsubNotes();
    };
  }, [isPitcher, user]);

  return (
    <PowerNowFrame
      title="Rubric"
      lede="Selected pitchers can read the criteria for the night. This page does not show scores or the judge form."
    >
      <EmailLinkSignIn
        path="/power-now/rubric"
        intro="Sign in with the email an admin selected for the night. The link is only for you."
      />
      {user && (loading || isPitcher === null) ? <p className="pn-note">Loading.</p> : null}
      {user && isPitcher === false ? <p className="pn-alert" role="alert">This email is not a selected pitcher.</p> : null}
      {user && isPitcher ? (
        <>
          <SignOutButton />
          <p className="pn-note">This view is read only.</p>
          {rubric.placeholder ? <PlaceholderBanner notice={rubric.notice} /> : null}
          {!rubric.placeholder && rubric.notice ? <p className="pn-note">{rubric.notice}</p> : null}
          {missing || criteria.length === 0 ? <p className="pn-note">The rubric has not been published yet.</p> : (
            <CriteriaReadout items={criteria} showAnchors={false} pitcherQuestions={rubric.pitcherQuestions} />
          )}
          <h2>Comments for you</h2>
          {released.length === 0 ? (
            <p className="pn-note">Jonathan has not released founder comments.</p>
          ) : (
            <ul className="pn-readonly">
              {released.map((comment, index) => (
                <li key={`${comment.judge}-${index}`}>
                  <p><strong>{comment.judge}</strong></p>
                  {comment.strength ? <p>Strength: {comment.strength}</p> : null}
                  {comment.nextStep ? <p>Next step: {comment.nextStep}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </PowerNowFrame>
  );
}
