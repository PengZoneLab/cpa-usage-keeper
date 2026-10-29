export interface PlannerCard { id: string; expiresAt: number }
export interface PlannerAccount {
  id: string; name: string; plan: string; weight: 1 | 2 | null; priority: number;
  remainingPercent: number | null; resetAt: number | null; observedAt: number | null;
  disabled: boolean; issues: string[]; cards: PlannerCard[];
  stopAt: number | null; minimumPercent: number;
  shortRemainingPercent: number | null; shortResetAt: number | null; shortWindowSeconds: number | null;
}
export interface PlannerSnapshot { accounts: PlannerAccount[]; loadedAt: number }
export interface PlannerInput {
  accounts: PlannerAccount[]; now: number; end: number; monthEnd: number;
  dailyDemand: number; uncertaintyPercent: number; slotHours: number;
  model: string; effort: string;
  // Weighted weekly percentage points represented by a full short window, per account.
  shortCapacity: Record<string, number>;
  allowCards: boolean; resumeDelayMinutes: number;
}
export interface PlannerAction { at: number; end: number; accountId: string; consumed: number; cardId?: string }
export interface PlannerRank {
  accountId: string; score: number; monthScore: number; lowScore: number; highScore: number;
  delta: number; actions: PlannerAction[];
}
export interface PlannerResult {
  status: 'optimal' | 'incomplete' | 'invalid'; message: string;
  ranking: PlannerRank[]; stable: boolean; tied: boolean; computedAt: number;
  slots: number; assumptions: string[]; elapsedMs: number;
}
