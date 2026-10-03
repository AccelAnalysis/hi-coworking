"use client";

import dynamic from "next/dynamic";

export const FloorplanCanvas = dynamic(
  () => import("./FloorplanCanvas").then((mod) => mod.FloorplanCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-64 items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading layout editor…
      </div>
    ),
  },
);
