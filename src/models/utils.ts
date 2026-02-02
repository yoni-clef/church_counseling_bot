// Utility functions for ID generation and data operations
import { v4 as uuidv4 } from 'uuid';

// ID generation functions
export const generateUserId = (): string => {
    return uuidv4();
};

export const generateCounselorId = (): string => {
    return `counselor_${uuidv4()}`;
};

export const generateSessionId = (): string => {
    return `session_${uuidv4()}`;
};

export const generateMessageId = (): string => {
    return `msg_${uuidv4()}`;
};

export const generatePrayerId = (): string => {
    return `prayer_${uuidv4()}`;
};

export const generateReportId = (): string => {
    return `report_${uuidv4()}`;
};

export const generateAuditLogId = (): string => {
    return `audit_${uuidv4()}`;
};

// Date utility functions
export const getCurrentTimestamp = (): Date => {
    return new Date();
};

export const calculateSessionDuration = (startTime: Date, endTime: Date): number => {
    const durationMs = endTime.getTime() - startTime.getTime();
    return Math.round(durationMs / (1000 * 60)); // Convert to minutes
};

// Data anonymization utilities
export const anonymizeUserId = (userId: string): string => {
    // Return only the first 8 characters for logging/debugging while maintaining anonymity
    return userId.substring(0, 8) + '...';
};

export const anonymizeCounselorId = (counselorId: string): string => {
    // Return only the counselor prefix and first few characters
    if (counselorId.startsWith('counselor_')) {
        return 'counselor_' + counselorId.substring(10, 18) + '...';
    }
    return counselorId.substring(0, 8) + '...';
};

// Collection name constants for MongoDB
export const COLLECTIONS = {
    USERS: 'users',
    COUNSELORS: 'counselors',
    SESSIONS: 'sessions',
    MESSAGES: 'messages',
    PRAYER_REQUESTS: 'prayer_requests',
    REPORTS: 'reports',
    AUDIT_LOGS: 'audit_logs'
} as const;

export type CollectionName = typeof COLLECTIONS[keyof typeof COLLECTIONS];