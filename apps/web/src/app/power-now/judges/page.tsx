"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { AdminLinks, AdminRequired, PowerNowFrame, SignOutButton, callableMessage, useAdminGate } from "../ui";

type Judge = { uid: string; email: string; active: boolean };
type Night = { id: string; label: string; locked: boolean };
type Founder = { personId: string; name: string; email: string; company: string };
type SelectedPitcher = { id: string; name: string; email: string; company: string };

export default function JudgesPage() {
  const { user, loading, isAdmin } = useAdminGate();
  const [judges, setJudges] = useState<Judge[]>([]);
  const [nights, setNights] = useState<Night[]>([]);
  const [founders, setFounders] = useState<Founder[]>([]);
  const [judgeEmail, setJudgeEmail] = useState("");
  const [nightId, setNightId] = useState("");
  const [nightLabel, setNightLabel] = useState("");
  const [selectedNight, setSelectedNight] = useState("");
  const [founderId, setFounderId] = useState("");
  const [pitchers, setPitchers] = useState<SelectedPitcher[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    const seed = httpsCallable(functions, "powerNow_seedPlaceholders");
    void seed({}).catch(() => undefined);
    const unsubJudges = onSnapshot(collection(db, "powerNowJudges"), (snap) => {
      setJudges(snap.docs.map((item) => {
        const data = item.data() as { email?: string; active?: boolean };
        return { uid: item.id, email: data.email || "", active: data.active === true };
      }));
    });
    const unsubNights = onSnapshot(collection(db, "powerNowNights"), (snap) => {
      const next = snap.docs.map((item) => {
        const data = item.data() as { label?: string; locked?: boolean };
        return { id: item.id, label: data.label || item.id, locked: data.locked === true };
      });
      setNights(next);
      setSelectedNight((current) => current || next[0]?.id || "");
    });
    return () => {
      unsubJudges();
      unsubNights();
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const list = httpsCallable<Record<string, never>, { founders: Founder[] }>(functions, "powerNow_listPitchFounders");
    void list({}).then((result) => setFounders(result.data.founders ?? [])).catch(() => undefined);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !selectedNight) {
      setPitchers([]);
      return;
    }
    const unsub = onSnapshot(collection(db, "powerNowNights", selectedNight, "pitchers"), (snap) => {
      setPitchers(snap.docs.map((item) => {
        const data = item.data() as { name?: string; email?: string; company?: string; selected?: boolean };
        return {
          id: item.id,
          name: data.name || "Unnamed founder",
          email: data.email || "",
          company: data.company || "",
        };
      }));
    });
    return () => unsub();
  }, [isAdmin, selectedNight]);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
      setStatus(message);
    } catch (caught) {
      setError(callableMessage(caught, "That change could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PowerNowFrame
      title="Judges and pitchers"
      lede="Add the judges who score a night, and mark the founders who are selected to pitch. Each person signs in with their own email link."
    >
      <AdminLinks />
      {!isAdmin ? <AdminRequired loading={loading} signedIn={Boolean(user)} /> : (
        <div className="pn-split">
          <SignOutButton />
          <form onSubmit={(event) => {
            event.preventDefault();
            const add = httpsCallable(functions, "powerNow_addJudge");
            void run(() => add({ email: judgeEmail }), "Judge added.");
          }}>
            <h2>Judges</h2>
            <div className="pn-field">
              <label htmlFor="judge-email">Judge email</label>
              <input id="judge-email" type="email" required value={judgeEmail} onChange={(event) => setJudgeEmail(event.target.value)} />
            </div>
            <div className="pn-actions">
              <button className="pn-btn pn-btn-primary" type="submit" disabled={busy}>Add judge</button>
            </div>
            {judges.length === 0 ? <p className="pn-note">No judges yet.</p> : (
              <ul className="pn-readonly">
                {judges.map((judge) => (
                  <li key={judge.uid}>
                    <p>{judge.email || judge.uid} {judge.active ? "" : "(removed)"}</p>
                    {judge.active ? (
                      <button
                        className="pn-btn pn-btn-outline"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const remove = httpsCallable(functions, "powerNow_removeJudge");
                          void run(() => remove({ uid: judge.uid }), "Judge removed.");
                        }}
                      >
                        Remove judge
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </form>

          <form onSubmit={(event) => {
            event.preventDefault();
            const save = httpsCallable(functions, "powerNow_saveNight");
            void run(async () => {
              await save({ nightId, label: nightLabel });
              setSelectedNight(nightId.trim());
            }, "Pitch night saved.");
          }}>
            <h2>Pitch night</h2>
            <div className="pn-field">
              <label htmlFor="night-id">Night id</label>
              <span className="pn-help">Letters, numbers, and hyphens. Example: 2026-11-12.</span>
              <input id="night-id" required value={nightId} onChange={(event) => setNightId(event.target.value)} />
            </div>
            <div className="pn-field">
              <label htmlFor="night-label">Night name</label>
              <input id="night-label" required value={nightLabel} onChange={(event) => setNightLabel(event.target.value)} />
            </div>
            <div className="pn-actions">
              <button className="pn-btn pn-btn-primary" type="submit" disabled={busy}>Save night</button>
            </div>
          </form>

          <form onSubmit={(event) => {
            event.preventDefault();
            const founder = founders.find((item) => item.personId === founderId);
            if (!founder || !selectedNight) {
              setError("Choose a night and a founder.");
              return;
            }
            const select = httpsCallable(functions, "powerNow_setSelectedPitcher");
            void run(() => select({
              nightId: selectedNight,
              pitcherId: founder.personId,
              name: founder.name,
              email: founder.email,
              company: founder.company,
              attioPersonId: founder.personId,
              selected: true,
            }), "Pitcher selected for this night.");
          }}>
            <h2>Selected pitchers</h2>
            <div className="pn-field">
              <label htmlFor="selected-night">Night</label>
              <select id="selected-night" value={selectedNight} onChange={(event) => setSelectedNight(event.target.value)}>
                <option value="">Choose a night</option>
                {nights.map((night) => (
                  <option key={night.id} value={night.id}>{night.label}{night.locked ? " (locked)" : ""}</option>
                ))}
              </select>
            </div>
            <div className="pn-field">
              <label htmlFor="selected-founder">Founder</label>
              <select id="selected-founder" value={founderId} onChange={(event) => setFounderId(event.target.value)}>
                <option value="">Choose a founder</option>
                {founders.map((founder) => (
                  <option key={founder.personId} value={founder.personId}>
                    {[founder.name || "Unnamed founder", founder.email].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </div>
            {pitchers.length === 0 ? <p className="pn-note">No selected pitchers for this night.</p> : (
              <ul className="pn-readonly">
                {pitchers.map((pitcher) => (
                  <li key={pitcher.id}>
                    <p>{[pitcher.name, pitcher.company, pitcher.email].filter(Boolean).join(", ")}</p>
                    <button
                      className="pn-btn pn-btn-outline"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const select = httpsCallable(functions, "powerNow_setSelectedPitcher");
                        void run(() => select({
                          nightId: selectedNight,
                          pitcherId: pitcher.id,
                          name: pitcher.name,
                          email: pitcher.email,
                          company: pitcher.company,
                          selected: false,
                        }), "Pitcher removed from this night.");
                      }}
                    >
                      Remove from this night
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="pn-actions">
              <button className="pn-btn pn-btn-primary" type="submit" disabled={busy}>Mark as selected pitcher</button>
              <button
                className="pn-btn pn-btn-outline"
                type="button"
                disabled={busy || !selectedNight}
                onClick={() => {
                  const night = nights.find((item) => item.id === selectedNight);
                  const lock = httpsCallable(functions, "powerNow_lockNight");
                  void run(() => lock({ nightId: selectedNight, locked: !night?.locked }), night?.locked ? "Night unlocked." : "Night locked.");
                }}
              >
                {nights.find((item) => item.id === selectedNight)?.locked ? "Unlock this night" : "Lock this night"}
              </button>
            </div>
          </form>
          {error ? <p className="pn-alert" role="alert">{error}</p> : null}
          {status ? <p className="pn-status" role="status">{status}</p> : null}
        </div>
      )}
    </PowerNowFrame>
  );
}
