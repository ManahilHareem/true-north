/**
 * ArticlesComponent — "Signal Stream" personalized news feed.
 *
 * Generates 5 articles (one per user topic from onboarding.newsTopics) using
 * onGenerateEditionItem Cloud Function with web search.
 *
 * Generation flow:
 *   1. Fire 5 PARALLEL calls (one per topic) for fast loading
 *   2. Articles appear one by one as they arrive
 *   3. After all 5: calls onSaveEdition to persist to Firestore
 *
 * Articles contain REAL URLs from Claude's web_search tool — not hallucinated.
 * Cached per date (users/{uid}/editions/{date}).
 * First article renders as "hero" card, rest in a 2-column grid.
 * User can up/down vote articles (saved as feedback, but not yet used for personalization).
 */
import { Component, inject, NgZone, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { Edition } from '../../models/interfaces';

@Component({
  selector: 'app-articles',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="container">
        <div class="page-header">
          <button class="btn-ghost" (click)="goBack()">← Dashboard</button>
          <h2>Signal Stream</h2>
        </div>

        <div class="section">
          <div class="section-header">
            <h3 class="section-title">Today's Signal Stream</h3>
            <button class="btn-ghost" (click)="generateEdition()" [disabled]="editionLoading" *ngIf="(edition || streamItems.length > 0) && !editionLoading">↻ Refresh</button>
          </div>

          <div *ngIf="displayItems.length > 0" class="news-grid">
            <div class="news-hero animate-fade" (click)="openLink(displayItems[0].url)">
              <div class="news-hero-img" [style.background]="getCategoryGradient(displayItems[0].category)">
                <span class="news-hero-icon">{{ getCategoryIcon(displayItems[0].category) }}</span>
              </div>
              <div class="news-hero-body">
                <div class="news-hero-meta">
                  <span class="news-tag" [style.background]="getCategoryColor(displayItems[0].category)">{{ displayItems[0].category | titlecase }}</span>
                  <span class="news-source">{{ displayItems[0].source }}</span>
                </div>
                <h3 class="news-hero-title">{{ displayItems[0].title }}</h3>
                <p class="news-hero-summary">{{ displayItems[0].summary }}</p>
              </div>
            </div>

            <div class="news-row">
              <ng-container *ngFor="let item of displayItems.slice(1)">
                <div class="news-card animate-fade" (click)="openLink(item.url)">
                  <div class="news-card-img" [style.background]="getCategoryGradient(item.category)">
                    <span class="news-card-icon">{{ getCategoryIcon(item.category) }}</span>
                  </div>
                  <div class="news-card-body">
                    <span class="news-tag-sm" [style.color]="getCategoryAccent(item.category)">{{ item.category | titlecase }}</span>
                    <h4 class="news-card-title">{{ item.title }}</h4>
                    <span class="news-source-sm">{{ item.source }}</span>
                  </div>
                </div>
              </ng-container>
              <div *ngFor="let i of remainingSlots" class="news-card skeleton-card-inline shimmer"></div>
            </div>

            <div *ngIf="editionLoading" class="stream-progress">
              <div class="stream-progress-bar">
                <div class="stream-progress-fill" [style.width.%]="(streamItems.length / 5) * 100"></div>
              </div>
              <span class="stream-progress-text">{{ streamItems.length }} of 5 articles found...</span>
            </div>
          </div>

          <div *ngIf="displayItems.length === 0 && !editionLoading" class="empty-card" (click)="generateEdition()">
            <p>Tap to generate your curated news feed — 5 real articles picked for you.</p>
          </div>

          <div *ngIf="editionLoading && displayItems.length === 0" class="loading-feed">
            <div class="loading-progress">
              <div class="loading-icon-spin">📡</div>
              <p class="loading-msg">Searching for articles...</p>
              <div class="loading-bar"><div class="loading-bar-fill"></div></div>
            </div>
            <div class="skeleton-grid">
              <div class="skeleton-hero shimmer"></div>
              <div class="skeleton-row">
                <div class="skeleton-card shimmer" *ngFor="let i of [1,2]"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
    .page-header h2 { flex: 1; color: var(--accent-text); }
    .section-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
    .empty-card {
      text-align: center; padding: 48px 24px; background: var(--bg-surface); border: 2px dashed var(--border-subtle);
      border-radius: var(--radius-lg); cursor: pointer; transition: all 0.2s;
    }
    .empty-card:hover { border-color: var(--accent-primary); background: var(--accent-soft); }
    .empty-card p { color: var(--text-muted); max-width: 400px; margin: 0 auto; }
    .news-grid { display: flex; flex-direction: column; gap: 16px; }
    .news-hero {
      display: flex; flex-direction: column; border-radius: var(--radius-lg); overflow: hidden;
      background: var(--bg-surface); border: 1px solid var(--border-subtle);
      cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
    }
    .news-hero:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
    .news-hero-img { height: 180px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .news-hero-icon { font-size: 4rem; opacity: 0.3; filter: grayscale(0.3); }
    .news-hero-body { padding: 20px; }
    .news-hero-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .news-tag {
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
      padding: 3px 10px; border-radius: 100px; color: #fff;
    }
    .news-source { font-size: 0.75rem; color: var(--text-muted); }
    .news-hero-title { font-family: var(--font-display); font-size: 1.35rem; color: var(--text-primary); margin-bottom: 8px; line-height: 1.3; }
    .news-hero-summary { font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; margin: 0; }
    .news-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .news-card {
      border-radius: var(--radius-md); overflow: hidden; background: var(--bg-surface);
      border: 1px solid var(--border-subtle); cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
    }
    .news-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.12); }
    .news-card-img { height: 100px; display: flex; align-items: center; justify-content: center; }
    .news-card-icon { font-size: 2.2rem; opacity: 0.3; filter: grayscale(0.3); }
    .news-card-body { padding: 14px; }
    .news-tag-sm { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; display: block; margin-bottom: 6px; }
    .news-card-title {
      font-family: var(--font-display); font-size: 0.95rem; color: var(--text-primary);
      margin: 0 0 8px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    .news-source-sm { font-size: 0.7rem; color: var(--text-muted); }
    @media (max-width: 500px) { .news-row { grid-template-columns: 1fr; } }
    .stream-progress { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
    .stream-progress-bar { flex: 1; height: 3px; background: var(--bg-elevated); border-radius: 100px; overflow: hidden; }
    .stream-progress-fill { height: 100%; background: var(--accent-primary); border-radius: 100px; transition: width 0.4s ease; }
    .stream-progress-text { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }
    .skeleton-card-inline { height: 180px; border-radius: var(--radius-md); }
    .loading-msg { font-size: 0.9rem; color: var(--text-secondary); margin: 12px 0 16px; }
    .loading-feed { display: flex; flex-direction: column; gap: 24px; }
    .loading-progress {
      text-align: center; padding: 32px 20px; background: var(--bg-surface);
      border-radius: var(--radius-lg); border: 1px solid var(--border-subtle);
    }
    .loading-icon-spin { font-size: 2.5rem; margin-bottom: 16px; animation: spin 2s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .loading-bar { height: 3px; background: var(--bg-elevated); border-radius: 100px; overflow: hidden; }
    .loading-bar-fill { height: 100%; background: var(--accent-primary); border-radius: 100px; animation: progress-sweep 12s ease-in-out forwards; }
    @keyframes progress-sweep { 0% { width: 0%; } 20% { width: 25%; } 50% { width: 55%; } 80% { width: 80%; } 100% { width: 95%; } }
    .skeleton-grid { display: flex; flex-direction: column; gap: 12px; }
    .skeleton-hero { height: 220px; border-radius: var(--radius-lg); }
    .skeleton-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .skeleton-card { height: 160px; border-radius: var(--radius-md); }
    @media (max-width: 500px) { .skeleton-row { grid-template-columns: 1fr; } }
    .shimmer {
      background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%);
      background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite;
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  `],
})
export class ArticlesComponent implements OnInit {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private router = inject(Router);
  private zone = inject(NgZone);

  edition: Edition | null = null;
  editionLoading = false;
  streamItems: any[] = [];
  private userTopics: string[] = [];
  private userExclusions: string[] = [];

  get displayItems(): any[] {
    if (this.streamItems.length > 0) return this.streamItems;
    return this.edition?.items || [];
  }

  get remainingSlots(): number[] {
    if (!this.editionLoading) return [];
    const shown = this.streamItems.length;
    const rowItems = Math.max(0, shown - 1);
    const totalRowSlots = 4;
    const remaining = totalRowSlots - rowItems;
    return remaining > 0 ? Array.from({ length: remaining }, (_, i) => i) : [];
  }

  async ngOnInit() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;

    const user = await this.userData.getUserProfile(userId);
    if (user?.profile) this.theme.setTheme(user.profile.colorKeyword);

    if (user?.onboarding) {
      this.userTopics = user.onboarding.newsTopics || [];
      this.userExclusions = user.onboarding.exclusions || [];
    }

    const edition = await this.userData.getTodayEdition(userId);
    this.zone.run(() => { this.edition = edition; });
  }

  async generateEdition() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;

    const topics = this.userTopics.length > 0
      ? this.userTopics.slice(0, 5)
      : ['technology', 'health', 'finance', 'science', 'culture'];

    const base = [...topics];
    while (topics.length < 5) {
      topics.push(base[topics.length % base.length]);
    }

    this.editionLoading = true;
    this.streamItems = [];
    this.edition = null;

    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const promises = topics.slice(0, 5).map((topic, i) =>
      this.api.generateEditionItem(userId, topic, i, this.userExclusions)
        .then(item => {
          this.zone.run(() => { this.streamItems = [...this.streamItems, item]; });
          return item;
        })
        .catch(err => {
          console.error(`Failed to fetch article for "${topic}":`, err);
          return null;
        })
    );

    await Promise.allSettled(promises);
    const items = this.streamItems;

    if (items.length > 0) {
      try {
        const edition = await this.api.saveEdition(userId, localDate, items);
        this.zone.run(() => {
          this.edition = edition || { editionId: '', userId, date: localDate, items };
          this.editionLoading = false;
        });
      } catch (e) {
        console.error('Failed to save edition:', e);
        this.zone.run(() => {
          this.edition = { editionId: '', userId, date: localDate, items } as any;
          this.editionLoading = false;
        });
      }
    } else {
      this.zone.run(() => { this.editionLoading = false; });
    }
  }

  getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      food: '🥗', money: '💰', medicine: '🌿', media: '📡', relationships: '💫',
      finance: '💰', health: '🌿', technology: '💻', science: '🔬', business: '📊',
      politics: '🏛️', culture: '🎭', sports: '⚽', entertainment: '🎬',
    };
    return icons[category?.toLowerCase()] || '📰';
  }

  getCategoryGradient(category: string): string {
    const gradients: Record<string, string> = {
      food: 'linear-gradient(135deg, #2d5016 0%, #1a3a0a 100%)',
      money: 'linear-gradient(135deg, #4a3800 0%, #2a2000 100%)',
      finance: 'linear-gradient(135deg, #4a3800 0%, #2a2000 100%)',
      medicine: 'linear-gradient(135deg, #0a3a2a 0%, #062a1e 100%)',
      health: 'linear-gradient(135deg, #0a3a2a 0%, #062a1e 100%)',
      media: 'linear-gradient(135deg, #1a1a4a 0%, #0e0e2e 100%)',
      technology: 'linear-gradient(135deg, #1a1a4a 0%, #0e0e2e 100%)',
      relationships: 'linear-gradient(135deg, #3a1a2a 0%, #2a0e1e 100%)',
      science: 'linear-gradient(135deg, #0a2a3a 0%, #061e2a 100%)',
      business: 'linear-gradient(135deg, #2a2a1a 0%, #1e1e0e 100%)',
    };
    return gradients[category?.toLowerCase()] || 'linear-gradient(135deg, #1a1a2e 0%, #0e0e1e 100%)';
  }

  getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
      food: '#4a8c2a', money: '#c8a82a', finance: '#c8a82a', medicine: '#2a8c6a', health: '#2a8c6a',
      media: '#5a5aaa', technology: '#5a5aaa', relationships: '#aa5a7a', science: '#2a7a9a',
      business: '#8a7a3a', politics: '#7a5a3a', culture: '#7a4a8a', sports: '#3a7a4a', entertainment: '#8a4a6a',
    };
    return colors[category?.toLowerCase()] || '#5a6a7a';
  }

  getCategoryAccent(category: string): string {
    const accents: Record<string, string> = {
      food: '#6ab04c', money: '#f0c040', finance: '#f0c040', medicine: '#4ac09a', health: '#4ac09a',
      media: '#8a8ae0', technology: '#8a8ae0', relationships: '#e08aaa', science: '#4aaac0',
      business: '#c0b060', politics: '#c0906a', culture: '#b07acc', sports: '#6ac08a', entertainment: '#cc7a9a',
    };
    return accents[category?.toLowerCase()] || '#8a9aaa';
  }

  openLink(url: string) {
    if (url) window.open(url, '_blank');
  }

  goBack() { this.router.navigate(['/dashboard']); }
}
