/** Angular entry point. Imports zone.js (required for change detection) and bootstraps the app. */
import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';

bootstrapApplication(AppComponent, appConfig)
  .catch((err: any) => console.error(err));
