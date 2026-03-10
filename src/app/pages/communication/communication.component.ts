/**
 * CommunicationComponent — Language pattern analysis and live speech coaching.
 *
 * 4 tabs:
 *   1. Live Mode   — Real-time speech analysis via Web Speech API + onLiveAnalyze (Haiku, polled every 8s)
 *                     Shows animated gauges for pace, clarity, empathy, emotional intensity, etc.
 *                     On stop: calls onPostCallSummary for full session analysis.
 *   2. Reflect     — Journal entry submission → onReframeSubmit → pattern analysis + reframes
 *   3. Lexicon     — User's personal vocabulary upgrade library (weak phrases → strong replacements)
 *   4. Insights    — Historical journal entries with their analyses
 *
 * Live Mode uses the browser's SpeechRecognition API (Chrome/Edge only).
 * A rolling 500-char transcript window is sent to the backend for analysis.
 */
import { Component, inject, NgZone, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { ReframeAnalysis, LexiconItem, LiveGauges } from '../../models/interfaces';

@Component({
  selector: 'app-communication',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="container">
        <div class="page-header">
          <button class="btn-ghost" (click)="goBack()">← Dashboard</button>
          <h2>Communication Intelligence</h2>
        </div>

        <!-- Tabs -->
        <div class="tabs">
          <button *ngFor="let t of ['Live Mode','Reflect','Lexicon','Insights']" class="tab" [class.active]="activeTab === t" (click)="activeTab = t">{{ t }}</button>
        </div>

        <!-- LIVE MODE -->
        <div *ngIf="activeTab === 'Live Mode'" class="tab-content animate-fade">
          <div class="live-controls">
            <button class="btn-primary" *ngIf="!liveActive" (click)="startLive()">🎙 Start Session</button>
            <button class="btn-secondary" *ngIf="liveActive" (click)="stopLive()" style="background:#c0392b;border-color:#c0392b;color:white">⏹ Stop Session</button>
          </div>

          <div *ngIf="liveActive || gauges" class="gauges-grid">
            <div *ngFor="let g of gaugeConfigs" class="gauge-item">
              <div class="gauge-label">{{ g.label }}</div>
              <div class="gauge-bar-bg">
                <div class="gauge-bar-fill" [style.width.%]="getGaugeValue(g.key)" [style.background]="getGaugeColor(g.key)"></div>
              </div>
              <div class="gauge-value">{{ getGaugeValue(g.key) | number:'1.0-0' }}</div>
            </div>
          </div>

          <div *ngIf="gauges?.microPrompt" class="micro-prompt animate-fade">
            💡 {{ gauges!.microPrompt }}
          </div>

          <!-- Intent Sliders -->
          <div *ngIf="liveActive" class="intent-sliders">
            <h3 class="section-title">Adjust Intent</h3>
            <div *ngFor="let s of sliderConfigs" class="slider-item">
              <label>{{ s.label }}</label>
              <input type="range" min="0" max="100" [(ngModel)]="intentSliders[s.key]" class="slider" />
            </div>
          </div>

          <!-- Post-call summary -->
          <div *ngIf="postCallSummary" class="card post-call">
            <h3>Session Summary</h3>
            <div class="summary-section">
              <strong>Improve:</strong>
              <ul><li *ngFor="let m of postCallSummary.topMomentsToImprove">{{ m }}</li></ul>
            </div>
            <div class="summary-section">
              <strong>Wins:</strong>
              <ul><li *ngFor="let w of postCallSummary.wins">{{ w }}</li></ul>
            </div>
            <div class="summary-score">Overall: {{ postCallSummary.overallScore }}/10</div>
          </div>
        </div>

        <!-- REFLECT MODE -->
        <div *ngIf="activeTab === 'Reflect'" class="tab-content animate-fade">
          <div class="reflect-input">
            <textarea [(ngModel)]="reflectText" placeholder="Write a thought, frustration, or something you said in a conversation..." rows="4"></textarea>
            <div class="reflect-actions">
              <button class="btn-ghost" (click)="startVoiceCapture()" [disabled]="isRecording">
                {{ isRecording ? '🔴 Recording...' : '🎙 Voice' }}
              </button>
              <button class="btn-primary" (click)="submitReframe()" [disabled]="!reflectText.trim() || reframeLoading">
                {{ reframeLoading ? 'Analyzing...' : 'Analyze & Reframe' }}
              </button>
            </div>
          </div>

          <div *ngIf="analysis" class="analysis-results animate-slide">
            <!-- Scores -->
            <div class="scores-grid">
              <div *ngFor="let s of scoreItems" class="score-item">
                <div class="score-label">{{ s.label }}</div>
                <div class="gauge-bar-bg"><div class="gauge-bar-fill" [style.width.%]="s.value" [style.background]="s.color"></div></div>
                <div class="score-val">{{ s.value }}</div>
              </div>
            </div>

            <!-- Patterns -->
            <div class="patterns" *ngIf="analysis.patternsDetected.length">
              <h3>Detected Patterns</h3>
              <div class="pattern-chips">
                <span *ngFor="let p of analysis.patternsDetected" class="pattern-chip">{{ p }}</span>
              </div>
            </div>

            <!-- Reframes -->
            <div class="reframes">
              <h3>Empowered Reframes</h3>
              <div *ngFor="let r of analysis.reframes" class="reframe-card card">
                <h4>{{ r.title }}</h4>
                <p class="reframe-text">{{ r.reframeText }}</p>
                <p class="reframe-why"><em>{{ r.whyItWorks }}</em></p>
                <p class="reframe-action">Next action: {{ r.nextAction }}</p>
              </div>
            </div>

            <!-- Vocab Upgrades -->
            <div class="vocab-section" *ngIf="analysis.vocabularyUpgrades.length">
              <h3>Vocabulary Upgrades</h3>
              <div *ngFor="let v of analysis.vocabularyUpgrades" class="vocab-item">
                <span class="vocab-weak">"{{ v.weakPhrase }}"</span>
                <span class="vocab-arrow">→</span>
                <span class="vocab-strong">"{{ v.strongReplacement }}"</span>
                <button class="btn-ghost save-btn" (click)="saveToLexicon(v)">Save</button>
              </div>
            </div>

            <!-- Gene Keys -->
            <div *ngIf="analysis.genekeysAlignment?.length" class="gk-section">
              <h3>Gene Keys Alignment</h3>
              <div *ngFor="let gk of analysis.genekeysAlignment" class="gk-item card">
                <div class="gk-key">Key {{ gk.geneKey }} — {{ gk.frequencyDetected }}</div>
                <p>{{ gk.suggestedGiftReframe }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- LEXICON -->
        <div *ngIf="activeTab === 'Lexicon'" class="tab-content animate-fade">
          <div *ngIf="lexiconItems.length === 0" class="empty-state">
            <p>Your Strength Lexicon is empty. Save vocabulary upgrades from Reflect Mode to build it.</p>
          </div>
          <div *ngFor="let item of lexiconItems" class="vocab-item lexicon-entry">
            <span class="vocab-weak">"{{ item.weakPhrase }}"</span>
            <span class="vocab-arrow">→</span>
            <span class="vocab-strong">"{{ item.strongReplacement }}"</span>
            <span class="usage-count">Used {{ item.usageCount }}x</span>
          </div>
        </div>

        <!-- INSIGHTS -->
        <div *ngIf="activeTab === 'Insights'" class="tab-content animate-fade">
          <div *ngIf="weeklyData.length === 0" class="empty-state">
            <p>Submit journal entries in Reflect Mode to see your weekly trends here.</p>
          </div>
          <div *ngIf="weeklyData.length > 0" class="insights-chart">
            <h3>Agency Score — Last 7 Days</h3>
            <div class="mini-chart">
              <div *ngFor="let d of weeklyData" class="chart-bar-col">
                <div class="chart-bar" [style.height.%]="d.agency"></div>
                <span class="chart-label">{{ d.day }}</span>
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

    .tabs { display: flex; gap: 4px; margin-bottom: 24px; overflow-x: auto; }
    .tab {
      padding: 10px 18px; background: var(--bg-surface); color: var(--text-muted); border: 1px solid var(--border-subtle);
      border-radius: 100px; font-size: 0.85rem; cursor: pointer; white-space: nowrap; transition: all 0.2s;
    }
    .tab.active { background: var(--accent-soft); color: var(--accent-primary); border-color: var(--accent-primary); }
    .tab-content { min-height: 300px; }

    .live-controls { margin-bottom: 24px; }
    .gauges-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .gauge-item { padding: 10px 14px; background: var(--bg-surface); border-radius: var(--radius-sm); }
    .gauge-label { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    .gauge-bar-bg { height: 6px; background: var(--bg-elevated); border-radius: 3px; overflow: hidden; }
    .gauge-bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease, background 0.3s; }
    .gauge-value { font-size: 0.8rem; color: var(--text-primary); margin-top: 4px; text-align: right; }

    .micro-prompt {
      padding: 16px 20px; background: var(--accent-soft); border: 1px solid var(--accent-primary);
      border-radius: var(--radius-md); font-size: 1rem; color: var(--accent-primary);
      margin-bottom: 20px; text-align: center; font-weight: 500;
    }

    .intent-sliders { margin-top: 20px; }
    .slider-item { margin-bottom: 12px; }
    .slider-item label { font-size: 0.8rem; }
    .slider { width: 100%; -webkit-appearance: none; height: 4px; border-radius: 2px; background: var(--bg-elevated); border: none; padding: 0; }
    .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent-primary); cursor: pointer; }

    .post-call { margin-top: 24px; }
    .post-call h3 { margin-bottom: 12px; color: var(--accent-text); }
    .summary-section { margin-bottom: 12px; }
    .summary-section strong { color: var(--text-primary); font-size: 0.85rem; }
    .summary-section ul { margin: 6px 0 0 20px; }
    .summary-section li { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 4px; }
    .summary-score { font-size: 1.2rem; color: var(--accent-primary); font-weight: 600; margin-top: 12px; }

    .reflect-input { margin-bottom: 24px; }
    .reflect-input textarea { margin-bottom: 12px; }
    .reflect-actions { display: flex; gap: 10px; justify-content: flex-end; }

    .scores-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px; }
    .score-item { padding: 10px 14px; background: var(--bg-surface); border-radius: var(--radius-sm); }
    .score-label { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .score-val { font-size: 0.8rem; color: var(--text-primary); margin-top: 4px; text-align: right; }

    .patterns { margin-bottom: 24px; }
    .patterns h3, .reframes h3, .vocab-section h3, .gk-section h3 { font-family: var(--font-display); font-size: 1.1rem; color: var(--accent-text); margin-bottom: 12px; }
    .pattern-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .pattern-chip { padding: 6px 12px; background: rgba(231,76,60,0.15); color: #e74c3c; border-radius: 100px; font-size: 0.8rem; }

    .reframe-card { margin-bottom: 12px; }
    .reframe-card h4 { font-family: var(--font-display); color: var(--accent-primary); margin-bottom: 6px; }
    .reframe-text { color: var(--text-primary); margin-bottom: 6px; }
    .reframe-why { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 4px; }
    .reframe-action { color: var(--accent-primary); font-size: 0.85rem; }

    .vocab-section, .gk-section { margin-top: 24px; }
    .vocab-item { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--bg-surface); border-radius: var(--radius-sm); margin-bottom: 6px; flex-wrap: wrap; }
    .vocab-weak { color: #e74c3c; font-size: 0.85rem; }
    .vocab-arrow { color: var(--text-muted); }
    .vocab-strong { color: #50C878; font-size: 0.85rem; font-weight: 500; }
    .save-btn { margin-left: auto; padding: 4px 10px; font-size: 0.75rem; }
    .usage-count { margin-left: auto; font-size: 0.75rem; color: var(--text-muted); }

    .gk-item { margin-bottom: 10px; }
    .gk-key { font-size: 0.85rem; color: var(--accent-primary); font-weight: 600; margin-bottom: 4px; }

    .empty-state { text-align: center; padding: 60px 20px; }
    .empty-state p { color: var(--text-muted); }

    .insights-chart h3 { font-family: var(--font-display); color: var(--accent-text); margin-bottom: 16px; }
    .mini-chart { display: flex; gap: 8px; align-items: flex-end; height: 150px; padding: 0 10px; }
    .chart-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
    .chart-bar { width: 100%; max-width: 40px; background: var(--accent-primary); border-radius: 4px 4px 0 0; transition: height 0.3s; min-height: 4px; }
    .chart-label { font-size: 0.7rem; color: var(--text-muted); margin-top: 6px; }
  `],
})
export class CommunicationComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private router = inject(Router);
  private zone = inject(NgZone);

  activeTab = 'Reflect';

  // Live Mode
  liveActive = false;
  gauges: LiveGauges | null = null;
  intentSliders: Record<string, number> = { warmer: 50, direct: 50, reduceIntensity: 50, inviteParticipation: 50, slowDown: 50, shortenAnswers: 50 };
  postCallSummary: any = null;
  private mediaRecorder: MediaRecorder | null = null;
  private liveInterval: any = null;
  private liveTranscript = '';

  // Reflect Mode
  reflectText = '';
  reframeLoading = false;
  analysis: ReframeAnalysis | null = null;
  isRecording = false;

  // Lexicon
  lexiconItems: LexiconItem[] = [];

  // Insights
  weeklyData: { day: string; agency: number }[] = [];

  gaugeConfigs = [
    { label: 'Volume', key: 'volumeLevel' }, { label: 'Pace', key: 'pace' },
    { label: 'Talk Time %', key: 'talkTimeRatio' }, { label: 'Interruptions', key: 'interruptionCount' },
    { label: 'Intensity', key: 'emotionalIntensity' }, { label: 'Empathy', key: 'empathySignals' },
    { label: 'Anger/Edge', key: 'angerEdge' }, { label: 'Clarity', key: 'clarity' },
    { label: 'Alignment', key: 'overallAlignment' },
  ];

  sliderConfigs = [
    { label: 'Be Warmer', key: 'warmer' }, { label: 'Be More Direct', key: 'direct' },
    { label: 'Reduce Intensity', key: 'reduceIntensity' }, { label: 'Invite Participation', key: 'inviteParticipation' },
    { label: 'Slow Down', key: 'slowDown' }, { label: 'Shorten Answers', key: 'shortenAnswers' },
  ];

  get scoreItems() {
    if (!this.analysis) return [];
    const s = this.analysis.scores;
    return [
      { label: 'Agency', value: s.agency, color: '#50C878' },
      { label: 'Blame', value: s.blame, color: '#e74c3c' },
      { label: 'Certainty', value: s.certainty, color: '#3498db' },
      { label: 'Future Orientation', value: s.futureOrientation, color: '#2A9D8F' },
      { label: 'Emotional Polarity', value: Math.abs(s.emotionalPolarity), color: s.emotionalPolarity >= 0 ? '#50C878' : '#e74c3c' },
    ];
  }

  async ngOnInit() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;
    const user = await this.userData.getUserProfile(userId);
    if (user?.profile) this.theme.setTheme(user.profile.colorKeyword);
    this.lexiconItems = await this.userData.getLexicon(userId);
    await this.loadWeeklyData();
  }

  ngOnDestroy() { this.stopLive(); }

  // ── Live Mode ──────────────────────────────────────────────
  async startLive() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.liveActive = true;
      this.liveTranscript = '';
      this.postCallSummary = null;

      // Set up MediaRecorder for chunked capture
      this.mediaRecorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      this.mediaRecorder.start();

      // Poll every 8 seconds
      this.liveInterval = setInterval(async () => {
        // For V1, we simulate transcript from accumulated audio
        // In production, each chunk would go through Whisper transcription
        // Here we send accumulated text to the LLM for gauge analysis
        if (this.liveTranscript.length > 10) {
          await this.analyzeLiveChunk();
        }
      }, 8000);

      // For demo purposes, use speech recognition if available
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          this.liveTranscript += ' ' + transcript;
          // Keep only last ~500 chars for analysis window
          if (this.liveTranscript.length > 500) {
            this.liveTranscript = this.liveTranscript.slice(-500);
          }
        };
        recognition.start();
        (this as any)._recognition = recognition;
      }
    } catch (e) {
      console.error('Mic access denied:', e);
    }
  }

  async stopLive() {
    this.liveActive = false;
    if (this.liveInterval) { clearInterval(this.liveInterval); this.liveInterval = null; }
    if (this.mediaRecorder) { this.mediaRecorder.stop(); this.mediaRecorder = null; }
    if ((this as any)._recognition) { (this as any)._recognition.stop(); }

    // Generate post-call summary
    if (this.liveTranscript.length > 20) {
      const userId = this.auth.getCurrentUserId();
      if (userId) {
        try {
          const summary = await this.api.generatePostCallSummary(userId, this.liveTranscript);
          this.zone.run(() => { this.postCallSummary = summary; });
        } catch (e) { console.error(e); }
      }
    }
  }

  private async analyzeLiveChunk() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;
    try {
      const result = await this.api.analyzeLive(userId, this.liveTranscript, this.intentSliders);
      this.zone.run(() => { if (result) { this.gauges = result; } });
    } catch (e) { console.error(e); }
  }

  getGaugeValue(key: string): number {
    if (!this.gauges) return 0;
    const val = (this.gauges as any)[key];
    if (key === 'talkTimeRatio') return val || 0;
    return ((val || 0) / 10) * 100; // convert 1-10 to percentage
  }

  getGaugeColor(key: string): string {
    const val = this.getGaugeValue(key);
    if (key === 'angerEdge' || key === 'emotionalIntensity') {
      return val > 70 ? '#e74c3c' : val > 40 ? '#f39c12' : '#50C878';
    }
    if (key === 'empathySignals' || key === 'clarity' || key === 'overallAlignment') {
      return val > 60 ? '#50C878' : val > 30 ? '#f39c12' : '#e74c3c';
    }
    return 'var(--accent-primary)';
  }

  // ── Reflect Mode ───────────────────────────────────────────
  async startVoiceCapture() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Speech recognition not supported in this browser.');
      return;
    }
    this.isRecording = true;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      this.reflectText += event.results[0][0].transcript;
      this.isRecording = false;
    };
    recognition.onerror = () => { this.isRecording = false; };
    recognition.onend = () => { this.isRecording = false; };
    recognition.start();
  }

  async submitReframe() {
    const userId = this.auth.getCurrentUserId();
    if (!userId || !this.reflectText.trim()) return;
    this.reframeLoading = true;
    try {
      const result = await this.api.submitReframe(userId, this.reflectText);
      this.zone.run(() => {
        this.analysis = result;
        this.reframeLoading = false;
      });
      await this.userData.saveJournalEntry(userId, this.reflectText, result);
    } catch (e) {
      console.error(e);
      this.zone.run(() => { this.reframeLoading = false; });
    }
  }

  async saveToLexicon(v: { weakPhrase: string; strongReplacement: string; rationale: string }) {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;
    await this.userData.saveLexiconItem(userId, v);
    this.lexiconItems = await this.userData.getLexicon(userId);
  }

  // ── Insights ───────────────────────────────────────────────
  async loadWeeklyData() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;
    const entries = await this.userData.getJournalEntries(userId, 7);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    this.weeklyData = entries.slice(0, 7).reverse().map((e: any) => ({
      day: e.createdAt ? days[e.createdAt.toDate().getDay()] : '?',
      agency: e.analysis?.scores?.agency || 0,
    }));
  }

  goBack() { this.router.navigate(['/dashboard']); }
}
