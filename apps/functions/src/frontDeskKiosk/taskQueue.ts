import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFunctions } from "firebase-admin/functions";
import type { PlannedTask } from "./policy";

/**
 * Cloud Tasks queue for the front desk's one-time deferred tasks (late /
 * no-show checks and forgotten check-outs). Deploying kioskFrontDeskTask
 * creates the queue; nothing here polls.
 */
export const FRONT_DESK_TASK_FUNCTION = "kioskFrontDeskTask";
export const FRONT_DESK_TASK_REGION = "us-central1";
export const TASK_DISPATCH_DEADLINE_SECONDS = 120;

export type TaskQueueLike = {
  enqueue(
    data: Record<string, unknown>,
    opts: { id: string; scheduleTime: Date; dispatchDeadlineSeconds: number },
  ): Promise<void>;
};

const EMULATOR_APP_NAME = "front-desk-tasks-emulator";

/**
 * In production the Admin SDK signs tasks as the runtime service account,
 * found via the metadata server. The local emulator has no metadata server,
 * so it gets a named app with a placeholder account (the Cloud Tasks
 * emulator does not check it). Emulator only.
 */
function taskApp() {
  if (!process.env.CLOUD_TASKS_EMULATOR_HOST) return undefined;
  const existing = getApps().find((app) => app.name === EMULATOR_APP_NAME);
  if (existing) return existing;
  return initializeApp({ ...getApp().options, serviceAccountId: "emulated-tasks@example.invalid" }, EMULATOR_APP_NAME);
}

export function frontDeskTaskQueue(): TaskQueueLike {
  return getFunctions(taskApp()).taskQueue(`locations/${FRONT_DESK_TASK_REGION}/functions/${FRONT_DESK_TASK_FUNCTION}`);
}

function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "functions/task-already-exists" || code === "task-already-exists";
}

/**
 * Enqueues each task under its deterministic ID. A task that already exists
 * (or ran recently; Cloud Tasks keeps the name reserved) counts as a
 * duplicate, not a failure. Any other error is thrown after every task was
 * tried, so the caller's retry re-enqueues only what is missing.
 */
export async function enqueueFrontDeskTasks(queue: TaskQueueLike, tasks: PlannedTask[]) {
  const enqueued: string[] = [];
  const duplicates: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  for (const task of tasks) {
    try {
      await queue.enqueue(task.payload as unknown as Record<string, unknown>, {
        id: task.id,
        scheduleTime: new Date(task.scheduleAt),
        dispatchDeadlineSeconds: TASK_DISPATCH_DEADLINE_SECONDS,
      });
      enqueued.push(task.id);
    } catch (error) {
      if (isAlreadyExists(error)) duplicates.push(task.id);
      else failures.push({ id: task.id, error: String((error as Error)?.message || error) });
    }
  }
  if (failures.length) {
    const error = new Error(`Could not enqueue ${failures.length} front desk task(s): ${failures.map((f) => `${f.id}: ${f.error}`).join("; ")}`);
    (error as Error & { enqueued?: string[]; duplicates?: string[] }).enqueued = enqueued;
    (error as Error & { enqueued?: string[]; duplicates?: string[] }).duplicates = duplicates;
    throw error;
  }
  return { enqueued, duplicates };
}
