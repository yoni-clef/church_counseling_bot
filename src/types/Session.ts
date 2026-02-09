export interface Session {
    sessionId: string;
    userId: string;
    counselorId: string;
    currentCounselorId?: string;
    previousCounselorId?: string;
    startTime: Date;
    endTime?: Date;
    isActive: boolean;
    duration?: number; // in minutes
    consentGiven?: boolean;
    consentTimestamp?: Date;
    userPreferredLanguage?: string[];
    userRequestedDomain?: string;
    transferReason?: string;
    transferTimestamp?: Date;
    transferCount?: number;
    transferHistory?: Array<{
        fromCounselorId: string;
        toCounselorId: string;
        reason: string;
        timestamp: Date;
    }>;
    ratingScore?: number;
    ratingTimestamp?: Date;
}