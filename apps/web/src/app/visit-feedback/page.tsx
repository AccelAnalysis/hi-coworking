import type { Metadata } from "next";
import { VisitFeedbackForm } from "./VisitFeedbackForm";

export const metadata: Metadata = {
  title: "Visit feedback · Hi Coworking",
  description: "A short survey about your visit to Hi Coworking.",
  robots: { index: false, follow: false },
};

export default function VisitFeedbackPage() {
  return <VisitFeedbackForm />;
}
