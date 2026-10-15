"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { AdminLinks, AdminRequired, PlaceholderBanner, PowerNowFrame, SignOutButton, callableMessage, useAdminGate } from "../ui";

type Founder = { personId: string; name: string; email: string; company: string };
type Question = { id: string; prompt: string };

export default function FitConversationPage() {
  const { user, loading, isAdmin } = useAdminGate();
  const [founders, setFounders] = useState<Founder[]>([]);
  const [personId, setPersonId] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [placeholder, setPlaceholder] = useState(false);
  const [notice, setNotice] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    const seed = httpsCallable(functions, "powerNow_seedPlaceholders");
    void seed({}).catch(() => undefined);
    const unsub = onSnapshot(doc(db, "powerNowFitQuestions", "current"), (snap) => {
      const data = snap.data() as { placeholder?: boolean; notice?: string; items?: Question[] } | undefined;
      const items = Array.isArray(data?.items) ? data.items.filter((item) => item?.id && item?.prompt) : [];
      setQuestions(items);
      setPlaceholder(data?.placeholder === true);
      setNotice(typeof data?.notice === "string" ? data.notice : "");
    });
    return () => unsub();
  }, [isAdmin]);

  async function loadFounders() {
    setBusy(true);
    setError("");
    try {
      const list = httpsCallable<Record<string, never>, { founders: Founder[] }>(functions, "powerNow_listPitchFounders");
      const result = await list({});
      setFounders(result.data.founders ?? []);
      if (!personId && result.data.founders?.[0]) setPersonId(result.data.founders[0].personId);
    } catch (caught) {
      setError(callableMessage(caught, "The pitch list could not be read."));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (isAdmin) void loadFounders();
    // Load once when admin access is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const founder = founders.find((item) => item.personId === personId);
    if (!founder) {
      setError("Choose a founder from the pitch list.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const saveNote = httpsCallable(functions, "powerNow_saveFitNote");
      await saveNote({
        personId: founder.personId,
        founderName: founder.name,
        company: founder.company,
        answers,
      });
      setStatus("Saved as a note on that person's Attio record.");
    } catch (caught) {
      setError(callableMessage(caught, "The fit conversation note could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PowerNowFrame
      title="Fit conversation"
      lede="Choose a founder from the Power NOW pitch list, answer the fit questions, and save the note on their Attio record."
    >
      <AdminLinks />
      {!isAdmin ? <AdminRequired loading={loading} signedIn={Boolean(user)} /> : (
        <form onSubmit={save}>
          <SignOutButton />
          {placeholder ? <PlaceholderBanner notice={notice} /> : null}
          <div className="pn-field">
            <label htmlFor="founder">Founder</label>
            <select id="founder" value={personId} onChange={(event) => setPersonId(event.target.value)} required>
              <option value="">Choose a founder</option>
              {founders.map((founder) => (
                <option key={founder.personId} value={founder.personId}>
                  {[founder.name || "Unnamed founder", founder.company, founder.email].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          </div>
          <div className="pn-actions">
            <button className="pn-btn pn-btn-outline" type="button" onClick={() => void loadFounders()} disabled={busy}>
              Refresh the pitch list
            </button>
          </div>
          {questions.length === 0 ? <p className="pn-note">The question list is not published yet.</p> : questions.map((question) => (
            <div className="pn-field" key={question.id}>
              <label htmlFor={`q-${question.id}`}>{question.prompt}</label>
              <textarea
                id={`q-${question.id}`}
                required
                value={answers[question.id] ?? ""}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              />
            </div>
          ))}
          {error ? <p className="pn-alert" role="alert">{error}</p> : null}
          {status ? <p className="pn-status" role="status">{status}</p> : null}
          <div className="pn-actions">
            <button className="pn-btn pn-btn-primary" type="submit" disabled={busy || questions.length === 0}>
              Save the note
            </button>
          </div>
        </form>
      )}
    </PowerNowFrame>
  );
}
