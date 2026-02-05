export type UserState = 'IDLE' | 'SUBMITTING_PRAYER' | 'WAITING_COUNSELOR' | 'IN_SESSION' | 'VIEWING_HISTORY' | 'REPORTING' | 'POST_SESSION';

export interface User {
    uuid: string;
    telegramChatId: number;
    createdAt: Date;
    lastActive: Date;
    state: UserState;
}