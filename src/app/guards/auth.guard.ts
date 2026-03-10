/**
 * auth.guard.ts — Route guards for authentication and role-based access.
 *
 * authGuard:    Checks Firebase Auth. No user → redirect to /login.
 * founderGuard: Checks Auth + Firestore role field. Only 'founder' or 'admin'
 *               can access protected routes (currently just /intelligence).
 *               Other roles → redirect to /dashboard.
 */
import { inject, Injector, runInInjectionContext } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { map, take } from 'rxjs/operators';
import { user } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';

/** Requires any authenticated user. Redirects to /login if not logged in. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  const currentUser = await firstValueFrom(user(auth).pipe(take(1)));

  if (!currentUser) {
    router.navigate(['/login']);
    return false;
  }
  return true;
};

/** Requires role='founder' or 'admin'. Reads from Firestore users/{uid}.role. */
export const founderGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const firestore = inject(Firestore);
  const router = inject(Router);
  const injector = inject(Injector);
  const currentUser = await firstValueFrom(user(auth).pipe(take(1)));

  if (!currentUser) {
    router.navigate(['/login']);
    return false;
  }

  const userDoc = await runInInjectionContext(injector, () =>
    getDoc(doc(firestore, 'users', currentUser.uid))
  );
  const role = userDoc.data()?.['role'];

  if (role === 'founder' || role === 'admin') {
    return true;
  }

  router.navigate(['/dashboard']);
  return false;
};
