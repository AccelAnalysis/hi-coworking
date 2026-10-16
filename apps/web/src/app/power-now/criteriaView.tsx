import type { PowerNowCriterion } from "@/lib/powerNowScore";

export function CriteriaReadout({
  items,
  showAnchors = true,
  pitcherQuestions = [],
}: {
  items: PowerNowCriterion[];
  showAnchors?: boolean;
  pitcherQuestions?: string[];
}) {
  return (
    <ol className="pn-readonly">
      {items.map((criterion) => (
        <li key={criterion.id}>
          <h2>{criterion.code ? `${criterion.code}. ${criterion.label}` : criterion.label}</h2>
          {criterion.prompt ? <p>{criterion.prompt}</p> : null}
          {criterion.weight > 0 ? (
            <p className="pn-help">{criterion.proposed ? "Proposed weight" : "Weight"} {criterion.weight}%.</p>
          ) : null}
          {!showAnchors && criterion.code === "J6" && pitcherQuestions.length > 0 ? (
            <ul>
              {pitcherQuestions.map((question) => <li key={question}>{question}</li>)}
            </ul>
          ) : null}
          {showAnchors && criterion.anchors.length > 0 ? (
            <ul className="pn-anchors">
              {criterion.anchors.map((anchor) => (
                <li key={anchor.score}>{anchor.score}: {anchor.text}</li>
              ))}
            </ul>
          ) : null}
          {showAnchors && criterion.anchors.length === 0 ? <p className="pn-help">Score from 1 to {criterion.max}.</p> : null}
        </li>
      ))}
    </ol>
  );
}
