/**
 * ScoringService — all Wheel of Life score math lives here.
 *
 * SCORING MODEL (exponential moving average with decay):
 *   - Scores range from 5 (floor) to 100 (ceiling) per dimension
 *   - Each dimension decays toward 5 with a 7-day half-life when inactive
 *   - Daily actions boost scores via diminishing returns curve
 *   - Game tile choices apply instant deltas: avoid=-3, explore=+2, act=+4, transmute=+5
 *
 * IMPORTANT: The consequence deltas here MUST match the ones in functions/index.js
 * (onChoosePath). Backend applies them to Firestore; frontend applies them optimistically.
 *
 * COHERENCE & BOARD LEVEL:
 *   - Coherence is a 0-100 score computed from streak, courage ratio, balance, transmutations
 *   - Board level (1-4) maps from coherence: <35=1, 35-59=2, 60-79=3, 80+=4
 *   - Board level is purely cosmetic — it doesn't affect gameplay mechanics
 */
import { Injectable } from '@angular/core';
import { DimensionScores, WheelOfLife, ConsequenceType } from '../models/interfaces';

// Decay half-life: a score of 50 decays to 25 after 7 days of inactivity
const HALF_LIFE = 7;
const ALPHA = 1 - Math.pow(0.5, 1 / HALF_LIFE);
const SCORE_FLOOR = 5;    // Scores never drop below this
const SCORE_CEILING = 100; // Scores never exceed this
const MAX_DAILY = 1.0;     // Max normalized daily input (asymptote)
const DIMINISHING_C = 1.5; // Steepness of diminishing returns curve

@Injectable({ providedIn: 'root' })
export class ScoringService {

  /** Apply exponential decay to a score based on days of inactivity */
  decayScore(score: number, daysElapsed: number): number {
    if (daysElapsed <= 0) return score;
    const decayed = score * Math.pow(1 - ALPHA, daysElapsed);
    return Math.max(SCORE_FLOOR, decayed);
  }

  dailyInput(numActions: number): number {
    if (numActions <= 0) return 0;
    return MAX_DAILY * (1 - Math.exp(-DIMINISHING_C * numActions));
  }

  updateScore(previousScore: number, numActions: number, daysElapsed: number): number {
    const decayed = this.decayScore(previousScore, daysElapsed);
    const input = this.dailyInput(numActions);
    const raw = (1 - ALPHA) * decayed + ALPHA * input * SCORE_CEILING;
    return Math.max(SCORE_FLOOR, Math.min(SCORE_CEILING, raw));
  }

  decayAllScores(scores: DimensionScores, today: string): DimensionScores {
    const dims: (keyof WheelOfLife)[] = [
      'spirit', 'body', 'relationships', 'wealth',
      'creativeExpression', 'service', 'learning', 'environment',
    ];
    const updated = { ...scores, lastDate: today };
    for (const dim of dims) {
      const lastDate = scores.lastActivity?.[dim] || scores.lastDate;
      const elapsed = this.daysBetween(lastDate, today);
      if (elapsed > 0) {
        (updated as any)[dim] = this.decayScore(scores[dim] as number, elapsed);
      }
    }
    return updated;
  }

  initFromWheel(wheel: WheelOfLife, today: string): DimensionScores {
    const lastActivity: Record<string, string> = {};
    const dims: (keyof WheelOfLife)[] = [
      'spirit', 'body', 'relationships', 'wealth',
      'creativeExpression', 'service', 'learning', 'environment',
    ];
    for (const dim of dims) {
      lastActivity[dim] = today;
    }
    return {
      spirit: wheel.spirit,
      body: wheel.body,
      relationships: wheel.relationships,
      wealth: wheel.wealth,
      creativeExpression: wheel.creativeExpression,
      service: wheel.service,
      learning: wheel.learning,
      environment: wheel.environment,
      lastActivity,
      lastDate: today,
    };
  }

  daysBetween(dateA: string, dateB: string): number {
    const a = new Date(dateA + 'T00:00:00');
    const b = new Date(dateB + 'T00:00:00');
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
  }

  // ── Choice Consequences ──────────────────────────────────
  private readonly CONSEQUENCE_DELTAS: Record<ConsequenceType, number> = {
    avoid: -3,
    explore: 2,
    act: 4,
    transmute: 5,
  };

  applyConsequence(scores: DimensionScores, dimension: string, consequenceType: ConsequenceType): DimensionScores {
    const delta = this.CONSEQUENCE_DELTAS[consequenceType];
    const current = (scores as any)[dimension] as number;
    if (current === undefined) return scores;
    const updated = { ...scores };
    (updated as any)[dimension] = Math.max(SCORE_FLOOR, Math.min(SCORE_CEILING, current + delta));
    return updated;
  }

  // ── Coherence & Board Level ──────────────────────────────
  calculateCoherence(streak: number, courageRatio: number, dimensionBalance: number, transmutations: number): number {
    // streak: days in a row (0+), courageRatio: 0-1, dimensionBalance: 0-1 (1=perfectly even), transmutations: count
    const streakScore = Math.min(1, streak / 14); // 14-day streak = max
    const transmuteScore = Math.min(1, transmutations / 10); // 10 transmutations = max
    return (streakScore * 25 + courageRatio * 35 + dimensionBalance * 20 + transmuteScore * 20);
  }

  getDimensionBalance(scores: DimensionScores): number {
    const dims: (keyof WheelOfLife)[] = [
      'spirit', 'body', 'relationships', 'wealth',
      'creativeExpression', 'service', 'learning', 'environment',
    ];
    const values = dims.map(d => scores[d] as number);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) return 0;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const cv = Math.sqrt(variance) / mean; // coefficient of variation
    return Math.max(0, 1 - cv); // lower variance = higher balance
  }

  getBoardLevel(coherence: number): number {
    if (coherence >= 80) return 4;
    if (coherence >= 60) return 3;
    if (coherence >= 35) return 2;
    return 1;
  }
}
