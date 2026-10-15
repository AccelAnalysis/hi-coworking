import type { Metadata } from "next";
import { HomePage } from "./HomePage";
import {
  HOME_DESCRIPTION,
  HOME_TITLE,
  PUBLIC_SITE_ORIGIN,
} from "@/lib/publicSite";

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    siteName: HOME_TITLE,
    type: "website",
    url: PUBLIC_SITE_ORIGIN,
  },
  twitter: {
    card: "summary",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
};

export default function Page() {
  return <HomePage />;
}
