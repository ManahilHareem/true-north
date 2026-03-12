/**
 * ApiService — thin wrapper over Firebase callable Cloud Functions.
 *
 * Every backend call goes through the private `call<T>()` method, which:
 *   1. Wraps httpsCallable in runInInjectionContext to avoid NgZone issues
 *   2. Returns typed data from the Cloud Function response
 *
 * Function names here (e.g. 'onProfileGenerate') map 1:1 to exports
 * in functions/index.js. If you rename a Cloud Function, update it here too.
 *
 * WHY runInInjectionContext? Angular Fire's httpsCallable needs access
 * to the injector for its internal DI. Without this wrapper, calls made
 * outside a component constructor (e.g. in async callbacks) would throw.
 */
import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AvailableAgent, PersonalizedRespondResult, RunAgentTaskResult, SpecializedAgentType } from '../models/interfaces';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private functions = inject(Functions);
  private injector = inject(Injector);

  /** Generic caller — all public methods delegate here. fnName must match the Cloud Function export name. */
  private async call<T>(fnName: string, data: Record<string, unknown>): Promise<T> {
    const fn = runInInjectionContext(this.injector, () =>
      httpsCallable(this.functions, fnName)
    );
    const result = await fn(data);
    return result.data as T;
  }

  async generateProfile(userId: string): Promise<any> {
    return this.call('onProfileGenerate', { userId });
  }

  async sendChatMessage(userId: string, agentId: string, message: string, threadId?: string): Promise<any> {
    return this.call('onChatMessage', { userId, agentId, message, ...(threadId ? { threadId } : {}) });
  }

  async submitReframe(userId: string, text: string): Promise<any> {
    return this.call('onReframeSubmit', { userId, text });
  }

  async analyzeLive(userId: string, transcript: string, intentSliders: Record<string, number>): Promise<any> {
    return this.call('onLiveAnalyze', { userId, transcript, intentSliders });
  }

  async generatePostCallSummary(userId: string, fullTranscript: string): Promise<any> {
    return this.call('onPostCallSummary', { userId, fullTranscript });
  }

  async generateFutures(userId: string): Promise<any> {
    return this.call('onGenerateFutures', { userId });
  }

  async generateFutureVision(userId: string, category: string): Promise<any> {
    return this.call('onGenerateFutureVision', { userId, category });
  }

  async finalizeFutures(userId: string, visions: any[]): Promise<any> {
    return this.call('onFinalizeFutures', { userId, visions });
  }

  async generateEdition(userId: string, localDate: string): Promise<any> {
    return this.call('onGenerateEdition', { userId, localDate });
  }

  async generateEditionItem(userId: string, topic: string, itemIndex: number, exclusions: string[]): Promise<any> {
    return this.call('onGenerateEditionItem', { userId, topic, itemIndex, exclusions });
  }

  async saveEdition(userId: string, localDate: string, items: any[]): Promise<any> {
    return this.call('onSaveEdition', { userId, localDate, items });
  }

  async processTranscript(userId: string, fileUrl: string, fileName: string): Promise<any> {
    return this.call('onTranscriptProcess', { userId, fileUrl, fileName });
  }

  async queryTranscripts(userId: string, question: string): Promise<any> {
    return this.call('onTranscriptQuery', { userId, question });
  }

  async generateDailyBriefing(userId: string, localDate: string): Promise<any> {
    return this.call('onDailyBriefingManual', { userId, localDate });
  }

  async triggerNewDay(userId: string, yesterdaySnapshot: any, entryCalibration?: any, localDate?: string): Promise<any> {
    return this.call('onNewDay', { userId, yesterdaySnapshot, localDate, ...(entryCalibration ? { entryCalibration } : {}) });
  }

  async choosePath(userId: string, date: string, choiceIndex: number): Promise<any> {
    return this.call('onChoosePath', { userId, date, choiceIndex });
  }

  async completeAction(userId: string, date: string, actionId: string): Promise<any> {
    return this.call('onCompleteAction', { userId, date, actionId });
  }

  async processFile(userId: string, fileUrl: string, fileName: string): Promise<any> {
    return this.call('onFileUpload', { userId, fileUrl, fileName });
  }

  async personalizedRespond(
    userId: string,
    message: string,
    options?: { threadId?: string; preferredAgent?: SpecializedAgentType; mode?: 'auto' | 'direct' }
  ): Promise<PersonalizedRespondResult> {
    return this.call('onPersonalizedRespond', {
      userId,
      message,
      ...(options?.threadId ? { threadId: options.threadId } : {}),
      ...(options?.preferredAgent ? { preferredAgent: options.preferredAgent } : {}),
      ...(options?.mode ? { mode: options.mode } : {}),
    });
  }

  async runAgentTask(
    userId: string,
    agentType: SpecializedAgentType,
    task: string,
    options?: { threadId?: string; options?: Record<string, unknown> }
  ): Promise<RunAgentTaskResult> {
    return this.call('onRunAgentTask', {
      userId,
      agentType,
      task,
      ...(options?.threadId ? { threadId: options.threadId } : {}),
      ...(options?.options ? { options: options.options } : {}),
    });
  }

  async listAvailableAgents(userId: string): Promise<{ agents: AvailableAgent[] }> {
    return this.call('onListAvailableAgents', { userId });
  }
}
