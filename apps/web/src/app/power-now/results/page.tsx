"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminLinks, AdminRequired, PowerNowFrame, SignOutButton, useAdminGate } from "../ui";

type Point = { criterionId: string; value: number };
type Score = { id: string; nightId: string; pitcherId: string; judgeUid: string; points: Point[] };
type Pitcher = { id: string; nightId: string; name: string; company: string };
type Criterion = { id: string; label: string };

export default function ResultsPage() {
  const { user, loading, isAdmin } = useAdminGate();
  const [scores, setScores] = useState<Score[]>([]);
  const [pitchers, setPitchers] = useState<Pitcher[]>([]);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    const unsubScores = onSnapshot(collection(db, "powerNowScores"), (snap) => {
      setScores(snap.docs.map((item) => {
        const data = item.data() as { nightId?: string; pitcherId?: string; judgeUid?: string; points?: Point[] };
        return {
          id: item.id,
          nightId: data.nightId || "",
          pitcherId: data.pitcherId || "",
          judgeUid: data.judgeUid || "",
          points: Array.isArray(data.points) ? data.points : [],
        };
      }));
    }, () => setError("Live results could not be loaded."));
    const unsubCriteria = onSnapshot(doc(db, "powerNowCriteria", "current"), (snap) => {
      const items = snap.data()?.items;
      setCriteria(Array.isArray(items) ? items as Criterion[] : []);
    });
    return () => {
      unsubScores();
      unsubCriteria();
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
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
  }, [isAdmin]);

  const rows = useMemo(() => {
    const groups = new Map<string, Score[]>();
    for (const score of scores) {
      const key = `${score.nightId}:${score.pitcherId}`;
      groups.set(key, [...(groups.get(key) ?? []), score]);
    }
    return [...groups.entries()].map(([key, group]) => {
      const [nightId, pitcherId] = key.split(":");
      const pitcher = pitchers.find((item) => item.nightId === nightId && item.id === pitcherId);
      const judgeCount = group.length;
      const total = group.reduce((sum, score) => sum + score.points.reduce((inner, point) => inner + Number(point.value || 0), 0), 0);
      const average = judgeCount ? total / judgeCount : 0;
      const byCriterion = criteria.map((criterion) => {
        const values = group.flatMap((score) => score.points.filter((point) => point.criterionId === criterion.id).map((point) => point.value));
        const criterionAverage = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        return { label: criterion.label, average: criterionAverage };
      });
      return {
        key,
        name: pitcher?.name || pitcherId,
        company: pitcher?.company || "",
        nightId,
        judgeCount,
        total,
        average,
        byCriterion,
      };
    });
  }, [criteria, pitchers, scores]);

  return (
    <PowerNowFrame
      title="Live results"
      lede="Totals and averages update as judges save scores. Pitchers cannot see this page."
    >
      <AdminLinks />
      {!isAdmin ? <AdminRequired loading={loading} signedIn={Boolean(user)} /> : (
        <div aria-live="polite">
          <SignOutButton />
          {error ? <p className="pn-alert" role="alert">{error}</p> : null}
          {rows.length === 0 ? <p className="pn-note">No scores yet.</p> : (
            <div className="pn-table-wrap">
              <table className="pn-table">
                <caption className="pn-help">Per-pitcher totals and averages for the open scores.</caption>
                <thead>
                  <tr>
                    <th scope="col">Pitcher</th>
                    <th scope="col">Night</th>
                    <th scope="col">Judges</th>
                    <th scope="col">Total</th>
                    <th scope="col">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.name}{row.company ? `, ${row.company}` : ""}</th>
                      <td>{row.nightId}</td>
                      <td>{row.judgeCount}</td>
                      <td>{row.total}</td>
                      <td>{row.average.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.some((row) => row.byCriterion.length > 0) ? (
            <div className="pn-table-wrap">
              <table className="pn-table">
                <caption className="pn-help">Average by criterion.</caption>
                <thead>
                  <tr>
                    <th scope="col">Pitcher</th>
                    {criteria.map((criterion) => <th key={criterion.id} scope="col">{criterion.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.key}-criteria`}>
                      <th scope="row">{row.name}</th>
                      {row.byCriterion.map((criterion) => <td key={criterion.label}>{criterion.average.toFixed(1)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </PowerNowFrame>
  );
}
