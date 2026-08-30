const HC_LAUNCH_AT = new Date("2026-10-01T00:00:00-04:00").getTime();

function makeCountdownUnit(key, label, index) {
  const unit = document.createElement("div");
  unit.className = "hc-countdown__unit";
  unit.dataset.unit = key;
  unit.dataset.value = "";
  unit.style.setProperty("--hc-index", String(index));

  const plate = document.createElement("div");
  plate.className = "hc-countdown__plate";

  const valueStack = document.createElement("div");
  valueStack.className = "hc-countdown__value-stack";

  const value = document.createElement("span");
  value.className = "hc-countdown__value";
  value.textContent = "00";
  valueStack.append(value);

  const caption = document.createElement("span");
  caption.className = "hc-countdown__label";
  caption.textContent = label;

  plate.append(valueStack, caption);
  unit.append(plate);
  return unit;
}

function setUnitValue(unit, nextValue, reducedMotion) {
  const previousValue = unit.dataset.value;
  const stack = unit.querySelector(".hc-countdown__value-stack");
  if (!stack) return;

  if (!previousValue) {
    const current = stack.querySelector(".hc-countdown__value");
    if (current) current.textContent = nextValue;
    unit.dataset.value = nextValue;
    return;
  }

  if (previousValue === nextValue) return;

  if (reducedMotion) {
    const current = stack.querySelector(".hc-countdown__value");
    if (current) current.textContent = nextValue;
    unit.dataset.value = nextValue;
    return;
  }

  stack.querySelectorAll(".hc-countdown__value").forEach((node) => node.remove());

  const leaving = document.createElement("span");
  leaving.className = "hc-countdown__value hc-countdown__value--leaving";
  leaving.textContent = previousValue;

  const entering = document.createElement("span");
  entering.className = "hc-countdown__value hc-countdown__value--entering";
  entering.textContent = nextValue;

  stack.append(leaving, entering);
  unit.dataset.value = nextValue;

  window.setTimeout(() => {
    if (unit.dataset.value !== nextValue) return;
    stack.replaceChildren();
    const current = document.createElement("span");
    current.className = "hc-countdown__value";
    current.textContent = nextValue;
    stack.append(current);
  }, 500);
}

function startScrollPerspective(reducedMotion) {
  const stage = document.querySelector("[data-hc-perspective]");
  if (!stage || reducedMotion) return;

  let frame = 0;

  const update = () => {
    frame = 0;
    const rect = stage.getBoundingClientRect();
    const viewportHeight = Math.max(window.innerHeight, 1);
    const stageCenter = rect.top + rect.height / 2;
    const viewportCenter = viewportHeight / 2;
    const normalized = Math.max(-1, Math.min(1, (stageCenter - viewportCenter) / viewportHeight));
    stage.style.setProperty("--hc-scroll", normalized.toFixed(4));
    stage.style.setProperty("--hc-tilt", `${(-normalized * 9).toFixed(2)}deg`);
    stage.style.setProperty("--hc-shift", `${(-normalized * 7).toFixed(2)}px`);

    stage.querySelectorAll(".hc-countdown__unit").forEach((unit, index) => {
      const side = index % 2 === 0 ? 1 : -1;
      const spread = index < 2 ? -1 : 1;
      unit.style.setProperty("--hc-yaw", `${(normalized * side * 4.5).toFixed(2)}deg`);
      unit.style.setProperty("--hc-unit-depth", `${(Math.abs(normalized) * spread * 8).toFixed(2)}px`);
      unit.style.setProperty("--hc-plate-depth", `${(16 + Math.abs(normalized) * 8).toFixed(2)}px`);
      unit.style.setProperty("--hc-card-tilt", `${(-normalized * 3.5).toFixed(2)}deg`);
    });
  };

  const requestUpdate = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate, { passive: true });
}

function startCountdown() {
  const clock = document.querySelector("[data-hc-countdown-clock]");
  if (!clock) return;

  const units = [
    ["days", "Days"],
    ["hours", "Hours"],
    ["minutes", "Minutes"],
    ["seconds", "Seconds"],
  ];

  units.forEach(([key, label], index) => clock.append(makeCountdownUnit(key, label, index)));

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const accessible = document.querySelector("[data-hc-countdown-accessible]");
  startScrollPerspective(reducedMotion);

  const tick = () => {
    const remaining = Math.max(0, HC_LAUNCH_AT - Date.now());
    const values = {
      days: String(Math.floor(remaining / 86_400_000)).padStart(2, "0"),
      hours: String(Math.floor((remaining % 86_400_000) / 3_600_000)).padStart(2, "0"),
      minutes: String(Math.floor((remaining % 3_600_000) / 60_000)).padStart(2, "0"),
      seconds: String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, "0"),
    };

    Object.entries(values).forEach(([key, value]) => {
      const unit = clock.querySelector(`[data-unit="${key}"]`);
      if (unit) setUnitValue(unit, value, reducedMotion);
    });

    if (accessible) {
      accessible.textContent = `${Number(values.days)} days, ${Number(values.hours)} hours, ${Number(values.minutes)} minutes, and ${Number(values.seconds)} seconds until opening.`;
    }
  };

  tick();
  window.setInterval(tick, 1_000);
}

const PRINCIPLES = {
  "Massive Floors": {
    tone: "neutral",
    eyebrow: "Not about",
    icon: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 51V16h30v35"/><path d="M13 51h38"/><path d="M23 23h6M35 23h6M23 30h6M35 30h6M23 37h6M35 37h6"/><path d="M29 51v-7h6v7"/></svg>`,
  },
  "Calm Focus": {
    tone: "positive",
    eyebrow: "Built around",
    icon: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 40h36"/><path d="M20 40v12M44 40v12"/><path d="M24 31h14v9H24z"/><path d="M43 38V23l6-7"/><path d="M46 18h8"/><path d="M28 27h6"/></svg>`,
  },
  "Local Use": {
    tone: "featured",
    eyebrow: "Built around",
    icon: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 28h29v24H14z"/><path d="M11 28l4-10h27l4 10"/><path d="M20 52V40h9v12M34 36h5"/><path d="M49 22c0 5-6 11-6 11s-6-6-6-11a6 6 0 1 1 12 0Z"/><circle cx="43" cy="22" r="2"/></svg>`,
  },
  "Long Contracts": {
    tone: "neutral",
    eyebrow: "Not about",
    icon: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 12h20l8 8v32H18z"/><path d="M38 12v9h8"/><path d="M24 29h16M24 35h16M24 41h10"/><path d="M39 47c2-3 5-4 8-2l2 1"/><path d="M49 46l3 2-3 3"/></svg>`,
  },
};

function polishPrincipleCards() {
  const heading = Array.from(document.querySelectorAll("h2")).find(
    (node) => node.textContent?.trim() === "What is a Micro-Coworking Space?"
  );
  const section = heading?.closest("section");
  if (!section) return false;

  let polished = 0;

  Object.entries(PRINCIPLES).forEach(([title, config]) => {
    const titleNode = Array.from(section.querySelectorAll("div")).find(
      (node) => node.children.length === 0 && node.textContent?.trim() === title
    );
    const card = titleNode?.parentElement;
    if (!titleNode || !card) return;

    card.classList.add("hc-principle", `hc-principle--${config.tone}`);
    titleNode.classList.add("hc-principle__title");
    titleNode.dataset.hcEyebrow = config.eyebrow;

    const originalIcon = Array.from(card.children).find(
      (child) => child !== titleNode && !child.classList.contains("hc-principle__icon")
    );
    if (originalIcon) originalIcon.classList.add("hc-principle__original-icon");

    if (!card.querySelector(".hc-principle__icon")) {
      const icon = document.createElement("div");
      icon.className = "hc-principle__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = config.icon;
      card.insertBefore(icon, card.firstChild);
    }

    polished += 1;
  });

  return polished === Object.keys(PRINCIPLES).length;
}

startCountdown();

if (!polishPrincipleCards()) {
  const observer = new MutationObserver(() => {
    if (polishPrincipleCards()) observer.disconnect();
  });
  observer.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 15_000);
}
