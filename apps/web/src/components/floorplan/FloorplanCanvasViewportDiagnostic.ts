const SELF_TEST_PARAM = "viewportSelfTest";
const RESULT_ATTRIBUTE = "data-viewport-self-test";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function dispatchMouse(
  target: EventTarget,
  type: "mousedown" | "mousemove" | "mouseup",
  clientX: number,
  clientY: number,
  buttons: number
) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons,
      clientX,
      clientY,
    })
  );
}

async function findCanvas(attempts = 180): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const wrapper = document.querySelector<HTMLElement>("[data-testid='floorplan-canvas']");
    const stage = wrapper?.querySelector<HTMLElement>(".konvajs-content");
    if (wrapper && stage && stage.getBoundingClientRect().width > 650) return wrapper;
    await nextFrame();
  }
  return null;
}

async function runViewportSelfTest() {
  const root = document.documentElement;
  root.setAttribute(RESULT_ATTRIBUTE, "running");

  const wrapper = await findCanvas();
  const stage = wrapper?.querySelector<HTMLElement>(".konvajs-content");
  if (!wrapper || !stage) {
    root.setAttribute(RESULT_ATTRIBUTE, "fail-no-canvas");
    return;
  }

  const before = {
    x: wrapper.dataset.viewportX ?? "",
    y: wrapper.dataset.viewportY ?? "",
    scale: wrapper.dataset.viewportScale ?? "",
  };
  const rect = stage.getBoundingClientRect();
  const startX = rect.left + 550;
  const startY = rect.top + 300;
  const endX = startX + 80;
  const endY = startY + 40;

  dispatchMouse(stage, "mousedown", startX, startY, 1);
  await nextFrame();
  dispatchMouse(stage, "mousemove", startX + 30, startY + 15, 1);
  dispatchMouse(stage, "mousemove", endX, endY, 1);
  await delay(120);

  const dragStarted = wrapper.dataset.objectDragging === "true";
  dispatchMouse(stage, "mouseup", endX, endY, 0);
  await delay(650);

  const after = {
    x: wrapper.dataset.viewportX ?? "",
    y: wrapper.dataset.viewportY ?? "",
    scale: wrapper.dataset.viewportScale ?? "",
  };
  const viewportStable =
    before.x === after.x && before.y === after.y && before.scale === after.scale;

  root.dataset.viewportSelfTestBefore = `${before.x},${before.y},${before.scale}`;
  root.dataset.viewportSelfTestAfter = `${after.x},${after.y},${after.scale}`;
  root.dataset.viewportSelfTestDragStarted = dragStarted ? "true" : "false";
  root.setAttribute(
    RESULT_ATTRIBUTE,
    dragStarted && viewportStable ? "pass" : dragStarted ? "fail-viewport-moved" : "fail-drag-not-started"
  );
}

if (
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get(SELF_TEST_PARAM) === "1"
) {
  const start = () => {
    void runViewportSelfTest();
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

export {};
