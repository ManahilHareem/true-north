/**
 * FilesComponent — dedicated file management page.
 *
 * Lists all files uploaded by the user (from Firebase Storage / Firestore).
 * Supports uploading new files via FileIngestionComponent (local + Google Drive).
 * Allows deleting files (Firestore metadata only — storage object is orphaned but harmless).
 */
import { Component, inject, NgZone, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';
import { EmbeddingService } from '../../services/embedding.service';
import { UploadedFile } from '../../models/interfaces';
import { FileIngestionComponent } from '../../components/file-ingestion/file-ingestion.component';

@Component({
  selector: 'app-files',
  standalone: true,
  imports: [CommonModule, FileIngestionComponent],
  template: `
    <div class="page">
      <div class="container">
        <!-- Header -->
        <div class="page-header">
          <button class="btn-ghost back-btn" (click)="router.navigate(['/dashboard'])">← Back</button>
          <h2 class="page-title">My Files</h2>
          <button class="btn-primary upload-btn" (click)="showUploadPanel = !showUploadPanel">
            {{ showUploadPanel ? 'Cancel' : '+ Upload' }}
          </button>
        </div>

        <!-- Upload Panel -->
        <div *ngIf="showUploadPanel" class="upload-panel animate-fade">
          <app-file-ingestion
            [userId]="currentUserId"
            [mode]="'onboarding'"
            [hint]="'PDFs, docs, images, lab results, 23andMe raw data'"
            (fileIngested)="onFileUploaded($event)"
            (ingestError)="onFileError($event)">
          </app-file-ingestion>
        </div>

        <!-- Stats bar -->
        <div *ngIf="!loading && files.length > 0" class="stats-bar animate-fade">
          <span class="stat">{{ files.length }} file{{ files.length === 1 ? '' : 's' }}</span>
          <span class="stat-sep">·</span>
          <span class="stat">{{ localCount }} local</span>
          <span *ngIf="driveCount > 0" class="stat-sep">·</span>
          <span *ngIf="driveCount > 0" class="stat">{{ driveCount }} from Drive</span>
        </div>

        <!-- Loading -->
        <div *ngIf="loading" class="file-list">
          <div *ngFor="let _ of [1,2,3]" class="file-item skeleton">
            <div class="fi-icon-skel shimmer"></div>
            <div class="fi-body">
              <div class="skel-line skel-long shimmer"></div>
              <div class="skel-line skel-short shimmer" style="margin-top:6px"></div>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div *ngIf="!loading && files.length === 0 && !showUploadPanel" class="empty-state animate-fade">
          <div class="empty-icon">📁</div>
          <h3>No files yet</h3>
          <p>Upload documents, lab results, genome data, or any files to enrich your True North profile.</p>
          <button class="btn-primary" style="margin-top:20px" (click)="showUploadPanel = true">Upload your first file</button>
        </div>

        <!-- File list -->
        <div *ngIf="!loading && files.length > 0" class="file-list animate-fade">
          <div *ngFor="let f of files" class="file-item">
            <div class="fi-icon" [class.drive]="f.source === 'drive'">
              {{ f.source === 'drive' ? '☁' : '📄' }}
            </div>
            <div class="fi-body">
              <div class="fi-name">{{ f.fileName }}</div>
              <div class="fi-meta">
                <span class="fi-badge" [ngClass]="f.category">{{ f.category }}</span>
                <span class="fi-type" *ngIf="f.fileType && f.fileType !== 'unknown'">{{ shortType(f.fileType) }}</span>
                <span class="fi-date" *ngIf="f.createdAt">{{ formatDate(f.createdAt) }}</span>
              </div>
              <div class="fi-summary" *ngIf="f.summary && f.summary !== 'Processing...'">{{ f.summary }}</div>
              <div class="fi-processing" *ngIf="f.summary === 'Processing...'">⚙ Processing...</div>
            </div>
            <div class="fi-actions">
              <a *ngIf="f.fileUrl" [href]="f.fileUrl" target="_blank" rel="noopener" class="fi-action-btn" title="Open file">↗</a>
              <button class="fi-action-btn fi-delete" (click)="deleteFile(f)" title="Delete">✕</button>
            </div>
          </div>
        </div>

        <!-- Delete error -->
        <div *ngIf="deleteError" class="error-banner">{{ deleteError }}</div>
      </div>
    </div>
  `,
  styles: [`
    .page-header {
      display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
    }
    .back-btn { flex-shrink: 0; }
    .page-title {
      flex: 1; font-family: var(--font-display); font-size: 1.6rem;
      color: var(--accent-text); margin: 0;
    }
    .upload-btn { flex-shrink: 0; }

    .upload-panel {
      background: var(--bg-surface); border-radius: var(--radius-lg);
      padding: 20px; margin-bottom: 20px;
      border: 1px solid var(--border-subtle);
    }

    .stats-bar {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.8rem; color: var(--text-muted);
      margin-bottom: 16px;
    }
    .stat-sep { opacity: 0.4; }

    .file-list { display: flex; flex-direction: column; gap: 8px; }

    .file-item {
      display: flex; align-items: flex-start; gap: 14px;
      padding: 16px; background: var(--bg-surface);
      border-radius: var(--radius-md); border: 1px solid transparent;
      transition: border-color 0.15s, background 0.15s;
    }
    .file-item:hover { background: var(--bg-elevated); border-color: var(--border-subtle); }
    .file-item.skeleton { pointer-events: none; }

    .fi-icon {
      font-size: 1.4rem; flex-shrink: 0; width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-elevated); border-radius: var(--radius-sm);
    }
    .fi-icon.drive { background: rgba(38, 132, 252, 0.1); }
    .fi-icon-skel {
      width: 36px; height: 36px; border-radius: var(--radius-sm); flex-shrink: 0;
    }

    .fi-body { flex: 1; min-width: 0; }
    .fi-name {
      font-size: 0.92rem; color: var(--text-primary); font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      margin-bottom: 6px;
    }
    .fi-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }

    .fi-badge {
      font-size: 0.68rem; padding: 2px 8px; border-radius: 100px;
      background: var(--bg-elevated); color: var(--text-muted);
      text-transform: capitalize; letter-spacing: 0.04em; flex-shrink: 0;
    }
    .fi-badge.genome { background: rgba(80, 200, 120, 0.15); color: #50C878; }
    .fi-badge.health { background: rgba(231, 76, 60, 0.12); color: #e74c3c; }
    .fi-badge.finance { background: rgba(255, 186, 0, 0.15); color: #ffba00; }

    .fi-type { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .fi-date { font-size: 0.75rem; color: var(--text-muted); }
    .fi-summary {
      font-size: 0.8rem; color: var(--text-muted); line-height: 1.5;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .fi-processing { font-size: 0.78rem; color: var(--accent-primary); }

    .fi-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; align-self: center; }
    .fi-action-btn {
      background: none; border: none; cursor: pointer; font-size: 0.85rem;
      padding: 6px 8px; border-radius: var(--radius-sm); color: var(--text-muted);
      text-decoration: none; display: flex; align-items: center; transition: all 0.15s;
    }
    .fi-action-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
    .fi-delete:hover { background: rgba(231, 76, 60, 0.1) !important; color: #e74c3c !important; }

    .empty-state {
      text-align: center; padding: 64px 24px;
    }
    .empty-icon { font-size: 3rem; margin-bottom: 16px; opacity: 0.6; }
    .empty-state h3 { font-family: var(--font-display); font-size: 1.4rem; color: var(--text-primary); margin-bottom: 8px; }
    .empty-state p { font-size: 0.9rem; color: var(--text-muted); max-width: 380px; margin: 0 auto; line-height: 1.6; }

    .error-banner {
      margin-top: 12px; padding: 10px 14px; background: rgba(231,76,60,0.1);
      border-radius: var(--radius-sm); color: #e74c3c; font-size: 0.85rem;
    }

    .skel-line { height: 10px; border-radius: 4px; }
    .skel-long { width: 70%; }
    .skel-short { width: 40%; }
    .shimmer {
      background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%);
      background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite;
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  `],
})
export class FilesComponent implements OnInit {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private embedding = inject(EmbeddingService);
  private zone = inject(NgZone);
  router = inject(Router);

  currentUserId = '';
  files: UploadedFile[] = [];
  loading = false;
  showUploadPanel = false;
  deleteError = '';

  get localCount() { return this.files.filter(f => f.source !== 'drive').length; }
  get driveCount() { return this.files.filter(f => f.source === 'drive').length; }

  async ngOnInit() {
    const userId = this.auth.getCurrentUserId();
    if (!userId) return;
    this.currentUserId = userId;
    this.loadFiles(userId);
  }

  private async loadFiles(userId: string) {
    this.loading = true;
    try {
      const files = await this.userData.getUploads(userId);
      this.zone.run(() => { this.files = files; this.loading = false; });
    } catch {
      this.zone.run(() => { this.loading = false; });
    }
  }

  onFileUploaded(event: { fileName: string; fileUrl: string; source: 'local' | 'drive' }) {
    this.showUploadPanel = false;
    this.loadFiles(this.currentUserId);
  }

  onFileError(event: { fileName: string; error: string }) {
    console.error('File ingestion error:', event);
  }

  async deleteFile(file: UploadedFile) {
    if (!file.id) return;
    this.deleteError = '';
    try {
      await this.userData.deleteUpload(this.currentUserId, file.id);
      this.embedding.deleteFileEmbeddings(file.id).catch(e =>
        console.warn('Embedding delete error:', e)
      );
      this.zone.run(() => { this.files = this.files.filter(f => f.id !== file.id); });
    } catch (e: any) {
      this.zone.run(() => { this.deleteError = 'Could not delete file. Please try again.'; });
    }
  }

  shortType(mimeType: string): string {
    const map: Record<string, string> = {
      'application/pdf': 'PDF',
      'text/plain': 'TXT',
      'text/csv': 'CSV',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
      'application/msword': 'DOC',
      'image/jpeg': 'JPG',
      'image/png': 'PNG',
    };
    return map[mimeType] ?? mimeType.split('/').pop()?.toUpperCase() ?? '';
  }

  formatDate(ts: any): string {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
