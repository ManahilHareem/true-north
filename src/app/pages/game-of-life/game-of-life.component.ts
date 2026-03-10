/**
 * GameOfLifeComponent — the core daily growth game.
 *
 * STATE MACHINE (GameDay.state):
 *   "no_game"        → User hasn't played today. Show "I'M READY TO PLAY" or entry calibration form.
 *   "pending_choice"  → Tile generated, waiting for user to choose a path. Shows tile prompt + choice cards.
 *   "in_progress"     → Choice made, actions generated. Shows action checklist with completion tracking.
 *   "completed"       → All actions done. Shows congratulations + streak info.
 *
 * FLOW:
 *   1. User taps "I'M READY TO PLAY" → calls onNewDay → gets tile + choices
 *   2. User selects a choice → calls onChoosePath → gets score delta + daily actions
 *   3. User completes actions → calls onCompleteAction per action → updates score
 *   4. All done → state = "completed"
 *
 * First-time users see an Entry Calibration form (4 questions) before their first tile.
 * The Wheel of Life is shown with animated arcs that update in real-time after choices.
 *
 * Score deltas: avoid=-3, explore=+2, act=+4, transmute=+5
 * These are applied OPTIMISTICALLY on frontend AND confirmed on backend.
 */
import { Component, inject, NgZone, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { ScoringService } from '../../services/scoring.service';
import {
  GeneratedProfile, DimensionScores, WheelOfLife, GameDay, DailyAction,
  TileType, TileChoice, CoherenceMetrics, ConsequenceType
} from '../../models/interfaces';

// Visual metadata for each tile type (emoji, label, accent color)
const TILE_META: Record<TileType, { icon: string; label: string; color: string }> = {
  mirror:       { icon: '\u{1FA9E}', label: 'Mirror',       color: '#9b8ec4' },
  risk:         { icon: '\u{1F525}', label: 'Risk',         color: '#e09f3e' },
  shadow:       { icon: '\u{1F311}', label: 'Shadow',       color: '#8b6f9e' },
  vitality:     { icon: '\u{1F49A}', label: 'Vitality',     color: '#50c878' },
  relationship: { icon: '\u{1F4AB}', label: 'Relationship', color: '#d4728c' },
  unknown:      { icon: '\u{1F300}', label: 'Unknown',      color: '#2a9d8f' },
};

const CONSEQUENCE_COLORS: Record<ConsequenceType, string> = {
  avoid: '#e05555',
  explore: '#e09f3e',
  act: '#50c878',
  transmute: '#9b8ec4',
};

const BOARD_TILES: { type: string; label: string; icon: string; level: number }[] = [
  { type: 'mirror', label: 'Mirror', icon: '\u{1FA9E}', level: 1 },
  { type: 'risk', label: 'Risk', icon: '\u{1F525}', level: 1 },
  { type: 'shadow', label: 'Shadow', icon: '\u{1F311}', level: 1 },
  { type: 'vitality', label: 'Vitality', icon: '\u{1F49A}', level: 1 },
  { type: 'relationship', label: 'Relationship', icon: '\u{1F4AB}', level: 1 },
  { type: 'unknown', label: 'Unknown', icon: '\u{1F300}', level: 1 },
  { type: 'co-creation', label: 'Co-Creation', icon: '\u{1F91D}', level: 2 },
  { type: 'wealth-energy', label: 'Wealth Energy', icon: '\u{26A1}', level: 2 },
  { type: 'service-mission', label: 'Service', icon: '\u{1F31F}', level: 3 },
  { type: 'leadership-trial', label: 'Leadership', icon: '\u{1F451}', level: 3 },
  { type: 'silence-retreat', label: 'Silence', icon: '\u{1F54A}\u{FE0F}', level: 4 },
  { type: 'regenerative', label: 'Regenerative', icon: '\u{1F331}', level: 4 },
];

@Component({
  selector: 'app-game-of-life',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="container">
        <!-- Header -->
        <div class="gol-header">
          <button class="btn-ghost" (click)="goBack()">\u2190 Dashboard</button>
          <span class="logo-small">GAME OF LIFE</span>
        </div>

        <!-- Loading -->
        <div *ngIf="loading" class="loading-placeholder">
          <div class="loading-shimmer" style="height:200px;margin-bottom:24px"></div>
          <div class="loading-shimmer" style="height:150px;margin-bottom:24px"></div>
          <div class="loading-shimmer" style="height:300px"></div>
        </div>

        <!-- Generating Tile -->
        <div *ngIf="generatingTile" class="generating-state">
          <div class="generating-icon">\u2726</div>
          <p class="generating-text">{{ generatingText }}</p>
          <div class="generating-bar"><div class="generating-fill"></div></div>
        </div>

        <!-- Choosing Path (generating actions) -->
        <div *ngIf="choosingPath" class="generating-state">
          <div class="generating-icon">\u2726</div>
          <p class="generating-text">Generating your path...</p>
          <div class="generating-bar"><div class="generating-fill fast"></div></div>
        </div>

        <div *ngIf="!loading && !generatingTile && !choosingPath">

          <!-- ═══ ENTRY CALIBRATION (first time ever) ═══ -->
          <div *ngIf="showCalibration" class="calibration-state animate-fade">
            <div class="calibration-header">
              <h2>State Your Direction</h2>
              <p class="calibration-sub">Before the board appears, answer honestly. There are no wrong answers.</p>
            </div>
            <div class="calibration-form">
              <div class="calibration-field">
                <label>What do you want more of in your life?</label>
                <textarea [(ngModel)]="calibration.wantMore" rows="2" placeholder="Be specific..."></textarea>
              </div>
              <div class="calibration-field">
                <label>What drains you?</label>
                <textarea [(ngModel)]="calibration.drains" rows="2" placeholder="Be honest..."></textarea>
              </div>
              <div class="calibration-field">
                <label>What are you afraid to risk right now?</label>
                <textarea [(ngModel)]="calibration.afraidToRisk" rows="2" placeholder="Name it..."></textarea>
              </div>
              <div class="calibration-field">
                <label>What feels alive but uncertain?</label>
                <textarea [(ngModel)]="calibration.aliveButUncertain" rows="2" placeholder="The edge..."></textarea>
              </div>
            </div>
            <button class="btn-ready" (click)="submitCalibrationAndPlay()"
              [disabled]="!calibration.wantMore || !calibration.drains || !calibration.afraidToRisk || !calibration.aliveButUncertain">
              I'M READY TO PLAY
            </button>
          </div>

          <!-- ═══ READY TO PLAY (returning, no game today) ═══ -->
          <div *ngIf="showReadyToPlay" class="ready-state animate-fade">
            <!-- Yesterday's Analysis from previous day -->
            <div *ngIf="history.length > 0" class="section">
              <div class="analysis-card">
                <h3 class="section-title">Yesterday</h3>
                <div class="history-quick">
                  <span class="history-tile-icon">{{ getTileMeta(history[0].tileType).icon }}</span>
                  <span>{{ getTileMeta(history[0].tileType).label }} Tile</span>
                  <span class="history-choice-badge" *ngIf="history[0].chosenPath !== null && history[0].chosenPath !== undefined">
                    {{ history[0].choices?.[history[0].chosenPath]?.label }}
                  </span>
                  <span class="history-score">{{ countCompleted(history[0]) }}/{{ history[0].actions?.length || 0 }}</span>
                </div>
              </div>
            </div>

            <!-- Board Level -->
            <div *ngIf="coherence" class="section">
              <div class="coherence-bar">
                <span class="coherence-label">Board Level {{ coherence.boardLevel }}</span>
                <span class="coherence-streak" *ngIf="coherence.streak > 1">{{ coherence.streak }} day streak</span>
              </div>
            </div>

            <!-- Wheel Preview -->
            <div *ngIf="scores" class="section">
              <div class="wheel-container">
                <svg viewBox="0 0 300 300" class="wheel-svg">
                  <circle *ngFor="let r of [30, 60, 90, 120]" [attr.cx]="150" [attr.cy]="150" [attr.r]="r" fill="none" stroke="var(--border-subtle)" stroke-width="0.5"/>
                  <line *ngFor="let a of wheelAngles; let i = index"
                    [attr.x1]="150" [attr.y1]="150"
                    [attr.x2]="150 + 125 * cos(a)" [attr.y2]="150 + 125 * sin(a)"
                    stroke="var(--border-subtle)" stroke-width="0.5"/>
                  <polygon [attr.points]="wheelPoints" fill="var(--accent-soft)" stroke="var(--accent-primary)" stroke-width="2" opacity="0.8"/>
                  <text *ngFor="let cat of wheelCategories; let i = index"
                    [attr.x]="150 + 140 * cos(wheelAngles[i])"
                    [attr.y]="155 + 140 * sin(wheelAngles[i])"
                    fill="var(--text-muted)" font-size="9" text-anchor="middle" font-family="var(--font-body)">
                    {{ cat.label }}
                  </text>
                  <circle *ngFor="let cat of wheelCategories; let i = index"
                    [attr.cx]="150 + (cat.score / 100 * 120) * cos(wheelAngles[i])"
                    [attr.cy]="150 + (cat.score / 100 * 120) * sin(wheelAngles[i])"
                    r="4" fill="var(--accent-primary)"/>
                </svg>
              </div>
            </div>

            <button class="btn-ready" (click)="triggerNewDay()">I'M READY TO PLAY</button>

            <!-- Board Tiles -->
            <div class="board-tiles section">
              <div *ngFor="let bt of boardTiles" class="board-tile" [class.locked]="bt.level > (coherence?.boardLevel || 1)">
                <span class="bt-icon">{{ bt.icon }}</span>
                <span class="bt-label">{{ bt.label }}</span>
                <span class="bt-lock" *ngIf="bt.level > (coherence?.boardLevel || 1)">Lv{{ bt.level }}</span>
              </div>
            </div>
          </div>

          <!-- ═══ CHOICE MOMENT (tile shown, waiting for user to choose) ═══ -->
          <div *ngIf="gameDay?.state === 'pending_choice'" class="choice-state animate-fade">
            <!-- Yesterday's Analysis -->
            <div *ngIf="gameDay!.yesterdayAnalysis" class="section">
              <h3 class="section-title">Yesterday's Reflection</h3>
              <div class="analysis-card">
                <p>{{ gameDay!.yesterdayAnalysis }}</p>
              </div>
            </div>

            <!-- Today's Tile -->
            <div class="section" style="animation-delay: 0.1s">
              <div class="tile-card" [style.border-color]="tileMeta.color">
                <div class="tile-header">
                  <span class="tile-icon">{{ tileMeta.icon }}</span>
                  <div>
                    <h2 class="tile-type" [style.color]="tileMeta.color">{{ tileMeta.label }} Tile</h2>
                    <span class="tile-timer" *ngIf="timeRemaining">{{ timeRemaining }}</span>
                  </div>
                </div>
                <p class="tile-prompt">{{ gameDay!.tilePrompt }}</p>

                <!-- Shadow Progression -->
                <div *ngIf="gameDay!.shadowProgression" class="shadow-progression">
                  <span class="sp-stage sp-shadow">{{ gameDay!.shadowProgression!.shadow }}</span>
                  <span class="sp-arrow">\u2192</span>
                  <span class="sp-stage sp-gift">{{ gameDay!.shadowProgression!.gift }}</span>
                  <span class="sp-arrow">\u2192</span>
                  <span class="sp-stage sp-siddhi">{{ gameDay!.shadowProgression!.siddhi }}</span>
                </div>
              </div>
            </div>

            <!-- Choice Cards -->
            <div class="section">
              <h3 class="section-title">Choose Your Path</h3>
              <div class="choices-list">
                <button *ngFor="let choice of gameDay!.choices; let i = index"
                  class="choice-card"
                  [class.selected]="selectedChoice === i"
                  [style.border-color]="selectedChoice === i ? getConsequenceColor(choice.consequenceType) : 'var(--border-subtle)'"
                  (click)="selectedChoice = i">
                  <span class="choice-label">{{ choice.label }}</span>
                  <span class="choice-desc">{{ choice.description }}</span>
                  <span class="choice-consequence" [style.color]="getConsequenceColor(choice.consequenceType)">
                    {{ getConsequenceLabel(choice.consequenceType) }}
                  </span>
                </button>
              </div>
              <button class="btn-confirm" *ngIf="selectedChoice !== null" (click)="confirmChoice()">
                Commit to This Path
              </button>
            </div>
          </div>

          <!-- ═══ CONSEQUENCE FLASH ═══ -->
          <div *ngIf="consequenceFlash" class="consequence-flash animate-fade" [style.color]="consequenceFlash!.color">
            <span class="cf-delta">{{ consequenceFlash!.delta > 0 ? '+' : '' }}{{ consequenceFlash!.delta }}</span>
            <span class="cf-dim">{{ consequenceFlash!.dimension }}</span>
          </div>

          <!-- ═══ IN PROGRESS (actions after choice) ═══ -->
          <div *ngIf="gameDay?.state === 'in_progress' || gameDay?.state === 'completed'">
            <!-- Tile Summary -->
            <div class="section animate-fade">
              <div class="tile-card compact" [style.border-color]="tileMeta.color">
                <div class="tile-header">
                  <span class="tile-icon">{{ tileMeta.icon }}</span>
                  <div>
                    <h2 class="tile-type" [style.color]="tileMeta.color">{{ tileMeta.label }} Tile</h2>
                    <span class="tile-timer" *ngIf="timeRemaining">{{ timeRemaining }}</span>
                    <span class="chosen-badge" *ngIf="gameDay!.chosenPath !== null">
                      {{ gameDay!.choices[gameDay!.chosenPath!].label }}
                    </span>
                  </div>
                </div>
                <p class="tile-prompt">{{ gameDay!.tilePrompt }}</p>
              </div>
            </div>

            <!-- Daily Actions -->
            <div *ngIf="gameDay!.actions?.length" class="section animate-fade" style="animation-delay: 0.1s">
              <h3 class="section-title">Today's Actions</h3>
              <div class="actions-list">
                <div *ngFor="let action of gameDay!.actions; let i = index"
                     class="action-item" [class.completed]="action.completed">
                  <button class="action-check" (click)="toggleAction(action)" [disabled]="action.completed">
                    <span *ngIf="action.completed">\u2713</span>
                  </button>
                  <div class="action-content">
                    <span class="action-title" [class.done]="action.completed">{{ action.title }}</span>
                    <span class="action-desc">{{ action.description }}</span>
                    <span class="action-dim">{{ dimensionLabel(action.linkedDimension) }}</span>
                  </div>
                </div>
              </div>
              <div class="actions-progress">
                {{ completedCount }}/{{ gameDay!.actions.length }} completed
              </div>
            </div>

            <!-- Completed State -->
            <div *ngIf="gameDay?.state === 'completed'" class="section animate-fade completed-banner">
              <p>Day complete. Rest. Integrate. Return tomorrow.</p>
            </div>

            <!-- Wheel of Life -->
            <div *ngIf="scores" class="section animate-fade" style="animation-delay: 0.2s">
              <h3 class="section-title">Wheel of Life</h3>
              <div class="wheel-container">
                <svg viewBox="0 0 300 300" class="wheel-svg">
                  <circle *ngFor="let r of [30, 60, 90, 120]" [attr.cx]="150" [attr.cy]="150" [attr.r]="r" fill="none" stroke="var(--border-subtle)" stroke-width="0.5"/>
                  <line *ngFor="let a of wheelAngles; let i = index"
                    [attr.x1]="150" [attr.y1]="150"
                    [attr.x2]="150 + 125 * cos(a)" [attr.y2]="150 + 125 * sin(a)"
                    stroke="var(--border-subtle)" stroke-width="0.5"/>
                  <polygon [attr.points]="wheelPoints" fill="var(--accent-soft)" stroke="var(--accent-primary)" stroke-width="2" opacity="0.8"/>
                  <text *ngFor="let cat of wheelCategories; let i = index"
                    [attr.x]="150 + 140 * cos(wheelAngles[i])"
                    [attr.y]="155 + 140 * sin(wheelAngles[i])"
                    fill="var(--text-muted)" font-size="9" text-anchor="middle" font-family="var(--font-body)">
                    {{ cat.label }}
                  </text>
                  <circle *ngFor="let cat of wheelCategories; let i = index"
                    [attr.cx]="150 + (cat.score / 100 * 120) * cos(wheelAngles[i])"
                    [attr.cy]="150 + (cat.score / 100 * 120) * sin(wheelAngles[i])"
                    r="4" fill="var(--accent-primary)"/>
                </svg>
              </div>
            </div>

            <!-- Board Tiles -->
            <div *ngIf="coherence" class="section animate-fade" style="animation-delay: 0.3s">
              <h3 class="section-title">Board Level {{ coherence.boardLevel }}</h3>
              <div class="board-tiles">
                <div *ngFor="let bt of boardTiles" class="board-tile" [class.locked]="bt.level > coherence!.boardLevel">
                  <span class="bt-icon">{{ bt.icon }}</span>
                  <span class="bt-label">{{ bt.label }}</span>
                  <span class="bt-lock" *ngIf="bt.level > coherence!.boardLevel">Lv{{ bt.level }}</span>
                </div>
              </div>
            </div>

            <!-- History -->
            <div *ngIf="history.length > 0" class="section animate-fade" style="animation-delay: 0.4s">
              <h3 class="section-title">Recent History</h3>
              <div class="history-list">
                <div *ngFor="let day of history" class="history-item">
                  <span class="history-date">{{ day.date }}</span>
                  <span class="history-tile-icon">{{ getTileMeta(day.tileType).icon }}</span>
                  <span class="history-tile-label">{{ getTileMeta(day.tileType).label }}</span>
                  <span class="history-choice-badge" *ngIf="day.chosenPath !== null && day.chosenPath !== undefined">
                    {{ day.choices?.[day.chosenPath]?.label }}
                  </span>
                  <span class="history-score">{{ countCompleted(day) }}/{{ day.actions?.length || 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .gol-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
    .logo-small{font-family:var(--font-display);font-size:1.1rem;letter-spacing:.15em;color:var(--text-muted)}
    .section{margin-bottom:28px}
    .calibration-state{max-width:520px;margin:0 auto}
    .calibration-header{text-align:center;margin-bottom:32px}
    .calibration-header h2{font-family:var(--font-display);font-size:1.6rem;color:var(--text-primary);margin:0 0 8px}
    .calibration-sub{color:var(--text-muted);font-size:.9rem;margin:0}
    .calibration-form{display:flex;flex-direction:column;gap:20px;margin-bottom:32px}
    .calibration-field label{display:block;font-size:.85rem;color:var(--text-secondary);margin-bottom:6px;font-weight:600}
    .calibration-field textarea{width:100%;padding:12px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);color:var(--text-primary);font-family:var(--font-body);font-size:.9rem;resize:none}
    .calibration-field textarea:focus{outline:none;border-color:var(--accent-primary)}
    .ready-state{text-align:center}
    .btn-ready{display:block;width:100%;max-width:360px;margin:0 auto 32px;padding:18px 32px;font-family:var(--font-display);font-size:1.1rem;letter-spacing:.12em;background:var(--accent-primary);color:var(--bg-deep);border:none;border-radius:var(--radius-lg);cursor:pointer;font-weight:600;transition:all .3s}
    .btn-ready:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
    .btn-ready:disabled{opacity:.4;cursor:not-allowed;transform:none}
    .coherence-bar{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;background:var(--bg-surface);border-radius:var(--radius-md)}
    .coherence-label{font-family:var(--font-display);font-size:.9rem;color:var(--text-primary);letter-spacing:.08em}
    .coherence-streak{font-size:.8rem;color:var(--accent-primary)}
    .tile-card{padding:28px 24px;background:var(--bg-glass);backdrop-filter:blur(16px);border:2px solid var(--accent-primary);border-radius:var(--radius-xl);text-align:left}
    .tile-card.compact{padding:20px}
    .tile-header{display:flex;align-items:center;gap:14px;margin-bottom:16px}
    .tile-icon{font-size:2.4rem}
    .tile-type{font-family:var(--font-display);font-size:1.5rem;margin:0}
    .tile-prompt{font-size:1rem;line-height:1.7;color:var(--text-secondary);margin:0}
    .tile-timer{font-size:.75rem;color:var(--text-muted)}
    .chosen-badge,.history-choice-badge{font-size:.75rem;padding:3px 10px;border-radius:100px;background:var(--accent-soft);color:var(--accent-primary)}
    .chosen-badge{display:inline-block;margin-top:4px}
    .history-choice-badge{font-size:.7rem;padding:2px 8px}
    .shadow-progression{display:flex;align-items:center;gap:10px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border-subtle);flex-wrap:wrap;justify-content:center}
    .sp-stage{font-size:.82rem;padding:4px 12px;border-radius:100px}
    .sp-shadow{background:rgba(139,111,158,.2);color:#b39ddb}.sp-gift{background:rgba(224,159,62,.2);color:#e09f3e}.sp-siddhi{background:rgba(80,200,120,.2);color:#50c878}.sp-arrow{color:var(--text-muted)}
    .choices-list{display:flex;flex-direction:column;gap:12px}
    .choice-card{display:flex;flex-direction:column;gap:6px;padding:20px;background:var(--bg-surface);border:2px solid var(--border-subtle);border-radius:var(--radius-md);cursor:pointer;transition:all .25s;text-align:left;width:100%}
    .choice-card:hover,.choice-card.selected{background:var(--bg-elevated)}
    .choice-card.selected{transform:scale(1.01)}
    .choice-label{font-size:1.05rem;font-weight:700;color:var(--text-primary)}
    .choice-desc{font-size:.88rem;color:var(--text-secondary);line-height:1.5}
    .choice-consequence{font-size:.72rem;text-transform:uppercase;letter-spacing:.1em}
    .btn-confirm{display:block;width:100%;margin-top:16px;padding:14px;font-family:var(--font-display);font-size:.95rem;letter-spacing:.08em;background:var(--accent-primary);color:var(--bg-deep);border:none;border-radius:var(--radius-md);cursor:pointer}
    .btn-confirm:hover{opacity:.9}
    .consequence-flash{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:4px;font-family:var(--font-display);z-index:100;pointer-events:none;animation:cf 1.5s ease-out forwards}
    .cf-delta{font-size:3rem;font-weight:800}
    .cf-dim{font-size:1rem;letter-spacing:.1em;text-transform:uppercase}
    @keyframes cf{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}20%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-60%)}}
    .analysis-card{padding:20px;background:var(--bg-surface);border-radius:var(--radius-md);border-left:3px solid var(--accent-primary);text-align:left}
    .analysis-card p{font-size:.92rem;line-height:1.7;color:var(--text-secondary);margin:0}
    .actions-list{display:flex;flex-direction:column;gap:10px}
    .action-item{display:flex;gap:14px;padding:16px;background:var(--bg-surface);border-radius:var(--radius-md);align-items:flex-start;transition:all .3s}
    .action-item.completed{opacity:.6}
    .action-check{width:28px;height:28px;border-radius:50%;border:2px solid var(--accent-primary);background:transparent;color:var(--accent-primary);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}
    .action-check:hover:not(:disabled){background:var(--accent-soft)}
    .action-check:disabled{cursor:default;background:var(--accent-primary);color:var(--bg-deep)}
    .action-content{display:flex;flex-direction:column;gap:4px}
    .action-title{font-size:.95rem;font-weight:600;color:var(--text-primary)}
    .action-title.done{text-decoration:line-through;color:var(--text-muted)}
    .action-desc{font-size:.85rem;color:var(--text-secondary);line-height:1.5}
    .action-dim{font-size:.7rem;color:var(--accent-primary);text-transform:uppercase;letter-spacing:.08em}
    .actions-progress{text-align:center;font-size:.8rem;color:var(--text-muted);margin-top:12px}
    .completed-banner{text-align:center;padding:24px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--accent-primary)}
    .completed-banner p{color:var(--accent-primary);font-family:var(--font-display);margin:0}
    .wheel-container{display:flex;justify-content:center}
    .wheel-svg{width:100%;max-width:340px}
    .board-tiles{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
    .board-tile{display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--bg-surface);border-radius:var(--radius-sm);font-size:.8rem}
    .board-tile.locked{opacity:.3}
    .bt-icon{font-size:1rem}.bt-label{color:var(--text-primary)}
    .bt-lock{font-size:.65rem;color:var(--text-muted);margin-left:2px}
    .history-list{display:flex;flex-direction:column;gap:6px}
    .history-item{display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg-surface);border-radius:var(--radius-sm);font-size:.85rem}
    .history-date{color:var(--text-muted)}
    .history-tile-icon{font-size:1.1rem}
    .history-tile-label{color:var(--text-primary);flex:1}
    .history-score{color:var(--accent-primary);font-weight:600}
    .history-quick{display:flex;align-items:center;gap:10px;font-size:.88rem;color:var(--text-secondary)}
    .generating-state{text-align:center;padding:60px 20px;background:var(--bg-surface);border-radius:var(--radius-lg)}
    .generating-icon{font-size:2.5rem;color:var(--accent-primary);display:inline-block;animation:spin-star 2s ease-in-out infinite}
    @keyframes spin-star{0%{transform:rotate(0) scale(1)}50%{transform:rotate(180deg) scale(1.2)}100%{transform:rotate(360deg) scale(1)}}
    .generating-text{font-size:.9rem;color:var(--text-secondary);margin:16px 0}
    .generating-bar{height:3px;background:var(--bg-elevated);border-radius:100px;overflow:hidden;max-width:220px;margin:0 auto}
    .generating-fill{height:100%;background:var(--accent-primary);border-radius:100px;animation:gen-progress 12s ease-in-out forwards}
    .generating-fill.fast{animation:gen-progress 6s ease-in-out forwards}
    @keyframes gen-progress{0%{width:0}30%{width:30%}60%{width:60%}90%{width:85%}100%{width:95%}}
    .loading-placeholder{padding-top:24px}
    @media(max-width:600px){.tile-card{padding:20px 16px}.choice-card{padding:16px}}
  `],
})
export class GameOfLifeComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private scoring = inject(ScoringService);
  private router = inject(Router);
  private zone = inject(NgZone);

  loading = true;
  generatingTile = false;
  choosingPath = false;
  generatingText = 'Analyzing your patterns...';
  profile: GeneratedProfile | null = null;
  scores: DimensionScores | null = null;
  gameDay: GameDay | null = null;
  history: GameDay[] = [];
  coherence: CoherenceMetrics | null = null;
  private userId = '';

  // Calibration
  showCalibration = false;
  calibration = { wantMore: '', drains: '', afraidToRisk: '', aliveButUncertain: '' };

  // Choice
  selectedChoice: number | null = null;
  consequenceFlash: { delta: number; dimension: string; color: string } | null = null;

  // Timer
  timeRemaining = '';
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  // Board
  boardTiles = BOARD_TILES;

  // Wheel
  wheelCategories: { label: string; key: string; score: number }[] = [];
  wheelAngles: number[] = [];
  wheelPoints = '';

  get tileMeta() {
    return TILE_META[this.gameDay?.tileType || 'unknown'];
  }

  get completedCount(): number {
    return this.gameDay?.actions?.filter(a => a.completed).length || 0;
  }

  get showReadyToPlay(): boolean {
    return !this.showCalibration && !this.gameDay && !this.generatingTile;
  }

  async ngOnInit() {
    this.userId = this.auth.getCurrentUserId() || '';
    if (!this.userId) return;

    const [user, scores, history, coherence, calibration] = await Promise.all([
      this.userData.getUserProfile(this.userId),
      this.userData.getDimensionScores(this.userId),
      this.userData.getRecentGameDays(this.userId, 7),
      this.userData.getCoherenceMetrics(this.userId),
      this.userData.getEntryCalibration(this.userId),
    ]);

    if (user?.profile) {
      this.theme.setTheme(user.profile.colorKeyword);
      this.profile = user.profile;
    }

    const today = this.getLocalDate();

    // Initialize scores if needed
    let liveScores = scores;
    if (!liveScores && this.profile) {
      liveScores = this.scoring.initFromWheel(this.profile.wheelOfLife, today);
      await this.userData.saveDimensionScores(this.userId, liveScores);
    }

    // Decay if stale
    if (liveScores && liveScores.lastDate !== today) {
      liveScores = this.scoring.decayAllScores(liveScores, today);
      liveScores.lastDate = today;
      await this.userData.saveDimensionScores(this.userId, liveScores);
    }

    // Load active game day (could be today or yesterday if within 24h)
    let activeGame = await this.userData.getGameDay(this.userId, today);
    if (!activeGame) {
      const yesterday = this.getDateOffset(-1);
      activeGame = await this.userData.getGameDay(this.userId, yesterday);
    }

    // Check 24h expiry
    if (activeGame?.createdAt) {
      const createdMs = activeGame.createdAt.toDate().getTime();
      const expiresMs = createdMs + 24 * 60 * 60 * 1000;
      if (Date.now() >= expiresMs) {
        activeGame = null; // expired
      }
    }

    // Determine if we need calibration (first time ever + no calibration saved)
    const needsCalibration = !calibration && history.length === 0 && !activeGame;

    this.zone.run(() => {
      this.scores = liveScores;
      this.gameDay = activeGame;
      this.history = history.filter(h => h.date !== activeGame?.date);
      this.coherence = coherence || { streak: 0, totalChoices: 0, courageChoices: 0, transmutations: 0, boardLevel: 1 };
      this.showCalibration = needsCalibration;
      if (liveScores) this.buildWheel(liveScores);
      this.loading = false;
      if (activeGame?.createdAt) this.startCountdown(activeGame.createdAt);
    });
  }

  async submitCalibrationAndPlay() {
    // Save calibration and trigger new day
    this.showCalibration = false;
    await this.triggerNewDay(this.calibration);
  }

  async triggerNewDay(entryCalibration?: any) {
    if (this.generatingTile) return;
    this.generatingTile = true;
    this.generatingText = 'Analyzing your patterns...';

    const textCycle = [
      'Analyzing your patterns...',
      'Reading your field...',
      'Choosing your tile...',
      'Crafting today\'s initiation...',
    ];
    let idx = 0;
    const timer = setInterval(() => {
      idx = Math.min(idx + 1, textCycle.length - 1);
      this.zone.run(() => { this.generatingText = textCycle[idx]; });
    }, 3000);

    try {
      const yesterday = this.history.length > 0 ? this.history[0] : null;
      const snapshot: any = yesterday ? {
        date: yesterday.date,
        scores: this.scores,
        tileType: yesterday.tileType,
        consequenceType: yesterday.chosenPath !== null && yesterday.chosenPath !== undefined
          ? yesterday.choices?.[yesterday.chosenPath]?.consequenceType : null,
        actionsServed: yesterday.actions?.length || 0,
        actionsCompleted: yesterday.actions?.filter((a: DailyAction) => a.completed).length || 0,
        actionsSkipped: (yesterday.actions?.length || 0) - (yesterday.actions?.filter((a: DailyAction) => a.completed).length || 0),
      } : { date: null, scores: this.scores };

      const result = await this.api.triggerNewDay(this.userId, snapshot, entryCalibration, this.getLocalDate());

      this.zone.run(() => {
        this.gameDay = result;
        this.selectedChoice = null;
        this.generatingTile = false;
        clearInterval(timer);
        if (result?.createdAt) this.startCountdown(result.createdAt);
      });
    } catch (e) {
      console.error('New day generation failed:', e);
      this.zone.run(() => {
        this.generatingTile = false;
        clearInterval(timer);
      });
    }
  }

  async confirmChoice() {
    if (this.selectedChoice === null || !this.gameDay || this.choosingPath) return;

    this.choosingPath = true;
    const choiceIndex = this.selectedChoice;
    const chosen = this.gameDay.choices[choiceIndex];

    try {
      const result = await this.api.choosePath(this.userId, this.gameDay.date, choiceIndex);

      this.zone.run(() => {
        // Show consequence flash
        if (result.choiceConsequences) {
          const dim = Object.keys(result.choiceConsequences)[0];
          const delta = result.choiceConsequences[dim];
          if (dim && delta !== undefined) {
            this.consequenceFlash = {
              delta,
              dimension: this.dimensionLabel(dim),
              color: CONSEQUENCE_COLORS[chosen.consequenceType as ConsequenceType] || '#fff',
            };
            setTimeout(() => { this.zone.run(() => { this.consequenceFlash = null; }); }, 1500);
          }
        }

        // Update game day
        this.gameDay = {
          ...this.gameDay!,
          chosenPath: choiceIndex,
          choiceConsequences: result.choiceConsequences,
          state: 'in_progress',
          actions: result.actions || [],
        };

        // Update scores if returned
        if (result.scores) {
          this.scores = result.scores;
          this.buildWheel(result.scores);
        }

        // Update coherence
        if (result.coherence) {
          this.coherence = result.coherence;
        }

        this.choosingPath = false;
      });
    } catch (e) {
      console.error('Choose path failed:', e);
      this.zone.run(() => { this.choosingPath = false; });
    }
  }

  async toggleAction(action: DailyAction) {
    if (action.completed || !this.gameDay || !this.scores) return;

    action.completed = true;
    const dim = action.linkedDimension as keyof WheelOfLife;
    const today = this.getLocalDate();

    const currentScore = (this.scores as any)[dim] as number;
    const lastActive = this.scores.lastActivity?.[dim] || this.scores.lastDate;
    const elapsed = this.scoring.daysBetween(lastActive, today);
    const actionsForDim = this.gameDay.actions.filter(
      a => a.linkedDimension === dim && a.completed
    ).length;

    const newScore = this.scoring.updateScore(currentScore, actionsForDim, elapsed);
    (this.scores as any)[dim] = newScore;
    this.scores.lastActivity = { ...this.scores.lastActivity, [dim]: today };
    this.buildWheel(this.scores);

    // Check if all done
    const allDone = this.gameDay.actions.every(a => a.completed);
    if (allDone) {
      this.gameDay = { ...this.gameDay, state: 'completed' };
    }

    try {
      await Promise.all([
        this.api.completeAction(this.userId, this.gameDay.date, action.id),
        this.userData.saveDimensionScores(this.userId, this.scores),
      ]);
    } catch (e) {
      console.error('Failed to save action completion:', e);
      // Rollback local state on failure
      action.completed = false;
      (this.scores as any)[dim] = currentScore;
      this.scores.lastActivity = { ...this.scores.lastActivity, [dim]: lastActive };
      this.buildWheel(this.scores);
      if (allDone) {
        this.gameDay = { ...this.gameDay!, state: 'in_progress' };
      }
    }
  }

  getConsequenceColor(type: string): string {
    return CONSEQUENCE_COLORS[type as ConsequenceType] || 'var(--text-muted)';
  }

  getConsequenceLabel(type: string): string {
    const labels: Record<string, string> = {
      avoid: 'Avoidance \u2014 costs vitality',
      explore: 'Curiosity \u2014 unlocks insight',
      act: 'Courage \u2014 expands your field',
      transmute: 'Transmutation \u2014 transforms the pattern',
    };
    return labels[type] || type;
  }

  dimensionLabel(dim: string): string {
    const labels: Record<string, string> = {
      spirit: 'Spirit', body: 'Body', relationships: 'Relationships',
      wealth: 'Wealth', creativeExpression: 'Creative', service: 'Service',
      learning: 'Learning', environment: 'Environment',
    };
    return labels[dim] || dim;
  }

  getTileMeta(type: TileType) {
    return TILE_META[type] || TILE_META.unknown;
  }

  countCompleted(day: GameDay): number {
    return day.actions?.filter(a => a.completed).length || 0;
  }

  buildWheel(scores: DimensionScores) {
    const cats = [
      { label: 'Spirit', key: 'spirit', score: Math.round(scores.spirit) },
      { label: 'Body', key: 'body', score: Math.round(scores.body) },
      { label: 'Relationships', key: 'relationships', score: Math.round(scores.relationships) },
      { label: 'Wealth', key: 'wealth', score: Math.round(scores.wealth) },
      { label: 'Creative', key: 'creativeExpression', score: Math.round(scores.creativeExpression) },
      { label: 'Service', key: 'service', score: Math.round(scores.service) },
      { label: 'Learning', key: 'learning', score: Math.round(scores.learning) },
      { label: 'Environment', key: 'environment', score: Math.round(scores.environment) },
    ];
    this.wheelCategories = cats;
    this.wheelAngles = cats.map((_, i) => (i * 2 * Math.PI) / cats.length - Math.PI / 2);
    this.wheelPoints = cats.map((cat, i) => {
      const r = (cat.score / 100) * 120;
      const x = 150 + r * Math.cos(this.wheelAngles[i]);
      const y = 150 + r * Math.sin(this.wheelAngles[i]);
      return `${x},${y}`;
    }).join(' ');
  }

  cos(a: number) { return Math.cos(a); }
  sin(a: number) { return Math.sin(a); }

  ngOnDestroy() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  goBack() { this.router.navigate(['/dashboard']); }

  private startCountdown(createdAt: any) {
    const createdMs = createdAt.toDate().getTime();
    const expiresMs = createdMs + 24 * 60 * 60 * 1000;
    const update = () => {
      const diff = expiresMs - Date.now();
      if (diff <= 0) {
        this.timeRemaining = 'New tile available';
        if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      this.timeRemaining = `${h}h ${m}m remaining`;
    };
    update();
    this.countdownTimer = setInterval(() => { this.zone.run(update); }, 60000);
  }

  private getDateOffset(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private getLocalDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
}
