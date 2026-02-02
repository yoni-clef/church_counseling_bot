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