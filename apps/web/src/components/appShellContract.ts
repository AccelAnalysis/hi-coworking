export type AppShellVariant = "site" | "workspace";

export interface AppShellLayoutContract {
  rootClassName: string;
  mainClassName: string;
  showFooter: boolean;
  workspace: boolean;
}

/**
 * Pure, testable layout contract shared by every AppShell consumer. The
 * default remains the existing site shell; full-height behavior is opt-in.
 */
export function resolveAppShellLayout(
  variant: AppShellVariant = "site",
  fullWidth = false,
): AppShellLayoutContract {
  if (variant === "workspace") {
    return {
      rootClassName: "min-h-dvh flex flex-col h-dvh overflow-hidden",
      mainClassName: "flex-1 w-full min-h-0 overflow-hidden bg-slate-100",
      showFooter: false,
      workspace: true,
    };
  }

  return {
    rootClassName: "min-h-dvh flex flex-col",
    mainClassName: fullWidth
      ? "flex-1 w-full bg-slate-50"
      : "flex-1 w-full max-w-7xl mx-auto px-6 py-8",
    showFooter: true,
    workspace: false,
  };
}
