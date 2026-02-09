export type CounselorStatus = 'available' | 'busy' | 'away' | 'Pending Admin Approval';

export interface Counselor {
    id: string;
    telegramChatId: number;
    status: CounselorStatus;
    isApproved: boolean;
    strikes: number;
    isSuspended: boolean;
    sessionsHandled: number;
    ratingCount: number;
    ratingTotal: number;
    ratingAverage: number;
    createdAt: Date;
    lastActive: Date;
    fullName?: string;
    telegramUsername?: string;
    languagesSpoken?: string[];
    domainExpertise?: string[];
    yearsExperience?: number;
    country?: string;
    location?: string;
}