/**
 * AuthService — handles Firebase Authentication + post-login routing.
 *
 * Supports: Google sign-in, email/password sign-up, email/password sign-in.
 *
 * POST-LOGIN ROUTING LOGIC (handlePostLogin):
 *   1. User doc exists AND has profile → /dashboard (returning user)
 *   2. User doc exists but NO profile  → /onboarding (partially onboarded)
 *   3. No user doc at all              → creates doc with role='member', → /onboarding (new user)
 *
 * The user$ observable emits the current Firebase Auth user (or null).
 * Components and guards subscribe to this to check auth state.
 */
import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import { Auth, signInWithPopup, GoogleAuthProvider, signOut, user, User, createUserWithEmailAndPassword, signInWithEmailAndPassword } from '@angular/fire/auth';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Router } from '@angular/router';
import { VaultCryptoService } from './vault-crypto.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);
  private injector = inject(Injector);
  private vaultCrypto = inject(VaultCryptoService);

  /** Emits current auth user (or null). Used by AuthGuard and components. */
  user$: Observable<User | null> = user(this.auth);

  async signInWithGoogle(): Promise<void> {
    const result = await signInWithPopup(this.auth, new GoogleAuthProvider());
    await this.handlePostLogin(result.user);
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const result = await signInWithEmailAndPassword(this.auth, email, password);
    await this.handlePostLogin(result.user);
  }

  async signUpWithEmail(email: string, password: string): Promise<void> {
    const result = await createUserWithEmailAndPassword(this.auth, email, password);
    await this.handlePostLogin(result.user);
  }

  async signOut(): Promise<void> {
    this.vaultCrypto.clearSession();
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }

  private async handlePostLogin(user: User): Promise<void> {
    const userDocRef = doc(this.firestore, 'users', user.uid);
    const userDoc = await runInInjectionContext(this.injector, () =>
      getDoc(userDocRef)
    );

    if (userDoc.exists() && userDoc.data()?.['profile']) {
      this.router.navigate(['/dashboard']);
    } else if (userDoc.exists()) {
      this.router.navigate(['/onboarding']);
    } else {
      await runInInjectionContext(this.injector, () =>
        setDoc(userDocRef, {
          uid: user.uid,
          email: user.email,
          role: 'member',
          createdAt: serverTimestamp(),
        })
      );
      this.router.navigate(['/onboarding']);
    }
  }

  getCurrentUserId(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }
}
