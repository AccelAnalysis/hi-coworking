import type { Metadata } from "next";
import { JessicaAvatar } from "@/booth/JessicaAvatar";
import { GREETING_LINE } from "@/booth/jessicaSession";
import { AccelWordmark } from "@/components/AccelWordmark";

export const metadata: Metadata = {
  title: { absolute: "Jessica frames · Accel Analysis" },
  robots: { index: false, follow: false },
};

const FRAMES = [
  {
    title: "Idle",
    note: "Soft rounded chin, gentle smile, breathing.",
    status: "ready",
    caption: "",
    mouth: 0,
  },
  {
    title: "Happy",
    note: "Greeting. Big eyes, open smile, small nod.",
    status: "speaking",
    caption: GREETING_LINE,
    mouth: 0,
  },
  {
    title: "Speaking",
    note: "Mouth follows the voice level. No cleft.",
    status: "speaking",
    caption: "So the need is a clearer way to review the work this quarter.",
    mouth: 0.82,
  },
] as const;

export default function JessicaFramesPage() {
  return (
    <main className="min-h-dvh bg-[#00072E] px-6 py-8 text-white [font-family:var(--font-aa-body),Arial,sans-serif]">
      <div className="mx-auto max-w-6xl">
        <span className="inline-flex rounded-xl bg-white px-3 py-1.5">
          <AccelWordmark height={40} />
        </span>
        <h1 className="mt-4 text-4xl font-bold [font-family:var(--font-aa-display),Georgia,serif]">Jessica, for review</h1>
        <p className="mt-2 max-w-3xl text-lg text-white/85">
          Abstract pebble. Cute, feminine-leaning, no hair or clothes, no chin cleft.
          Motion is a requestAnimationFrame loop aimed at 60 fps, with exponential easing between poses.
          These three frames are concepts to pick from before the face is locked.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {FRAMES.map((frame) => (
            <figure key={frame.title} className="rounded-3xl bg-[#F2F6FF] p-4 text-[#1B1B1B]">
              <div className="aspect-square w-full">
                <JessicaAvatar status={frame.status} caption={frame.caption} mouth={frame.mouth} />
              </div>
              <figcaption className="mt-3">
                <p className="text-2xl font-bold text-[#00072E] [font-family:var(--font-aa-display),Georgia,serif]">{frame.title}</p>
                <p className="mt-1 text-base leading-snug">{frame.note}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </main>
  );
}
