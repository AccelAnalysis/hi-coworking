import { readFileSync } from "node:fs";
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
});
