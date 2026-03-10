/**
 * LoginComponent — entry point of the app. Shows Google sign-in + email/password form.
 * After successful login, AuthService.handlePostLogin() routes to /dashboard or /onboarding.
 * This is the ONLY page accessible without authentication.
 */
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-page">
      <div class="login-glow"></div>
      <div class="login-container animate-slide">
        <div class="logo-area">
          <div class="compass-icon">
            <svg viewBox="0 0 80 80" width="80" height="80">
              <circle cx="40" cy="40" r="38" fill="none" stroke="var(--accent-primary)" stroke-width="1.5" opacity="0.4"/>
              <circle cx="40" cy="40" r="28" fill="none" stroke="var(--accent-primary)" stroke-width="1" opacity="0.25"/>
              <polygon points="40,8 44,36 40,42 36,36" fill="var(--accent-primary)" opacity="0.9"/>
              <polygon points="40,72 36,44 40,38 44,44" fill="var(--text-muted)" opacity="0.5"/>
              <circle cx="40" cy="40" r="3" fill="var(--accent-primary)"/>
            </svg>
          </div>
          <h1>TRUE NORTH</h1>
          <p class="tagline">Your personal intelligence mirror</p>
        </div>

        <div class="auth-section" *ngIf="!showEmailForm">
          <button class="btn-google" (click)="signInGoogle()">
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/><path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
            Sign in with Google
          </button>

          <div class="divider"><span>or</span></div>

          <button class="btn-secondary email-btn" (click)="showEmailForm = true">
            Sign in with Email
          </button>
        </div>

        <div class="auth-section" *ngIf="showEmailForm">
          <div class="form-group">
            <label>Email</label>
            <input type="email" [(ngModel)]="email" placeholder="you@example.com" />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" [(ngModel)]="password" placeholder="••••••••" />
          </div>

          <div *ngIf="error" class="error-msg">{{ error }}</div>

          <button class="btn-primary" style="width:100%" (click)="signInEmail()" [disabled]="loading">
            {{ loading ? 'Signing in...' : 'Sign In' }}
          </button>
          <button class="btn-ghost" style="width:100%;margin-top:8px" (click)="signUpEmail()" [disabled]="loading">
            Create Account
          </button>
          <button class="btn-ghost" style="width:100%;margin-top:8px" (click)="showEmailForm = false">
            ← Back
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .login-page {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: var(--bg-deep); position: relative; overflow: hidden;
    }
    .login-glow {
      position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
      width: 400px; height: 400px; border-radius: 50%;
      background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
      filter: blur(60px); opacity: 0.3; pointer-events: none;
    }
    .login-container {
      position: relative; z-index: 1; width: 100%; max-width: 400px; padding: 0 20px;
    }
    .logo-area { text-align: center; margin-bottom: 40px; }
    .compass-icon { margin-bottom: 20px; animation: breathe 4s ease-in-out infinite; display: inline-block; }
    .logo-area h1 {
      font-family: var(--font-display); font-size: 2.8rem; letter-spacing: 0.15em;
      color: var(--text-primary); margin-bottom: 8px;
    }
    .tagline { color: var(--text-muted); font-size: 0.95rem; letter-spacing: 0.05em; }
    .auth-section { display: flex; flex-direction: column; gap: 12px; }
    .btn-google {
      display: flex; align-items: center; justify-content: center; gap: 12px;
      width: 100%; padding: 14px; background: white; color: #333; font-weight: 600;
      font-size: 0.95rem; border: none; border-radius: var(--radius-md); cursor: pointer;
      transition: all 0.2s;
    }
    .btn-google:hover { box-shadow: 0 4px 16px rgba(255,255,255,0.1); transform: translateY(-1px); }
    .divider {
      display: flex; align-items: center; gap: 16px; margin: 8px 0;
      color: var(--text-muted); font-size: 0.8rem;
    }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border-subtle); }
    .email-btn { width: 100%; }
    .form-group { margin-bottom: 4px; }
    .error-msg { color: #e74c3c; font-size: 0.85rem; padding: 8px 12px; background: rgba(231,76,60,0.1); border-radius: var(--radius-sm); }
  `],
})
export class LoginComponent {
  private auth = inject(AuthService);

  email = '';
  password = '';
  showEmailForm = false;
  loading = false;
  error = '';

  async signInGoogle() {
    try {
      this.loading = true;
      await this.auth.signInWithGoogle();
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  async signInEmail() {
    try {
      this.loading = true;
      this.error = '';
      await this.auth.signInWithEmail(this.email, this.password);
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  async signUpEmail() {
    try {
      this.loading = true;
      this.error = '';
      await this.auth.signUpWithEmail(this.email, this.password);
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }
}
