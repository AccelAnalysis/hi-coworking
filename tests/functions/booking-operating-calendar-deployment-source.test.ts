import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bookingWorkflow = readFileSync(
  ".github/workflows/firebase-live-booking-functions.yml",
  "utf8",
);
const adminWorkflow = readFileSync(
  ".github/workflows/firebase-live-admin-member-functions.yml",
  "utf8",
);
const bookingDeployIndex = readFileSync(
  "firebase/booking-public-functions/src/index.ts",
  "utf8",
);
const adminDeployIndex = readFileSync(
  "firebase/admin-member-functions/src/index.ts",
  "utf8",
);

describe("booking operating calendar deployment contract", () => {
  it("redeploys the public booking calendar whenever its authoritative source changes", () => {
    expect(bookingWorkflow).toContain('"apps/functions/src/bookingOperatingCalendar.ts"');
    expect(bookingWorkflow).toContain('"apps/functions/src/bookingPublicScheduledAuthority.ts"');
    expect(bookingDeployIndex).toContain("booking_getDaySchedule");
    expect(bookingWorkflow).toContain("Verify public operating-calendar endpoint");
    expect(bookingWorkflow).toContain("booking_getDaySchedule");
  });

  it("redeploys the Admin calendar whenever its authoritative source changes", () => {
    expect(adminWorkflow).toContain('"apps/functions/src/bookingOperatingCalendar.ts"');
    expect(adminWorkflow).toContain('"apps/functions/src/adminBookingScheduledAuthority.ts"');
    expect(adminDeployIndex).toContain("booking_adminGetOperatingCalendar");
    expect(adminDeployIndex).toContain("booking_adminSetWeeklyHours");
    expect(adminDeployIndex).toContain("booking_adminAddException");
    expect(adminDeployIndex).toContain("booking_adminDeleteException");
    expect(adminWorkflow).toContain("Verify Admin operating-calendar endpoint");
    expect(adminWorkflow).toContain("booking_adminGetOperatingCalendar");
  });
  it("has exactly one deploy codebase exporting the Admin calendar functions", () => {
    // Two codebases exporting the same function names make each deploy steal
    // ownership from the other. admin-member-ops is the sole owner.
    expect(existsSync("firebase.admin-calendar.json")).toBe(false);
    expect(existsSync(".github/workflows/firebase-live-admin-operating-calendar.yml")).toBe(false);
    const owners = readdirSync("firebase", { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(`firebase/${d.name}/src/index.ts`))
      .filter((d) =>
        readFileSync(`firebase/${d.name}/src/index.ts`, "utf8").includes("booking_adminSetWeeklyHours"),
      )
      .map((d) => d.name);
    expect(owners).toEqual(["admin-member-functions"]);
  });
});
