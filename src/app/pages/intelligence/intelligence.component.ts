/**
 * IntelligenceComponent — Founders-only transcript intelligence agent.
 * Protected by founderGuard (requires role='founder' or 'admin').
 *
 * 5 tabs:
 *   1. Upload  — Upload call transcripts → processed by onTranscriptProcess
 *   2. Briefs  — View extracted summaries and key insights from past transcripts
 *   3. Threads — Auto-generated topic threads that evolve across transcripts
 *   4. People  — Entity/person extraction from all transcripts (deduplicated)
 *   5. Query   — Natural language questions across all transcript data via onTranscriptQuery
 *
 * This is the most complex data page. It manages relationships between
 * transcripts, threads, entities, decisions, and open loops.
 */
import { Component, inject, NgZone, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { TranscriptExtraction, Thread } from '../../models/interfaces';
import { FileIngestionComponent } from '../../components/file-ingestion/file-ingestion.component';

@Component({
  selector: 'app-intelligence',
  standalone: true,
  imports: [CommonModule, FormsModule, FileIngestionComponent],
  template: `
    <div class="page">
      <div class="container">
        <div class="page-header">
          <button class="btn-ghost" (click)="goBack()">← Dashboard</button>
          <h2>Intelligence Agent</h2>
          <span class="founder-badge">Founders Only</span>
        </div>

        <!-- Tabs -->
        <div class="tabs">
          <button *ngFor="let t of ['Upload','Briefs','Threads','People','Query']" class="tab" [class.active]="activeTab === t" (click)="activeTab = t">{{ t }}</button>
        </div>

        <!-- UPLOAD TAB -->
        <div *ngIf="activeTab === 'Upload'" class="tab-content animate-fade">
          <app-file-ingestion
            [userId]="currentUserId"
            [mode]="'intelligence'"
            [accept]="'.txt,.pdf,.doc,.docx'"
            [hint]="'Call transcripts, meeting notes, strategy documents'"
            (fileIngested)="onTranscriptIngested($event)"
            (ingestError)="onIngestError($event)">
          </app-file-ingestion>
        </div>

        <!-- BRIEFS TAB -->
        <div *ngIf="activeTab === 'Briefs'" class="tab-content animate-fade">
          <div *ngIf="extractions.length === 0" class="empty-state">
            <p>No transcripts processed yet. Upload call recordings or transcripts to get started.</p>
          </div>

          <div *ngFor="let ext of extractions" class="brief-card card" [class.expanded]="expandedBrief === ext.id">
            <div class="brief-header" (click)="expandedBrief = expandedBrief === ext.id ? null : ext.id">
              <div>
                <h4>{{ ext.fileName }}</h4>
                <span class="brief-date">{{ ext.createdAt?.toDate ? (ext.createdAt.toDate() | date:'mediumDate') : '' }}</span>
              </div>
              <span class="expand-arrow">{{ expandedBrief === ext.id ? '▼' : '▶' }}</span>
            </div>

            <div *ngIf="expandedBrief === ext.id" class="brief-body animate-fade">
              <div class="brief-section">
                <h5>Executive Summary</h5>
                <p>{{ ext.executiveSummary }}</p>
              </div>

              <div class="brief-section" *ngIf="ext.nuggets.length">
                <h5>Top Insights</h5>
                <ol class="nuggets-list"><li *ngFor="let n of ext.nuggets">{{ n }}</li></ol>
              </div>

              <div class="brief-section" *ngIf="ext.decisionsMade.length">
                <h5>Decisions Made</h5>
                <div *ngFor="let d of ext.decisionsMade" class="decision-item">
                  <strong>{{ d.decision }}</strong>
                  <span class="decision-context">{{ d.context }}</span>
                </div>
              </div>

              <div class="brief-section" *ngIf="ext.openLoops.length">
                <h5>Open Loops</h5>
                <div *ngFor="let ol of ext.openLoops" class="loop-item">
                  <span class="loop-question">{{ ol.question }}</span>
                  <span class="loop-owner">→ {{ ol.whoOwesAnswer }}</span>
                  <span class="loop-priority" [ngClass]="ol.priority">{{ ol.priority }}</span>
                </div>
              </div>

              <div class="brief-section" *ngIf="ext.actionItems.length">
                <h5>Action Items</h5>
                <div *ngFor="let ai of ext.actionItems" class="action-item">
                  <span class="action-text">{{ ai.action }}</span>
                  <span class="action-owner">{{ ai.suggestedOwner }}</span>
                  <span class="action-urgency" [ngClass]="ai.urgency">{{ ai.urgency }}</span>
                </div>
              </div>

              <div class="brief-section" *ngIf="ext.risks.length">
                <h5>Risks & Concerns</h5>
                <div *ngFor="let r of ext.risks" class="risk-item">⚠ {{ r }}</div>
              </div>

              <div class="brief-section" *ngIf="ext.entitiesMentioned.length">
                <h5>Entities Mentioned</h5>
                <div class="entities-chips">
                  <span *ngFor="let e of ext.entitiesMentioned" class="entity-chip" [ngClass]="e.type" [title]="e.context">
                    {{ getEntityIcon(e.type) }} {{ e.name }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- THREADS TAB -->
        <div *ngIf="activeTab === 'Threads'" class="tab-content animate-fade">
          <div *ngIf="threads.length === 0" class="empty-state">
            <p>No threads yet. Threads form automatically as you process transcripts.</p>
          </div>

          <div *ngFor="let t of threads" class="thread-card card">
            <div class="thread-header">
              <h4>{{ t.title }}</h4>
              <span class="thread-status" [ngClass]="t.status">{{ t.status }}</span>
            </div>
            <p class="thread-summary">{{ t.summaryCurrent }}</p>
            <div class="thread-meta">
              <span *ngIf="t.lastMentionedAt">Last mentioned: {{ t.lastMentionedAt?.toDate ? (t.lastMentionedAt.toDate() | date:'mediumDate') : '' }}</span>
            </div>
            <div *ngIf="t.openLoops.length" class="thread-loops">
              <span class="loop-label">Open loops:</span>
              <span *ngFor="let ol of t.openLoops" class="mini-loop">{{ ol }}</span>
            </div>
            <div *ngIf="t.nextBestActions.length" class="thread-actions">
              <span class="action-label">Next moves:</span>
              <span *ngFor="let a of t.nextBestActions" class="mini-action">{{ a }}</span>
            </div>
          </div>
        </div>

        <!-- PEOPLE TAB -->
        <div *ngIf="activeTab === 'People'" class="tab-content animate-fade">
          <div *ngIf="people.length === 0" class="empty-state">
            <p>No people tracked yet. People are extracted from processed transcripts.</p>
          </div>
          <div *ngFor="let p of people" class="person-card card">
            <div class="person-name">{{ p.name }}</div>
            <div class="person-context">{{ p.context }}</div>
            <div class="person-source">From: {{ p.sourceTranscript }}</div>
          </div>
        </div>

        <!-- QUERY TAB -->
        <div *ngIf="activeTab === 'Query'" class="tab-content animate-fade">
          <p class="query-desc">Ask questions across all your processed transcripts. Answers are grounded in the data with citations.</p>

          <div class="query-examples">
            <span class="example-chip" *ngFor="let ex of queryExamples" (click)="queryText = ex">{{ ex }}</span>
          </div>

          <div class="query-input-area">
            <textarea [(ngModel)]="queryText" placeholder="What did we decide about...?" rows="2"></textarea>
            <button class="btn-primary" (click)="submitQuery()" [disabled]="!queryText.trim() || queryLoading">
              {{ queryLoading ? 'Searching...' : 'Ask' }}
            </button>
          </div>

          <div *ngIf="queryResponse" class="query-response card animate-fade">
            <div class="response-text" [innerHTML]="formatResponse(queryResponse)"></div>
          </div>

          <div *ngIf="queryHistory.length > 0" class="query-history">
            <h5>Previous Queries</h5>
            <div *ngFor="let qh of queryHistory" class="history-item" (click)="queryText = qh.question">
              <span class="history-q">{{ qh.question }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
    .page-header h2 { flex: 1; color: var(--accent-text); }
    .founder-badge {
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em;
      padding: 4px 10px; background: var(--accent-soft); color: var(--accent-primary);
      border-radius: 100px; border: 1px solid var(--accent-primary);
    }

    .tabs { display: flex; gap: 4px; margin-bottom: 24px; overflow-x: auto; }
    .tab {
      padding: 10px 18px; background: var(--bg-surface); color: var(--text-muted); border: 1px solid var(--border-subtle);
      border-radius: 100px; font-size: 0.85rem; cursor: pointer; white-space: nowrap; transition: all 0.2s;
    }
    .tab.active { background: var(--accent-soft); color: var(--accent-primary); border-color: var(--accent-primary); }

.brief-card { margin-bottom: 12px; padding: 0; overflow: hidden; }
    .brief-header {
      display: flex; justify-content: space-between; align-items: center; padding: 18px 20px;
      cursor: pointer; transition: background 0.2s;
    }
    .brief-header:hover { background: var(--bg-elevated); }
    .brief-header h4 { font-family: var(--font-display); color: var(--text-primary); margin-bottom: 2px; }
    .brief-date { font-size: 0.75rem; color: var(--text-muted); }
    .expand-arrow { color: var(--text-muted); font-size: 0.7rem; }

    .brief-body { padding: 0 20px 20px; }
    .brief-section { margin-bottom: 20px; }
    .brief-section h5 {
      font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--accent-primary); margin-bottom: 8px;
    }
    .brief-section p { font-size: 0.9rem; line-height: 1.7; }

    .nuggets-list { margin-left: 18px; }
    .nuggets-list li { font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 4px; }

    .decision-item { margin-bottom: 8px; }
    .decision-item strong { display: block; font-size: 0.9rem; color: var(--text-primary); }
    .decision-context { font-size: 0.8rem; color: var(--text-muted); }

    .loop-item, .action-item { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
    .loop-question, .action-text { font-size: 0.9rem; color: var(--text-primary); flex: 1; }
    .loop-owner, .action-owner { font-size: 0.8rem; color: var(--accent-primary); }
    .loop-priority, .action-urgency {
      font-size: 0.7rem; padding: 2px 8px; border-radius: 100px; text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .loop-priority.high, .action-urgency.immediate { background: rgba(231,76,60,0.15); color: #e74c3c; }
    .loop-priority.medium, .action-urgency.this-week { background: rgba(243,156,18,0.15); color: #f39c12; }
    .loop-priority.low, .action-urgency.soon, .action-urgency.backlog { background: rgba(42,157,143,0.15); color: #2A9D8F; }

    .risk-item { font-size: 0.9rem; color: #f39c12; margin-bottom: 4px; }

    .entities-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .entity-chip {
      padding: 4px 10px; font-size: 0.8rem; border-radius: 100px; border: 1px solid var(--border-subtle);
      color: var(--text-secondary); cursor: default;
    }
    .entity-chip.person { border-color: rgba(42,157,143,0.4); color: #2A9D8F; }
    .entity-chip.org { border-color: rgba(212,168,67,0.4); color: #D4A843; }
    .entity-chip.project { border-color: rgba(80,200,120,0.4); color: #50C878; }
    .entity-chip.asset { border-color: rgba(212,114,140,0.4); color: #D4728C; }

    .thread-card { margin-bottom: 12px; }
    .thread-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .thread-header h4 { font-family: var(--font-display); color: var(--text-primary); }
    .thread-status {
      font-size: 0.7rem; padding: 3px 10px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .thread-status.active { background: rgba(80,200,120,0.15); color: #50C878; }
    .thread-status.waiting { background: rgba(243,156,18,0.15); color: #f39c12; }
    .thread-status.stalled { background: rgba(231,76,60,0.15); color: #e74c3c; }
    .thread-status.resolved { background: rgba(42,157,143,0.15); color: #2A9D8F; }
    .thread-summary { font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 8px; }
    .thread-meta { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; }
    .thread-loops, .thread-actions { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .loop-label, .action-label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; }
    .mini-loop, .mini-action { font-size: 0.8rem; padding: 3px 10px; background: var(--bg-elevated); border-radius: 100px; color: var(--text-secondary); }

    .person-card { margin-bottom: 10px; }
    .person-name { font-family: var(--font-display); font-size: 1.05rem; color: var(--text-primary); margin-bottom: 4px; }
    .person-context { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 4px; }
    .person-source { font-size: 0.75rem; color: var(--text-muted); }

    .query-desc { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 16px; }
    .query-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
    .example-chip {
      padding: 6px 12px; background: var(--bg-surface); border: 1px solid var(--border-subtle);
      border-radius: 100px; font-size: 0.8rem; color: var(--text-secondary); cursor: pointer; transition: all 0.2s;
    }
    .example-chip:hover { border-color: var(--accent-primary); color: var(--accent-primary); }
    .query-input-area { display: flex; gap: 10px; align-items: flex-end; margin-bottom: 20px; }
    .query-input-area textarea { flex: 1; min-height: 60px; }
    .query-response { margin-bottom: 24px; }
    .response-text { font-size: 0.9rem; line-height: 1.7; color: var(--text-primary); white-space: pre-wrap; }
    .query-history { margin-top: 24px; }
    .query-history h5 { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
    .history-item { padding: 8px 12px; background: var(--bg-surface); border-radius: var(--radius-sm); margin-bottom: 4px; cursor: pointer; transition: background 0.2s; }
    .history-item:hover { background: var(--bg-elevated); }
    .history-q { font-size: 0.85rem; color: var(--text-secondary); }

    .empty-state { text-align: center; padding: 60px 20px; }
    .empty-state p { color: var(--text-muted); }
  `],
})
export class IntelligenceComponent implements OnInit {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private router = inject(Router);
  private zone = inject(NgZone);

  currentUserId = this.auth.getCurrentUserId() ?? '';
  activeTab = 'Upload';

  extractions: TranscriptExtraction[] = [];
  expandedBrief: string | null | undefined = null;

  threads: Thread[] = [];
  people: any[] = [];

  queryText = '';
  queryLoading = false;
  queryResponse = '';
  queryHistory: { question: string; answer: string }[] = [];

  queryExamples = [
    'What are the top open loops?',
    'What did we decide about tokenization?',
    'List all investment ideas discussed',
    'Who do we need to follow up with?',
    'What contradictions have emerged?',
  ];

  async ngOnInit() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;

    const user = await this.userData.getUserProfile(userId);
    if (user?.profile) this.theme.setTheme(user.profile.colorKeyword);

    this.extractions = await this.userData.getTranscriptExtractions(userId);
    this.threads = await this.userData.getThreads(userId);
    this.people = await this.userData.getAllEntities(userId);
    // Filter to people only
    this.people = this.people.filter(e => e.type === 'person');
  }

  async onTranscriptIngested(event: { fileName: string; fileUrl: string; source: 'local' | 'drive' }) {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;
    const extractions = await this.userData.getTranscriptExtractions(userId);
    const threads = await this.userData.getThreads(userId);
    const people = (await this.userData.getAllEntities(userId)).filter((e: any) => e.type === 'person');
    this.zone.run(() => {
      this.extractions = extractions;
      this.threads = threads;
      this.people = people;
      this.activeTab = 'Briefs';
    });
  }

  onIngestError(event: { fileName: string; error: string }) {
    console.error('Transcript ingestion error:', event);
  }

  async submitQuery() {
    const userId = this.auth.getCurrentUserId();
    if (!userId || !this.queryText.trim()) return;
    this.queryLoading = true;
    try {
      const result = await this.api.queryTranscripts(userId, this.queryText);
      this.zone.run(() => {
        this.queryResponse = result?.answer || result?.response || 'No answer found.';
        this.queryHistory.unshift({ question: this.queryText, answer: this.queryResponse });
        this.queryLoading = false;
      });
    } catch (e) {
      console.error(e);
      this.zone.run(() => {
        this.queryResponse = 'Query failed. Please try again.';
        this.queryLoading = false;
      });
    }
  }

  getEntityIcon(type: string): string {
    const icons: Record<string, string> = { person: '👤', org: '🏢', project: '📋', asset: '💎' };
    return icons[type] || '◆';
  }

  formatResponse(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  goBack() { this.router.navigate(['/dashboard']); }
}
