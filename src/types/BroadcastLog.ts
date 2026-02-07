export type BroadcastTargetGroup = 'users' | 'counselors' | 'everyone';

export interface BroadcastLog {
    broadcastId: string;
    message: string;
    targetGroup: BroadcastTargetGroup;
    sentByAdminId: string;
    sentAt: Date;
    successCount: number;
    failedCount: number;
}