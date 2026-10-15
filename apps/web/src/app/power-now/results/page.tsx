"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, deleteField, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  DEFAULT_TIE_BREAK,
  rankPitchers,
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
  founderStrength: string;
  founderNextStep: string;
};
type Pitcher = { id: string; nightId: string; name: string; company: string; uid: string; jonathanRank: number | null };
type Night = { id: string; label: string; locked: boolean; released: boolean; lockAt: Date | null };
type PrivateNote = { id: string; comment: string; judgeUid: string };

function asDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function lockLabel(night: Night | undefined): string {
  if (!night) return "Scoring stays open until a host or admin locks it.";
  if (night.locked || (night.lockAt && night.lockAt.getTime() <= Date.now())) return "Scoring is locked.";
  if (night.lockAt) {
    const clock = night.lockAt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Chicago",
      timeZoneName: "short",
    });
    return `Scoring locks at ${clock}.`;
  }
  return "Scoring stays open until a host or admin locks it.";
}

export default function ResultsPage() {
  const { user, loading, isAdmin } = useAdminGate();
  const [isHost, setIsHost] = useState<boolean | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [criteria, setCriteria] = useState<PowerNowCriterion[]>([]);
  const [judges, setJudges] = useState<Record<string, string>>({});
  const [privateNotes, setPrivateNotes] = useState<PrivateNote[]>([]);
  const [nights, setNights] = useState<Night[]>([]);
  const [tieBreak, setTieBreak] = useState<string[]>(DEFAULT_TIE_BREAK);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
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
          founderStrength?: string;
          founderNextStep?: string;
        };
        return {
          id: item.id,
          nightId: data.nightId || "",
          pitcherId: data.pitcherId || "",
          judgeUid: data.judgeUid || "",
          points: Array.isArray(data.points) ? data.points : [],
          recused: data.recused === true,
          founderStrength: typeof data.founderStrength === "string" ? data.founderStrength : "",
          founderNextStep: typeof data.founderNextStep === "string" ? data.founderNextStep : "",
        };
      }));
      setError("");
    }, () => setError("Live results could not be loaded."));
    const unsubCriteria = onSnapshot(doc(db, "powerNowCriteria", "current"), (snap) => {
      setCriteria(readPowerNowCriteria(snap.data()).items);
    });
    const unsubSettings = onSnapshot(doc(db, "powerNowSettings", "current"), (snap) => {
      const order = snap.data()?.tieBreak;
      setTieBreak(Array.isArray(order) ? order.filter((item): item is string => typeof item === "string") : DEFAULT_TIE_BREAK);
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
      unsubSettings();
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
      setNights(snap.docs.map((item) => {
        const data = item.data() as { label?: string; locked?: boolean; founderCommentsReleased?: boolean; lockAt?: unknown };
        return {
          id: item.id,
          label: data.label || item.id,
          locked: data.locked === true,
          released: data.founderCommentsReleased === true,
          lockAt: asDate(data.lockAt),
        };
      }));
      setPitchers((current) => current.filter((item) => nightIds.has(item.nightId)));
      for (const night of snap.docs) {
        const stop = onSnapshot(collection(db, "powerNowNights", night.id, "pitchers"), (pitcherSnap) => {
          const rows = pitcherSnap.docs.map((item) => {
            const data = item.data() as { name?: string; company?: string; uid?: string; jonathanRank?: unknown };
            return {
              id: item.id,
              nightId: night.id,
              name: data.name || item.id,
              company: data.company || "",
              uid: typeof data.uid === "string" ? data.uid : "",
              jonathanRank: typeof data.jonathanRank === "number" ? data.jonathanRank : null,
            };
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

  const boards = useMemo(() => {
    const nightIds = [...new Set([...pitchers.map((pitcher) => pitcher.nightId), ...scores.map((score) => score.nightId)])];
    return nightIds.filter(Boolean).map((nightId) => ({
      nightId,
      ranked: rankPitchers(
        pitchers.filter((pitcher) => pitcher.nightId === nightId).map((pitcher) => ({
          key: `${nightId}:${pitcher.id}`,
          jonathanRank: pitcher.jonathanRank,
        })),
        scores.filter((score) => score.nightId === nightId).map((score) => ({
          pitcherKey: `${score.nightId}:${score.pitcherId}`,
          judgeUid: score.judgeUid,
          recused: score.recused,
          points: score.points,
        })),
        criteria,
        tieBreak,
      ),
    }));
  }, [criteria, pitchers, scores, tieBreak]);

  async function lockNight(nightId: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await updateDoc(doc(db, "powerNowNights", nightId), { locked: true, updatedAt: serverTimestamp() });
      setStatus("Scoring is locked.");
    } catch {
      setError("Scoring could not be locked.");
    } finally {
      setBusy(false);
    }
  }

  async function releaseComments(nightId: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const nightPitchers = pitchers.filter((pitcher) => pitcher.nightId === nightId && pitcher.uid);
      for (const pitcher of nightPitchers) {
        const comments = scores
          .filter((score) => score.nightId === nightId && score.pitcherId === pitcher.id && (score.founderStrength || score.founderNextStep))
          .map((score) => ({
            judge: judges[score.judgeUid] || "Judge",
            strength: score.founderStrength,
            nextStep: score.founderNextStep,
          }));
        await setDoc(doc(db, "powerNowReleasedNotes", pitcher.uid), {
          nightId,
          comments,
          releasedAt: serverTimestamp(),
        });
      }
      await updateDoc(doc(db, "powerNowNights", nightId), { founderCommentsReleased: true });
      setStatus("Founder comments released for this night.");
    } catch {
      setError("Founder comments could not be released.");
    } finally {
      setBusy(false);
    }
  }

  const waiting = Boolean(user) && (loading || (!isAdmin && isHost === null));

  return (
    <PowerNowFrame
      title="Live results"
      lede="Each judge score updates live, with the average of the weighted scores. Recusals are left out. Pitchers cannot see this page."
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
          {status ? <p className="pn-status" role="status">{status}</p> : null}
          {boards.map((board) => {
            const night = nights.find((item) => item.id === board.nightId);
            const steps = tieBreak.filter((step) => step === "judge-preference" || step === "jonathan" || criteria.some((criterion) => criterion.id === step));
            return (
              <section key={`${board.nightId}-rank`}>
                <h2>{night?.label || board.nightId}</h2>
                <p className="pn-help">{lockLabel(night)} Place uses the average weighted score, then {steps.map((step) => {
                  if (step === "judge-preference") return "judge preference";
                  if (step === "jonathan") return "Jonathan";
                  return criteria.find((criterion) => criterion.id === step)?.code || step;
                }).join(", then ")}.</p>
                <div className="pn-actions">
                  <button className="pn-btn pn-btn-primary" type="button" disabled={busy || night?.locked} onClick={() => void lockNight(board.nightId)}>
                    Lock scoring
                  </button>
                  {isAdmin ? (
                    <button className="pn-btn pn-btn-outline" type="button" disabled={busy} onClick={() => void releaseComments(board.nightId)}>
                      {night?.released ? "Release founder comments again" : "Release founder comments"}
                    </button>
                  ) : null}
                </div>
                {board.ranked.length === 0 ? <p className="pn-note">No pitchers for this night.</p> : (
                  <div className="pn-table-wrap">
                    <table className="pn-table">
                      <caption className="pn-help">Places for {night?.label || board.nightId}.</caption>
                      <thead>
                        <tr>
                          <th scope="col">Place</th>
                          <th scope="col">Pitcher</th>
                          <th scope="col">Average weighted score</th>
                          {steps.map((step) => (
                            <th key={step} scope="col">
                              {step === "judge-preference" ? "Judge preference" : step === "jonathan" ? "Jonathan" : (criteria.find((criterion) => criterion.id === step)?.code || step)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {board.ranked.map((row) => {
                          const pitcher = pitchers.find((item) => `${item.nightId}:${item.id}` === row.key);
                          return (
                            <tr key={row.key}>
                              <td>{row.place}</td>
                              <th scope="row">{pitcher ? `${pitcher.name}${pitcher.company ? `, ${pitcher.company}` : ""}` : row.key}</th>
                              <td>{row.weightedAverage.toFixed(1)}</td>
                              {steps.map((step) => (
                                <td key={step}>
                                  {step === "judge-preference" ? row.preferenceCount : step === "jonathan" ? (
                                    isAdmin && pitcher ? (
                                      <input
                                        aria-label={`Jonathan rank for ${pitcher.name}`}
                                        type="number"
                                        min={1}
                                        key={`${row.key}-${row.jonathanRank ?? "none"}`}
                                        defaultValue={row.jonathanRank ?? ""}
                                        onBlur={(event) => {
                                          const raw = event.target.value.trim();
                                          void updateDoc(doc(db, "powerNowNights", pitcher.nightId, "pitchers", pitcher.id), {
                                            jonathanRank: raw ? Number(raw) : deleteField(),
                                          });
                                        }}
                                      />
                                    ) : (row.jonathanRank ?? "—")
                                  ) : (row.criterionAverages[step] ?? 0).toFixed(1)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
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
                      <th scope="col">Weighted score</th>
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
                      <th scope="row">Average weighted score</th>
                      {group.criterionTotals.map((criterion) => <td key={criterion.id}>{criterion.average.toFixed(1)}</td>)}
                      <td>{group.weightedAverage.toFixed(1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <h3>Comments for the founder</h3>
              <p className="pn-help">Jonathan releases these to the founder. Hosts can read them here before that.</p>
              {group.scores.some((score) => score.founderStrength || score.founderNextStep) ? (
                <ul className="pn-readonly">
                  {group.scores.filter((score) => score.founderStrength || score.founderNextStep).map((score) => (
                    <li key={`${score.id}-founder`}>
                      <p><strong>{judges[score.judgeUid] || score.judgeUid}</strong></p>
                      {score.founderStrength ? <p>Strength: {score.founderStrength}</p> : null}
                      {score.founderNextStep ? <p>Next step: {score.founderNextStep}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="pn-note">No founder comments yet.</p>}
              {isAdmin ? (
                <>
                  <h3>Private notes</h3>
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
