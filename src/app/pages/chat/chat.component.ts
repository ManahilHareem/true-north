/**
 * ChatComponent — multi-threaded advisor chat.
 *
 * Route: /chat/:agentId (financial, food-medicine, media, relationship, moonshot)
 * Each agent has its own system prompt (see functions/index.js section 3).
 *
 * Features:
 *   - Thread drawer (slide-out panel listing past conversations)
 *   - New thread creation (auto-titled from first message)
 *   - One-time migration of legacy flat messages into a "Previous conversation" thread
 *   - Messages are saved to Firestore and loaded on init
 *   - Backend handles memory injection + insight extraction automatically
 */
import { Component, inject, NgZone, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UserDataService } from '../../services/user-data.service';
import { ApiService } from '../../services/api.service';
import { ThemeService } from '../../services/theme.service';
import { ChatMessage, ChatThread, AgentId } from '../../models/interfaces';
import { AGENT_NAMES, AGENT_ICONS } from '../../prompts/templates';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat-page">
      <!-- Thread Drawer Backdrop -->
      <div class="drawer-backdrop" *ngIf="drawerOpen" (click)="drawerOpen = false"></div>

      <!-- Thread Drawer -->
      <div class="thread-drawer" [class.open]="drawerOpen">
        <div class="drawer-header">
          <h4>Conversations</h4>
          <button class="btn-ghost drawer-close" (click)="drawerOpen = false">&times;</button>
        </div>
        <button class="new-thread-btn" (click)="startNewThread()">+ New Thread</button>
        <div class="thread-list">
          <div *ngFor="let t of threads" class="thread-item" [class.active]="t.id === activeThreadId" (click)="switchThread(t)">
            <div class="thread-title">{{ t.title }}</div>
            <div class="thread-time">{{ getRelativeTime(t.lastMessageAt) }}</div>
          </div>
          <div *ngIf="threads.length === 0" class="thread-empty">No conversations yet</div>
        </div>
      </div>

      <!-- Header -->
      <div class="chat-header">
        <button class="btn-ghost back-btn" (click)="goBack()">&larr;</button>
        <button class="btn-ghost drawer-btn" (click)="drawerOpen = !drawerOpen">&#9776;</button>
        <div class="chat-agent-info">
          <span class="agent-emoji">{{ agentIcon }}</span>
          <div>
            <h3>{{ agentName }}</h3>
            <span class="agent-status">Online</span>
          </div>
        </div>
      </div>

      <!-- Messages -->
      <div class="messages-area" #messagesArea>
        <!-- Loading skeletons -->
        <div *ngIf="historyLoading" class="skeleton-messages">
          <div class="skel-row assistant"><div class="skel-bubble shimmer" style="width:65%"></div></div>
          <div class="skel-row user"><div class="skel-bubble shimmer" style="width:50%"></div></div>
          <div class="skel-row assistant"><div class="skel-bubble shimmer" style="width:70%"></div></div>
          <div class="skel-row user"><div class="skel-bubble shimmer" style="width:40%"></div></div>
          <div class="skel-row assistant"><div class="skel-bubble shimmer" style="width:60%"></div></div>
          <div class="skel-row user"><div class="skel-bubble shimmer" style="width:45%"></div></div>
        </div>

        <div *ngIf="!historyLoading">
          <div class="messages-start">
            <div class="agent-intro">
              <span class="intro-emoji">{{ agentIcon }}</span>
              <p *ngIf="messages.length === 0">Start a conversation with <strong>{{ agentName }}</strong>.</p>
              <p *ngIf="messages.length > 0">Conversation with <strong>{{ agentName }}</strong></p>
            </div>
          </div>

          <div *ngFor="let msg of messages; let i = index" class="msg-row" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
            <div class="msg-bubble" [class.user-bubble]="msg.role === 'user'" [class.ai-bubble]="msg.role === 'assistant'">
              <div class="msg-content" [innerHTML]="formatMessage(msg.content)"></div>
            </div>
          </div>

          <!-- Typing indicator -->
          <div *ngIf="typing" class="msg-row assistant">
            <div class="msg-bubble ai-bubble typing-bubble">
              <div class="typing-shimmer shimmer"></div>
              <div class="typing-status">{{ typingStatus }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="chat-input-area">
        <div class="input-row">
          <textarea
            [(ngModel)]="inputText"
            placeholder="Message {{ agentName }}..."
            (keydown.enter)="onEnterKey($event)"
            rows="1"
            class="chat-input"
            #chatInput
          ></textarea>
          <button class="send-btn" (click)="sendMessage()" [disabled]="!inputText.trim() || typing">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .chat-page { display: flex; flex-direction: column; height: 100vh; background: var(--bg-deep); position: relative; }

    /* ── Drawer ── */
    .drawer-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 90;
      animation: fadeIn 0.2s ease;
    }
    .thread-drawer {
      position: fixed; top: 0; left: -280px; width: 280px; height: 100vh;
      background: var(--bg-base); border-right: 1px solid var(--border-subtle);
      z-index: 100; transition: left 0.25s ease; display: flex; flex-direction: column;
      overflow: hidden;
    }
    .thread-drawer.open { left: 0; }
    .drawer-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 16px 12px; border-bottom: 1px solid var(--border-subtle);
    }
    .drawer-header h4 { font-family: var(--font-display); font-size: 1rem; color: var(--text-primary); margin: 0; }
    .drawer-close { font-size: 1.4rem; padding: 4px 8px; }
    .new-thread-btn {
      margin: 12px 12px 8px; padding: 10px; background: var(--accent-primary); color: var(--bg-deep);
      border: none; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 600;
      cursor: pointer; transition: opacity 0.2s;
    }
    .new-thread-btn:hover { opacity: 0.9; }
    .thread-list { flex: 1; overflow-y: auto; padding: 4px 8px; }
    .thread-item {
      padding: 12px; border-radius: var(--radius-md); cursor: pointer;
      transition: background 0.15s; margin-bottom: 2px;
    }
    .thread-item:hover { background: var(--bg-elevated); }
    .thread-item.active { background: var(--accent-soft); border: 1px solid var(--accent-primary); }
    .thread-title {
      font-size: 0.85rem; color: var(--text-primary); white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .thread-time { font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; }
    .thread-empty { text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 24px 12px; }

    /* ── Header ── */
    .chat-header {
      display: flex; align-items: center; gap: 8px; padding: 14px 20px;
      background: var(--bg-base); border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }
    .back-btn { padding: 6px 10px; font-size: 1.1rem; }
    .drawer-btn { padding: 6px 10px; font-size: 1.1rem; }
    .chat-agent-info { display: flex; align-items: center; gap: 10px; flex: 1; }
    .agent-emoji { font-size: 1.5rem; }
    .chat-agent-info h3 { font-family: var(--font-display); font-size: 1.1rem; color: var(--text-primary); margin: 0; }
    .agent-status { font-size: 0.75rem; color: var(--accent-primary); }

    /* ── Skeleton loading ── */
    .skeleton-messages { display: flex; flex-direction: column; gap: 12px; padding: 60px 20px 20px; }
    .skel-row { display: flex; }
    .skel-row.user { justify-content: flex-end; }
    .skel-row.assistant { justify-content: flex-start; }
    .skel-bubble { height: 44px; border-radius: 18px; }
    .shimmer {
      background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%);
      background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite;
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* ── Messages ── */
    .messages-area { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 8px; }
    .messages-start { text-align: center; padding: 40px 20px 24px; }
    .agent-intro { color: var(--text-muted); font-size: 0.85rem; }
    .intro-emoji { font-size: 2.5rem; display: block; margin-bottom: 12px; }
    .agent-intro p { max-width: 300px; margin: 0 auto; }

    .msg-row { display: flex; animation: fadeIn 0.3s ease forwards; }
    .msg-row.user { justify-content: flex-end; }
    .msg-row.assistant { justify-content: flex-start; }

    .msg-bubble { max-width: 75%; padding: 12px 16px; border-radius: 18px; font-size: 0.92rem; line-height: 1.6; }
    .user-bubble { background: var(--accent-primary); color: var(--bg-deep); border-bottom-right-radius: 4px; }
    .ai-bubble { background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-subtle); border-bottom-left-radius: 4px; }
    .msg-content { white-space: pre-wrap; word-wrap: break-word; }

    .typing-bubble { padding: 14px 20px; min-width: 120px; }
    .typing-shimmer { height: 14px; border-radius: 7px; width: 100%; }
    .typing-status { font-size: 0.75rem; color: var(--text-muted); margin-top: 8px; animation: fadeIn 0.4s ease; }

    /* ── Input ── */
    .chat-input-area {
      padding: 12px 16px 20px; background: var(--bg-base);
      border-top: 1px solid var(--border-subtle); flex-shrink: 0;
    }
    .input-row { display: flex; gap: 8px; align-items: flex-end; }
    .chat-input {
      flex: 1; padding: 12px 16px; background: var(--bg-surface); color: var(--text-primary);
      border: 1px solid var(--border-subtle); border-radius: 22px; font-family: var(--font-body);
      font-size: 0.92rem; outline: none; resize: none; max-height: 120px; line-height: 1.4;
    }
    .chat-input:focus { border-color: var(--accent-primary); }
    .send-btn {
      width: 44px; height: 44px; border-radius: 50%; background: var(--accent-primary);
      color: var(--bg-deep); border: none; cursor: pointer; display: flex; align-items: center;
      justify-content: center; flex-shrink: 0; transition: all 0.2s;
    }
    .send-btn:hover { transform: scale(1.05); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    @media (max-width: 600px) {
      .msg-bubble { max-width: 88%; }
      .thread-drawer { width: 260px; left: -260px; }
    }
  `],
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messagesArea') messagesArea!: ElementRef;
  @ViewChild('chatInput') chatInput!: ElementRef;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private userData = inject(UserDataService);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private zone = inject(NgZone);

  agentId: string = '';
  agentName = '';
  agentIcon = '';
  messages: ChatMessage[] = [];
  inputText = '';
  typing = false;
  historyLoading = true;
  drawerOpen = false;
  threads: ChatThread[] = [];
  activeThreadId: string | null = null;
  private shouldScroll = false;
  private userId = '';
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private typingPhase = 0;

  private readonly typingMessages = ['Thinking...', 'Composing...', 'Almost ready...'];

  get typingStatus(): string {
    if (!this.typing) return 'Online';
    return this.typingMessages[this.typingPhase] || 'Thinking...';
  }

  async ngOnInit() {
    this.agentId = this.route.snapshot.paramMap.get('agentId') || 'financial';
    this.agentName = AGENT_NAMES[this.agentId] || 'Advisor';
    this.agentIcon = AGENT_ICONS[this.agentId] || '🤖';

    this.userId = this.auth.getCurrentUserId() || '';
    if (!this.userId) { this.historyLoading = false; return; }

    // Load user theme
    const user = await this.userData.getUserProfile(this.userId);
    if (user?.profile) { this.theme.setTheme(user.profile.colorKeyword); }

    // Migrate old flat messages if needed, then load threads
    await this.userData.migrateToThreads(this.userId, this.agentId);
    const threads = await this.userData.getChatThreads(this.userId, this.agentId);

    this.zone.run(() => {
      this.threads = threads;
      this.historyLoading = false;
      // Don't auto-load any thread — start fresh each time
      this.messages = [];
      this.shouldScroll = true;
    });
  }

  ngOnDestroy() {
    if (this.typingTimer) clearInterval(this.typingTimer);
  }

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  async switchThread(thread: ChatThread) {
    if (!thread.id) return;
    this.drawerOpen = false;
    this.historyLoading = true;
    this.messages = [];
    this.activeThreadId = thread.id;

    const msgs = await this.userData.getChatHistory(this.userId, this.agentId, thread.id);
    this.zone.run(() => {
      this.messages = msgs;
      this.historyLoading = false;
      this.shouldScroll = true;
    });
  }

  async startNewThread() {
    this.drawerOpen = false;
    this.activeThreadId = null;
    this.messages = [];
    this.shouldScroll = true;
  }

  onEnterKey(event: Event) {
    const ke = event as KeyboardEvent;
    if (!ke.shiftKey) {
      ke.preventDefault();
      this.sendMessage();
    }
  }

  async sendMessage() {
    const text = this.inputText.trim();
    if (!text || !this.userId) return;

    // Create thread on first message if none active
    if (!this.activeThreadId) {
      const title = text.length > 40 ? text.substring(0, 40) + '...' : text;
      const threadId = await this.userData.createChatThread(this.userId, this.agentId, title);
      this.activeThreadId = threadId;
      // Refresh thread list in background
      this.userData.getChatThreads(this.userId, this.agentId).then(t => {
        this.zone.run(() => { this.threads = t; });
      });
    }

    // Add user message locally
    const userMsg: any = { role: 'user', content: text, agentId: this.agentId };
    this.messages.push(userMsg);
    this.inputText = '';
    this.typing = true;
    this.typingPhase = 0;
    this.shouldScroll = true;

    // Start cycling typing status
    this.typingTimer = setInterval(() => {
      this.zone.run(() => {
        this.typingPhase = Math.min(this.typingPhase + 1, this.typingMessages.length - 1);
      });
    }, 3000);

    // Save user message (fire-and-forget — don't block API call)
    this.userData.saveChatMessage(this.userId, this.agentId, userMsg, this.activeThreadId!).catch(console.error);

    try {
      const result = await this.api.sendChatMessage(this.userId, this.agentId, text, this.activeThreadId!);
      const aiMsg: any = { role: 'assistant', content: result.response || result.content || 'I couldn\'t generate a response.', agentId: this.agentId };
      this.zone.run(() => {
        this.messages.push(aiMsg);
        this.typing = false;
        if (this.typingTimer) { clearInterval(this.typingTimer); this.typingTimer = null; }
        this.shouldScroll = true;
      });
      this.userData.saveChatMessage(this.userId, this.agentId, aiMsg, this.activeThreadId!).catch(console.error);
    } catch (e) {
      this.zone.run(() => {
        this.messages.push({ role: 'assistant', content: 'Something went wrong. Please try again.', agentId: this.agentId as AgentId } as any);
        this.typing = false;
        if (this.typingTimer) { clearInterval(this.typingTimer); this.typingTimer = null; }
        this.shouldScroll = true;
      });
    }
  }

  getRelativeTime(timestamp: any): string {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = Date.now();
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  formatMessage(content: string): string {
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  goBack() { this.router.navigate(['/dashboard']); }

  private scrollToBottom() {
    try {
      this.messagesArea.nativeElement.scrollTop = this.messagesArea.nativeElement.scrollHeight;
    } catch {}
  }
}
