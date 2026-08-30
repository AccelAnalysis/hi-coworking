const HC_LAUNCH_AT = new Date("2026-10-01T00:00:00-04:00").getTime();

function getCountdownValues() {
  const remaining = Math.max(0, HC_LAUNCH_AT - Date.now());
  return {
    days: String(Math.floor(remaining / 86_400_000)).padStart(2, "0"),
    hours: String(Math.floor((remaining % 86_400_000) / 3_600_000)).padStart(2, "0"),
    minutes: String(Math.floor((remaining % 3_600_000) / 60_000)).padStart(2, "0"),
    seconds: String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, "0"),
  };
}

function makeCountdownUnit(key, label) {
  const unit = document.createElement("div");
  unit.className = "hc-scroll-countdown__unit";
  unit.dataset.unit = key;

  const face = document.createElement("div");
  face.className = "hc-scroll-countdown__face";

  const value = document.createElement("strong");
  value.textContent = "00";
  face.append(value);

  const caption = document.createElement("span");
  caption.className = "hc-scroll-countdown__label";
  caption.textContent = label;

  unit.append(face, caption);
  return unit;
}

function setUnitValue(unit, nextValue) {
  const value = unit.querySelector(".hc-scroll-countdown__face strong");
  if (value) value.textContent = nextValue;
}

function viewportPerspective(element) {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
  const center = rect.top + rect.height / 2;
  return Math.max(-1, Math.min(1, (viewportHeight / 2 - center) / (viewportHeight * 0.56)));
}

function startScrollPerspective(reducedMotion) {
  const shell = document.querySelector("[data-hc-perspective]");
  const clock = document.querySelector("[data-hc-countdown-clock]");
  if (!shell || !clock || reducedMotion) return;

  let frame = 0;

  const update = () => {
    frame = 0;
    const progress = viewportPerspective(shell);
    const tilt = progress * 26;
    const yaw = -tilt * 0.12;
    clock.style.setProperty("--hc-scroll-tilt", `${tilt.toFixed(2)}deg`);
    clock.style.setProperty("--hc-scroll-yaw", `${yaw.toFixed(2)}deg`);
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

  units.forEach(([key, label]) => clock.append(makeCountdownUnit(key, label)));

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const accessible = document.querySelector("[data-hc-countdown-accessible]");
  startScrollPerspective(reducedMotion);

  const tick = () => {
    const values = getCountdownValues();

    Object.entries(values).forEach(([key, value]) => {
      const unit = clock.querySelector(`[data-unit="${key}"]`);
      if (unit) setUnitValue(unit, value);
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
