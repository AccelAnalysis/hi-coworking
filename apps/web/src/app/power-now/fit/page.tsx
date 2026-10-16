"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { readPowerNowFit, type FitField, type FitForm, type FitValue } from "@/lib/powerNowFit";
import { AdminLinks, AdminRequired, PlaceholderBanner, PowerNowFrame, SignOutButton, callableMessage, useAdminGate } from "../ui";
import { FitFields } from "../fitFields";

type Founder = { personId: string; name: string; email: string; company: string };

const EMPTY_FORM: FitForm = {
  placeholder: false,
  draft: false,
  version: "",
  notice: "",
  openingScript: "",
  confidentialityNote: "",
  closingScript: "",
  closingNote: "",
  closingFollowUp: "",
  sections: [],
  items: [],
};

export default function FitConversationPage() {
  const { user, loading, isAdmin } = useAdminGate();
  const [founders, setFounders] = useState<Founder[]>([]);
  const [personId, setPersonId] = useState("");
  const [form, setForm] = useState<FitForm>(EMPTY_FORM);
  const [answers, setAnswers] = useState<Record<string, FitValue>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    const seed = httpsCallable(functions, "powerNow_seedPlaceholders");
    void seed({}).catch(() => undefined);
    const unsub = onSnapshot(doc(db, "powerNowFitQuestions", "current"), (snap) => {
      setForm(readPowerNowFit(snap.data()));
    });
    return () => unsub();
  }, [isAdmin]);

  function applyFounder(nextId: string, list: Founder[]) {
    const founder = list.find((item) => item.personId === nextId);
    setPersonId(nextId);
    setAnswers({
      rec_founder: founder?.name ?? "",
      rec_business: founder?.company ?? "",
    });
  }

  async function loadFounders() {
    setBusy(true);
    setError("");
    try {
      const list = httpsCallable<Record<string, never>, { founders: Founder[] }>(functions, "powerNow_listPitchFounders");
      const result = await list({});
      const next = result.data.founders ?? [];
      setFounders(next);
      if (!personId && next[0]) applyFounder(next[0].personId, next);
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

  function changeAnswer(id: string, value: FitValue) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

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

  const sections = form.sections.length > 0
    ? form.sections
    : [{ id: "", title: "" }];
  const itemsFor = (sectionId: string): FitField[] => (
    sectionId ? form.items.filter((item) => item.section === sectionId) : form.items
  );

  return (
    <PowerNowFrame
      title="Fit conversation"
      lede="Choose a founder from the Power NOW pitch list, answer the fit questions, and save the note on their Attio record."
    >
      <AdminLinks />
      {!isAdmin ? <AdminRequired loading={loading} signedIn={Boolean(user)} /> : (
        <form onSubmit={save}>
          <SignOutButton />
          {form.placeholder ? <PlaceholderBanner notice={form.notice} /> : null}
          {!form.placeholder && form.notice ? <p className="pn-note">{form.notice}</p> : null}
          <div className="pn-field">
            <label htmlFor="founder">Founder</label>
            <select
              id="founder"
              value={personId}
              onChange={(event) => applyFounder(event.target.value, founders)}
              required
            >
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
          {form.items.length === 0 ? <p className="pn-note">The question list is not published yet.</p> : sections.map((section) => (
            <section key={section.id || "questions"}>
              {section.title ? <h2>{section.title}</h2> : null}
              {section.id === "questions" ? (
                <CallScript quote={form.openingScript} note={form.confidentialityNote} />
              ) : null}
              <FitFields
                items={itemsFor(section.id)}
                answers={answers}
                disabled={busy}
                onChange={changeAnswer}
              />
              {section.id === "questions" ? (
                <CallScript quote={form.closingScript} note={form.closingNote} follow={form.closingFollowUp} />
              ) : null}
            </section>
          ))}
          {error ? <p className="pn-alert" role="alert">{error}</p> : null}
          {status ? <p className="pn-status" role="status">{status}</p> : null}
          <div className="pn-actions">
            <button className="pn-btn pn-btn-primary" type="submit" disabled={busy || form.items.length === 0}>
              Save the note
            </button>
          </div>
        </form>
      )}
    </PowerNowFrame>
  );
}

function CallScript({ quote, note, follow }: { quote: string; note: string; follow?: string }) {
  if (!quote && !note && !follow) return null;
  return (
    <div className="pn-script">
      {quote ? <blockquote>{quote}</blockquote> : null}
      {note ? <p>{note}</p> : null}
      {follow ? <blockquote>{follow}</blockquote> : null}
    </div>
  );
}
