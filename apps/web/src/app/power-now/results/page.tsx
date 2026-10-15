"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  readPowerNowCriteria,
  weightedScore,
  type PowerNowCriterion,
  type PowerNowPoint,
} from "@/lib/powerNowScore";
import { AdminLinks, EmailLinkSignIn, PowerNowFrame, SignOutButton, useAdminGate } from "../ui";

type Score = {
  id: string;
  nightId: string;
  pitcherId: string;
  judgeUid: string;
  points: PowerNowPoint[];
  recused: boolean;
  founderComment: string;
};
type Pitcher = { id: string; nightId: string; name: string; company: string };
type PrivateNote = { id: string; comment: string; judgeUid: string };

export default function ResultsPage() {
  const { user, loading, isAdmin } = useAdminGate();
  const [isHost, setIsHost] = useState<boolean | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [criteria, setCriteria] = useState<PowerNowCriterion[]>([]);
  const [judges, setJudges] = useState<Record<string, string>>({});
  const [privateNotes, setPrivateNotes] = useState<PrivateNote[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setIsHost(null);
      return;
    }
    if (isAdmin) {
      setIsHost(false);
      return;
    }
    const unsub = onSnapshot(doc(db, "powerNowHosts", user.uid), (snap) => {
      setIsHost(snap.exists() && snap.data()?.active === true);
    }, () => setIsHost(false));
    return () => unsub();
  }, [isAdmin, user]);

  const allowed = isAdmin || isHost === true;

  useEffect(() => {
    if (!allowed) return;
    const unsubScores = onSnapshot(collection(db, "powerNowScores"), (snap) => {
      setScores(snap.docs.map((item) => {
        const data = item.data() as {
          nightId?: string;
          pitcherId?: string;
          judgeUid?: string;
          points?: PowerNowPoint[];
          recused?: boolean;
          founderComment?: string;
        };
        return {
          id: item.id,
          nightId: data.nightId || "",
          pitcherId: data.pitcherId || "",
          judgeUid: data.judgeUid || "",
          points: Array.isArray(data.points) ? data.points : [],
          recused: data.recused === true,
          founderComment: typeof data.founderComment === "string" ? data.founderComment : "",
        };
      }));
      setError("");
    }, () => setError("Live results could not be loaded."));
    const unsubCriteria = onSnapshot(doc(db, "powerNowCriteria", "current"), (snap) => {
      setCriteria(readPowerNowCriteria(snap.data()).items);
    });
    const unsubJudges = onSnapshot(collection(db, "powerNowJudges"), (snap) => {
      const next: Record<string, string> = {};
      snap.docs.forEach((item) => {
        const email = item.data().email;
        next[item.id] = typeof email === "string" && email ? email : item.id;
      });
      setJudges(next);
    });
    return () => {
      unsubScores();
      unsubCriteria();
      unsubJudges();
    };
  }, [allowed]);

  useEffect(() => {
    if (!isAdmin) {
      setPrivateNotes([]);
      return;
    }
    const unsub = onSnapshot(collection(db, "powerNowPrivateComments"), (snap) => {
      setPrivateNotes(snap.docs.map((item) => {
        const data = item.data() as { comment?: string; judgeUid?: string };
        return {
          id: item.id,
          comment: typeof data.comment === "string" ? data.comment : "",
          judgeUid: typeof data.judgeUid === "string" ? data.judgeUid : "",
        };
      }));
    });
    return () => unsub();
  }, [isAdmin]);

  useEffect(() => {
    if (!allowed) return;
    const stops = new Set<() => void>();
    const unsub = onSnapshot(collection(db, "powerNowNights"), (snap) => {
      stops.forEach((stop) => stop());
      stops.clear();
      const nightIds = new Set(snap.docs.map((item) => item.id));
      setPitchers((current) => current.filter((item) => nightIds.has(item.nightId)));
      for (const night of snap.docs) {
        const stop = onSnapshot(collection(db, "powerNowNights", night.id, "pitchers"), (pitcherSnap) => {
          const rows = pitcherSnap.docs.map((item) => {
            const data = item.data() as { name?: string; company?: string };
            return { id: item.id, nightId: night.id, name: data.name || item.id, company: data.company || "" };
          });
          setPitchers((current) => [
            ...current.filter((item) => item.nightId !== night.id),
            ...rows,
          ]);
        });
        stops.add(stop);
      }
    });
    return () => {
      unsub();
      stops.forEach((stop) => stop());
    };
  }, [allowed]);

  const groups = useMemo(() => {
    const byPitcher = new Map<string, Score[]>();
    for (const score of scores) {
      const key = `${score.nightId}:${score.pitcherId}`;
      byPitcher.set(key, [...(byPitcher.get(key) ?? []), score]);
    }
    return [...byPitcher.entries()].map(([key, group]) => {
      const [nightId, pitcherId] = key.split(":");
      const pitcher = pitchers.find((item) => item.nightId === nightId && item.id === pitcherId);
      const scoring = group.filter((score) => !score.recused);
      const criterionTotals = criteria.map((criterion) => {
        const values = scoring.flatMap((score) => score.points.filter((point) => point.criterionId === criterion.id).map((point) => Number(point.value)));
        const total = values.reduce((sum, value) => sum + value, 0);
        return {
          id: criterion.id,
          total,
          average: values.length ? total / values.length : 0,
        };
      });
      const weightedValues = scoring.map((score) => weightedScore(score.points, criteria));
      const weightedTotal = weightedValues.reduce((sum, value) => sum + value, 0);
      return {
        key,
        nightId,
        pitcherId,
        name: pitcher?.name || pitcherId,
        company: pitcher?.company || "",
        scores: group,
        scoringCount: scoring.length,
        recusalCount: group.length - scoring.length,
        criterionTotals,
        weightedTotal,
        weightedAverage: scoring.length ? weightedTotal / scoring.length : 0,
      };
    });
  }, [criteria, pitchers, scores]);

  const waiting = Boolean(user) && (loading || (!isAdmin && isHost === null));

  return (
    <PowerNowFrame
      title="Live results"
      lede="Scores from each judge update as they are saved, with totals beside them. Recusals are left out. Pitchers cannot see this page."
    >
      {isAdmin ? <AdminLinks /> : null}
      {!user ? (
        <>
          <EmailLinkSignIn
            path="/power-now/results"
            intro="Hosts sign in with their own email link. There is no shared sign-in link."
          />
          <p className="pn-note">Admins sign in with the Accel Analysis admin account.</p>
          <p><Link className="pn-btn pn-btn-outline" href="/login?next=/power-now/results">Admin sign-in</Link></p>
        </>
      ) : null}
      {waiting ? <p className="pn-note">Loading.</p> : null}
      {user && !waiting && !allowed ? (
        <p className="pn-alert" role="alert">This account is not a host or an admin.</p>
      ) : null}
      {allowed ? (
        <div aria-live="polite">
          <SignOutButton />
          {error ? <p className="pn-alert" role="alert">{error}</p> : null}
          {groups.length === 0 ? <p className="pn-note">No scores yet.</p> : groups.map((group) => (
            <section key={group.key}>
              <h2>{group.name}{group.company ? `, ${group.company}` : ""}</h2>
              <p className="pn-help">{group.nightId}. {group.scoringCount} scoring {group.scoringCount === 1 ? "judge" : "judges"}. {group.recusalCount} {group.recusalCount === 1 ? "recusal" : "recusals"} left out.</p>
              <div className="pn-table-wrap">
                <table className="pn-table">
                  <caption className="pn-help">Individual scores and totals for {group.name}.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Judge</th>
                      {criteria.map((criterion) => (
                        <th key={criterion.id} scope="col">
                          {criterion.code || criterion.label}
                          {criterion.code ? <span className="pn-help">{criterion.label}</span> : null}
                        </th>
                      ))}
                      <th scope="col">Weighted total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.scores.map((score) => (
                      <tr key={score.id}>
                        <th scope="row">{judges[score.judgeUid] || score.judgeUid}</th>
                        {score.recused ? (
                          <td colSpan={criteria.length + 1}>Recused</td>
                        ) : (
                          <>
                            {criteria.map((criterion) => {
                              const point = score.points.find((item) => item.criterionId === criterion.id);
                              return <td key={criterion.id}>{point ? point.value : "—"}</td>;
                            })}
                            <td>{weightedScore(score.points, criteria).toFixed(1)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">Total</th>
                      {group.criterionTotals.map((criterion) => <td key={criterion.id}>{criterion.total}</td>)}
                      <td>{group.weightedTotal.toFixed(1)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Average</th>
                      {group.criterionTotals.map((criterion) => <td key={criterion.id}>{criterion.average.toFixed(1)}</td>)}
                      <td>{group.weightedAverage.toFixed(1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <h3>Comments for the founder</h3>
              <p className="pn-help">Jonathan decides later whether founders see these comments.</p>
              {group.scores.some((score) => score.founderComment) ? (
                <ul className="pn-readonly">
                  {group.scores.filter((score) => score.founderComment).map((score) => (
                    <li key={`${score.id}-founder`}>
                      <p><strong>{judges[score.judgeUid] || score.judgeUid}</strong></p>
                      <p>{score.founderComment}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="pn-note">No founder comments yet.</p>}
              {isAdmin ? (
                <>
                  <h3>Private comments</h3>
                  <p className="pn-help">Only Jonathan can read these. Hosts cannot.</p>
                  {privateNotes.some((note) => note.id.startsWith(`${group.nightId}_${group.pitcherId}_`) && note.comment) ? (
                    <ul className="pn-readonly">
                      {privateNotes.filter((note) => note.id.startsWith(`${group.nightId}_${group.pitcherId}_`) && note.comment).map((note) => (
                        <li key={note.id}>
                          <p><strong>{judges[note.judgeUid] || note.judgeUid}</strong></p>
                          <p>{note.comment}</p>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="pn-note">No private comments yet.</p>}
                </>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
    </PowerNowFrame>
  );
}
