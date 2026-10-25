import { describe, expect, it } from "vitest";
import { csvCell, rosterCsv, rosterCsvFilename } from "../../apps/web/src/lib/rosterCsv";

describe("staff roster CSV", () => {
  it("quotes cells and neutralises spreadsheet formulas", () => {
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+1 555")).toBe(`"'+1 555"`);
    expect(csvCell(undefined)).toBe('""');
  });

  it("writes a header and one row per registration", () => {
    const csv = rosterCsv([{
      id: "r1",
      displayName: "Ada Guest",
      email: "ada@example.test",
      status: "CONFIRMED",
      quantity: 2,
      checkedInQuantity: 1,
      attendanceStatus: "PARTIAL",
      source: "web",
      registeredAt: Date.UTC(2026, 9, 1, 12),
    } as never]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Name","Email","Status"');
    expect(lines[1]).toBe('"Ada Guest","ada@example.test","CONFIRMED","2","1","PARTIAL","web","2026-10-01T12:00:00.000Z"');
  });

  it("names the file after the event and date", () => {
    expect(rosterCsvFilename("Founders Night: Q4!", Date.UTC(2026, 10, 5))).toBe("founders-night-q4-2026-11-05-roster.csv");
  });
});
