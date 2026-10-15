/** Same id the Firestore rules require: night_pitcher_judge. */
export function powerNowScoreDocId(nightId: string, pitcherId: string, judgeUid: string): string {
  return `${nightId}_${pitcherId}_${judgeUid}`;
}
