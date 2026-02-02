export interface Counselor {
    id: string;
    telegramChatId: number;
    status: 'available' | 'busy' | 'away';
    isApproved: boolean;
    strikes: number;
    isSuspended: boolean;
    sessionsHandled: number;
    createdAt: Date;
    lastActive: Date;
}