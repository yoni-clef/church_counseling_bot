export interface PrayerRequest {
    prayerId: string;
    userId: string;
    title: string;
    createdAt: Date;
    status: 'open' | 'closed';
    closedAt?: Date;
}