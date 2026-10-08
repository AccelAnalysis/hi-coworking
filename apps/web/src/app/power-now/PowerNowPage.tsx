"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  BUSINESS_STAGES,
  HEARD_ABOUT_OPTIONS,
  OFFER_TYPES,
  POWER_NOW_CHANNELS,
  POWER_NOW_CONSENT_CATALOG,
  POWER_NOW_FORM,
  POWER_NOW_SEND_ERROR,
  canonicalizePowerNowPath,
  validatePowerNowPayload,
  watchUpdatePhrase,
  type PowerNowChannel,
  type PowerNowFieldErrors,
  type PowerNowPath,
} from "@/lib/powerNowLead";
import { resolvePowerNowPath } from "@/lib/powerNowLocation";
import {
  POWER_NOW_QUEUED_MESSAGE,
  enqueuePowerNow,
  flushPowerNowQueue,
  postPowerNow,
  powerNowQueueInMemory,
  type PowerNowSubmission,
} from "@/lib/powerNowQueue";
import { powerNowRecaptchaToken, preloadPowerNowRecaptcha } from "@/lib/powerNowRecaptcha";

const QUESTIONS = (
  <p>
    Questions? Email <a href="mailto:hello@accelanalysis.com">hello@accelanalysis.com</a> or call{" "}
    <a href="tel:+17572360651">(757) 236-0651</a>.
  </p>
);

type PitchDraft = {
  name: string;
  email: string;
  phone: string;
  business: string;
  city: string;
  stage: string;
  stageOther: string;
  does: string;
  pitch: string;
  progress: string;
  heard: string;
  heardOther: string;
  emailConsent: boolean;
  smsConsent: boolean;
  phoneConsent: boolean;
};

type WatchDraft = {
  name: string;
  email: string;
  company: string;
  phone: string;
  emailConsent: boolean;
  smsConsent: boolean;
};

type ContributeDraft = {
  name: string;
  business: string;
  email: string;
  phone: string;
  offerType: string;
  offer: string;
  value: string;
  website: string;
  heard: string;
  heardOther: string;
  emailConsent: boolean;
  smsConsent: boolean;
  phoneConsent: boolean;
};

const EMPTY_PITCH: PitchDraft = {
  name: "",
  email: "",
  phone: "",
  business: "",
  city: "",
  stage: "",
  stageOther: "",
  does: "",
  pitch: "",
  progress: "",
  heard: "",
  heardOther: "",
  emailConsent: false,
  smsConsent: false,
  phoneConsent: false,
};

const EMPTY_WATCH: WatchDraft = {
  name: "",
  email: "",
  company: "",
  phone: "",
  emailConsent: false,
  smsConsent: false,
};

const EMPTY_CONTRIBUTE: ContributeDraft = {
  name: "",
  business: "",
  email: "",
  phone: "",
  offerType: "",
  offer: "",
  value: "",
  website: "",
  heard: "",
  heardOther: "",
  emailConsent: false,
  smsConsent: false,
  phoneConsent: false,
};

type Receipt = {
  id: string;
  state: "synced" | "queued";
  path: PowerNowPath;
  firstName: string;
  email: string;
  business: string;
  channels: string;
};

const PATHS: Array<{ id: PowerNowPath; title: string; body: string }> = [
  {
    id: "pitch",
    title: "Apply to pitch",
    body: "Tell us what you’re building. Every pitch starts with a short conversation with us about fit and timing. Joining the pitch interest list doesn’t reserve a pitch slot.",
  },
  {
    id: "watch",
    title: "Get pitch-night updates",
    body: "Hear about upcoming Power NOW pitch nights and how to join online.",
  },
  {
    id: "contribute",
    title: "Contribute to the prize pack",
    body: "Local businesses can contribute a product, service, or experience to the Power NOW prize pack.",
  },
];

export function PowerNowPage() {
  const [active, setActive] = useState<PowerNowPath | null>(null);
  const [pitch, setPitch] = useState<PitchDraft>(EMPTY_PITCH);
  const [watch, setWatch] = useState<WatchDraft>(EMPTY_WATCH);
  const [contribute, setContribute] = useState<ContributeDraft>(EMPTY_CONTRIBUTE);
  const [honeypot, setHoneypot] = useState("");
  const [fieldErrors, setFieldErrors] = useState<PowerNowFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [memoryWarning, setMemoryWarning] = useState(false);
  const startedAt = useRef(new Date().toISOString());

  useEffect(() => {
    preloadPowerNowRecaptcha();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = canonicalizePowerNowPath(params.get("path"));
    if (params.has("path") && !fromQuery) {
      params.delete("path");
      const query = params.toString();
      window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
    }
    const path = fromQuery ?? resolvePowerNowPath(window.location.pathname, "");
    if (path) {
      setActive(path);
      window.setTimeout(() => scrollToPath(path), 0);
    }

    const applyFlush = (result: { syncedIds: string[] }) => {
      setReceipt((current) =>
        current && current.state === "queued" && result.syncedIds.includes(current.id)
          ? { ...current, state: "synced" }
          : current,
      );
    };
    const onOnline = () => {
      void flushPowerNowQueue().then(applyFlush);
    };
    window.addEventListener("online", onOnline);
    void flushPowerNowQueue().then(applyFlush);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  function openPath(path: PowerNowPath) {
    setActive(path);
    setFieldErrors({});
    setFormError(null);
    if (receipt?.path !== path) setReceipt(null);
    const params = new URLSearchParams(window.location.search);
    params.set("path", path);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
    window.setTimeout(() => scrollToPath(path), 0);
  }

  async function submit(path: PowerNowPath, payload: PowerNowSubmission, form: HTMLFormElement) {
    setFormError(null);
    const validated = validatePowerNowPayload(payload);
    if (!validated.ok) {
      setFieldErrors(validated.fields);
      focusField(form, Object.keys(validated.fields)[0]);
      return;
    }
    setFieldErrors({});
    const recaptchaToken = await powerNowRecaptchaToken();
    const outbound: PowerNowSubmission = {
      ...payload,
      pnStartedAt: startedAt.current,
      recaptchaToken,
    };
    setSaving(true);
    const receiptBase: Receipt = {
      id: payload.clientSubmissionId,
      state: "synced",
      path,
      firstName: validated.lead.firstName,
      email: validated.lead.email,
      business: validated.lead.companyName ?? "",
      channels: watchUpdatePhrase(
        validated.lead.consent.some((item) => item.key === "email" && item.optIn),
        validated.lead.consent.some((item) => item.key === "sms" && item.optIn),
      ),
    };
    try {
      if (!navigator.onLine) {
        await enqueuePowerNow(outbound);
        setMemoryWarning(powerNowQueueInMemory());
        setReceipt({ ...receiptBase, state: "queued" });
        clearPath(path);
        return;
      }
      const outcome = await postPowerNow(outbound);
      if (outcome.decision === "saved") {
        setReceipt(receiptBase);
        clearPath(path);
        return;
      }
      if (outcome.decision === "queue") {
        await enqueuePowerNow(outbound, outcome.error);
        setMemoryWarning(powerNowQueueInMemory());
        setReceipt({ ...receiptBase, state: "queued" });
        clearPath(path);
        return;
      }
      if (outcome.fields) {
        setFieldErrors(outcome.fields);
        focusField(form, Object.keys(outcome.fields)[0]);
      }
      setFormError(outcome.error || POWER_NOW_SEND_ERROR);
    } catch {
      setFormError(POWER_NOW_SEND_ERROR);
    } finally {
      setSaving(false);
    }
  }

  function clearPath(path: PowerNowPath) {
    setHoneypot("");
    if (path === "pitch") setPitch(EMPTY_PITCH);
    if (path === "watch") setWatch(EMPTY_WATCH);
    if (path === "contribute") setContribute(EMPTY_CONTRIBUTE);
  }

  async function tryAgain() {
    setSaving(true);
    try {
      const result = await flushPowerNowQueue({ force: true });
      setReceipt((current) =>
        current && result.syncedIds.includes(current.id) ? { ...current, state: "synced" } : current,
      );
      const blocked = result.leads.find((lead) => lead.clientSubmissionId === receipt?.id && lead.status === "needs_attention");
      if (blocked) setFormError(blocked.lastError || POWER_NOW_SEND_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <a className="pn-skip" href="#paths">
        Skip to the ways to take part
      </a>
      <header className="pn-header">
        <div className="pn-wrap">
          <div className="pn-lockup-wrap">
            <img
              className="pn-lockup"
              src="/power-now/power-now-logo-lockup.jpg"
              width={1209}
              height={430}
              alt="POWER NOW logo"
            />
          </div>
          <p className="pn-presented">Power NOW Pitch Competition presented by Accel Analysis</p>
        </div>
      </header>

      <main>
        <div className="pn-hero">
          <div className="pn-wrap">
            <h1>Power NOW starts with a conversation</h1>
            <div className="pn-intro">
              <p>
                Power NOW is a virtual pitch competition for local entrepreneurs who are building a business, presented
                by Accel Analysis. Upcoming pitch nights are held online through the year.
              </p>
              <p>Join the list to pitch your business, watch a pitch night, or contribute to the prize pack.</p>
            </div>
            <a
              className="pn-btn pn-btn-primary"
              href="#paths"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById("paths")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
              }}
            >
              Join the Power NOW list
            </a>
          </div>
        </div>

        <section className="pn-section pn-ice" aria-labelledby="how-heading">
          <div className="pn-wrap">
            <h2 className="pn-section-title" id="how-heading">
              Pitch path: how it works
            </h2>
            <ol className="pn-steps">
              <li className="pn-step">
                <span className="pn-num" aria-hidden="true" />
                <div>
                  <h3>Join the pitch interest list.</h3>
                  <p>Tell us about your business and what you’d pitch.</p>
                </div>
              </li>
              <li className="pn-step">
                <span className="pn-num" aria-hidden="true" />
                <div>
                  <h3>Talk with us.</h3>
                  <p>We’ll reach out to set up a short conversation about your business, fit, and timing.</p>
                </div>
              </li>
              <li className="pn-step">
                <span className="pn-num" aria-hidden="true" />
                <div>
                  <h3>Pick your night together.</h3>
                  <p>If it’s a good fit, we’ll agree on which pitch night works and what to prepare.</p>
                </div>
              </li>
              <li className="pn-step">
                <span className="pn-num" aria-hidden="true" />
                <div>
                  <h3>Get ready to pitch.</h3>
                  <p>You’ll receive the details and a short tech check before your night.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="pn-section" id="paths" aria-labelledby="paths-heading">
          <div className="pn-wrap">
            <h2 className="pn-section-title" id="paths-heading">
              Choose how you’d like to take part
            </h2>
            <div className="pn-cards">
              {PATHS.map((item) => (
                <div className={active === item.id ? "pn-card pn-card-active" : "pn-card"} key={item.id} id={`card-${item.id}`}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <button
                    type="button"
                    className="pn-btn pn-btn-outline"
                    aria-controls={`form-${item.id}`}
                    aria-expanded={active === item.id}
                    onClick={() => openPath(item.id)}
                  >
                    {item.title}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="pn-wrap">
            <PitchPanel
              open={active === "pitch"}
              draft={pitch}
              setDraft={setPitch}
              errors={fieldErrors}
              formError={active === "pitch" ? formError : null}
              saving={saving}
              honeypot={honeypot}
              setHoneypot={setHoneypot}
              receipt={receipt?.path === "pitch" ? receipt : null}
              memoryWarning={memoryWarning}
              onTryAgain={() => void tryAgain()}
              onSubmit={(event) => {
                const payload = basePayload("pitch", {
                  fullName: pitch.name,
                  email: pitch.email,
                  phone: pitch.phone,
                  businessName: pitch.business,
                  city: pitch.city,
                  businessStage: pitch.stage,
                  businessStageOther: pitch.stageOther,
                  businessDescription: pitch.does,
                  pitchTopic: pitch.pitch,
                  progress: pitch.progress,
                  heardAbout: pitch.heard,
                  heardAboutOther: pitch.heardOther,
                  consent: { email: pitch.emailConsent, sms: pitch.smsConsent, phone: pitch.phoneConsent },
                  expo_hp: honeypot,
                });
                void submit("pitch", payload, event.currentTarget);
              }}
            />
            <WatchPanel
              open={active === "watch"}
              draft={watch}
              setDraft={setWatch}
              errors={fieldErrors}
              formError={active === "watch" ? formError : null}
              saving={saving}
              honeypot={honeypot}
              setHoneypot={setHoneypot}
              receipt={receipt?.path === "watch" ? receipt : null}
              memoryWarning={memoryWarning}
              onTryAgain={() => void tryAgain()}
              onSubmit={(event) => {
                const payload = basePayload("watch", {
                  fullName: watch.name,
                  email: watch.email,
                  phone: watch.phone,
                  company: watch.company,
                  consent: { email: watch.emailConsent, sms: watch.smsConsent, phone: false },
                  expo_hp: honeypot,
                });
                void submit("watch", payload, event.currentTarget);
              }}
            />
            <ContributePanel
              open={active === "contribute"}
              draft={contribute}
              setDraft={setContribute}
              errors={fieldErrors}
              formError={active === "contribute" ? formError : null}
              saving={saving}
              honeypot={honeypot}
              setHoneypot={setHoneypot}
              receipt={receipt?.path === "contribute" ? receipt : null}
              memoryWarning={memoryWarning}
              onTryAgain={() => void tryAgain()}
              onSubmit={(event) => {
                const payload = basePayload("contribute", {
                  fullName: contribute.name,
                  email: contribute.email,
                  phone: contribute.phone,
                  businessName: contribute.business,
                  offerType: contribute.offerType,
                  offerDescription: contribute.offer,
                  approximateValue: contribute.value,
                  website: contribute.website,
                  heardAbout: contribute.heard,
                  heardAboutOther: contribute.heardOther,
                  consent: {
                    email: contribute.emailConsent,
                    sms: contribute.smsConsent,
                    phone: contribute.phoneConsent,
                  },
                  expo_hp: honeypot,
                });
                void submit("contribute", payload, event.currentTarget);
              }}
            />
          </div>
        </section>

        <section className="pn-privacy-section" id="privacy">
          <div className="pn-wrap">
            <div className="pn-privacy">
              <p>
                <strong>How we use your information.</strong> Accel Analysis uses what you share here to respond to your
                request and contact you about Power NOW in the ways you choose. Your information is kept in our contact
                records and seen only by the people at Accel Analysis who handle Power NOW. We don’t sell personal data.
                To see, correct, or delete your information, or to stop hearing from us, email{" "}
                <a href="mailto:hello@accelanalysis.com">hello@accelanalysis.com</a> or call{" "}
                <a href="tel:+17572360651">(757) 236-0651</a>.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="pn-footer">
        <div className="pn-wrap">
          <img
            className="pn-mark"
            src="/power-now/accel-analysis-mark.png"
            width={327}
            height={300}
            alt="Accel Analysis"
          />
          <p className="pn-presented">Power NOW Pitch Competition presented by Accel Analysis</p>
          <p className="pn-line">
            <span>Accel Analysis</span>
            <span className="pn-sep">·</span>
            <span>15373 Carrollton Blvd, Carrollton, VA 23314</span>
          </p>
          <p className="pn-line">
            <span>
              <a href="tel:+17572360651">(757) 236-0651</a>
            </span>
            <span className="pn-sep">·</span>
            <span>
              <a href="mailto:hello@accelanalysis.com">hello@accelanalysis.com</a>
            </span>
            <span className="pn-sep">·</span>
            <span>
              <a href="https://accelanalysis.com">accelanalysis.com</a>
            </span>
          </p>
          <p className="pn-tagline">Clarity. Strategy. Execution.</p>
          <p>
            <a href="#privacy">Privacy</a>
          </p>
        </div>
      </footer>
    </>
  );
}

function PitchPanel(props: PanelProps<PitchDraft>) {
  const { draft, setDraft } = props;
  return (
    <PanelShell {...props} title="Apply to pitch" submitLabel="Send my pitch interest">
      <p className="pn-req">Fields marked * are required. Please don’t include confidential information.</p>
      <TextField id="p-name" field="name" label="Your name *" help="First and last name." autoComplete="name" value={draft.name} error={props.errors.name} onChange={(name) => setDraft({ ...draft, name })} />
      <TextField id="p-email" field="email" label="Email *" help="We’ll use this to set up your conversation." type="email" autoComplete="email" value={draft.email} error={props.errors.email} onChange={(email) => setDraft({ ...draft, email })} />
      <TextField id="p-phone" field="phone" label="Phone" help="Optional. Required if you check text or phone below." type="tel" autoComplete="tel" value={draft.phone} error={props.errors.phone} onChange={(phone) => setDraft({ ...draft, phone })} />
      <TextField id="p-business" field="business" label="Business name *" help={'If you haven’t named it yet, write “Not named yet.”'} autoComplete="organization" value={draft.business} error={props.errors.business} onChange={(business) => setDraft({ ...draft, business })} />
      <TextField id="p-city" field="city" label="City or county *" help="Where your business is based." value={draft.city} error={props.errors.city} onChange={(city) => setDraft({ ...draft, city })} />
      <fieldset className={props.errors.stage ? "pn-choice-field pn-field-error" : "pn-choice-field"} data-field="stage">
        <legend id="p-stage-label">Business stage *</legend>
        <span className="pn-help">Pick the closest fit.</span>
        <div className="pn-choices" role="radiogroup" aria-labelledby="p-stage-label">
          {BUSINESS_STAGES.map((stage) => (
            <label className="pn-choice" key={stage}>
              <input type="radio" name="pitch-stage" value={stage} checked={draft.stage === stage} onChange={() => setDraft({ ...draft, stage })} />
              <span>
                {stage}
                {stage === "Other" && draft.stage === "Other" ? (
                  <input
                    className="pn-other"
                    type="text"
                    aria-label="Other business stage"
                    value={draft.stageOther}
                    onChange={(event) => setDraft({ ...draft, stageOther: event.target.value })}
                  />
                ) : null}
              </span>
            </label>
          ))}
        </div>
        {props.errors.stage ? <span className="pn-err" role="alert">{props.errors.stage}</span> : null}
      </fieldset>
      <LongField id="p-does" field="does" label="What does your business do, and what problem does it solve? *" help="A few sentences in plain words." value={draft.does} error={props.errors.does} onChange={(does) => setDraft({ ...draft, does })} />
      <LongField id="p-pitch" field="pitch" label="What would you pitch? *" help="The idea, product, or next step you’d present." value={draft.pitch} error={props.errors.pitch} onChange={(value) => setDraft({ ...draft, pitch: value })} />
      <LongField id="p-progress" field="progress" label="What progress have you made so far?" help="For example, customer conversations, a prototype, a pilot, or first sales." value={draft.progress} error={props.errors.progress} onChange={(progress) => setDraft({ ...draft, progress })} />
      <HeardField id="p-heard" heard={draft.heard} heardOther={draft.heardOther} error={props.errors.heard} onHeard={(heard) => setDraft({ ...draft, heard })} onOther={(heardOther) => setDraft({ ...draft, heardOther })} />
      <ConsentFields
        path="pitch"
        values={{ email: draft.emailConsent, sms: draft.smsConsent, phone: draft.phoneConsent }}
        error={props.errors.consent}
        onChange={(key, checked) =>
          setDraft({
            ...draft,
            emailConsent: key === "email" ? checked : draft.emailConsent,
            smsConsent: key === "sms" ? checked : draft.smsConsent,
            phoneConsent: key === "phone" ? checked : draft.phoneConsent,
          })
        }
      />
    </PanelShell>
  );
}

function WatchPanel(props: PanelProps<WatchDraft>) {
  const { draft, setDraft } = props;
  return (
    <PanelShell {...props} title="Get pitch-night updates" submitLabel="Get updates">
      <TextField id="w-name" field="name" label="Your name *" autoComplete="name" value={draft.name} error={props.errors.name} onChange={(name) => setDraft({ ...draft, name })} />
      <TextField id="w-email" field="email" label="Email *" type="email" autoComplete="email" value={draft.email} error={props.errors.email} onChange={(email) => setDraft({ ...draft, email })} />
      <TextField id="w-company" field="company" label="Company" autoComplete="organization" value={draft.company} error={props.errors.company} onChange={(company) => setDraft({ ...draft, company })} />
      <TextField id="w-phone" field="phone" label="Phone" help="Only needed if you’d like texts." type="tel" autoComplete="tel" value={draft.phone} error={props.errors.phone} onChange={(phone) => setDraft({ ...draft, phone })} />
      <ConsentFields
        path="watch"
        values={{ email: draft.emailConsent, sms: draft.smsConsent, phone: false }}
        error={props.errors.consent}
        onChange={(key, checked) =>
          setDraft({
            ...draft,
            emailConsent: key === "email" ? checked : draft.emailConsent,
            smsConsent: key === "sms" ? checked : draft.smsConsent,
          })
        }
      />
    </PanelShell>
  );
}

function ContributePanel(props: PanelProps<ContributeDraft>) {
  const { draft, setDraft } = props;
  return (
    <PanelShell {...props} title="Contribute to the prize pack" submitLabel="Send my offer">
      <p className="pn-lede">
        Contribute a product, service, or experience from your business to the Power NOW prize pack. We’ll follow up to
        talk through your offer and confirm the details in writing before anything is final.
      </p>
      <TextField id="c-name" field="name" label="Your name *" autoComplete="name" value={draft.name} error={props.errors.name} onChange={(name) => setDraft({ ...draft, name })} />
      <TextField id="c-business" field="business" label="Business name *" autoComplete="organization" value={draft.business} error={props.errors.business} onChange={(business) => setDraft({ ...draft, business })} />
      <TextField id="c-email" field="email" label="Email *" type="email" autoComplete="email" value={draft.email} error={props.errors.email} onChange={(email) => setDraft({ ...draft, email })} />
      <TextField id="c-phone" field="phone" label="Phone" help="Optional. Required if you check text or phone below." type="tel" autoComplete="tel" value={draft.phone} error={props.errors.phone} onChange={(phone) => setDraft({ ...draft, phone })} />
      <fieldset className={props.errors.offerType ? "pn-choice-field pn-field-error" : "pn-choice-field"} data-field="offerType">
        <legend id="c-offer-label">What would you like to offer? *</legend>
        <div className="pn-choices" role="radiogroup" aria-labelledby="c-offer-label">
          {OFFER_TYPES.map((offerType) => (
            <label className="pn-choice" key={offerType}>
              <input type="radio" name="offer-type" value={offerType} checked={draft.offerType === offerType} onChange={() => setDraft({ ...draft, offerType })} />
              <span>{offerType}</span>
            </label>
          ))}
        </div>
        {props.errors.offerType ? <span className="pn-err" role="alert">{props.errors.offerType}</span> : null}
      </fieldset>
      <LongField id="c-offer" field="offer" label="Describe your offer *" help="In your own words, including any limits, such as an expiration date or local pickup." value={draft.offer} error={props.errors.offer} onChange={(offer) => setDraft({ ...draft, offer })} />
      <TextField id="c-value" field="value" label="Approximate value" help="Only if you’d like to share it." value={draft.value} error={props.errors.value} onChange={(value) => setDraft({ ...draft, value })} />
      <TextField id="c-website" field="website" label="Business website or social link" type="url" value={draft.website} error={props.errors.website} onChange={(website) => setDraft({ ...draft, website })} />
      <HeardField id="c-heard" heard={draft.heard} heardOther={draft.heardOther} error={props.errors.heard} onHeard={(heard) => setDraft({ ...draft, heard })} onOther={(heardOther) => setDraft({ ...draft, heardOther })} />
      <ConsentFields
        path="contribute"
        values={{ email: draft.emailConsent, sms: draft.smsConsent, phone: draft.phoneConsent }}
        error={props.errors.consent}
        onChange={(key, checked) =>
          setDraft({
            ...draft,
            emailConsent: key === "email" ? checked : draft.emailConsent,
            smsConsent: key === "sms" ? checked : draft.smsConsent,
            phoneConsent: key === "phone" ? checked : draft.phoneConsent,
          })
        }
      />
    </PanelShell>
  );
}

type PanelProps<T> = {
  open: boolean;
  draft: T;
  setDraft: (next: T) => void;
  errors: PowerNowFieldErrors;
  formError: string | null;
  saving: boolean;
  honeypot: string;
  setHoneypot: (value: string) => void;
  receipt: Receipt | null;
  memoryWarning: boolean;
  onTryAgain: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function PanelShell<T>({
  open,
  title,
  submitLabel,
  errors,
  formError,
  saving,
  honeypot,
  setHoneypot,
  receipt,
  memoryWarning,
  onTryAgain,
  onSubmit,
  children,
}: PanelProps<T> & { title: string; submitLabel: string; children: ReactNode }) {
  const done = Boolean(receipt);
  return (
    <div
      className={open ? (done ? "pn-panel pn-panel-open pn-done" : "pn-panel pn-panel-open") : "pn-panel"}
      id={`form-${titleToPath(title)}`}
      tabIndex={-1}
      aria-labelledby={`h-${titleToPath(title)}`}
    >
      <form noValidate onSubmit={(event) => { event.preventDefault(); onSubmit(event); }}>
        <h2 id={`h-${titleToPath(title)}`}>{title}</h2>
        {children}
        {formError ? <p className="pn-form-error" role="alert">{formError}</p> : null}
        {errors.path ? <p className="pn-form-error" role="alert">{errors.path}</p> : null}
        <Honeypot value={honeypot} onChange={setHoneypot} />
        <div className="pn-submit">
          <button className="pn-btn pn-btn-primary" type="submit" disabled={saving}>
            {saving ? "Sending…" : submitLabel}
          </button>
          <a className="pn-privacy-link" href="#privacy">How we use your information</a>
        </div>
      </form>
      {receipt ? <Thanks receipt={receipt} memoryWarning={memoryWarning} onTryAgain={onTryAgain} /> : null}
    </div>
  );
}

function Thanks({ receipt, memoryWarning, onTryAgain }: { receipt: Receipt; memoryWarning: boolean; onTryAgain: () => void }) {
  if (receipt.state === "queued") {
    return (
      <div className="pn-thanks" role="status" aria-live="polite">
        <h3>{POWER_NOW_QUEUED_MESSAGE}</h3>
        <p>We’ll send it when you’re back online. It isn’t on the list until it sends.</p>
        {memoryWarning ? <p>This browser can’t keep that saved copy after a refresh.</p> : null}
        <button type="button" className="pn-btn pn-btn-outline" onClick={onTryAgain}>Try again</button>
        {QUESTIONS}
      </div>
    );
  }
  if (receipt.path === "pitch") {
    return (
      <div className="pn-thanks" role="status" aria-live="polite">
        <h3>Thanks, {receipt.firstName}. You’re on the Power NOW pitch interest list.</h3>
        <p>We’ll email you at {receipt.email} to set up a short conversation. Joining the list doesn’t reserve a pitch slot.</p>
        {QUESTIONS}
      </div>
    );
  }
  if (receipt.path === "watch") {
    return (
      <div className="pn-thanks" role="status" aria-live="polite">
        <h3>You’re on the Power NOW audience list, {receipt.firstName}.</h3>
        <p>We’ll send you details about upcoming Power NOW pitch nights by {receipt.channels}.</p>
        {QUESTIONS}
      </div>
    );
  }
  return (
    <div className="pn-thanks" role="status" aria-live="polite">
      <h3>Thank you, {receipt.firstName}. We received your offer from {receipt.business}.</h3>
      <p>We’ll be in touch to talk through the details and confirm them in writing.</p>
      {QUESTIONS}
    </div>
  );
}

function TextField({
  id,
  field,
  label,
  help,
  value,
  error,
  onChange,
  type = "text",
  autoComplete,
}: {
  id: string;
  field: string;
  label: string;
  help?: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "url";
  autoComplete?: string;
}) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className={error ? "pn-field pn-field-error" : "pn-field"} data-field={field}>
      <label htmlFor={id}>{label}</label>
      {help ? <span className="pn-help" id={helpId}>{help}</span> : null}
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={[help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <span className="pn-err" id={errorId} role="alert">{error}</span> : null}
    </div>
  );
}

function LongField({
  id,
  field,
  label,
  help,
  value,
  error,
  onChange,
}: {
  id: string;
  field: string;
  label: string;
  help?: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className={error ? "pn-field pn-field-error" : "pn-field"} data-field={field}>
      <label htmlFor={id}>{label}</label>
      {help ? <span className="pn-help" id={helpId}>{help}</span> : null}
      <textarea
        id={id}
        maxLength={600}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={[help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="pn-count">{value.length} / 600</span>
      {error ? <span className="pn-err" id={errorId} role="alert">{error}</span> : null}
    </div>
  );
}

function HeardField({
  id,
  heard,
  heardOther,
  error,
  onHeard,
  onOther,
}: {
  id: string;
  heard: string;
  heardOther: string;
  error?: string;
  onHeard: (value: string) => void;
  onOther: (value: string) => void;
}) {
  return (
    <div className={error ? "pn-field pn-field-error" : "pn-field"} data-field="heard">
      <label htmlFor={id}>How did you hear about Power NOW?</label>
      <select id={id} value={heard} onChange={(event) => onHeard(event.target.value)}>
        <option value="">Choose one</option>
        {HEARD_ABOUT_OPTIONS.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      {heard === "Other" ? (
        <input
          className="pn-other"
          type="text"
          aria-label="Other: how you heard about Power NOW"
          value={heardOther}
          onChange={(event) => onOther(event.target.value)}
        />
      ) : null}
      {error ? <span className="pn-err" role="alert">{error}</span> : null}
    </div>
  );
}

function ConsentFields({
  path,
  values,
  error,
  onChange,
}: {
  path: PowerNowPath;
  values: Record<PowerNowChannel, boolean>;
  error?: string;
  onChange: (key: PowerNowChannel, checked: boolean) => void;
}) {
  const catalog = POWER_NOW_CONSENT_CATALOG[path];
  const channels = POWER_NOW_CHANNELS[path];
  return (
    <fieldset className={error ? "pn-consent pn-field-error" : "pn-consent"} data-field="consent">
      <legend>{catalog.leadIn}</legend>
      {channels.map((key) => {
        const item = channelCopy(path, key);
        if (!item) return null;
        return (
          <label className="pn-check" key={key}>
            <input type="checkbox" checked={values[key]} onChange={(event) => onChange(key, event.target.checked)} />
            <span>
              <strong>{item.label}:</strong> {item.wording}
            </span>
          </label>
        );
      })}
      {error ? <span className="pn-err" role="alert">{error}</span> : null}
    </fieldset>
  );
}

function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="pn-hp" aria-hidden="true">
      <label>
        Company website
        <input
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          name="expo_hp"
        />
      </label>
    </div>
  );
}

function channelCopy(path: PowerNowPath, key: PowerNowChannel): { label: string; wording: string } | null {
  const channels = POWER_NOW_CONSENT_CATALOG[path].channels as Partial<
    Record<PowerNowChannel, { label: string; wording: string }>
  >;
  return channels[key] ?? null;
}

function titleToPath(title: string): PowerNowPath {
  if (title === "Get pitch-night updates") return "watch";
  if (title === "Contribute to the prize pack") return "contribute";
  return "pitch";
}

function basePayload(path: PowerNowPath, fields: Partial<PowerNowSubmission> & Pick<PowerNowSubmission, "fullName" | "email" | "consent" | "expo_hp">): PowerNowSubmission {
  const campaign = typeof window === "undefined"
    ? { utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", referrerPath: "" }
    : readCampaign();
  return {
    form: POWER_NOW_FORM,
    path,
    fullName: fields.fullName,
    email: fields.email,
    phone: fields.phone ?? "",
    businessName: fields.businessName ?? "",
    company: fields.company ?? "",
    city: fields.city ?? "",
    businessStage: fields.businessStage ?? "",
    businessStageOther: fields.businessStageOther ?? "",
    businessDescription: fields.businessDescription ?? "",
    pitchTopic: fields.pitchTopic ?? "",
    progress: fields.progress ?? "",
    heardAbout: fields.heardAbout ?? "",
    heardAboutOther: fields.heardAboutOther ?? "",
    offerType: fields.offerType ?? "",
    offerDescription: fields.offerDescription ?? "",
    approximateValue: fields.approximateValue ?? "",
    website: fields.website ?? "",
    consent: fields.consent,
    utmSource: campaign.utmSource,
    utmMedium: campaign.utmMedium,
    utmCampaign: campaign.utmCampaign,
    utmContent: campaign.utmContent,
    referrerPath: campaign.referrerPath,
    submittedAt: new Date().toISOString(),
    clientSubmissionId: crypto.randomUUID(),
    expo_hp: fields.expo_hp,
  };
}

function readCampaign(): Pick<PowerNowSubmission, "utmSource" | "utmMedium" | "utmCampaign" | "utmContent" | "referrerPath"> {
  const params = new URLSearchParams(window.location.search);
  let referrerPath = "";
  if (document.referrer) {
    try {
      referrerPath = new URL(document.referrer).pathname.slice(0, 120);
    } catch {
      referrerPath = "";
    }
  }
  return {
    utmSource: params.get("utm_source") ?? "",
    utmMedium: params.get("utm_medium") ?? "",
    utmCampaign: params.get("utm_campaign") ?? "",
    utmContent: params.get("utm_content") ?? "",
    referrerPath,
  };
}

function scrollToPath(path: PowerNowPath) {
  const panel = document.getElementById(`form-${path}`);
  panel?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  panel?.focus({ preventScroll: true });
}

function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function focusField(form: HTMLFormElement, field: string | undefined) {
  if (!field) return;
  const target = form.querySelector<HTMLElement>(`[data-field="${field}"]`);
  target?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  target?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
}
