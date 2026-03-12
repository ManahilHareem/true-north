/**
 * DashboardComponent — the main hub after login. Shows:
 *   - Essence card (archetype, personality summary)
 *   - Wheel of Life (8 dimensions as animated arcs, with real-time decay)
 *   - Daily Briefing (generated via onDailyBriefingManual, cached by date)
 *   - Game of Life tile summary (today's tile + actions)
 *   - Navigation cards to all other pages (chat agents, communication, etc.)
 *
 * On init: loads user profile → applies theme → decays scores → loads briefing + game day.
 * Auto-refreshes every 60s via setInterval (for score decay animation).
 */
import { Component, inject, NgZone, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { ScoringService } from '../../services/scoring.service';
import { UserProfile, GeneratedProfile, DailyBriefing, WheelOfLife, DimensionScores, GameDay } from '../../models/interfaces';
import { AGENT_NAMES, AGENT_TAGLINES, AGENT_ICONS } from '../../prompts/templates';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="container">
        <!-- Header -->
        <div class="dash-header">
          <span class="logo-small">TRUE NORTH</span>
          <button class="btn-ghost" (click)="signOut()">Sign Out</button>
        </div>

        <div *ngIf="profile; else loadingState">
          <!-- Essence Card -->
          <div class="essence-card animate-slide">
            <div class="essence-glow"></div>
            <div class="essence-compass">
              <svg viewBox="0 0 200 200" width="160" height="160">
                <circle cx="100" cy="100" r="96" fill="none" stroke="var(--accent-primary)" stroke-width="1" opacity="0.2"/>
                <circle cx="100" cy="100" r="80" fill="none" stroke="var(--accent-primary)" stroke-width="0.5" opacity="0.15" stroke-dasharray="3 3"/>
                <circle cx="100" cy="100" r="60" fill="none" stroke="var(--accent-primary)" stroke-width="0.5" opacity="0.1"/>
                <polygon points="100,12 104,88 100,100 96,88" fill="var(--accent-primary)" opacity="0.7"/>
                <polygon points="100,188 96,112 100,100 104,112" fill="var(--text-muted)" opacity="0.3"/>
                <line x1="12" y1="100" x2="88" y2="100" stroke="var(--accent-primary)" stroke-width="0.5" opacity="0.3"/>
                <line x1="112" y1="100" x2="188" y2="100" stroke="var(--accent-primary)" stroke-width="0.5" opacity="0.3"/>
                <circle cx="100" cy="100" r="4" fill="var(--accent-primary)"/>
              </svg>
            </div>
            <h1 class="archetype-name">{{ profile.archetypeName }}</h1>
            <div class="essence-details">
              <div class="essence-item"><span class="essence-label">Strength</span><span class="essence-value">{{ profile.coreStrength }}</span></div>
              <div class="essence-item"><span class="essence-label">Shadow</span><span class="essence-value">{{ profile.shadowToTransmute }}</span></div>
              <div class="essence-item"><span class="essence-label">Seasonal Focus</span><span class="essence-value">{{ profile.seasonalFocus }}</span></div>
            </div>
          </div>

          <!-- Wheel of Life -->
          <div class="section animate-fade" style="animation-delay: 0.2s">
            <h3 class="section-title">Wheel of Life</h3>
            <div class="wheel-container">
              <svg viewBox="0 0 300 300" class="wheel-svg">
                <!-- Grid circles -->
                <circle *ngFor="let r of [30, 60, 90, 120]" [attr.cx]="150" [attr.cy]="150" [attr.r]="r" fill="none" stroke="var(--border-subtle)" stroke-width="0.5"/>
                <!-- Axes -->
                <line *ngFor="let a of wheelAngles; let i = index"
                  [attr.x1]="150" [attr.y1]="150"
                  [attr.x2]="150 + 125 * cos(a)" [attr.y2]="150 + 125 * sin(a)"
                  stroke="var(--border-subtle)" stroke-width="0.5"/>
                <!-- Data polygon -->
                <polygon [attr.points]="wheelPoints" fill="var(--accent-soft)" stroke="var(--accent-primary)" stroke-width="2" opacity="0.8"/>
                <!-- Labels -->
                <text *ngFor="let cat of wheelCategories; let i = index"
                  [attr.x]="150 + 140 * cos(wheelAngles[i])"
                  [attr.y]="155 + 140 * sin(wheelAngles[i])"
                  fill="var(--text-muted)" font-size="9" text-anchor="middle" font-family="var(--font-body)">
                  {{ cat.label }}
                </text>
                <!-- Score dots -->
                <circle *ngFor="let cat of wheelCategories; let i = index"
                  [attr.cx]="150 + (cat.score / 100 * 120) * cos(wheelAngles[i])"
                  [attr.cy]="150 + (cat.score / 100 * 120) * sin(wheelAngles[i])"
                  r="4" fill="var(--accent-primary)"/>
              </svg>
            </div>
          </div>

          <!-- Daily Briefing -->
          <div class="section animate-fade" style="animation-delay: 0.35s">
            <div class="section-header">
              <h3 class="section-title">Daily Briefing</h3>
              <button class="btn-ghost" (click)="refreshBriefing()" *ngIf="!briefingLoading">Refresh</button>
            </div>
            <div *ngIf="briefing; else briefingPlaceholder" class="briefing-grid">
              <div class="briefing-card animate-fade"><div class="briefing-icon">💰</div><div class="briefing-text">{{ briefing.financialInsight }}</div></div>
              <div class="briefing-card animate-fade" style="animation-delay:.05s"><div class="briefing-icon">🌿</div><div class="briefing-text">{{ briefing.healthSuggestion }}</div></div>
              <div class="briefing-card animate-fade" style="animation-delay:.1s">
                <div class="briefing-icon">📡</div>
                <div class="briefing-text">
                  <ng-container *ngIf="briefing.headlines && briefing.headlines.length > 0; else noSignals">
                    <div *ngFor="let h of briefing.headlines" class="headline-item">
                      <a *ngIf="h.url" [href]="h.url" target="_blank" rel="noopener">{{ h.title }} <span class="headline-source" *ngIf="h.source">↗ {{ h.source }}</span></a>
                      <span *ngIf="!h.url">{{ h.title }}</span>
                    </div>
                  </ng-container>
                  <ng-template #noSignals><span class="no-signals">No signals available right now. Try refreshing.</span></ng-template>
                </div>
              </div>
              <div class="briefing-card animate-fade" style="animation-delay:.15s"><div class="briefing-icon">💫</div><div class="briefing-text">{{ briefing.relationshipReflection }}</div></div>
              <div class="briefing-card animate-fade" style="animation-delay:.2s"><div class="briefing-icon">🚀</div><div class="briefing-text">{{ briefing.growthReminder }}</div></div>
            </div>
            <ng-template #briefingPlaceholder>
              <div *ngIf="!briefingLoading" class="briefing-empty" (click)="refreshBriefing()">
                <p>Tap to generate today's briefing</p>
              </div>
              <div *ngIf="briefingLoading" class="briefing-loading-feed">
                <div class="briefing-loading-header">
                  <div class="briefing-loading-icon">✦</div>
                  <p class="briefing-loading-text">{{ briefingLoadingText }}</p>
                  <div class="briefing-loading-bar"><div class="briefing-loading-fill"></div></div>
                </div>
                <div class="briefing-skeleton-grid">
                  <div *ngFor="let icon of ['💰','🌿','📡','💫','🚀']" class="briefing-skeleton-card">
                    <div class="briefing-skeleton-icon">{{ icon }}</div>
                    <div class="briefing-skeleton-lines">
                      <div class="skel-line skel-long shimmer"></div>
                      <div class="skel-line skel-med shimmer"></div>
                      <div class="skel-line skel-short shimmer"></div>
                    </div>
                  </div>
                </div>
              </div>
            </ng-template>
          </div>

          <!-- 5 Agents -->
          <div class="section animate-fade" style="animation-delay: 0.5s">
            <h3 class="section-title">Your Advisors</h3>
            <div class="agents-grid">
              <div *ngFor="let id of agentIds" class="card card-interactive agent-card" (click)="openAgent(id)">
                <div class="agent-icon">{{ getIcon(id) }}</div>
                <div class="agent-info">
                  <h3>{{ getName(id) }}</h3>
                  <p>{{ getTagline(id) }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Tools -->
          <div class="section animate-fade" style="animation-delay: 0.65s">
            <h3 class="section-title">Tools</h3>
            <div class="tools-grid">
              <div class="card card-interactive tool-card" (click)="navigate('/game-of-life')">
                <span class="tool-icon">🎮</span><span>Game of Life</span>
              </div>
              <div class="card card-interactive tool-card" (click)="navigate('/communication')">
                <span class="tool-icon">🎯</span><span>Communication Intelligence</span>
              </div>
              <div class="card card-interactive tool-card" (click)="navigate('/inspiration')">
                <span class="tool-icon">🔮</span><span>Positive Futures</span>
              </div>
              <div class="card card-interactive tool-card" (click)="navigate('/articles')">
                <span class="tool-icon">📡</span><span>Signal Stream</span>
              </div>
              <div class="card card-interactive tool-card" (click)="navigate('/files')">
                <span class="tool-icon">📁</span><span>My Files</span>
              </div>
              <div class="card card-interactive tool-card" (click)="navigate('/vault')">
                <span class="tool-icon">🔐</span><span>Password Vault</span>
              </div>
              <div *ngIf="userRole === 'founder' || userRole === 'admin'" class="card card-interactive tool-card tool-founder" (click)="navigate('/intelligence')">
                <span class="tool-icon">🧠</span><span>Intelligence Agent</span>
              </div>
            </div>
          </div>
        </div>

        <ng-template #loadingState>
          <div class="loading-placeholder">
            <div class="loading-shimmer" style="height:300px;margin-bottom:24px"></div>
            <div class="loading-shimmer" style="height:200px;margin-bottom:24px"></div>
            <div class="loading-shimmer" style="height:150px"></div>
          </div>
        </ng-template>
      </div>
    </div>
  `,
  styles: [`
    .dash-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .logo-small { font-family: var(--font-display); font-size: 1.1rem; letter-spacing: 0.15em; color: var(--text-muted); }

    .essence-card {
      position: relative; text-align: center; padding: 48px 24px 36px;
      background: var(--bg-glass); backdrop-filter: blur(20px);
      border: 1px solid var(--border-accent); border-radius: var(--radius-xl);
      animation: breathe 4s ease-in-out infinite; margin-bottom: 32px; overflow: hidden;
    }
    .essence-glow {
      position: absolute; top: -50%; left: 50%; transform: translateX(-50%);
      width: 300px; height: 300px; border-radius: 50%;
      background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
      filter: blur(40px); opacity: 0.2; pointer-events: none;
    }
    .essence-compass { position: relative; z-index: 1; margin-bottom: 16px; }
    .archetype-name { font-family: var(--font-display); font-size: 2.2rem; color: var(--accent-text); position: relative; z-index: 1; margin-bottom: 20px; }
    .essence-details { display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; position: relative; z-index: 1; }
    .essence-item { text-align: center; }
    .essence-label { display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 2px; }
    .essence-value { font-family: var(--font-display); font-size: 1rem; color: var(--text-primary); }

    .section { margin-bottom: 32px; }
    .section-header { display: flex; justify-content: space-between; align-items: center; }

    .wheel-container { display: flex; justify-content: center; }
    .wheel-svg { width: 100%; max-width: 320px; }

    .briefing-grid { display: flex; flex-direction: column; gap: 12px; }
    .briefing-card { display: flex; gap: 14px; padding: 16px; background: var(--bg-surface); border-radius: var(--radius-md); }
    .briefing-icon { font-size: 1.3rem; flex-shrink: 0; }
    .briefing-text { font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); }
    .headline-item { margin-bottom: 8px; }
    .headline-item a { font-size: 0.9rem; text-decoration: none; color: var(--accent-primary); display: block; }
    .headline-item a:hover { text-decoration: underline; }
    .headline-source { font-size: 0.75rem; color: var(--text-muted); margin-left: 4px; }
    .briefing-empty {
      text-align: center; padding: 32px; background: var(--bg-surface); border-radius: var(--radius-md);
      cursor: pointer; transition: all 0.2s;
    }
    .briefing-empty:hover { background: var(--bg-elevated); }
    .briefing-empty p { color: var(--text-muted); }

    .no-signals { color: var(--text-muted); font-style: italic; font-size: 0.85rem; }

    .briefing-loading-feed { display: flex; flex-direction: column; gap: 20px; }
    .briefing-loading-header {
      text-align: center; padding: 32px 20px; background: var(--bg-surface);
      border-radius: var(--radius-md); border: 1px solid var(--border-subtle);
    }
    .briefing-loading-icon {
      font-size: 2rem; color: var(--accent-primary); display: inline-block;
      animation: spin-star 2s ease-in-out infinite;
    }
    @keyframes spin-star {
      0% { transform: rotate(0deg) scale(1); }
      50% { transform: rotate(180deg) scale(1.2); }
      100% { transform: rotate(360deg) scale(1); }
    }
    .briefing-loading-text {
      font-size: 0.85rem; color: var(--text-secondary); margin: 12px 0 16px;
      animation: fade-text 0.4s ease;
    }
    @keyframes fade-text { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    .briefing-loading-bar { height: 3px; background: var(--bg-elevated); border-radius: 100px; overflow: hidden; max-width: 200px; margin: 0 auto; }
    .briefing-loading-fill {
      height: 100%; background: var(--accent-primary); border-radius: 100px;
      animation: briefing-progress 10s ease-in-out forwards;
    }
    @keyframes briefing-progress {
      0% { width: 0%; } 30% { width: 35%; } 60% { width: 65%; } 90% { width: 90%; } 100% { width: 95%; }
    }
    .briefing-skeleton-grid { display: flex; flex-direction: column; gap: 10px; }
    .briefing-skeleton-card {
      display: flex; gap: 14px; padding: 16px; background: var(--bg-surface);
      border-radius: var(--radius-md); align-items: flex-start;
    }
    .briefing-skeleton-icon { font-size: 1.3rem; flex-shrink: 0; opacity: 0.4; }
    .briefing-skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
    .skel-line { height: 10px; border-radius: 4px; }
    .skel-long { width: 90%; }
    .skel-med { width: 65%; }
    .skel-short { width: 40%; }
    .shimmer {
      background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%);
      background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite;
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .agents-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .agent-card { display: flex; align-items: center; gap: 16px; padding: 18px 20px; }
    .agent-icon { font-size: 2rem; }
    .agent-info h3 { font-family: var(--font-display); font-size: 1.15rem; margin-bottom: 2px; color: var(--text-primary); }
    .agent-info p { font-size: 0.8rem; color: var(--text-muted); margin: 0; }

    .tools-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
    .tool-card { display: flex; align-items: center; gap: 10px; padding: 14px 18px; font-size: 0.9rem; color: var(--text-primary); }
    .tool-icon { font-size: 1.3rem; }
    .tool-founder { border-color: var(--accent-primary); opacity: 0.8; }

    .loading-placeholder { padding-top: 24px; }

    @media (max-width: 600px) {
      .agents-grid { grid-template-columns: 1fr; }
      .essence-details { flex-direction: column; gap: 12px; }
    }
  `],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private scoring = inject(ScoringService);
  private router = inject(Router);
  private zone = inject(NgZone);

  profile: GeneratedProfile | null = null;
  briefing: DailyBriefing | null = null;
  briefingLoading = false;
  briefingLoadingText = 'Reading your profile...';
  private briefingTimer: ReturnType<typeof setInterval> | null = null;
  userRole = 'member';
  agentIds = ['financial', 'food-medicine', 'media', 'relationship', 'moonshot'];

  wheelCategories: { label: string; key: string; score: number }[] = [];
  wheelAngles: number[] = [];
  wheelPoints = '';

  private getLocalDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  async ngOnInit() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;

    const user = await this.userData.getUserProfile(userId);
    if (!user?.profile) {
      this.zone.run(() => this.router.navigate(['/onboarding']));
      return;
    }

    const [briefing, scores] = await Promise.all([
      this.userData.getTodayBriefing(userId),
      this.userData.getDimensionScores(userId),
    ]);

    const today = this.getLocalDate();
    let liveScores = scores;

    // Initialize scores from static profile if first time
    if (!liveScores) {
      liveScores = this.scoring.initFromWheel(user.profile!.wheelOfLife, today);
      await this.userData.saveDimensionScores(userId, liveScores);
    }

    // New-day detection: if stored date is not today, apply decay
    if (liveScores.lastDate !== today) {
      liveScores = this.scoring.decayAllScores(liveScores, today);
      liveScores.lastDate = today;
      await this.userData.saveDimensionScores(userId, liveScores);
    }

    this.zone.run(() => {
      this.profile = user.profile ?? null;
      this.userRole = user.role || 'member';
      this.theme.setTheme(this.profile!.colorKeyword);
      this.buildWheel(liveScores!);
      this.briefing = briefing;
    });
  }

  ngOnDestroy() {
    if (this.briefingTimer) clearInterval(this.briefingTimer);
  }

  buildWheel(scores: DimensionScores | WheelOfLife) {
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

  getName(id: string) { return AGENT_NAMES[id] || id; }
  getTagline(id: string) { return AGENT_TAGLINES[id] || ''; }
  getIcon(id: string) { return AGENT_ICONS[id] || '🤖'; }

  openAgent(id: string) { this.router.navigate(['/chat', id]); }
  navigate(path: string) { this.router.navigate([path]); }

  private readonly briefingMessages = [
    'Reading your profile...',
    'Checking your priorities...',
    'Crafting financial insights...',
    'Finding health suggestions...',
    'Personalizing your briefing...',
  ];

  async refreshBriefing() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;
    this.briefingLoading = true;
    this.briefingLoadingText = this.briefingMessages[0];
    let msgIndex = 0;
    this.briefingTimer = setInterval(() => {
      msgIndex = Math.min(msgIndex + 1, this.briefingMessages.length - 1);
      this.zone.run(() => {
        this.briefingLoadingText = this.briefingMessages[msgIndex];
      });
    }, 2500);
    try {
      const localDate = this.getLocalDate();
      const result = await this.api.generateDailyBriefing(userId, localDate);
      this.zone.run(() => {
        if (result) {
          this.briefing = result;
        }
        if (this.briefingTimer) clearInterval(this.briefingTimer);
        this.briefingTimer = null;
        this.briefingLoading = false;
      });
    } catch (e) {
      console.error(e);
      this.zone.run(() => {
        if (this.briefingTimer) clearInterval(this.briefingTimer);
        this.briefingTimer = null;
        this.briefingLoading = false;
      });
    }
  }

  signOut() { this.auth.signOut(); }
}
