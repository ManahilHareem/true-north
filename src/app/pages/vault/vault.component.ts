import { CommonModule } from '@angular/common';
import { Component, HostListener, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { UserDataService } from '../../services/user-data.service';
import { VaultCryptoService } from '../../services/vault-crypto.service';
import { VaultConfig, VaultLoginItem, VaultLoginItemInput, VaultLoginSecretData } from '../../models/interfaces';

@Component({
  selector: 'app-vault',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="container">
        <div class="page-header">
          <button class="btn-ghost" (click)="goBack()">← Dashboard</button>
          <h2>Password Vault</h2>
          <button *ngIf="isConfigured && isUnlocked" class="btn-ghost" (click)="lockVault()">Lock</button>
        </div>

        <div *ngIf="error" class="error-banner">{{ error }}</div>
        <div *ngIf="success" class="success-banner">{{ success }}</div>

        <div *ngIf="loading" class="card panel status-panel">Loading vault…</div>

        <ng-container *ngIf="!loading">
          <div *ngIf="!isConfigured" class="card panel">
            <div class="panel-header">
              <h3>Set up your vault</h3>
              <p>Choose a master password. Your secrets are encrypted in the browser before storage.</p>
            </div>
            <div class="stack-form">
              <div class="field-group">
                <label>Master password</label>
                <input class="vault-input" type="password" [(ngModel)]="setupPassword" placeholder="Create a strong master password" />
              </div>
              <div class="field-group">
                <label>Confirm password</label>
                <input class="vault-input" type="password" [(ngModel)]="setupPasswordConfirm" placeholder="Repeat master password" />
              </div>
            </div>
            <div class="panel-actions">
              <button class="btn-primary" (click)="initializeVault()">Create Vault</button>
            </div>
          </div>

          <div *ngIf="isConfigured && !isUnlocked" class="unlock-grid">
            <div class="card panel">
              <div class="panel-header">
                <h3>Unlock vault</h3>
                <p>Unlock this session with your master password. The key stays in memory only.</p>
              </div>
              <div class="stack-form">
                <div class="field-group">
                  <label>Master password</label>
                  <input class="vault-input" type="password" [(ngModel)]="unlockPassword" placeholder="Enter master password" />
                </div>
              </div>
              <div class="panel-actions">
                <button class="btn-primary" (click)="unlockVault()">Unlock</button>
              </div>
            </div>

            <div class="card panel">
              <div class="panel-header">
                <h3>Recover access</h3>
                <p>Use your recovery key to rotate the master password without exposing vault contents.</p>
              </div>
              <div class="stack-form">
                <div class="field-group">
                  <label>Recovery key</label>
                  <textarea class="vault-input vault-textarea" [(ngModel)]="recoveryKeyInput" rows="3" placeholder="Paste your recovery key"></textarea>
                </div>
                <div class="field-group">
                  <label>New master password</label>
                  <input class="vault-input" type="password" [(ngModel)]="recoveryNewPassword" placeholder="Choose a new master password" />
                </div>
                <div class="field-group">
                  <label>Confirm new password</label>
                  <input class="vault-input" type="password" [(ngModel)]="recoveryNewPasswordConfirm" placeholder="Repeat new master password" />
                </div>
              </div>
              <div class="panel-actions">
                <button class="btn-primary" (click)="recoverVault()">Recover Vault</button>
              </div>
            </div>
          </div>

          <div *ngIf="recoveryKeyVisible" class="card panel">
            <div class="panel-header">
              <h3>Save your recovery key now</h3>
              <p>This key is the only recovery path if you forget your master password.</p>
            </div>
            <div class="recovery-key">{{ recoveryKeyVisible }}</div>
            <div class="panel-actions">
              <button class="btn-ghost" (click)="copyText(recoveryKeyVisible)">Copy Recovery Key</button>
              <button class="btn-primary" (click)="dismissRecoveryKey()">I saved it</button>
            </div>
          </div>

          <ng-container *ngIf="isConfigured && isUnlocked">
            <div class="vault-shell">
              <div class="vault-toolbar card">
                <div class="vault-toolbar-copy">
                  <p class="vault-toolbar-label">Vault Entries</p>
                  <p class="vault-toolbar-count">{{ filteredItems.length }} {{ filteredItems.length === 1 ? 'login' : 'logins' }}</p>
                </div>
                <div class="vault-toolbar-actions">
                  <div class="search-field">
                    <label>Search logins</label>
                    <input class="vault-input" [(ngModel)]="searchQuery" placeholder="Search by title, provider, or tags" />
                  </div>
                  <button class="btn-primary add-button" (click)="startCreate()">+ Add Login</button>
                </div>
              </div>

              <div *ngIf="filteredItems.length === 0" class="card panel empty-state">
                <h3>No vault entries yet</h3>
                <p>Create your first login to test the full vault flow.</p>
              </div>

              <div class="vault-list">
                <div *ngFor="let item of filteredItems" class="card vault-item">
                  <div class="item-header">
                    <div class="item-summary">
                      <div class="item-title-row">
                        <h3>{{ item.title }}</h3>
                        <span *ngIf="item.favorite" class="favorite">★</span>
                      </div>
                      <p>{{ item.provider }}</p>
                    </div>
                    <div class="item-actions">
                      <button class="btn-ghost" (click)="toggleDetails(item.id!)">{{ expandedItemId === item.id ? 'Hide details' : 'View details' }}</button>
                      <button class="btn-ghost" (click)="editItem(item)">Edit</button>
                      <button class="btn-ghost delete" (click)="deleteItem(item)">Delete</button>
                    </div>
                  </div>
                  <div class="tag-row" *ngIf="item.tags.length > 0">
                    <span *ngFor="let tag of item.tags" class="tag">{{ tag }}</span>
                  </div>

                  <div *ngIf="expandedItemId === item.id && decryptedItems[item.id!]" class="secret-grid">
                    <div>
                      <label>Username</label>
                      <div class="secret-row">
                        <span class="secret-value">{{ decryptedItems[item.id!].username || '—' }}</span>
                        <button class="btn-ghost" (click)="copyText(decryptedItems[item.id!].username)">Copy</button>
                      </div>
                    </div>
                    <div>
                      <label>Password</label>
                      <div class="secret-row">
                        <span class="secret-value">{{ decryptedItems[item.id!].password || '—' }}</span>
                        <button class="btn-ghost" (click)="copyText(decryptedItems[item.id!].password)">Copy</button>
                      </div>
                    </div>
                    <div>
                      <label>URL</label>
                      <div class="secret-row">
                        <a *ngIf="decryptedItems[item.id!].url" class="secret-value" [href]="decryptedItems[item.id!].url" target="_blank" rel="noopener">{{ decryptedItems[item.id!].url }}</a>
                        <span *ngIf="!decryptedItems[item.id!].url" class="secret-value">—</span>
                        <button class="btn-ghost" (click)="copyText(decryptedItems[item.id!].url)">Copy</button>
                      </div>
                    </div>
                    <div>
                      <label>Notes</label>
                      <p class="notes">{{ decryptedItems[item.id!].notes || '—' }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div *ngIf="showEditor" class="modal-backdrop" (click)="cancelEdit()">
              <div class="modal-card" (click)="$event.stopPropagation()">
                <div class="modal-header">
                  <div>
                    <p class="eyebrow">Vault Editor</p>
                    <h3>{{ editingItemId ? 'Edit login' : 'Add login' }}</h3>
                    <p>Store login credentials with encrypted secrets and searchable metadata.</p>
                  </div>
                  <button class="btn-ghost close-button" (click)="cancelEdit()">Close</button>
                </div>

                <div class="form-grid">
                  <div class="field-group">
                    <label>Title</label>
                    <input class="vault-input" [(ngModel)]="editor.title" placeholder="Personal Gmail" />
                  </div>
                  <div class="field-group">
                    <label>Provider</label>
                    <input class="vault-input" [(ngModel)]="editor.provider" placeholder="Google" />
                  </div>
                  <div class="field-group">
                    <label>Username / email</label>
                    <input class="vault-input" [(ngModel)]="editor.username" placeholder="you@example.com" />
                  </div>
                  <div class="field-group">
                    <label>Password</label>
                    <input class="vault-input" type="password" [(ngModel)]="editor.password" placeholder="Password" />
                  </div>
                  <div class="field-group">
                    <label>URL</label>
                    <input class="vault-input" [(ngModel)]="editor.url" placeholder="https://accounts.google.com" />
                  </div>
                  <div class="field-group">
                    <label>Tags</label>
                    <input class="vault-input" [(ngModel)]="editor.tagsText" placeholder="work, personal" />
                  </div>
                </div>
                <div class="field-group">
                  <label>Notes</label>
                  <textarea class="vault-input vault-textarea" [(ngModel)]="editor.notes" rows="4" placeholder="Optional notes"></textarea>
                </div>
                <label class="checkbox field-group">
                  <input type="checkbox" [(ngModel)]="editor.favorite" />
                  <span>Favorite</span>
                </label>
                <div class="editor-actions">
                  <button class="btn-primary" (click)="saveItem()">{{ editingItemId ? 'Save Changes' : 'Create Item' }}</button>
                  <button class="btn-ghost" (click)="cancelEdit()">Cancel</button>
                </div>
              </div>
            </div>
          </ng-container>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    .page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
    .page-header h2 { flex: 1; color: var(--accent-text); margin: 0; }
    .panel {
      padding: 24px;
      margin-bottom: 18px;
      background: var(--bg-glass);
      border: 1px solid var(--border-subtle);
    }
    .status-panel { color: var(--text-secondary); }
    .panel-header { margin-bottom: 20px; }
    .panel h3 { margin: 0 0 8px; color: var(--text-primary); }
    .panel p { color: var(--text-secondary); line-height: 1.6; margin: 0; }
    .stack-form { display: grid; gap: 16px; }
    .field-group { display: grid; gap: 8px; }
    .field-group label {
      margin-bottom: 0;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-secondary);
      letter-spacing: 0.02em;
      text-transform: none;
    }
    .vault-input {
      width: 100%;
      min-height: 48px;
      padding: 13px 16px;
      background: linear-gradient(180deg, rgba(34, 34, 58, 0.92), rgba(42, 42, 72, 0.9));
      color: var(--text-primary);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
    }
    .vault-input:focus {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px var(--accent-soft), inset 0 1px 0 rgba(255,255,255,0.03);
    }
    .vault-textarea {
      min-height: 120px;
      resize: vertical;
    }
    .panel-actions {
      display: flex;
      gap: 12px;
      margin-top: 20px;
      padding-top: 4px;
      flex-wrap: wrap;
    }
    .unlock-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
    .vault-shell { display: grid; gap: 18px; }
    .vault-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 18px;
      padding: 22px;
      border-radius: var(--radius-md);
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
    }
    .vault-toolbar-copy { display: grid; gap: 4px; }
    .vault-toolbar-label {
      margin: 0;
      font-size: 0.76rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .vault-toolbar-count {
      margin: 0;
      font-family: var(--font-body);
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.4;
      color: var(--text-primary);
    }
    .vault-toolbar-actions {
      display: flex;
      align-items: end;
      gap: 14px;
      flex: 1;
      justify-content: flex-end;
    }
    .search-field {
      display: grid;
      gap: 8px;
      min-width: min(100%, 420px);
      flex: 1;
    }
    .search-field label {
      margin-bottom: 0;
      font-size: 0.76rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .search-field input { width: 100%; }
    .add-button { white-space: nowrap; }
    .eyebrow {
      margin: 0;
      font-size: 0.76rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .vault-list { display: grid; gap: 14px; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .editor-actions { display: flex; gap: 12px; margin-top: 20px; padding-top: 4px; flex-wrap: wrap; }
    .vault-item { padding: 22px; margin-bottom: 14px; border: 1px solid var(--border-subtle); }
    .item-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .item-summary { display: grid; gap: 4px; }
    .item-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .item-header h3 { margin: 0 0 4px; color: var(--text-primary); }
    .item-header p { margin: 0; color: var(--text-muted); }
    .item-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .favorite { color: #d4a843; font-size: 1.1rem; }
    .tag-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .tag { font-size: 0.72rem; padding: 5px 10px; border-radius: 100px; background: var(--bg-elevated); color: var(--text-secondary); }
    .secret-grid { margin-top: 18px; display: grid; gap: 16px; }
    .secret-row {
      display: flex;
      gap: 14px;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-elevated);
      padding: 14px 16px;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(255,255,255,0.03);
    }
    .secret-value { color: var(--text-primary); overflow-wrap: anywhere; flex: 1; min-width: 0; }
    .notes {
      background: var(--bg-elevated);
      padding: 14px 16px;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      white-space: pre-wrap;
      border: 1px solid rgba(255,255,255,0.03);
    }
    .checkbox { display: flex; align-items: center; gap: 8px; text-transform: none; letter-spacing: 0; }
    .checkbox input { width: auto; }
    .recovery-key {
      font-family: monospace;
      font-size: 1rem;
      line-height: 1.8;
      background: var(--bg-elevated);
      padding: 14px 16px;
      border-radius: var(--radius-sm);
      overflow-wrap: anywhere;
      border: 1px solid rgba(255,255,255,0.03);
    }
    .error-banner, .success-banner { padding: 12px 14px; margin-bottom: 16px; border-radius: var(--radius-sm); }
    .error-banner { background: rgba(231,76,60,0.12); color: #e74c3c; }
    .success-banner { background: rgba(42,157,143,0.14); color: #2A9D8F; }
    .empty-state { text-align: center; padding: 28px 24px; }
    .delete { color: #e74c3c; }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(11, 15, 19, 0.72);
      backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 50;
    }
    .modal-card {
      width: min(840px, 100%);
      max-height: calc(100vh - 48px);
      overflow: auto;
      padding: 24px;
      border-radius: var(--radius-lg);
      background: linear-gradient(180deg, var(--bg-glass), var(--bg-surface));
      border: 1px solid var(--border-accent);
      box-shadow: 0 32px 80px rgba(0, 0, 0, 0.28);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 22px;
    }
    .modal-header h3 { margin: 4px 0 8px; }
    .close-button { white-space: nowrap; }
    @media (max-width: 700px) {
      .page-header { flex-wrap: wrap; }
      .vault-toolbar, .vault-toolbar-actions { flex-direction: column; align-items: stretch; }
      .item-header { flex-direction: column; }
      .item-actions { justify-content: flex-start; }
      .panel-actions, .editor-actions { flex-direction: column; }
      .panel-actions button, .editor-actions button, .add-button, .close-button { width: 100%; }
      .secret-row { flex-direction: column; align-items: stretch; }
      .modal-backdrop { padding: 12px; }
      .modal-card { padding: 18px; max-height: calc(100vh - 24px); }
      .modal-header { flex-direction: column; }
    }
  `],
})
export class VaultComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private vaultCrypto = inject(VaultCryptoService);
  private theme = inject(ThemeService);
  private router = inject(Router);
  private zone = inject(NgZone);

  loading = true;
  error = '';
  success = '';
  config: VaultConfig | null = null;
  items: VaultLoginItem[] = [];
  decryptedItems: Record<string, VaultLoginSecretData> = {};
  searchQuery = '';
  expandedItemId: string | null = null;
  showEditor = false;
  editingItemId: string | null = null;
  recoveryKeyVisible = '';

  setupPassword = '';
  setupPasswordConfirm = '';
  unlockPassword = '';
  recoveryKeyInput = '';
  recoveryNewPassword = '';
  recoveryNewPasswordConfirm = '';

  editor: VaultLoginItemInput & { tagsText: string } = this.emptyEditor();

  async ngOnInit(): Promise<void> {
    try {
      const authUser = this.auth.getCurrentUserId()
        ? { uid: this.auth.getCurrentUserId() as string }
        : await this.withTimeout(firstValueFrom(this.auth.user$.pipe(take(1))), 4000, 'Auth state timed out.');

      if (!authUser?.uid) {
        this.router.navigate(['/login']);
        return;
      }

      const user = await this.withTimeout(this.userData.getUserProfile(authUser.uid), 4000, 'User profile lookup timed out.');
      if (user?.profile) {
        this.theme.setTheme(user.profile.colorKeyword);
      }

      const config = await this.withTimeout(this.userData.getVaultConfig(authUser.uid), 4000, 'Vault config lookup timed out.');
      this.zone.run(() => {
        this.config = config;
        this.vaultCrypto.setConfigured(!!config);
      });
    } catch (error) {
      console.error('Vault initialization failed:', error);
      this.zone.run(() => {
        this.error = error instanceof Error ? error.message : 'Could not load vault. Check your Firestore rules and authentication state.';
      });
    } finally {
      this.zone.run(() => {
        this.loading = false;
      });
    }
  }

  ngOnDestroy(): void {
    this.clearVaultSession();
  }

  @HostListener('window:beforeunload')
  handleBeforeUnload(): void {
    this.clearVaultSession();
  }

  get isConfigured(): boolean {
    return !!this.config;
  }

  get isUnlocked(): boolean {
    return this.vaultCrypto.sessionState.isUnlocked;
  }

  get filteredItems(): VaultLoginItem[] {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) return this.items;
    return this.items.filter((item) =>
      item.title.toLowerCase().includes(query) ||
      item.provider.toLowerCase().includes(query) ||
      item.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  }

  async initializeVault(): Promise<void> {
    this.resetNotices();
    if (!this.setupPassword || this.setupPassword !== this.setupPasswordConfirm) {
      this.error = 'Master password confirmation does not match.';
      return;
    }

    try {
      const userId = this.requireUserId();
      const { config, recoveryKey } = await this.vaultCrypto.initializeVault(this.setupPassword);
      await this.userData.saveVaultConfig(userId, config);
      const savedConfig = await this.userData.getVaultConfig(userId);
      this.zone.run(() => {
        this.config = savedConfig;
        this.recoveryKeyVisible = recoveryKey;
        this.setupPassword = '';
        this.setupPasswordConfirm = '';
        this.success = 'Vault created and unlocked.';
      });
      await this.loadItems();
    } catch (error) {
      console.error(error);
      this.zone.run(() => {
        this.error = error instanceof Error ? `Failed to create vault: ${error.message}` : 'Failed to create vault.';
      });
    }
  }

  async unlockVault(): Promise<void> {
    this.resetNotices();
    if (!this.config || !this.unlockPassword) return;

    try {
      await this.vaultCrypto.unlockWithPassword(this.unlockPassword, this.config);
      this.zone.run(() => {
        this.unlockPassword = '';
        this.success = 'Vault unlocked.';
      });
      await this.loadItems();
    } catch (error) {
      console.error(error);
      this.zone.run(() => {
        this.error = 'Could not unlock vault. Check your master password.';
      });
      this.vaultCrypto.clearSession();
    }
  }

  lockVault(): void {
    this.clearVaultSession();
    this.zone.run(() => {
      this.success = 'Vault locked.';
    });
  }

  async recoverVault(): Promise<void> {
    this.resetNotices();
    if (!this.config) return;
    if (!this.recoveryKeyInput || !this.recoveryNewPassword || this.recoveryNewPassword !== this.recoveryNewPasswordConfirm) {
      this.error = 'Recovery key and matching new master password are required.';
      return;
    }

    try {
      const userId = this.requireUserId();
      const updatedConfig = await this.vaultCrypto.recoverVault(this.recoveryKeyInput, this.config, this.recoveryNewPassword);
      await this.userData.saveVaultConfig(userId, updatedConfig);
      const savedConfig = await this.userData.getVaultConfig(userId);
      this.zone.run(() => {
        this.config = savedConfig;
        this.recoveryKeyInput = '';
        this.recoveryNewPassword = '';
        this.recoveryNewPasswordConfirm = '';
        this.success = 'Vault recovered. Your master password has been rotated.';
      });
      await this.loadItems();
    } catch (error) {
      console.error(error);
      this.zone.run(() => {
        this.error = 'Recovery failed. Check your recovery key.';
      });
      this.vaultCrypto.clearSession();
    }
  }

  startCreate(): void {
    this.showEditor = true;
    this.editingItemId = null;
    this.editor = this.emptyEditor();
  }

  cancelEdit(): void {
    this.showEditor = false;
    this.editingItemId = null;
    this.editor = this.emptyEditor();
  }

  editItem(item: VaultLoginItem): void {
    const decrypted = this.decryptedItems[item.id || ''];
    this.showEditor = true;
    this.editingItemId = item.id || null;
    this.editor = {
      title: item.title,
      provider: item.provider,
      favorite: item.favorite,
      tagsText: item.tags.join(', '),
      username: decrypted?.username || '',
      password: decrypted?.password || '',
      url: decrypted?.url || '',
      notes: decrypted?.notes || '',
      tags: item.tags,
    };
  }

  async saveItem(): Promise<void> {
    this.resetNotices();
    if (!this.editor.title.trim() || !this.editor.provider.trim()) {
      this.error = 'Title and provider are required.';
      return;
    }

    try {
      const userId = this.requireUserId();
      const itemPayload = await this.vaultCrypto.encryptVaultItem({
        ...this.editor,
        tags: this.editor.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
      });

      if (this.editingItemId) {
        await this.userData.updateVaultItem(userId, this.editingItemId, itemPayload);
      } else {
        await this.userData.createVaultItem(userId, itemPayload);
      }

      this.zone.run(() => {
        this.success = this.editingItemId ? 'Vault item updated.' : 'Vault item created.';
        this.cancelEdit();
      });
      await this.loadItems();
    } catch (error) {
      console.error(error);
      this.zone.run(() => {
        this.error = 'Could not save vault item.';
      });
    }
  }

  async deleteItem(item: VaultLoginItem): Promise<void> {
    if (!item.id) return;
    this.resetNotices();
    try {
      const userId = this.requireUserId();
      await this.userData.deleteVaultItem(userId, item.id);
      this.zone.run(() => {
        this.success = 'Vault item deleted.';
        if (this.expandedItemId === item.id) this.expandedItemId = null;
      });
      await this.loadItems();
    } catch (error) {
      console.error(error);
      this.zone.run(() => {
        this.error = 'Could not delete vault item.';
      });
    }
  }

  toggleDetails(itemId: string): void {
    this.expandedItemId = this.expandedItemId === itemId ? null : itemId;
  }

  async copyText(value: string): Promise<void> {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    this.success = 'Copied to clipboard.';
  }

  dismissRecoveryKey(): void {
    this.recoveryKeyVisible = '';
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  private async loadItems(): Promise<void> {
    if (!this.isUnlocked) return;
    const userId = this.requireUserId();
    const items = await this.userData.getVaultItems(userId);
    const decryptedItems = await this.vaultCrypto.decryptVaultItems(items);
    this.zone.run(() => {
      this.items = items;
      this.decryptedItems = decryptedItems;
    });
  }

  private emptyEditor(): VaultLoginItemInput & { tagsText: string } {
    return {
      title: '',
      provider: '',
      favorite: false,
      tags: [],
      tagsText: '',
      username: '',
      password: '',
      url: '',
      notes: '',
    };
  }

  private requireUserId(): string {
    const userId = this.auth.getCurrentUserId();
    if (!userId) throw new Error('Authentication required.');
    return userId;
  }

  private resetNotices(): void {
    this.error = '';
    this.success = '';
  }

  private clearVaultSession(): void {
    this.vaultCrypto.clearSession();
    this.zone.run(() => {
      this.items = [];
      this.decryptedItems = {};
      this.expandedItemId = null;
      this.showEditor = false;
      this.editingItemId = null;
      this.unlockPassword = '';
    });
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  }
}
