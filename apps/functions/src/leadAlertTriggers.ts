/**
 * New-lead alert for booth and Power NOW leads (Firestore intakeLeads).
 * Same flag, recipient and sender as leads_onNewLead; off by default.
 *
 * Deploy with firebase.lead-admin.json and --only functions:intake_onNewLead.
 */
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { buildIntakeLeadAlert, sendLeadAlert } from "./leadAlerts";
import "./leadAlertParams";
import { ResendEmailProvider } from "./providers/emailProvider";
import { resendApiKey } from "./providers/emailSecret";

export const intake_onNewLead = onDocumentCreated(
  { document: "intakeLeads/{leadId}", region: "us-central1", secrets: [resendApiKey] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    await sendLeadAlert({
      leadKey: `intakeLeads/${snap.id}`,
      data: snap.data() as Record<string, unknown>,
      build: buildIntakeLeadAlert,
      provider: () => new ResendEmailProvider(resendApiKey.value()),
    });
  },
);
