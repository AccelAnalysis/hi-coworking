"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { EmailLinkSignIn, PlaceholderBanner, PowerNowFrame, SignOutButton } from "../ui";

type Criterion = { id: string; label: string; max: number };

export default function RubricPage() {
  const { user, loading } = useAuth();
  const [isPitcher, setIsPitcher] = useState<boolean | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [placeholder, setPlaceholder] = useState(false);
  const [notice, setNotice] = useState("");
  const [missing, setMissing] = useState(false);

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
    if (!isPitcher) return;
    const unsub = onSnapshot(doc(db, "powerNowCriteria", "current"), (snap) => {
      if (!snap.exists()) {
        setMissing(true);
        setCriteria([]);
        return;
      }
      const data = snap.data() as { placeholder?: boolean; notice?: string; items?: Criterion[] };
      setMissing(false);
      setCriteria(Array.isArray(data.items) ? data.items : []);
      setPlaceholder(data.placeholder === true);
      setNotice(typeof data.notice === "string" ? data.notice : "");
    }, () => setMissing(true));
    return () => unsub();
  }, [isPitcher]);

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
          {placeholder ? <PlaceholderBanner notice={notice} /> : null}
          {missing || criteria.length === 0 ? <p className="pn-note">The rubric has not been published yet.</p> : (
            <ol className="pn-readonly">
              {criteria.map((criterion) => (
                <li key={criterion.id}>
                  <h2>{criterion.label}</h2>
                  <p className="pn-help">Scored from 1 to {criterion.max}.</p>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </PowerNowFrame>
  );
}
