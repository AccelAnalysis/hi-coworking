#!/usr/bin/env node
/**
 * Preview or send three fake NASA Expo booth leads.
 *
 * Dry run (default) prints the JSON and does not contact Attio.
 * --send posts to the booth ingest. The Attio token stays in ATTIO_API_KEY
 * on the Cloud Function; this script never reads or sends that key.
 *
 *   node scripts/expo-nasa-fake-leads.mjs
 *   node scripts/expo-nasa-fake-leads.mjs --send --url https://hi-coworking.com/api/expo/nasa-lead
 */

const send = process.argv.includes("--send");
const urlFlag = process.argv.indexOf("--url");
const url = urlFlag >= 0 ? process.argv[urlFlag + 1] : "";

const leads = [
  {
    fullName: "Jordan Hale",
    organization: "Example Dynamics",
    roleTitle: "Capture Manager",
    email: "expo-fake-jordan@example.com",
    phone: "202-555-0147",
    orgType: "prime",
    need: "A faster way to staff surge proposals.",
    timing: "FY27",
    interests: { powerNow: false, hiCoworkingEarlyAccess: false },
    consent: { sms: true, marketing: false, contact: true, email: false },
    submittedAt: new Date().toISOString(),
    clientSubmissionId: crypto.randomUUID(),
  },
  {
    fullName: "Priya Shah",
    organization: "Northstar Sub Co",
    roleTitle: "Owner",
    email: "",
    phone: "757-555-0199",
    orgType: "sub_small_business",
    need: "Introductions to a prime for a NASA subcontract.",
    timing: "",
    interests: { powerNow: false, hiCoworkingEarlyAccess: false },
    consent: { sms: false, marketing: false, contact: true, email: false },
    submittedAt: new Date().toISOString(),
    clientSubmissionId: crypto.randomUUID(),
  },
  {
    fullName: "Alex Kim",
    organization: "Other Workshop",
    roleTitle: "Analyst",
    email: "expo-fake-alex@example.com",
    phone: "",
    orgType: "other",
    need: "Wants a quiet place to write after the expo.",
    timing: "This quarter",
    interests: { powerNow: false, hiCoworkingEarlyAccess: true },
    consent: { sms: false, marketing: false, contact: false, email: false },
    submittedAt: new Date().toISOString(),
    clientSubmissionId: crypto.randomUUID(),
  },
];

if (!send) {
  console.log("Dry run. Three fake leads (not sent):");
  console.log(JSON.stringify(leads, null, 2));
  console.log("\nRe-run with --send --url <ingest-url> to post them.");
  process.exit(0);
}

if (!url) {
  console.error("Pass --url, for example https://hi-coworking.com/api/expo/nasa-lead");
  process.exit(1);
}

for (const lead of leads) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(lead),
  });
  const text = await response.text();
  console.log(`\n${response.status} ${lead.fullName}`);
  console.log(text);
  if (!response.ok) process.exitCode = 1;
}
