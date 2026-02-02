export interface Report {
    reportId: string;
    sessionId: string;
    counselorId: string;
    reason: string;
    timestamp: Date;
    processed: boolean;
}