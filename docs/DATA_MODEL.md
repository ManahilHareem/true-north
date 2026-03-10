# True North — Data Model

## Firestore Structure

All user data lives under `users/{uid}/`. There is no shared/global data.

```
users/
  {uid}/                              ← UserProfile document
    ├── .uid: string
    ├── .email: string
    ├── .role: 'member' | 'founder' | 'admin'
    ├── .createdAt: Timestamp
    ├── .onboarding: OnboardingData    ← collected during onboarding wizard
    ├── .profile: GeneratedProfile     ← LLM-generated from onboarding data
    ├── .genomeData: GenomeEntry[]     ← parsed 23andMe SNP data (optional)
    │
    ├── memory/
    │   └── core                       ← UserMemory (single doc, updated after every interaction)
    │       ├── .coreInsights: string[]          (max 10)
    │       ├── .activePatterns: MemoryPattern[] (max 8)
    │       ├── .avoidances: string[]            (max 5)
    │       ├── .strengths: string[]             (max 5)
    │       ├── .agentInsights: Record<string, string>
    │       ├── .currentEdge: string
    │       └── .lastUpdated: Timestamp
    │
    ├── scores/
    │   └── current                    ← DimensionScores (single doc)
    │       ├── .spirit: number (5-100)
    │       ├── .body: number
    │       ├── .relationships: number
    │       ├── .wealth: number
    │       ├── .creativeExpression: number
    │       ├── .service: number
    │       ├── .learning: number
    │       ├── .environment: number
    │       ├── .lastActivity: Record<string, string>  (per-dimension date for decay)
    │       └── .lastDate: string
    │
    ├── chat_history/
    │   └── {agentId}/                 ← financial, food-medicine, media, relationship, moonshot
    │       ├── messages/{id}          ← legacy flat messages (pre-threading)
    │       └── threads/
    │           └── {threadId}/
    │               ├── .title: string
    │               ├── .createdAt: Timestamp
    │               ├── .lastMessageAt: Timestamp
    │               └── messages/{id}  ← ChatMessage
    │                   ├── .role: 'user' | 'assistant'
    │                   ├── .content: string
    │                   ├── .agentId: AgentId
    │                   └── .timestamp: Timestamp
    │
    ├── journal_entries/{id}           ← Journal entry + analysis
    │   ├── .rawText: string
    │   ├── .analysis: ReframeAnalysis
    │   └── .createdAt: Timestamp
    │
    ├── lexicon/{id}                   ← LexiconItem
    │   ├── .weakPhrase: string
    │   ├── .strongReplacement: string
    │   ├── .rationale: string
    │   ├── .usageCount: number
    │   └── .createdAt: Timestamp
    │
    ├── daily_briefings/{date}         ← DailyBriefing (keyed by YYYY-MM-DD)
    │   ├── .financialInsight: string
    │   ├── .healthSuggestion: string
    │   ├── .headlines: BriefingHeadline[]
    │   ├── .relationshipReflection: string
    │   ├── .growthReminder: string
    │   └── .createdAt: Timestamp
    │
    ├── future_visions/
    │   └── current                    ← { visions: FutureVision[], updatedAt: Timestamp }
    │
    ├── editions/{date}                ← Edition (Signal Stream, keyed by YYYY-MM-DD)
    │   ├── .items: EditionItem[]
    │   └── .createdAt: Timestamp
    │
    ├── uploads/{id}                   ← UploadedFile metadata
    │   ├── .fileName: string
    │   ├── .fileUrl: string           (Firebase Storage URL)
    │   ├── .fileType: string
    │   ├── .category: string
    │   ├── .tags: string[]
    │   ├── .summary: string
    │   └── .createdAt: Timestamp
    │
    ├── transcript_extractions/{id}    ← TranscriptExtraction (founders only)
    │   ├── .executiveSummary: string
    │   ├── .nuggets: string[]
    │   ├── .decisionsMade: Decision[]
    │   ├── .openLoops: OpenLoop[]
    │   ├── .actionItems: ActionItem[]
    │   ├── .entitiesMentioned: EntityMention[]
    │   ├── .risks: string[]
    │   ├── .threadUpdates: string[]
    │   └── .createdAt: Timestamp
    │
    ├── threads/{id}                   ← Thread (intelligence agent, auto-generated)
    │   ├── .title: string
    │   ├── .summaryCurrent: string
    │   ├── .status: 'active' | 'waiting' | 'stalled' | 'resolved'
    │   ├── .keyEvents: ThreadEvent[]
    │   ├── .openLoops: string[]
    │   ├── .nextBestActions: string[]
    │   ├── .relatedEntities: string[]
    │   ├── .lastMentionedAt: Timestamp
    │   └── .createdAt: Timestamp
    │
    ├── game_days/{date}               ← GameDay (keyed by YYYY-MM-DD)
    │   ├── .tileType: TileType
    │   ├── .tilePrompt: string
    │   ├── .choices: TileChoice[]
    │   ├── .chosenPath: number | null
    │   ├── .choiceConsequences: Record<string, number> | null
    │   ├── .state: 'pending_choice' | 'in_progress' | 'completed'
    │   ├── .actions: DailyAction[]
    │   ├── .yesterdayAnalysis: string
    │   ├── .shadowProgression?: { shadow, gift, siddhi }
    │   └── .createdAt: Timestamp
    │
    ├── day_snapshots/{date}           ← DaySnapshot (end-of-day state capture)
    │
    ├── game_meta/
    │   ├── coherence                  ← CoherenceMetrics
    │   │   ├── .streak: number
    │   │   ├── .totalChoices: number
    │   │   ├── .courageChoices: number
    │   │   ├── .transmutations: number
    │   │   └── .boardLevel: number (1-4)
    │   └── calibration                ← EntryCalibration
    │       ├── .wantMore: string
    │       ├── .drains: string
    │       ├── .afraidToRisk: string
    │       ├── .aliveButUncertain: string
    │       └── .savedAt: Timestamp
    │
    ├── feedback/{id}                  ← article feedback
    │   ├── .itemId: string
    │   ├── .action: 'up' | 'down'
    │   └── .timestamp: Timestamp
    │
    └── call_summaries/{id}            ← Post-call analysis from Live Mode
        ├── .topMomentsToImprove: string[]
        ├── .wins: string[]
        ├── .overallScore: number
        ├── .summary: string
        └── .createdAt: Timestamp
```

## Firebase Storage Structure

```
users/{uid}/uploads/{timestamp}_{filename}
```

Files are uploaded via `UserDataService.uploadFile()` and metadata is stored in the `uploads` subcollection.

## Key Data Relationships

- **OnboardingData → GeneratedProfile**: Profile is generated from onboarding answers (one-time)
- **GeneratedProfile.wheelOfLife → DimensionScores**: Initial scores seeded from profile, then evolve independently
- **GameDay.choices[chosenPath].consequenceType → DimensionScores**: Choice deltas modify scores
- **DailyAction completion → DimensionScores**: Action completion boosts linked dimension
- **Every interaction → UserMemory**: Memory grows with every chat, reframe, and game choice
- **TranscriptExtraction.threadUpdates → Thread**: Threads are auto-created/updated from transcript analysis

## Types Reference

All TypeScript interfaces are defined in `src/app/models/interfaces.ts`. See that file for the complete type definitions.
