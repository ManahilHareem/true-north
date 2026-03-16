/**
 * UserDataService — the single Firestore data access layer for the entire frontend.
 *
 * Every Firestore read/write in the app goes through this service.
 * All calls are wrapped in firestoreCall() → runInInjectionContext() to
 * avoid Angular's NgZone/injection context issues with Firebase SDK.
 *
 * DATA HIERARCHY (all user data lives under users/{uid}/):
 *   users/{uid}                          → UserProfile (onboarding + profile)
 *   users/{uid}/uploads/{id}             → UploadedFile metadata
 *   users/{uid}/chat_history/{agentId}/threads/{threadId}/messages/{id} → ChatMessage
 *   users/{uid}/journal_entries/{id}     → Journal entry + ReframeAnalysis
 *   users/{uid}/lexicon/{id}             → LexiconItem (vocabulary upgrades)
 *   users/{uid}/daily_briefings/{date}   → DailyBriefing
 *   users/{uid}/future_visions/current   → FutureVision[]
 *   users/{uid}/editions/{date}          → Edition (Signal Stream articles)
 *   users/{uid}/transcript_extractions/{id} → TranscriptExtraction
 *   users/{uid}/threads/{id}            → Thread (intelligence agent)
 *   users/{uid}/memory/core             → UserMemory (persistent memory)
 *   users/{uid}/scores/current          → DimensionScores
 *   users/{uid}/game_days/{date}        → GameDay
 *   users/{uid}/day_snapshots/{date}    → DaySnapshot
 *   users/{uid}/game_meta/coherence     → CoherenceMetrics
 *   users/{uid}/game_meta/calibration   → EntryCalibration
 *   users/{uid}/feedback/{id}           → article feedback (up/down)
 */
import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import {
  Firestore, doc, getDoc, setDoc, updateDoc, collection,
  query, orderBy, limit, getDocs, addDoc, serverTimestamp,
  where, deleteDoc, Timestamp
} from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import {
  UserProfile, OnboardingData, GeneratedProfile, ChatMessage, ChatThread,
  LexiconItem, DailyBriefing, FutureVision, Edition, TranscriptExtraction,
  Thread, UploadedFile, ReframeAnalysis, Feedback, AgentId,
  UserMemory, DimensionScores, GameDay, DaySnapshot, TodoItem,
  CoherenceMetrics, EntryCalibration, RuntimeChatMessage, RuntimeChatThread, VaultConfig, VaultLoginItem
} from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class UserDataService {
  private firestore = inject(Firestore);
  private storage = inject(Storage);
  private injector = inject(Injector);

  /** Wraps all Firestore calls in injection context to prevent NgZone errors */
  private firestoreCall<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  // ── User Profile ───────────────────────────────────────────
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId))
    );
    return snap.exists() ? (snap.data() as UserProfile) : null;
  }

  async saveOnboarding(userId: string, data: OnboardingData): Promise<void> {
    await this.firestoreCall(() =>
      updateDoc(doc(this.firestore, 'users', userId), { onboarding: data })
    );
  }

  async saveGeneratedProfile(userId: string, profile: GeneratedProfile): Promise<void> {
    await this.firestoreCall(() =>
      updateDoc(doc(this.firestore, 'users', userId), { profile })
    );
  }

  // ── File Uploads ───────────────────────────────────────────
  async uploadFile(userId: string, file: File): Promise<string> {
    const storageRef = ref(this.storage, `users/${userId}/uploads/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  }

  async saveFileMeta(userId: string, meta: Omit<UploadedFile, 'id'>): Promise<string> {
    const docRef = await this.firestoreCall(() =>
      addDoc(collection(this.firestore, 'users', userId, 'uploads'), meta)
    );
    return docRef.id;
  }

  async getUploads(userId: string): Promise<UploadedFile[]> {
    const snap = await this.firestoreCall(() => {
      const q = query(
        collection(this.firestore, 'users', userId, 'uploads'),
        orderBy('createdAt', 'desc')
      );
      return getDocs(q);
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as UploadedFile));
  }

  async deleteUpload(userId: string, fileId: string): Promise<void> {
    await this.firestoreCall(() =>
      deleteDoc(doc(this.firestore, 'users', userId, 'uploads', fileId))
    );
  }

  // ── Password Vault ────────────────────────────────────────
  async getVaultConfig(userId: string): Promise<VaultConfig | null> {
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId, 'vault', 'config'))
    );
    return snap.exists() ? (snap.data() as VaultConfig) : null;
  }

  async saveVaultConfig(userId: string, config: Omit<VaultConfig, 'createdAt' | 'updatedAt'>): Promise<void> {
    const ref = doc(this.firestore, 'users', userId, 'vault', 'config');
    const existing = await this.firestoreCall(() => getDoc(ref));
    await this.firestoreCall(() =>
      setDoc(ref, {
        ...config,
        createdAt: existing.exists() ? existing.data()['createdAt'] : serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }

  async getVaultItems(userId: string): Promise<VaultLoginItem[]> {
    const snap = await this.firestoreCall(() => {
      return getDocs(collection(this.firestore, 'users', userId, 'vault', 'config', 'items'));
    });
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as VaultLoginItem))
      .sort((a, b) => {
        const aTime = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const bTime = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      });
  }

  async createVaultItem(userId: string, item: Omit<VaultLoginItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const docRef = await this.firestoreCall(() =>
      addDoc(collection(this.firestore, 'users', userId, 'vault', 'config', 'items'), {
        ...item,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    return docRef.id;
  }

  async updateVaultItem(userId: string, itemId: string, item: Partial<Omit<VaultLoginItem, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    await this.firestoreCall(() =>
      updateDoc(doc(this.firestore, 'users', userId, 'vault', 'config', 'items', itemId), {
        ...item,
        updatedAt: serverTimestamp(),
      })
    );
  }

  async deleteVaultItem(userId: string, itemId: string): Promise<void> {
    await this.firestoreCall(() =>
      deleteDoc(doc(this.firestore, 'users', userId, 'vault', 'config', 'items', itemId))
    );
  }

  // ── Runtime Chat Threads ──────────────────────────────────
  async getRuntimeThreads(userId: string): Promise<RuntimeChatThread[]> {
    const snap = await this.firestoreCall(() => {
      const q = query(
        collection(this.firestore, 'users', userId, 'runtime_threads'),
        orderBy('lastMessageAt', 'desc')
      );
      return getDocs(q);
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as RuntimeChatThread));
  }

  async createRuntimeThread(userId: string, title: string): Promise<string> {
    const docRef = await this.firestoreCall(() =>
      addDoc(collection(this.firestore, 'users', userId, 'runtime_threads'), {
        title,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
      })
    );
    return docRef.id;
  }

  async getRuntimeMessages(userId: string, threadId: string, count = 60): Promise<RuntimeChatMessage[]> {
    const snap = await this.firestoreCall(() => {
      const q = query(
        collection(this.firestore, 'users', userId, 'runtime_threads', threadId, 'messages'),
        orderBy('timestamp', 'asc'),
        limit(count)
      );
      return getDocs(q);
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as RuntimeChatMessage));
  }

  async saveRuntimeMessage(userId: string, threadId: string, message: Omit<RuntimeChatMessage, 'id' | 'timestamp'>): Promise<void> {
    await this.firestoreCall(() =>
      addDoc(collection(this.firestore, 'users', userId, 'runtime_threads', threadId, 'messages'), {
        ...message,
        timestamp: serverTimestamp(),
      })
    );

    await this.firestoreCall(() =>
      updateDoc(doc(this.firestore, 'users', userId, 'runtime_threads', threadId), {
        lastMessageAt: serverTimestamp(),
      })
    );
  }

  async deleteRuntimeThread(userId: string, threadId: string): Promise<void> {
    const messages = await this.getRuntimeMessages(userId, threadId, 200);

    for (const message of messages) {
      if (!message.id) continue;
      await this.firestoreCall(() =>
        deleteDoc(doc(this.firestore, 'users', userId, 'runtime_threads', threadId, 'messages', message.id!))
      );
    }

    await this.firestoreCall(() =>
      deleteDoc(doc(this.firestore, 'users', userId, 'runtime_threads', threadId))
    );
  }

  // ── Chat Threads ──────────────────────────────────────────
  async getChatThreads(userId: string, agentId: string): Promise<ChatThread[]> {
    const snap = await this.firestoreCall(() => {
      const q = query(
        collection(this.firestore, 'users', userId, 'chat_history', agentId, 'threads'),
        orderBy('lastMessageAt', 'desc')
      );
      return getDocs(q);
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatThread));
  }

  async createChatThread(userId: string, agentId: string, title: string): Promise<string> {
    const docRef = await this.firestoreCall(() =>
      addDoc(collection(this.firestore, 'users', userId, 'chat_history', agentId, 'threads'), {
        title,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
      })
    );
    return docRef.id;
  }

  async getChatHistory(userId: string, agentId: string, threadId?: string, count = 50): Promise<ChatMessage[]> {
    const snap = await this.firestoreCall(() => {
      const path = threadId
        ? collection(this.firestore, 'users', userId, 'chat_history', agentId, 'threads', threadId, 'messages')
        : collection(this.firestore, 'users', userId, 'chat_history', agentId, 'messages');
      const q = query(path, orderBy('timestamp', 'asc'), limit(count));
      return getDocs(q);
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
  }

  async saveChatMessage(userId: string, agentId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>, threadId?: string): Promise<void> {
    await this.firestoreCall(() => {
      const colRef = threadId
        ? collection(this.firestore, 'users', userId, 'chat_history', agentId, 'threads', threadId, 'messages')
        : collection(this.firestore, 'users', userId, 'chat_history', agentId, 'messages');
      return addDoc(colRef, { ...message, timestamp: serverTimestamp() });
    });
    if (threadId) {
      await this.firestoreCall(() =>
        updateDoc(doc(this.firestore, 'users', userId, 'chat_history', agentId, 'threads', threadId), { lastMessageAt: serverTimestamp() })
      );
    }
  }

  // Migrate old flat messages into a "default" thread (one-time)
  async migrateToThreads(userId: string, agentId: string): Promise<string | null> {
    const oldMessages = await this.getChatHistory(userId, agentId, undefined, 1);
    if (oldMessages.length === 0) return null;

    // Check if default thread already exists
    const threads = await this.getChatThreads(userId, agentId);
    const existing = threads.find(t => t.title === 'Previous conversation');
    if (existing) return existing.id!;

    // Create default thread
    const threadId = await this.createChatThread(userId, agentId, 'Previous conversation');

    // Copy old messages to thread (batch)
    const allOld = await this.getChatHistory(userId, agentId, undefined, 200);
    for (const msg of allOld) {
      await this.firestoreCall(() =>
        addDoc(collection(this.firestore, 'users', userId, 'chat_history', agentId, 'threads', threadId, 'messages'), {
          role: msg.role,
          content: msg.content,
          agentId: msg.agentId,
          timestamp: msg.timestamp || serverTimestamp(),
        })
      );
    }
    return threadId;
  }

  // ── Journal Entries & Reframes ─────────────────────────────
  async saveJournalEntry(userId: string, text: string, analysis: ReframeAnalysis): Promise<string> {
    const docRef = await this.firestoreCall(() =>
      addDoc(collection(this.firestore, 'users', userId, 'journal_entries'), {
        rawText: text,
        analysis,
        createdAt: serverTimestamp(),
      })
    );
    return docRef.id;
  }

  async getJournalEntries(userId: string, days = 7): Promise<any[]> {
    const snap = await this.firestoreCall(() => {
      const q = query(
        collection(this.firestore, 'users', userId, 'journal_entries'),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      return getDocs(q);
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ── Lexicon ────────────────────────────────────────────────
  async saveLexiconItem(userId: string, item: Omit<LexiconItem, 'id' | 'createdAt' | 'usageCount'>): Promise<void> {
    await this.firestoreCall(() =>
      addDoc(collection(this.firestore, 'users', userId, 'lexicon'), { ...item, usageCount: 0, createdAt: serverTimestamp() })
    );
  }

  async getLexicon(userId: string): Promise<LexiconItem[]> {
    const snap = await this.firestoreCall(() => {
      const q = query(
        collection(this.firestore, 'users', userId, 'lexicon'),
        orderBy('createdAt', 'desc')
      );
      return getDocs(q);
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as LexiconItem));
  }

  // ── Daily Briefing ─────────────────────────────────────────
  private getLocalDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  async getTodayBriefing(userId: string): Promise<DailyBriefing | null> {
    const today = this.getLocalDate();
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId, 'daily_briefings', today))
    );
    return snap.exists() ? (snap.data() as DailyBriefing) : null;
  }

  async saveDailyBriefing(userId: string, briefing: Omit<DailyBriefing, 'createdAt'>): Promise<void> {
    await this.firestoreCall(() =>
      setDoc(doc(this.firestore, 'users', userId, 'daily_briefings', briefing.date), {
        ...briefing,
        createdAt: serverTimestamp(),
      })
    );
  }

  // ── Future Visions ─────────────────────────────────────────
  async getFutureVisions(userId: string): Promise<{ visions: FutureVision[]; updatedAt: any } | null> {
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId, 'future_visions', 'current'))
    );
    return snap.exists() ? (snap.data() as any) : null;
  }

  async saveFutureVisions(userId: string, visions: FutureVision[]): Promise<void> {
    await this.firestoreCall(() =>
      setDoc(doc(this.firestore, 'users', userId, 'future_visions', 'current'), {
        visions,
        updatedAt: serverTimestamp(),
      })
    );
  }

  // ── Signal Stream / Editions ───────────────────────────────
  async getTodayEdition(userId: string): Promise<Edition | null> {
    const today = this.getLocalDate();
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId, 'editions', today))
    );
    return snap.exists() ? (snap.data() as Edition) : null;
  }

  async saveEdition(userId: string, edition: Omit<Edition, 'createdAt'>): Promise<void> {
    await this.firestoreCall(() =>
      setDoc(doc(this.firestore, 'users', userId, 'editions', edition.date), {
        ...edition,
        createdAt: serverTimestamp(),
      })
    );
  }

  async saveFeedback(userId: string, itemId: string, action: 'up' | 'down'): Promise<void> {
    await this.firestoreCall(() =>
      addDoc(collection(this.firestore, 'users', userId, 'feedback'), { itemId, action, timestamp: serverTimestamp() })
    );
  }

  // ── Transcripts & Intelligence ─────────────────────────────
  async getTranscriptExtractions(userId: string): Promise<TranscriptExtraction[]> {
    const snap = await this.firestoreCall(() => {
      const q = query(
        collection(this.firestore, 'users', userId, 'transcript_extractions'),
        orderBy('createdAt', 'desc')
      );
      return getDocs(q);
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as TranscriptExtraction));
  }

  async getThreads(userId: string): Promise<Thread[]> {
    const snap = await this.firestoreCall(() => {
      const q = query(
        collection(this.firestore, 'users', userId, 'threads'),
        orderBy('lastMentionedAt', 'desc')
      );
      return getDocs(q);
    });
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Thread));
  }

  async getAllEntities(userId: string): Promise<any[]> {
    const extractions = await this.getTranscriptExtractions(userId);
    const entities: any[] = [];
    for (const ext of extractions) {
      for (const e of ext.entitiesMentioned) {
        entities.push({ ...e, sourceTranscript: ext.fileName });
      }
    }
    return entities;
  }

  // ── Memory Layer ──────────────────────────────────────────
  async getMemory(userId: string): Promise<UserMemory | null> {
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId, 'memory', 'core'))
    );
    return snap.exists() ? (snap.data() as UserMemory) : null;
  }

  async saveMemory(userId: string, memory: UserMemory): Promise<void> {
    await this.firestoreCall(() =>
      setDoc(doc(this.firestore, 'users', userId, 'memory', 'core'), memory)
    );
  }

  // ── Dimension Scores ──────────────────────────────────────
  async getDimensionScores(userId: string): Promise<DimensionScores | null> {
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId, 'scores', 'current'))
    );
    return snap.exists() ? (snap.data() as DimensionScores) : null;
  }

  async saveDimensionScores(userId: string, scores: DimensionScores): Promise<void> {
    await this.firestoreCall(() =>
      setDoc(doc(this.firestore, 'users', userId, 'scores', 'current'), scores)
    );
  }

  // ── Game of Life ──────────────────────────────────────────
  async getGameDay(userId: string, date: string): Promise<GameDay | null> {
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId, 'game_days', date))
    );
    return snap.exists() ? (snap.data() as GameDay) : null;
  }

  async saveGameDay(userId: string, day: GameDay): Promise<void> {
    await this.firestoreCall(() =>
      setDoc(doc(this.firestore, 'users', userId, 'game_days', day.date), day)
    );
  }

  async getRecentGameDays(userId: string, count = 7): Promise<GameDay[]> {
    const snap = await this.firestoreCall(() => {
      const q = query(
        collection(this.firestore, 'users', userId, 'game_days'),
        orderBy('date', 'desc'),
        limit(count)
      );
      return getDocs(q);
    });
    return snap.docs.map(d => d.data() as GameDay);
  }

  async saveDaySnapshot(userId: string, snapshot: DaySnapshot): Promise<void> {
    await this.firestoreCall(() =>
      setDoc(doc(this.firestore, 'users', userId, 'day_snapshots', snapshot.date), snapshot)
    );
  }

  // ── Game Coherence & Calibration ───────────────────────────
  async getCoherenceMetrics(userId: string): Promise<CoherenceMetrics | null> {
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId, 'game_meta', 'coherence'))
    );
    return snap.exists() ? (snap.data() as CoherenceMetrics) : null;
  }

  async getEntryCalibration(userId: string): Promise<EntryCalibration | null> {
    const snap = await this.firestoreCall(() =>
      getDoc(doc(this.firestore, 'users', userId, 'game_meta', 'calibration'))
    );
    return snap.exists() ? (snap.data() as EntryCalibration) : null;
  }
}
