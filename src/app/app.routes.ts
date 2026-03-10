/**
 * app.routes.ts — All routes with lazy-loaded standalone components.
 *
 * ROUTE GUARDS:
 *   authGuard    → requires Firebase Auth login (all pages except /login)
 *   founderGuard → requires role='founder' or 'admin' (Intelligence page only)
 *
 * All components are lazy-loaded via dynamic import() for code splitting.
 * The chat route uses :agentId param (financial, food-medicine, media, relationship, moonshot).
 */
import { Routes } from '@angular/router';
import { authGuard, founderGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./pages/onboarding/onboarding.component').then(m => m.OnboardingComponent),
    canActivate: [authGuard],
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'chat/:agentId',
    loadComponent: () => import('./pages/chat/chat.component').then(m => m.ChatComponent),
    canActivate: [authGuard],
  },
  {
    path: 'communication',
    loadComponent: () => import('./pages/communication/communication.component').then(m => m.CommunicationComponent),
    canActivate: [authGuard],
  },
  {
    path: 'inspiration',
    loadComponent: () => import('./pages/inspiration/inspiration.component').then(m => m.InspirationComponent),
    canActivate: [authGuard],
  },
  {
    path: 'intelligence',
    loadComponent: () => import('./pages/intelligence/intelligence.component').then(m => m.IntelligenceComponent),
    canActivate: [founderGuard],
  },
  {
    path: 'articles',
    loadComponent: () => import('./pages/articles/articles.component').then(m => m.ArticlesComponent),
    canActivate: [authGuard],
  },
  {
    path: 'game-of-life',
    loadComponent: () => import('./pages/game-of-life/game-of-life.component').then(m => m.GameOfLifeComponent),
    canActivate: [authGuard],
  },
  {
    path: 'files',
    loadComponent: () => import('./pages/files/files.component').then(m => m.FilesComponent),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'login' },
];
