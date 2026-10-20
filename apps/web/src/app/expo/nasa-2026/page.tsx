import { AccelBrandFrame } from "@/components/AccelBrandFrame";
import { expoAliasBootScript } from "@/lib/expoAliasBoot";
import { NASA_EXPO_EVENT } from "@/lib/expoNasaLead";
import { IntakeForm } from "../../intake/IntakeForm";

/**
 * Existing booth QR codes and Guided Access stay on this path.
 * A parse-time script sends the browser to /intake with the event filled in.
 * The form below is already in the HTML, so a failed bundle cannot leave the loader up.
 */
export default function NasaExpoIntakeAlias() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: expoAliasBootScript() }} />
      <main id="expo-opening" className="grid min-h-dvh place-items-center bg-[#F2F6FF] px-6 text-center text-[#1B1B1B]">
        <div>
          <p className="text-2xl font-semibold">Opening Accel Analysis…</p>
          <p className="mt-6">
            <a
              className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-[#0163FD] px-6 text-xl font-semibold text-white focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#03C9FF]"
              href={`/intake?event=${NASA_EXPO_EVENT}`}
            >
              Continue to the form
            </a>
          </p>
        </div>
      </main>
      <div id="expo-form" hidden>
        <AccelBrandFrame>
          <IntakeForm presetEvent={NASA_EXPO_EVENT} />
        </AccelBrandFrame>
      </div>
      <noscript>
        <style>{`#expo-opening{display:none!important}#expo-form[hidden]{display:block!important}`}</style>
      </noscript>
    </>
  );
}
