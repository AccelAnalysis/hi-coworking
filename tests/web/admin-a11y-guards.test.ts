import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tablistKeyHandler } from "../../apps/web/src/lib/tablistKeys";

const ADMIN_DIR = "apps/web/src/app/admin";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

const adminFiles = [...tsxFiles(ADMIN_DIR), "apps/web/src/components/OperatingHoursManager.tsx"];

describe("Admin accessibility guards (audit P1-14, P2-4, P2-5, P2-6)", () => {
  it("uses in-app sheets instead of browser confirm/prompt dialogs", () => {
    const offenders = adminFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /window\.(confirm|prompt|alert)\(|(?<![\w.])(confirm|prompt)\(\s*[`"']/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("gives every tab a tablist, a selected state and keyboard support", () => {
    for (const file of adminFiles) {
      const source = readFileSync(file, "utf8");
      if (!source.includes('role="tab"')) continue;
      expect(source, file).toContain('role="tablist"');
      expect(source, file).toContain("aria-selected=");
      expect(source, file).toContain('role="tabpanel"');
      expect(source, file).toContain("tablistKeyHandler(");
    }
  });

  it("labels every search field", () => {
    for (const file of adminFiles) {
      const source = readFileSync(file, "utf8");
      const searchInputs = source.match(/<input[^>]*type="search"[^>]*>/g) ?? [];
      for (const input of searchInputs) {
        expect(/\bid="[^"]+"|aria-label=/.test(input), `${file}: ${input.slice(0, 80)}`).toBe(true);
      }
    }
  });

  it("confirms before sending a password reset and names the address", () => {
    const source = readFileSync(join(ADMIN_DIR, "members/page.tsx"), "utf8");
    const reset = source.slice(source.indexOf("async function sendReset"), source.indexOf("async function copyEmail"));
    expect(reset.indexOf("await confirm(")).toBeGreaterThan(-1);
    expect(reset.indexOf("await confirm(")).toBeLessThan(reset.indexOf("sendPasswordResetEmail("));
    expect(reset).toContain("${member.email}");
  });

  it("confirms before removing a schedule exception", () => {
    const source = readFileSync("apps/web/src/components/OperatingHoursManager.tsx", "utf8");
    const remove = source.slice(source.indexOf("async function removeException"));
    expect(remove.indexOf("await confirm(")).toBeLessThan(remove.indexOf("deleteException("));
  });
});

describe("tablistKeyHandler", () => {
  const order = ["a", "b", "c"] as const;
  function press(key: string, active: (typeof order)[number]) {
    let selected: string | null = null;
    let prevented = false;
    tablistKeyHandler(order, active, (next) => { selected = next; }, "t-")({
      key,
      preventDefault: () => { prevented = true; },
    } as never);
    return { selected, prevented };
  }

  it("moves with arrows and wraps", () => {
    expect(press("ArrowRight", "a").selected).toBe("b");
    expect(press("ArrowRight", "c").selected).toBe("a");
    expect(press("ArrowLeft", "a").selected).toBe("c");
  });

  it("jumps with Home and End", () => {
    expect(press("Home", "c").selected).toBe("a");
    expect(press("End", "a").selected).toBe("c");
  });

  it("ignores other keys", () => {
    expect(press("Enter", "b")).toEqual({ selected: null, prevented: false });
  });
});
