/**
 * Coming Soon survey questions. The id is the key stored in
 * leads/{id}.surveyAnswers and matches the legacy Sheet's Q1..Q10 columns.
 */
export type SurveyQuestion = {
  id: number;
  question: string;
  type: "single" | "multi" | "multi-limit-2" | "text";
  options?: string[];
  placeholder?: string;
};

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: 1,
    question: "How do you currently work most days?",
    type: "single",
    options: [
      "From home",
      "From home, but I need a change",
      "Coffee shops / public spaces",
      "Client site / on the road",
      "Office outside immediate area",
      "Other",
    ],
  },
  {
    id: 2,
    question: "How often would you realistically use a local coworking space?",
    type: "single",
    options: ["A few times per month", "About once per week", "2-3 days per week", "4-5 days per week", "Only occasionally"],
  },
  {
    id: 3,
    question: "What would be your primary reason for using Hi Coworking?",
    type: "multi-limit-2",
    options: ["Focus and productivity", "Separation from home", "Professional setting", "Reliable internet", "Networking", "Specific amenities"],
  },
  {
    id: 4,
    question: "Which of the following would you actually use?",
    type: "multi",
    options: ["Open desk seating", "Quiet / focus desks", "Small meeting room", "Phone / video call area", "Printing / scanning", "Mail handling", "Podcast setup", "Workshops"],
  },
  {
    id: 5,
    question: "When you're working, which matters more to you?",
    type: "single",
    options: ["Quiet and minimal distractions", "Balance of quiet and light interaction", "Energy and conversation", "It depends on the day"],
  },
  {
    id: 6,
    question: "What makes a coworking space not worth using for you?",
    type: "multi-limit-2",
    options: ["Too loud / distracting", "Too expensive", "Hard to access", "Long-term commitments", "Overcrowded", "Poor internet"],
  },
  {
    id: 7,
    question: "How far would you be willing to travel to use a coworking space?",
    type: "single",
    options: ["Under 5 minutes", "5-10 minutes", "10-15 minutes", "15-25 minutes", "Only if I'm already there"],
  },
  {
    id: 8,
    question: "Which pricing style feels most reasonable?",
    type: "single",
    options: ["Half-day access", "Full-day access", "Multi-day packs", "Monthly (no contract)", "Pay-as-you-go"],
  },
  {
    id: 9,
    question: "If Hi Coworking opened tomorrow, what would make you try it?",
    type: "text",
    placeholder: "e.g., A free trial day, meeting other locals...",
  },
  {
    id: 10,
    question: "If you could design the perfect shared workspace for your area, what would it include?",
    type: "text",
    placeholder: "e.g., standing desks...",
  },
];

export function surveyQuestionText(id: string | number): string {
  const question = SURVEY_QUESTIONS.find((q) => String(q.id) === String(id));
  return question ? question.question : `Question ${id}`;
}
