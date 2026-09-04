const SELF_TEST_PARAM = "viewportSelfTest";
const RESULT_ATTRIBUTE = "data-viewport-self-test";
type InputMode = "mouse" | "touch";
type ViewportSnapshot = { x: string; y: string; scale: string };

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

function createTouch(target: EventTarget, clientX: number, clientY: number): Touch | object {
  const init = {
    identifier: 1,
    target,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
    pageX: clientX + window.scrollX,
    pageY: clientY + window.scrollY,
    radiusX: 8,
    radiusY: 8,
    rotationAngle: 0,
    force: 0.5,
  };
  return typeof Touch === "function" ? new Touch(init) : init;
}

function dispatchTouch(
  target: EventTarget,
  type: "touchstart" | "touchmove" | "touchend",
  clientX: number,
  clientY: number
) {
  const touch = createTouch(target, clientX, clientY);
  const activeTouches = type === "touchend" ? [] : [touch];
  let event: Event;

  if (typeof TouchEvent === "function" && typeof Touch === "function") {
    event = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      touches: activeTouches as Touch[],
      targetTouches: activeTouches as Touch[],
      changedTouches: [touch as Touch],
    });
  } else {
    event = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, {
      touches: { value: activeTouches },
      targetTouches: { value: activeTouches },
      changedTouches: { value: [touch] },
    });
  }

  target.dispatchEvent(event);
}

async function findCanvas(attempts = 240): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const wrapper = document.querySelector<HTMLElement>("[data-testid='floorplan-canvas']");
    const stage = wrapper?.querySelector<HTMLElement>(".konvajs-content");
    const canvas = stage?.querySelector<HTMLCanvasElement>("canvas");
    if (
      wrapper &&
      stage &&
      canvas &&
      stage.getBoundingClientRect().width > 250 &&
      stage.getBoundingClientRect().height > 250
    ) {
      return wrapper;
    }
    await nextFrame();
  }
  return null;
}

function readViewport(wrapper: HTMLElement): ViewportSnapshot {
  return {
    x: wrapper.dataset.viewportX ?? "",
    y: wrapper.dataset.viewportY ?? "",
    scale: wrapper.dataset.viewportScale ?? "",
  };
}

function sameViewport(left: ViewportSnapshot, right: ViewportSnapshot) {
  return left.x === right.x && left.y === right.y && left.scale === right.scale;
}

function numberFrom(value: string | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hashPixels(data: Uint8ClampedArray) {
  let hash = 2166136261;
  for (let index = 0; index < data.length; index += 1) {
    hash ^= data[index] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function sampleCanvas(
  canvas: HTMLCanvasElement,
  localX: number,
  localY: number,
  cssWidth: number,
  cssHeight: number
) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const rect = canvas.getBoundingClientRect();
  if (!context || rect.width <= 0 || rect.height <= 0) return "no-canvas-sample";
  const ratioX = canvas.width / rect.width;
  const ratioY = canvas.height / rect.height;
  const x = Math.max(0, Math.min(canvas.width - 1, Math.round(localX * ratioX)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.round(localY * ratioY)));
  const width = Math.max(1, Math.min(canvas.width - x, Math.round(cssWidth * ratioX)));
  const height = Math.max(1, Math.min(canvas.height - y, Math.round(cssHeight * ratioY)));
  return hashPixels(context.getImageData(x, y, width, height).data);
}

async function runViewportSelfTest(mode: InputMode) {
  const root = document.documentElement;
  root.setAttribute(RESULT_ATTRIBUTE, "running");
  root.dataset.viewportSelfTestInput = mode;

  const wrapper = await findCanvas();
  const stage = wrapper?.querySelector<HTMLElement>(".konvajs-content");
  const canvas = stage?.querySelector<HTMLCanvasElement>("canvas");
  const fitButton = document.querySelector<HTMLButtonElement>(
    "button[aria-label='Fit floor plan in view']"
  );
  if (!wrapper || !stage || !canvas) {
    root.setAttribute(RESULT_ATTRIBUTE, "fail-no-canvas");
    return;
  }
  if (!fitButton) {
    root.setAttribute(RESULT_ATTRIBUTE, "fail-no-fit-control");
    return;
  }
  if (wrapper.dataset.dragModel !== "manual-client-delta") {
    root.dataset.viewportSelfTestDragModel = wrapper.dataset.dragModel ?? "missing";
    root.setAttribute(RESULT_ATTRIBUTE, "fail-wrong-drag-model");
    return;
  }

  // Exercise the exact reported path: explicitly Fit, then move a room object.
  fitButton.click();
  await delay(350);

  const before = readViewport(wrapper);
  const scale = numberFrom(before.scale, 1);
  const viewX = numberFrom(before.x);
  const viewY = numberFrom(before.y);
  const stageRect = stage.getBoundingClientRect();

  // The preview seed places the Boardroom mode zone at 250,130. Use an empty
  // point near its upper-left corner so the event cannot land on a chair/table.
  const targetLocalX = viewX + (250 + 30) * scale;
  const targetLocalY = viewY + (130 + 30) * scale;
  const startX = stageRect.left + targetLocalX;
  const startY = stageRect.top + targetLocalY;
  const endX = startX + (mode === "touch" ? 72 : 96);
  const endY = startY + (mode === "touch" ? 48 : 56);

  // Sample an unmoving section of the north wall and a sliver of the original
  // boardroom location. Comparing rendered pixels catches scene movement even
  // when stored viewport state incorrectly claims it stayed unchanged.
  const wallLocalX = viewX + (90 + 300) * scale;
  const wallLocalY = viewY + (70 + 7) * scale;
  const objectLocalX = viewX + (250 + 8) * scale;
  const objectLocalY = viewY + (130 + 25) * scale;
  const wallHashBefore = sampleCanvas(canvas, wallLocalX, wallLocalY, 28, 6);
  const objectHashBefore = sampleCanvas(canvas, objectLocalX, objectLocalY, 10, 20);
  const stageBefore = stage.getBoundingClientRect();

  if (mode === "touch") {
    dispatchTouch(stage, "touchstart", startX, startY);
    await nextFrame();
    dispatchTouch(window, "touchmove", startX + 30, startY + 20);
    dispatchTouch(window, "touchmove", endX, endY);
  } else {
    dispatchMouse(stage, "mousedown", startX, startY, 1);
    await nextFrame();
    dispatchMouse(window, "mousemove", startX + 35, startY + 20, 1);
    dispatchMouse(window, "mousemove", endX, endY, 1);
  }

  await delay(180);
  const dragStarted = wrapper.dataset.objectDragging === "true";
  const during = readViewport(wrapper);
  const wallHashDuring = sampleCanvas(canvas, wallLocalX, wallLocalY, 28, 6);

  if (mode === "touch") {
    dispatchTouch(window, "touchend", endX, endY);
  } else {
    dispatchMouse(window, "mouseup", endX, endY, 0);
  }
  await delay(1650);

  const after = readViewport(wrapper);
  const wallHashAfter = sampleCanvas(canvas, wallLocalX, wallLocalY, 28, 6);
  const objectHashAfter = sampleCanvas(canvas, objectLocalX, objectLocalY, 10, 20);
  const stageAfter = stage.getBoundingClientRect();

  const viewportStable = sameViewport(before, during) && sameViewport(before, after);
  const sceneAnchorStable =
    wallHashBefore === wallHashDuring && wallHashBefore === wallHashAfter;
  const objectMoved = objectHashBefore !== objectHashAfter;
  const stageStable =
    Math.abs(stageBefore.left - stageAfter.left) < 0.1 &&
    Math.abs(stageBefore.top - stageAfter.top) < 0.1 &&
    Math.abs(stageBefore.width - stageAfter.width) < 0.1 &&
    Math.abs(stageBefore.height - stageAfter.height) < 0.1;

  root.dataset.viewportSelfTestBefore = `${before.x},${before.y},${before.scale}`;
  root.dataset.viewportSelfTestDuring = `${during.x},${during.y},${during.scale}`;
  root.dataset.viewportSelfTestAfter = `${after.x},${after.y},${after.scale}`;
  root.dataset.viewportSelfTestDragModel = wrapper.dataset.dragModel;
  root.dataset.viewportSelfTestDragStarted = dragStarted ? "true" : "false";
  root.dataset.viewportSelfTestViewportStable = viewportStable ? "true" : "false";
  root.dataset.viewportSelfTestSceneAnchorStable = sceneAnchorStable ? "true" : "false";
  root.dataset.viewportSelfTestObjectMoved = objectMoved ? "true" : "false";
  root.dataset.viewportSelfTestStageStable = stageStable ? "true" : "false";
  root.dataset.viewportSelfTestWallHash = `${wallHashBefore},${wallHashDuring},${wallHashAfter}`;

  if (!dragStarted) root.setAttribute(RESULT_ATTRIBUTE, "fail-drag-not-started");
  else if (!viewportStable) root.setAttribute(RESULT_ATTRIBUTE, "fail-viewport-moved");
  else if (!sceneAnchorStable) root.setAttribute(RESULT_ATTRIBUTE, "fail-scene-anchor-moved");
  else if (!stageStable) root.setAttribute(RESULT_ATTRIBUTE, "fail-stage-moved");
  else if (!objectMoved) root.setAttribute(RESULT_ATTRIBUTE, "fail-object-did-not-move");
  else root.setAttribute(RESULT_ATTRIBUTE, "pass");
}

if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "demo-hi-coworking"
) {
  const requested = new URLSearchParams(window.location.search).get(SELF_TEST_PARAM);
  if (requested === "1" || requested === "mouse" || requested === "touch") {
    const mode: InputMode = requested === "touch" ? "touch" : "mouse";
    const start = () => {
      void runViewportSelfTest(mode);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
  }
}

export {};
