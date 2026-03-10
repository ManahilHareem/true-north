/**
 * InspirationComponent — "Positive Futures" page.
 *
 * Generates 5 personalized future visions (one per category: food, money, medicine,
 * media, relationships) using onGenerateFutureVision Cloud Function.
 *
 * Generation flow:
 *   1. Fire 5 sequential calls (one per category) with loading animation per card
 *   2. Each vision appears as it arrives (streaming UX without actual streaming)
 *   3. After all 5 arrive, call onFinalizeFutures to save + update memory
 *
 * Visions are cached in Firestore (users/{uid}/future_visions/current).
 * User can regenerate at any time.
 */
import { Component, inject, NgZone, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { FutureVision } from '../../models/interfaces';

const CATEGORIES = ['food', 'money', 'medicine', 'media', 'relationships'];

@Component({
  selector: 'app-inspiration',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="container">
        <div class="page-header">
          <button class="btn-ghost" (click)="goBack()">← Dashboard</button>
          <h2>Positive Futures</h2>
        </div>

        <div class="section">
          <div class="section-header">
            <h3 class="section-title">Your Positive Futures</h3>
            <button class="btn-ghost" (click)="regenerateVisions()" [disabled]="visionsLoading" *ngIf="(visions.length > 0 || visionsLoading) && !visionsLoading">↻ Regenerate</button>
          </div>

          <!-- Pre-load ceremony (before first vision arrives) -->
          <div *ngIf="showLoading" class="loading-feed">
            <div class="loading-progress">
              <div class="loading-icon-spin">🔮</div>
              <p class="loading-msg">Imagining your futures...</p>
              <div class="loading-bar"><div class="loading-bar-fill"></div></div>
            </div>
            <div class="skeleton-stack">
              <div *ngFor="let s of [1,2,3]" class="vision-skeleton shimmer"></div>
            </div>
          </div>

          <!-- Streaming visions + skeletons (once first vision arrives) -->
          <div *ngIf="visions.length > 0" class="visions-grid">
            <div *ngFor="let v of visions; let i = index" class="vision-card card animate-fade" [style.animation-delay.ms]="i * 80">
              <div class="vision-category">{{ getCategoryIcon(v.category) }} {{ v.category | titlecase }}</div>
              <h3 class="vision-title">{{ v.title }}</h3>
              <div class="vision-text" [innerHTML]="formatText(v.visionText)"></div>
            </div>
            <!-- Skeleton placeholders for remaining -->
            <div *ngFor="let s of skeletonSlots" class="vision-skeleton shimmer"></div>
          </div>

          <!-- Progress bar while loading (after first vision) -->
          <div *ngIf="visionsLoading && visions.length > 0" class="stream-progress">
            <div class="stream-bar"><div class="stream-fill" [style.width.%]="(visions.length / 5) * 100"></div></div>
            <span class="stream-text">{{ visions.length }} of 5 futures imagined...</span>
          </div>

          <!-- Empty state -->
          <div *ngIf="visions.length === 0 && !visionsLoading && !initialLoading" class="empty-card" (click)="regenerateVisions()">
            <p>Tap to generate your personalized future visions across 5 life categories.</p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-header{display:flex;align-items:center;gap:16px;margin-bottom:20px}
    .page-header h2{flex:1;color:var(--accent-text)}
    .section-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px}
    .visions-grid{display:flex;flex-direction:column;gap:16px}
    .vision-card{overflow:hidden}
    .vision-category{font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:var(--accent-primary);margin-bottom:8px;font-weight:600}
    .vision-title{font-family:var(--font-display);font-size:1.3rem;color:var(--accent-text);margin-bottom:12px}
    .vision-text{color:var(--text-secondary);font-size:.9rem;line-height:1.75}
    .loading-feed{display:flex;flex-direction:column;gap:24px}
    .loading-progress{text-align:center;padding:32px 20px;background:var(--bg-surface);border-radius:var(--radius-lg);border:1px solid var(--border-subtle)}
    .loading-icon-spin{font-size:2.5rem;margin-bottom:16px;animation:spin 2s linear infinite}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    .loading-msg{font-size:.9rem;color:var(--text-secondary);margin:12px 0 16px}
    .loading-bar{height:3px;background:var(--bg-elevated);border-radius:100px;overflow:hidden;max-width:200px;margin:0 auto}
    .loading-bar-fill{height:100%;background:var(--accent-primary);border-radius:100px;animation:progress-sweep 15s ease-in-out forwards}
    @keyframes progress-sweep{0%{width:0%}20%{width:20%}50%{width:45%}80%{width:75%}100%{width:95%}}
    .skeleton-stack{display:flex;flex-direction:column;gap:12px}
    .vision-skeleton{height:140px;border-radius:var(--radius-lg)}
    .shimmer{background:linear-gradient(90deg,var(--bg-surface) 25%,var(--bg-elevated) 50%,var(--bg-surface) 75%);background-size:200% 100%;animation:shimmer 1.5s ease-in-out infinite}
    @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    .stream-progress{display:flex;align-items:center;gap:12px;padding:8px 0;margin-top:4px}
    .stream-bar{flex:1;height:3px;background:var(--bg-elevated);border-radius:100px;overflow:hidden}
    .stream-fill{height:100%;background:var(--accent-primary);border-radius:100px;transition:width .4s ease}
    .stream-text{font-size:.75rem;color:var(--text-muted);white-space:nowrap}
    .empty-card{text-align:center;padding:48px 24px;background:var(--bg-surface);border:2px dashed var(--border-subtle);border-radius:var(--radius-lg);cursor:pointer;transition:all .2s}
    .empty-card:hover{border-color:var(--accent-primary);background:var(--accent-soft)}
    .empty-card p{color:var(--text-muted);max-width:400px;margin:0 auto}
  `],
})
export class InspirationComponent implements OnInit {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private router = inject(Router);
  private zone = inject(NgZone);

  visions: FutureVision[] = [];
  visionsLoading = false;
  initialLoading = true;

  get skeletonSlots(): number[] {
    if (!this.visionsLoading) return [];
    const remaining = 5 - this.visions.length;
    return remaining > 0 ? Array.from({ length: remaining }, (_, i) => i) : [];
  }

  get showLoading(): boolean {
    return (this.initialLoading || this.visionsLoading) && this.visions.length === 0;
  }

  async ngOnInit() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) { this.zone.run(() => { this.initialLoading = false; }); return; }

    const user = await this.userData.getUserProfile(userId);
    if (user?.profile) this.theme.setTheme(user.profile.colorKeyword);

    const visionsData = await this.userData.getFutureVisions(userId);

    this.zone.run(() => {
      if (visionsData?.visions) {
        const updatedAt = visionsData.updatedAt?.toDate?.() || new Date(0);
        const daysSince = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < 7) {
          this.visions = visionsData.visions;
        }
      }
      this.initialLoading = false;
    });
  }

  async regenerateVisions() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;

    this.zone.run(() => {
      this.visionsLoading = true;
      this.visions = [];
    });

    const completed: FutureVision[] = [];
    for (const category of CATEGORIES) {
      try {
        const vision = await this.api.generateFutureVision(userId, category);
        completed.push(vision);
        this.zone.run(() => {
          this.visions = [...completed];
        });
      } catch (err) {
        console.error(`Failed to generate vision for "${category}":`, err);
      }
    }

    this.zone.run(() => { this.visionsLoading = false; });

    // Save + memory update in background
    if (completed.length > 0) {
      this.api.finalizeFutures(userId, completed).catch(console.error);
    }
  }

  getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      food: '🥗', money: '💰', medicine: '🌿', media: '📡', relationships: '💫',
    };
    return icons[category?.toLowerCase()] || '📰';
  }

  formatText(text: string): string {
    return text.replace(/\n/g, '<br>');
  }

  goBack() { this.router.navigate(['/dashboard']); }
}
