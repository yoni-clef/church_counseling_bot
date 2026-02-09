export type UserState = 'IDLE' | 'SUBMITTING_PRAYER' | 'WAITING_COUNSELOR' | 'IN_SESSION' | 'VIEWING_HISTORY' | 'REPORTING' | 'POST_SESSION' | 'APPEALING' | 'COUNSELOR_ONBOARDING' | 'RATING_REQUIRED' | 'MATCHING';

export interface User {
    uuid: string;
    telegramChatId: number;
    createdAt: Date;
    lastActive: Date;
    state: UserState;
    user_preferred_language?: string[];
    user_requested_domain?: string;
}