/**
 * OnboardingComponent — 6-step wizard that collects user data for profile generation.
 *
 * Steps: 0=Identity, 1=Personality, 2=Life Priorities, 3=Preferences, 4=File Uploads, 5=Generate Profile
 * On final step: saves onboarding data → calls onProfileGenerate Cloud Function →
 * saves generated profile → initializes dimension scores → navigates to /dashboard.
 *
 * File uploads (step 4) go to Firebase Storage. Genome files (23andMe TSV) are
 * detected and parsed server-side by onFileUpload Cloud Function.
 */
import { Component, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';
import { ApiService } from '../../services/api.service';
import { OnboardingData } from '../../models/interfaces';
import { FileIngestionComponent } from '../../components/file-ingestion/file-ingestion.component';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule, FileIngestionComponent],
  template: `
    <div class="page">
      <div class="container">
        <!-- Progress Bar -->
        <div class="progress-bar">
          <div class="progress-fill" [style.width.%]="((step + 1) / 6) * 100"></div>
        </div>
        <div class="step-label">Step {{ step + 1 }} of 6</div>

        <!-- Step 0: Identity -->
        <div class="step-content animate-fade" *ngIf="step === 0">
          <h2>Who You Are</h2>
          <p class="step-desc">The foundation of your True North profile.</p>

          <div class="field">
            <label>Full Name</label>
            <input type="text" [(ngModel)]="data.name" placeholder="Your name" />
          </div>
          <div class="field">
            <label>Date of Birth</label>
            <input type="date" [(ngModel)]="data.birthDate" />
          </div>
          <div class="field">
            <label>Time of Birth <span class="optional">(for astrology & Human Design)</span></label>
            <input type="time" [(ngModel)]="data.birthTime" />
          </div>
          <div class="field">
            <label>Location of Birth</label>
            <input type="text" [(ngModel)]="data.birthLocation" placeholder="City, State/Country" />
          </div>
        </div>

        <!-- Step 1: Personality & Values -->
        <div class="step-content animate-fade" *ngIf="step === 1">
          <h2>Personality &amp; Values</h2>
          <p class="step-desc">Help True North understand how you move through the world.</p>

          <div class="field">
            <label>Your Top Strengths <span class="optional">(select up to 5)</span></label>
            <div class="chip-group">
              <span *ngFor="let s of strengthOptions" class="chip" [class.active]="data.strengths.includes(s)" (click)="toggleChip(data.strengths, s, 5)">{{ s }}</span>
            </div>
          </div>
          <div class="field">
            <label>Communication Style</label>
            <div class="chip-group">
              <span *ngFor="let s of commStyles" class="chip" [class.active]="data.communicationStyle === s" (click)="data.communicationStyle = $any(s)">{{ s }}</span>
            </div>
          </div>
          <div class="field">
            <label>Spiritual Orientation</label>
            <input type="text" [(ngModel)]="data.spiritualOrientation" placeholder="e.g., Contemplative, Buddhist, Non-religious, Eclectic..." />
          </div>
          <div class="field">
            <label>Are you a morning or night person?</label>
            <div class="chip-group">
              <span class="chip" [class.active]="data.chronotype === 'morning'" (click)="data.chronotype = 'morning'">🌅 Morning</span>
              <span class="chip" [class.active]="data.chronotype === 'night'" (click)="data.chronotype = 'night'">🌙 Night</span>
            </div>
          </div>
          <div class="field">
            <label>Risk Tolerance: {{ data.riskTolerance }}/10</label>
            <input type="range" min="1" max="10" [(ngModel)]="data.riskTolerance" class="slider" />
            <div class="slider-labels"><span>Conservative</span><span>Aggressive</span></div>
          </div>
        </div>

        <!-- Step 2: Life Priorities -->
        <div class="step-content animate-fade" *ngIf="step === 2">
          <h2>Life Priorities</h2>
          <p class="step-desc">What matters most to you right now.</p>

          <div class="field">
            <label>Health Priorities</label>
            <div class="chip-group">
              <span *ngFor="let h of healthOptions" class="chip" [class.active]="data.healthPriorities.includes(h)" (click)="toggleChip(data.healthPriorities, h)">{{ h }}</span>
            </div>
          </div>
          <div class="field">
            <label>Financial Priorities</label>
            <div class="chip-group">
              <span *ngFor="let f of financeOptions" class="chip" [class.active]="data.financialPriorities.includes(f)" (click)="toggleChip(data.financialPriorities, f)">{{ f }}</span>
            </div>
          </div>
          <div class="field">
            <label>Relationship Goals</label>
            <div class="chip-group">
              <span *ngFor="let r of relationshipOptions" class="chip" [class.active]="data.relationshipGoals.includes(r)" (click)="toggleChip(data.relationshipGoals, r)">{{ r }}</span>
            </div>
          </div>
          <div class="field">
            <label>Career / Purpose Direction</label>
            <input type="text" [(ngModel)]="data.careerDirection" placeholder="What you're building or moving toward..." />
          </div>
        </div>

        <!-- Step 3: Preferences -->
        <div class="step-content animate-fade" *ngIf="step === 3">
          <h2>Preferences</h2>
          <p class="step-desc">How you want True North to communicate with you.</p>

          <div class="field">
            <label>AI Tone Preference</label>
            <div class="chip-group">
              <span *ngFor="let t of toneOptions" class="chip" [class.active]="data.tonePref === t" (click)="data.tonePref = $any(t)">{{ t }}</span>
            </div>
          </div>
          <div class="field">
            <label>News Topics of Interest</label>
            <div class="chip-group">
              <span *ngFor="let n of newsOptions" class="chip" [class.active]="data.newsTopics.includes(n)" (click)="toggleChip(data.newsTopics, n)">{{ n }}</span>
            </div>
          </div>
          <div class="field">
            <label>Topics to Exclude</label>
            <div class="chip-group">
              <span *ngFor="let e of exclusionOptions" class="chip" [class.active]="data.exclusions.includes(e)" (click)="toggleChip(data.exclusions, e)">{{ e }}</span>
            </div>
          </div>
          <div class="field">
            <label>Novelty Mode</label>
            <div class="chip-group">
              <span class="chip" [class.active]="data.noveltyMode === 'stabilize'" (click)="data.noveltyMode = 'stabilize'">🔒 Stabilize</span>
              <span class="chip" [class.active]="data.noveltyMode === 'expand'" (click)="data.noveltyMode = 'expand'">🌊 Expand</span>
              <span class="chip" [class.active]="data.noveltyMode === 'accelerate'" (click)="data.noveltyMode = 'accelerate'">⚡ Accelerate</span>
            </div>
          </div>
        </div>

        <!-- Step 4: Optional Uploads -->
        <div class="step-content animate-fade" *ngIf="step === 4">
          <h2>Optional Uploads</h2>
          <p class="step-desc">Share data for deeper personalization. You can always add more later.</p>

          <app-file-ingestion
            [userId]="currentUserId"
            [mode]="'onboarding'"
            [accept]="'.txt,.pdf,.csv,.doc,.docx,.jpg,.png'"
            [hint]="'23andMe raw data, lab results, financial docs, PDFs'"
            (fileIngested)="onFileIngested($event)"
            (ingestError)="onIngestError($event)">
          </app-file-ingestion>
        </div>

        <!-- Step 5: Generating Profile -->
        <div class="step-content animate-fade" *ngIf="step === 5">
          <div class="generating-state">
            <div class="gen-compass">
              <svg viewBox="0 0 120 120" width="120" height="120">
                <circle cx="60" cy="60" r="56" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" opacity="0.3"/>
                <circle cx="60" cy="60" r="40" fill="none" stroke="var(--accent-primary)" stroke-width="1" opacity="0.2" stroke-dasharray="4 4">
                  <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="20s" repeatCount="indefinite"/>
                </circle>
                <polygon points="60,10 64,52 60,60 56,52" fill="var(--accent-primary)" opacity="0.8">
                  <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="3s" repeatCount="indefinite"/>
                </polygon>
                <circle cx="60" cy="60" r="4" fill="var(--accent-primary)"/>
              </svg>
            </div>
            <h2>Discovering Your True North</h2>
            <p class="gen-sub">Synthesizing your identity, values, and aspirations into your personalized essence profile...</p>
            <div class="gen-steps">
              <div class="gen-step" [class.active]="genPhase >= 0">Reading your birth data...</div>
              <div class="gen-step" [class.active]="genPhase >= 1">Mapping personality patterns...</div>
              <div class="gen-step" [class.active]="genPhase >= 2">Integrating life priorities...</div>
              <div class="gen-step" [class.active]="genPhase >= 3">{{ uploadedFileCount > 0 ? 'Processing uploaded data...' : 'Calibrating preferences...' }}</div>
              <div class="gen-step" [class.active]="genPhase >= 4">Generating your Essence Card...</div>
            </div>
          </div>
        </div>

        <!-- Navigation -->
        <div class="nav-buttons" *ngIf="step < 5">
          <button class="btn-ghost" (click)="prevStep()" *ngIf="step > 0">← Back</button>
          <div class="spacer"></div>
          <button class="btn-primary" (click)="nextStep()" *ngIf="step < 4">Continue →</button>
          <button class="btn-primary" (click)="submitOnboarding()" *ngIf="step === 4" [disabled]="submitting">
            {{ submitting ? 'Processing...' : 'Generate My Profile →' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .progress-bar { height: 3px; background: var(--bg-surface); border-radius: 2px; margin-bottom: 8px; overflow: hidden; }
    .progress-fill { height: 100%; background: var(--accent-primary); transition: width 0.4s ease; border-radius: 2px; }
    .step-label { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 32px; letter-spacing: 0.05em; }
    .step-content h2 { margin-bottom: 8px; color: var(--accent-text); }
    .step-desc { margin-bottom: 28px; font-size: 0.9rem; }
    .field { margin-bottom: 20px; }
    .optional { font-size: 0.75rem; color: var(--text-muted); font-weight: 400; }
    .slider { width: 100%; -webkit-appearance: none; height: 6px; border-radius: 3px; background: var(--bg-surface); outline: none; border: none; padding: 0; }
    .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%; background: var(--accent-primary); cursor: pointer; }
    .slider-labels { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; }

.nav-buttons { display: flex; align-items: center; margin-top: 32px; padding-bottom: 40px; }
    .spacer { flex: 1; }

    .generating-state { text-align: center; padding: 40px 0; }
    .gen-compass { margin-bottom: 24px; animation: breathe 4s ease-in-out infinite; display: inline-block; }
    .gen-sub { max-width: 400px; margin: 0 auto 32px; font-size: 0.9rem; }
    .gen-steps { text-align: left; max-width: 320px; margin: 0 auto; }
    .gen-step { padding: 8px 0; color: var(--text-muted); font-size: 0.9rem; transition: color 0.3s; }
    .gen-step.active { color: var(--accent-primary); }
  `],
})
export class OnboardingComponent {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private api = inject(ApiService);
  private router = inject(Router);
  private zone = inject(NgZone);

  currentUserId = this.auth.getCurrentUserId() ?? '';
  step = 0;
  submitting = false;
  genPhase = -1;
  uploadedFileCount = 0;

  data: OnboardingData = {
    name: '', birthDate: '', birthTime: '', birthLocation: '',
    strengths: [], communicationStyle: 'warm', spiritualOrientation: '', chronotype: 'morning', riskTolerance: 5,
    healthPriorities: [], financialPriorities: [], relationshipGoals: [], careerDirection: '',
    tonePref: 'warm', newsTopics: [], exclusions: [], noveltyMode: 'expand',
  };

  commStyles = ['direct', 'warm', 'analytical', 'reserved'];
  toneOptions = ['direct', 'warm', 'analytical', 'minimal'];
  strengthOptions = [
    'Strategic Thinking', 'Empathy', 'Leadership', 'Creativity', 'Discipline',
    'Communication', 'Resilience', 'Vision', 'Adaptability', 'Intuition',
    'Analytical Mind', 'Compassion', 'Courage', 'Patience', 'Humor',
  ];
  healthOptions = ['Sleep', 'Gut Health', 'Inflammation', 'Focus', 'Stamina', 'Longevity', 'Mental Clarity', 'Nervous System', 'Hormones'];
  financeOptions = ['Savings', 'Investing', 'Debt Reduction', 'Passive Income', 'Conscious Capital', 'Tax Optimization', 'Estate Planning'];
  relationshipOptions = ['Deeper Connection', 'Better Communication', 'Secure Attachment', 'Conflict Resolution', 'Finding Partner', 'Family Harmony', 'Professional Networking'];
  newsOptions = ['Regenerative Finance', 'Conscious Tech', 'Decentralization', 'Healing & Wellness', 'Food Systems', 'Cosmic Movements', 'Sports', 'Art & Culture', 'Climate', 'AI & Emerging Tech'];
  exclusionOptions = ['Crime', 'Doom/Fear', 'Hype/Clickbait', 'Partisan Politics', 'Celebrity Gossip', 'Violence', 'Pharmaceutical Ads'];

  toggleChip(arr: string[], val: string, max = 99) {
    const idx = arr.indexOf(val);
    if (idx >= 0) { arr.splice(idx, 1); }
    else if (arr.length < max) { arr.push(val); }
  }

  nextStep() { this.step = Math.min(this.step + 1, 5); }
  prevStep() { this.step = Math.max(this.step - 1, 0); }

  onFileIngested(event: { fileName: string; fileUrl: string; source: 'local' | 'drive' }) {
    this.uploadedFileCount++;
  }

  onIngestError(event: { fileName: string; error: string }) {
    console.error('File ingestion error:', event);
  }

  async submitOnboarding() {
    this.submitting = true;
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;

    // Save onboarding data
    await this.userData.saveOnboarding(userId, this.data);

    // Move to generation step
    this.step = 5;
    this.animateGeneration();

    // Call profile generation
    try {
      const result = await this.api.generateProfile(userId);
      if (result?.profile) {
        await this.userData.saveGeneratedProfile(userId, result.profile);
      }
      // Wait for animation to finish then navigate
      this.zone.run(() => setTimeout(() => this.router.navigate(['/dashboard']), 1500));
    } catch (e) {
      console.error('Profile generation failed:', e);
      // Still navigate — profile can be regenerated
      this.zone.run(() => setTimeout(() => this.router.navigate(['/dashboard']), 2000));
    }
  }

  private animateGeneration() {
    const phases = [0, 1, 2, 3, 4];
    phases.forEach((p, i) => {
      setTimeout(() => this.genPhase = p, i * 1200);
    });
  }
}
