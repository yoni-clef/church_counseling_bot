export interface AuditLog {
    logId: string;
    adminId: string;
    action: string;
    targetId?: string;
    timestamp: Date;
    details?: Record<string, unknown>;
}
