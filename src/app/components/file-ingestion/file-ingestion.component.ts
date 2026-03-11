/**
 * FileIngestionComponent — reusable multi-channel file upload component.
 *
 * Supports two channels:
 *   - Local: drag-drop or file browser
 *   - Google Drive: Google Picker API (enabled when googleDriveClientId is set in environment)
 *
 * All files land in Firebase Storage via UserDataService.uploadFile().
 * Metadata is saved to Firestore via UserDataService.saveFileMeta().
 * Backend processing is dispatched based on `mode`:
 *   - 'onboarding' → calls onFileUpload Cloud Function
 *   - 'intelligence' → calls onTranscriptProcess Cloud Function
 *
 * Google Drive setup (one-time):
 *   1. Enable Google Picker API in Google Cloud Console for project truenorth-ai-growth
 *   2. Add http://localhost:4200 to authorized JS origins on the Web OAuth Client
 *   3. Set environment.googleDriveClientId to the Web OAuth Client ID
 *   Leave googleDriveClientId empty → Drive button is hidden, local-only mode.
 */
import { Component, Input, Output, EventEmitter, OnInit, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UserDataService } from '../../services/user-data.service';
import { ApiService } from '../../services/api.service';
import { EmbeddingService } from '../../services/embedding.service';
import { environment } from '../../../environments/environment';

interface IngestItem {
  name: string;
  source: 'local' | 'drive';
  status: 'pending' | 'uploading' | 'processing' | 'done' | 'error';
  errorMsg?: string;
}

// Minimal typings for Google APIs loaded at runtime
declare const google: any;
declare const gapi: any;

@Component({
  selector: 'app-file-ingestion',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ingestion-wrap">
      <!-- Drop Zone -->
      <div
        class="drop-zone"
        [class.dragging]="isDragging"
        (dragover)="onDragOver($event)"
        (dragleave)="isDragging = false"
        (drop)="onDrop($event)"
        (click)="fileInput.click()"
      >
        <input
          #fileInput
          type="file"
          multiple
          hidden
          [accept]="accept"
          (change)="onFilesSelected($event)"
        />
        <div class="drop-icon">📁</div>
        <p class="drop-label">Drop files here or click to browse</p>
        <span class="drop-hint">{{ hint }}</span>
      </div>

      <!-- Google Drive Button -->
      <button
        *ngIf="driveEnabled"
        class="btn-drive"
        (click)="openDrivePicker()"
        [disabled]="!scriptsReady"
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 87.3 78" style="vertical-align:middle;margin-right:8px">
          <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H.4c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
          <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L.4 50.3c0 1.55.4 3.1 1.2 4.5H27.5z" fill="#00ac47"/>
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.9 54.8c.8-1.4 1.2-2.95 1.2-4.5H61.75l5.8 12.15z" fill="#ea4335"/>
          <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
          <path d="M61.75 50.3H27.5L13.75 74.1c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
          <path d="M73.4 26.45l-13.1-22.7C59.5 2.35 58.35 1.25 57 .45L43.25 24.25 57 48.05h29.85c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
        </svg>
        Import from Google Drive
      </button>

      <!-- Error message -->
      <div *ngIf="lastError" class="ingest-error">{{ lastError }}</div>

      <!-- File Queue -->
      <div *ngIf="queue.length > 0" class="file-queue">
        <div *ngFor="let item of queue" class="queue-item">
          <span class="item-source" [class.drive]="item.source === 'drive'">
            {{ item.source === 'drive' ? '☁' : '📄' }}
          </span>
          <span class="item-name">{{ item.name }}</span>
          <span class="item-status" [ngClass]="item.status">
            <ng-container [ngSwitch]="item.status">
              <span *ngSwitchCase="'uploading'">↑ Uploading...</span>
              <span *ngSwitchCase="'processing'">⚙ Processing...</span>
              <span *ngSwitchCase="'done'">✓ Done</span>
              <span *ngSwitchCase="'error'" [title]="item.errorMsg">✕ Error</span>
              <span *ngSwitchDefault>Pending</span>
            </ng-container>
          </span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ingestion-wrap { display: flex; flex-direction: column; gap: 12px; }

    .drop-zone {
      border: 2px dashed var(--border-subtle); border-radius: var(--radius-lg);
      padding: 40px 24px; text-align: center; cursor: pointer; transition: all 0.2s;
    }
    .drop-zone:hover, .drop-zone.dragging {
      border-color: var(--accent-primary); background: var(--accent-soft);
    }
    .drop-icon { font-size: 2rem; margin-bottom: 8px; }
    .drop-label { color: var(--text-primary); font-size: 0.95rem; margin-bottom: 4px; }
    .drop-hint { color: var(--text-muted); font-size: 0.8rem; }

    .btn-drive {
      display: flex; align-items: center; justify-content: center;
      width: 100%; padding: 12px; background: var(--bg-surface);
      border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
      color: var(--text-secondary); font-size: 0.9rem; cursor: pointer; transition: all 0.2s;
    }
    .btn-drive:hover:not(:disabled) { border-color: var(--accent-primary); color: var(--accent-primary); }
    .btn-drive:disabled { opacity: 0.5; cursor: not-allowed; }

    .ingest-error {
      padding: 10px 14px; background: rgba(231,76,60,0.1); border-radius: var(--radius-sm);
      color: #e74c3c; font-size: 0.85rem;
    }

    .file-queue { margin-top: 4px; }
    .queue-item {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      background: var(--bg-surface); border-radius: var(--radius-sm); margin-bottom: 6px;
    }
    .item-source { font-size: 1rem; flex-shrink: 0; }
    .item-name { flex: 1; font-size: 0.9rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item-status { font-size: 0.8rem; white-space: nowrap; color: var(--text-muted); }
    .item-status.uploading, .item-status.processing { color: var(--accent-primary); }
    .item-status.done { color: #50C878; }
    .item-status.error { color: #e74c3c; }
  `],
})
export class FileIngestionComponent implements OnInit {
  @Input() userId = '';
  @Input() mode: 'onboarding' | 'intelligence' = 'onboarding';
  @Input() accept = '.txt,.pdf,.csv,.doc,.docx,.jpg,.png';
  @Input() hint = 'Drop files or click to browse';

  @Output() fileIngested = new EventEmitter<{ fileName: string; fileUrl: string; source: 'local' | 'drive' }>();
  @Output() ingestError = new EventEmitter<{ fileName: string; error: string }>();

  private userData = inject(UserDataService);
  private api = inject(ApiService);
  private embedding = inject(EmbeddingService);
  private zone = inject(NgZone);

  driveEnabled = !!environment.googleDriveClientId;
  isDragging = false;
  scriptsReady = false;
  lastError = '';
  queue: IngestItem[] = [];

  private driveAccessToken: string | null = null;

  async ngOnInit() {
    if (this.driveEnabled) {
      await this.loadDriveScripts();
    }
  }

  // ── Local Upload ─────────────────────────────────────────────

  onDragOver(e: DragEvent) {
    e.preventDefault();
    this.isDragging = true;
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.isDragging = false;
    if (e.dataTransfer?.files) {
      this.handleLocalFiles(Array.from(e.dataTransfer.files));
    }
  }

  onFilesSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      this.handleLocalFiles(Array.from(input.files));
      input.value = '';
    }
  }

  private handleLocalFiles(files: File[]) {
    for (const file of files) {
      const item: IngestItem = { name: file.name, source: 'local', status: 'pending' };
      this.queue.push(item);
      this.uploadAndProcess(file, item);
    }
  }

  // ── Google Drive ─────────────────────────────────────────────

  private loadDriveScripts(): Promise<void> {
    const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(s);
    });

    return Promise.all([
      loadScript('https://accounts.google.com/gsi/client'),
      loadScript('https://apis.google.com/js/api.js'),
    ]).then(() => {
      this.zone.run(() => { this.scriptsReady = true; });
    }).catch(() => {
      this.zone.run(() => { this.driveEnabled = false; });
    });
  }

  async openDrivePicker() {
    this.lastError = '';
    try {
      const token = await this.requestDriveToken();
      this.driveAccessToken = token;
      this.openPicker(token);
    } catch (e: any) {
      this.zone.run(() => { this.lastError = e.message; });
      this.ingestError.emit({ fileName: 'Google Drive', error: e.message });
    }
  }

  private requestDriveToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: environment.googleDriveClientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (resp: any) => {
          if (resp.error) {
            const msg = resp.error === 'access_denied'
              ? 'Drive access was denied.'
              : resp.error === 'popup_blocked_by_browser'
              ? 'Popup was blocked. Allow popups for this site and try again.'
              : `Drive auth failed: ${resp.error}`;
            reject(new Error(msg));
          } else {
            resolve(resp.access_token);
          }
        },
      });
      client.requestAccessToken({ prompt: '' });
    });
  }

  private openPicker(accessToken: string) {
    gapi.load('picker', () => {
      const picker = new google.picker.PickerBuilder()
        .addView(google.picker.ViewId.DOCS)
        .setOAuthToken(accessToken)
        .setDeveloperKey(environment.googlePickerApiKey || environment.firebase.apiKey)
        .setCallback((data: any) => this.onPickerCallback(data, accessToken))
        .build();
      picker.setVisible(true);
    });
  }

  private async onPickerCallback(data: any, accessToken: string) {
    if (data.action !== google.picker.Action.PICKED) return;

    for (const driveFile of data.docs) {
      const item: IngestItem = { name: driveFile.name, source: 'drive', status: 'pending' };
      this.zone.run(() => { this.queue.push(item); });

      try {
        const resp = await fetch(
          `https://www.googleapis.com/drive/v3/files/${driveFile.id}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (resp.status === 401) {
          this.driveAccessToken = null;
          throw new Error('Drive session expired. Click "Import from Google Drive" again.');
        }
        if (!resp.ok) throw new Error(`Drive fetch failed (${resp.status})`);

        const blob = await resp.blob();
        if (blob.size > 52_428_800) throw new Error('File exceeds 50 MB limit');

        const file = new File([blob], driveFile.name, { type: driveFile.mimeType || 'application/octet-stream' });
        await this.uploadAndProcess(file, item);
      } catch (e: any) {
        this.zone.run(() => {
          item.status = 'error';
          item.errorMsg = e.message;
          this.lastError = e.message;
        });
        this.ingestError.emit({ fileName: driveFile.name, error: e.message });
      }
    }
  }

  // ── Shared Upload + Process ──────────────────────────────────

  private async uploadAndProcess(file: File, item: IngestItem): Promise<void> {
    try {
      this.zone.run(() => { item.status = 'uploading'; });

      const fileUrl = await this.userData.uploadFile(this.userId, file);

      const fileId = await this.userData.saveFileMeta(this.userId, {
        fileName: file.name,
        fileUrl,
        fileType: file.type || 'unknown',
        category: 'pending',
        tags: [],
        summary: 'Processing...',
        source: item.source,
        createdAt: null as any,
      });

      this.zone.run(() => { item.status = 'processing'; });

      // Index file in embedding service (fire-and-forget — errors don't fail the upload)
      this.embedding.indexFile(file, fileId, this.userId).catch(e =>
        console.warn('Embedding indexing error (file safely stored):', e)
      );

      // Fire-and-forget processing — errors don't fail the upload
      this.dispatchProcessing(fileUrl, file.name).catch(e =>
        console.warn('Backend processing error (file safely stored):', e)
      );

      this.zone.run(() => {
        item.status = 'done';
        this.fileIngested.emit({ fileName: file.name, fileUrl, source: item.source });
      });
    } catch (e: any) {
      this.zone.run(() => {
        item.status = 'error';
        item.errorMsg = e.message;
      });
      this.ingestError.emit({ fileName: file.name, error: e.message });
    }
  }

  private async dispatchProcessing(fileUrl: string, fileName: string): Promise<void> {
    if (this.mode === 'intelligence') {
      await this.api.processTranscript(this.userId, fileUrl, fileName);
    } else {
      await this.api.processFile(this.userId, fileUrl, fileName);
    }
  }
}
