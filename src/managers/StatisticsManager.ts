import { Collections } from '../database/Collections';
import { Session } from '../types/Session';

export type StatsRole = 'admin' | 'counselor' | 'user';

export interface SessionStats {
    totalSessionsCompleted: number;
    activeSessions: number;
    averageSessionDuration: number; // minutes
}

export interface SystemStats extends SessionStats {
    totalPrayerRequests: number;
    peakUsageHours: number[];
}

export interface AnalyticsWindow {
    start?: Date;
    end?: Date;
}

export class StatisticsManager {
    private collections: Collections;

    constructor(collections: Collections) {
        this.collections = collections;
    }

    /**
     * Get system-wide statistics with role-appropriate filtering
     * Requirements: 8.1, 8.3, 8.4
     */
    async getSystemStats(role: StatsRole, requesterId?: string): Promise<SystemStats> {
        if (role === 'user') {
            if (!requesterId) {
                throw new Error('Requester ID is required for user statistics.');
            }
            return this.getUserStats(requesterId);
        }

        if (role === 'counselor') {
            if (!requesterId) {
                throw new Error('Requester ID is required for counselor statistics.');
            }
            return this.getCounselorStats(requesterId);
        }

        return this.getAdminStats();
    }

    /**
     * Admin-level statistics across all sessions and prayers
     * Requirements: 8.1, 8.3
     */
    async getAdminStats(): Promise<SystemStats> {
        const [sessionStats, totalPrayerRequests, peakUsageHours] = await Promise.all([
            this.getSessionStats(),
            this.collections.prayers.countDocuments(),
            this.getPeakUsageHours()
        ]);

        return {
            ...sessionStats,
            totalPrayerRequests,
            peakUsageHours
        };
    }

    /**
     * Counselor-level statistics scoped to the counselor's sessions
     * Requirements: 8.4
     */
    async getCounselorStats(counselorId: string): Promise<SystemStats> {
        const [sessionStats, peakUsageHours] = await Promise.all([
            this.getSessionStats({ counselorId }),
            this.getPeakUsageHours({ counselorId })
        ]);

        return {
            ...sessionStats,
            totalPrayerRequests: 0,
            peakUsageHours
        };
    }

    /**
     * User-level statistics scoped to the user's sessions and prayer requests
     * Requirements: 8.4
     */
    async getUserStats(userId: string): Promise<SystemStats> {
        const [sessionStats, totalPrayerRequests, peakUsageHours] = await Promise.all([
            this.getSessionStats({ userId }),
            this.collections.prayers.countDocuments({ userId }),
            this.getPeakUsageHours({ userId })
        ]);

        return {
            ...sessionStats,
            totalPrayerRequests,
            peakUsageHours
        };
    }

    /**
     * Session statistics for any scope
     * Requirements: 8.1
     */
    async getSessionStats(filter: Partial<Pick<Session, 'userId' | 'counselorId'>> = {}): Promise<SessionStats> {
        const [activeSessions, completedSessions] = await Promise.all([
            this.collections.sessions.countDocuments({ ...filter, isActive: true }),
            this.collections.sessions.find({ ...filter, isActive: false }).toArray()
        ]);

        const totalSessionsCompleted = completedSessions.length;
        const averageSessionDuration = this.calculateAverageDuration(completedSessions);

        return {
            totalSessionsCompleted,
            activeSessions,
            averageSessionDuration
        };
    }

    /**
     * Peak usage hours based on session start times
     * Requirements: 8.3
     */
    async getPeakUsageHours(
        filter: Partial<Pick<Session, 'userId' | 'counselorId'>> = {},
        window?: AnalyticsWindow,
        top = 3
    ): Promise<number[]> {
        const timeFilter: Record<string, unknown> = { ...filter };
        if (window?.start || window?.end) {
            timeFilter.startTime = {} as { $gte?: Date; $lte?: Date };
            if (window.start) {
                (timeFilter.startTime as { $gte?: Date }).$gte = window.start;
            }
            if (window.end) {
                (timeFilter.startTime as { $lte?: Date }).$lte = window.end;
            }
        }

        const sessions = await this.collections.sessions.find(timeFilter).toArray();
        const hourCounts = new Map<number, number>();

        for (const session of sessions) {
            const hour = session.startTime.getHours();
            hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
        }

        return Array.from(hourCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, top)
            .map(([hour]) => hour);
    }

    private calculateAverageDuration(sessions: Session[]): number {
        if (sessions.length === 0) {
            return 0;
        }

        const durations = sessions.map(session => {
            if (typeof session.duration === 'number') {
                return session.duration;
            }
            if (session.endTime) {
                const durationMs = session.endTime.getTime() - session.startTime.getTime();
                return Math.round(durationMs / (1000 * 60));
            }
            return 0;
        });

        const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
        return Math.round((totalDuration / sessions.length) * 100) / 100;
    }
}
