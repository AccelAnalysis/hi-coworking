const HC_LAUNCH_AT = new Date("2026-10-01T00:00:00-04:00").getTime();

function makeDigitCard() {
  const card = document.createElement("div");
  card.className = "hc-countdown__flip-card";
  card.dataset.value = "";
  card.innerHTML = `
    <div class="hc-countdown__half hc-countdown__top"><span>0</span></div>
    <div class="hc-countdown__half hc-countdown__bottom"><span>0</span></div>
  `;
  return card;
}

function makeCountdownUnit(key, label) {
  const unit = document.createElement("div");
  unit.className = "hc-countdown__unit";
  unit.dataset.unit = key;

  const digits = document.createElement("div");
  digits.className = "hc-countdown__digits";
  digits.append(makeDigitCard(), makeDigitCard());

  const caption = document.createElement("span");
  caption.className = "hc-countdown__label";
  caption.textContent = label;

  unit.append(digits, caption);
  return unit;
}

function setDigit(card, nextValue, reducedMotion) {
  const previousValue = card.dataset.value;
  const top = card.querySelector(".hc-countdown__top span");
  const bottom = card.querySelector(".hc-countdown__bottom span");
  if (!top || !bottom) return;

  if (!previousValue) {
    top.textContent = nextValue;
    bottom.textContent = nextValue;
    card.dataset.value = nextValue;
    return;
  }

  if (previousValue === nextValue) return;

  top.textContent = nextValue;
  bottom.textContent = nextValue;
  card.querySelectorAll(".hc-countdown__flap").forEach((flap) => flap.remove());

  if (!reducedMotion) {
    const topFlap = document.createElement("div");
    topFlap.className = "hc-countdown__flap hc-countdown__top-flap";
    topFlap.innerHTML = `<span>${previousValue}</span>`;

    const bottomFlap = document.createElement("div");
    bottomFlap.className = "hc-countdown__flap hc-countdown__bottom-flap";
    bottomFlap.innerHTML = `<span>${nextValue}</span>`;

    card.append(topFlap, bottomFlap);
    window.setTimeout(() => {
      topFlap.remove();
      bottomFlap.remove();
    }, 760);
  }

  card.dataset.value = nextValue;
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

  const tick = () => {
    const remaining = Math.max(0, HC_LAUNCH_AT - Date.now());
    const values = {
      days: String(Math.floor(remaining / 86_400_000)).padStart(2, "0"),
      hours: String(Math.floor((remaining % 86_400_000) / 3_600_000)).padStart(2, "0"),
      minutes: String(Math.floor((remaining % 3_600_000) / 60_000)).padStart(2, "0"),
      seconds: String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, "0"),
    };

    Object.entries(values).forEach(([key, value]) => {
      const digitCards = clock.querySelectorAll(`[data-unit="${key}"] .hc-countdown__flip-card`);
      value.split("").forEach((digit, index) => {
        const card = digitCards[index];
        if (card) setDigit(card, digit, reducedMotion);
      });
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
