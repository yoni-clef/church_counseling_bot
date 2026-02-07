// Data Models for Telegram Counseling Bot
// All interfaces follow the design document specifications

export type UserState = 'IDLE' | 'SUBMITTING_PRAYER' | 'WAITING_COUNSELOR' | 'IN_SESSION' | 'VIEWING_HISTORY' | 'REPORTING' | 'POST_SESSION' | 'APPEALING' | 'BROADCASTING';

export interface User {
    uuid: string;           // Anonymous identifier
    telegramChatId: number; // Telegram chat ID for messaging
    state: UserState;        // Conversation state for menu routing
    createdAt: Date;
    lastInteraction: Date;
    activeSessionId?: string;
    broadcastData?: {
        target?: 'users' | 'counselors' | 'everyone';
        message?: string;
    };
}

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

export interface Session {
    sessionId: string;
    userId: string;
    counselorId: string;
    startTime: Date;
    endTime?: Date;
    isActive: boolean;
    duration?: number; // in minutes
    consentGiven?: boolean;
    consentTimestamp?: Date;
}

export interface Message {
    messageId: string;
    sessionId: string;
    senderId: string;      // UUID for user, counselor ID for counselor
    senderType: 'user' | 'counselor';
    content: string;
    timestamp: Date;
}

export interface PrayerRequest {
    prayerId: string;
    userId: string;
    title: string;
    createdAt: Date;
}

export interface Report {
    reportId: string;
    sessionId: string;
    counselorId: string;
    reason: string;
    timestamp: Date;
    processed: boolean;
}

export interface AuditLog {
    logId: string;
    adminId: string;
    action: string;
    targetId?: string;
    timestamp: Date;
    details?: Record<string, unknown>;
}

// Additional interfaces for statistics and operations
export interface CounselorStats {
    counselorId: string;
    sessionsHandled: number;
    averageSessionDuration: number;
    currentStatus: 'available' | 'busy' | 'away';
    workloadPercentage: number;
}

export interface SystemStats {
    totalSessionsCompleted: number;
    activeSessions: number;
    averageSessionDuration: number;
    totalPrayerRequests: number;
    peakUsageHours: number[];
}

// Validation schemas and utility types
export type CounselorStatus = 'available' | 'busy' | 'away';
export type SenderType = 'user' | 'counselor';
export type UserRole = 'user' | 'counselor' | 'admin';

// Database document interfaces (for MongoDB operations)
export interface UserDocument extends User {
    _id?: string;
}

export interface CounselorDocument extends Counselor {
    _id?: string;
}

export interface SessionDocument extends Session {
    _id?: string;
}

export interface MessageDocument extends Message {
    _id?: string;
}

export interface PrayerRequestDocument extends PrayerRequest {
    _id?: string;
}

export interface ReportDocument extends Report {
    _id?: string;
}

export interface AuditLogDocument extends AuditLog {
    _id?: string;
}