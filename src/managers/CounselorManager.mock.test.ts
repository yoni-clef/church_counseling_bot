import { CounselorManager } from './CounselorManager';
import { Collections } from '../database/Collections';
import { Counselor } from '../types/Counselor';
import { Session } from '../types/Session';
import fc from 'fast-check';

// Mock MongoDB Collection
class MockCollection<T> {
    private data: T[] = [];

    async insertOne(doc: T): Promise<{ insertedId: any }> {
        this.data.push(doc);
        return { insertedId: 'mock-id' };
    }

    async insertMany(docs: T[]): Promise<{ insertedIds: any[] }> {
        this.data.push(...docs);
        return { insertedIds: docs.map(() => 'mock-id') };
    }

    async findOne(filter: any): Promise<T | null> {
        return this.data.find(item => this.matchesFilter(item, filter)) || null;
    }

    find(filter: any = {}): { toArray: () => Promise<T[]> } {
        const results = this.data.filter(item => this.matchesFilter(item, filter));
        return {
            toArray: async () => results
        };
    }

    async updateOne(filter: any, update: any): Promise<{ matchedCount: number; modifiedCount: number }> {
        const index = this.data.findIndex(item => this.matchesFilter(item, filter));
        if (index >= 0) {
            if (update.$set) {
                this.data[index] = { ...this.data[index], ...update.$set };
            }
            return { matchedCount: 1, modifiedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
    }

    async deleteMany(filter: any): Promise<{ deletedCount: number }> {
        const initialLength = this.data.length;
        this.data = this.data.filter(item => !this.matchesFilter(item, filter));
        return { deletedCount: initialLength - this.data.length };
    }

    private matchesFilter(item: any, filter: any): boolean {
        if (Object.keys(filter).length === 0) return true;

        for (const [key, value] of Object.entries(filter)) {
            if (item[key] !== value) return false;
        }
        return true;
    }

    clear() {
        this.data = [];
    }
}

describe('CounselorManager Property Tests (Mocked)', () => {
    let counselorManager: CounselorManager;
    let mockCollections: Collections;
    let mockCounselors: MockCollection<Counselor>;
    let mockSessions: MockCollection<Session>;

    beforeEach(() => {
        // Create mock collections
        mockCounselors = new MockCollection<Counselor>();
        mockSessions = new MockCollection<Session>();

        // Create mock Collections object
        mockCollections = {
            counselors: mockCounselors as any,
            sessions: mockSessions as any,
            users: new MockCollection() as any,
            messages: new MockCollection() as any,
            prayers: new MockCollection() as any,
            reports: new MockCollection() as any,
            initializeCollections: jest.fn(),
            ensureCollectionsExist: jest.fn(),
            getCollectionStats: jest.fn()
        } as any; // Type assertion to bypass private property requirements

        counselorManager = new CounselorManager(mockCollections);

        // Clear any existing data
        mockCounselors.clear();
        mockSessions.clear();
    });

    afterEach(() => {
        mockCounselors.clear();
        mockSessions.clear();
    });

    /**
     * Property 8: Counselor status validation
     * Feature: telegram-counseling-bot, Property 8: Counselor status validation
     * Validates: Requirements 3.1
     */
    test('Property 8: Counselor status validation', async () => {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1 }), // counselorId
            fc.integer({ min: 1000000, max: 9999999999 }), // telegramChatId
            fc.oneof(
                fc.constant('available'),
                fc.constant('busy'),
                fc.constant('away'),
                fc.string().filter(s => !['available', 'busy', 'away'].includes(s)) // invalid status
            ),
            async (counselorId, telegramChatId, status) => {
                // Create a counselor first
                const counselor: Counselor = {
                    id: counselorId,
                    telegramChatId,
                    status: 'away',
                    isApproved: true,
                    strikes: 0,
                    isSuspended: false,
                    sessionsHandled: 0,
                    ratingCount: 0,
                    ratingTotal: 0,
                    ratingAverage: 0,
                    createdAt: new Date(),
                    lastActive: new Date()
                };
                await mockCollections.counselors.insertOne(counselor);

                const validStatuses = ['available', 'busy', 'away'];

                if (validStatuses.includes(status as any)) {
                    // Valid status should succeed
                    await expect(counselorManager.setAvailability(counselorId, status as any))
                        .resolves.not.toThrow();

                    // Verify status was updated
                    const updatedCounselor = await mockCollections.counselors.findOne({ id: counselorId });
                    expect(updatedCounselor?.status).toBe(status);
                } else {
                    // Invalid status should throw error
                    await expect(counselorManager.setAvailability(counselorId, status as any))
                        .rejects.toThrow();
                }
            }
        ), { numRuns: 50 }); // Reduced runs for faster execution
    });

    /**
     * Property 9: Available counselor assignment
     * Feature: telegram-counseling-bot, Property 9: Available counselor assignment
     * Validates: Requirements 3.2
     */
    test('Property 9: Available counselor assignment', async () => {
        await fc.assert(fc.asyncProperty(
            fc.array(fc.record({
                id: fc.string({ minLength: 1 }),
                telegramChatId: fc.integer({ min: 1000000, max: 9999999999 }),
                status: fc.oneof(fc.constant('available'), fc.constant('busy'), fc.constant('away')),
                isApproved: fc.boolean(),
                isSuspended: fc.boolean()
            }), { minLength: 1, maxLength: 5 }), // Reduced max length
            async (counselorData) => {
                // Clear any existing data from previous iterations
                mockCounselors.clear();
                mockSessions.clear();

                // Insert counselors
                const counselors: Counselor[] = counselorData.map(data => ({
                    ...data,
                    status: data.status as 'available' | 'busy' | 'away',
                    strikes: 0,
                    sessionsHandled: 0,
                    ratingCount: 0,
                    ratingTotal: 0,
                    ratingAverage: 0,
                    createdAt: new Date(),
                    lastActive: new Date()
                }));

                await mockCollections.counselors.insertMany(counselors);

                const assignedCounselorId = await counselorManager.getAvailableCounselor();

                if (assignedCounselorId) {
                    // If a counselor was assigned, they must be available, approved, and not suspended
                    const assignedCounselor = await mockCollections.counselors.findOne({ id: assignedCounselorId });
                    expect(assignedCounselor).toBeTruthy();
                    expect(assignedCounselor!.status).toBe('available');
                    expect(assignedCounselor!.isApproved).toBe(true);
                    expect(assignedCounselor!.isSuspended).toBe(false);
                } else {
                    // If no counselor was assigned, there should be no available, approved, non-suspended counselors
                    const availableCounselors = (await mockCollections.counselors.find({
                        status: 'available',
                        isApproved: true,
                        isSuspended: false
                    })).toArray();
                    expect((await availableCounselors).length).toBe(0);
                }
            }
        ), { numRuns: 50 });
    });

    /**
     * Property 21: Counselor listing content
     * Feature: telegram-counseling-bot, Property 21: Counselor listing content
     * Validates: Requirements 6.3
     */
    test('Property 21: Counselor listing content', async () => {
        await fc.assert(fc.asyncProperty(
            fc.array(fc.record({
                id: fc.string({ minLength: 1 }),
                telegramChatId: fc.integer({ min: 1000000, max: 9999999999 }),
                status: fc.oneof(fc.constant('available'), fc.constant('busy'), fc.constant('away')),
                isApproved: fc.boolean(),
                strikes: fc.integer({ min: 0, max: 10 }),
                isSuspended: fc.boolean(),
                sessionsHandled: fc.integer({ min: 0, max: 100 })
            }), { minLength: 1, maxLength: 5 }),
            async (counselorData) => {
                // Clear any existing data from previous iterations
                mockCounselors.clear();
                mockSessions.clear();

                // Insert counselors
                const counselors: Counselor[] = counselorData.map(data => ({
                    ...data,
                    status: data.status as 'available' | 'busy' | 'away',
                    createdAt: new Date(),
                    lastActive: new Date(),
                    ratingCount: 0,
                    ratingTotal: 0,
                    ratingAverage: 0
                }));

                await mockCollections.counselors.insertMany(counselors);

                const listing = await counselorManager.listCounselors();

                // Verify listing contains all required information
                expect(listing.length).toBe(counselors.length);

                for (const listedCounselor of listing) {
                    expect(listedCounselor).toHaveProperty('counselorId');
                    expect(listedCounselor).toHaveProperty('status');
                    expect(listedCounselor).toHaveProperty('isApproved');
                    expect(listedCounselor).toHaveProperty('sessionsHandled');
                    expect(listedCounselor).toHaveProperty('strikes');
                    expect(listedCounselor).toHaveProperty('isSuspended');
                    expect(listedCounselor).toHaveProperty('lastActive');

                    // Verify the counselor exists in our original data
                    const originalCounselor = counselors.find(c => c.id === listedCounselor.counselorId);
                    expect(originalCounselor).toBeTruthy();
                    expect(listedCounselor.status).toBe(originalCounselor!.status);
                    expect(listedCounselor.isApproved).toBe(originalCounselor!.isApproved);
                    expect(listedCounselor.sessionsHandled).toBe(originalCounselor!.sessionsHandled);
                    expect(listedCounselor.strikes).toBe(originalCounselor!.strikes);
                    expect(listedCounselor.isSuspended).toBe(originalCounselor!.isSuspended);
                }
            }
        ), { numRuns: 50 });
    });

    /**
     * Property 29: Counselor statistics content
     * Feature: telegram-counseling-bot, Property 29: Counselor statistics content
     * Validates: Requirements 8.2
     */
    test('Property 29: Counselor statistics content', async () => {
        await fc.assert(fc.asyncProperty(
            fc.array(fc.record({
                id: fc.string({ minLength: 1 }),
                telegramChatId: fc.integer({ min: 1000000, max: 9999999999 }),
                status: fc.oneof(fc.constant('available'), fc.constant('busy'), fc.constant('away')),
                isApproved: fc.boolean(),
                strikes: fc.integer({ min: 0, max: 10 }),
                isSuspended: fc.boolean(),
                sessionsHandled: fc.integer({ min: 0, max: 100 })
            }), { minLength: 1, maxLength: 5 }),
            async (counselorData) => {
                // Clear any existing data from previous iterations
                mockCounselors.clear();
                mockSessions.clear();

                // Insert counselors
                const counselors: Counselor[] = counselorData.map(data => ({
                    ...data,
                    status: data.status as 'available' | 'busy' | 'away',
                    createdAt: new Date(),
                    lastActive: new Date(),
                    ratingCount: 0,
                    ratingTotal: 0,
                    ratingAverage: 0
                }));

                await mockCollections.counselors.insertMany(counselors);

                // Test individual counselor statistics
                for (const counselor of counselors) {
                    const stats = await counselorManager.getCounselorStats(counselor.id);

                    // Verify stats contain sessions handled and workload distribution metrics
                    expect(stats.counselorId).toBe(counselor.id);
                    expect(stats.sessionsHandled).toBe(counselor.sessionsHandled);
                    expect(stats.status).toBe(counselor.status);
                    expect(stats.isApproved).toBe(counselor.isApproved);
                    expect(stats.strikes).toBe(counselor.strikes);
                    expect(stats.isSuspended).toBe(counselor.isSuspended);
                    expect(stats.lastActive).toEqual(counselor.lastActive);
                }

                // Test workload distribution
                const workloadDistribution = await counselorManager.getWorkloadDistribution();
                expect(workloadDistribution.length).toBe(counselors.length);

                const totalSessions = counselors.reduce((sum, c) => sum + c.sessionsHandled, 0);
                let totalPercentage = 0;

                for (const workload of workloadDistribution) {
                    expect(workload).toHaveProperty('counselorId');
                    expect(workload).toHaveProperty('sessionsHandled');
                    expect(workload).toHaveProperty('workloadPercentage');

                    const originalCounselor = counselors.find(c => c.id === workload.counselorId);
                    expect(originalCounselor).toBeTruthy();
                    expect(workload.sessionsHandled).toBe(originalCounselor!.sessionsHandled);

                    if (totalSessions > 0) {
                        const expectedPercentage = (originalCounselor!.sessionsHandled / totalSessions) * 100;
                        expect(workload.workloadPercentage).toBeCloseTo(expectedPercentage, 2);
                        totalPercentage += workload.workloadPercentage;
                    } else {
                        expect(workload.workloadPercentage).toBe(0);
                    }
                }

                // Total percentage should be close to 100% (or 0% if no sessions)
                if (totalSessions > 0) {
                    expect(totalPercentage).toBeCloseTo(100, 1);
                }

                // Test comprehensive statistics
                const allStats = await counselorManager.getAllCounselorStats();
                expect(allStats.totalCounselors).toBe(counselors.length);
                expect(allStats.approvedCounselors).toBe(counselors.filter(c => c.isApproved).length);
                expect(allStats.availableCounselors).toBe(
                    counselors.filter(c => c.status === 'available' && c.isApproved && !c.isSuspended).length
                );
                expect(allStats.suspendedCounselors).toBe(counselors.filter(c => c.isSuspended).length);
                expect(allStats.totalSessionsHandled).toBe(totalSessions);

                if (counselors.length > 0) {
                    expect(allStats.averageSessionsPerCounselor).toBeCloseTo(totalSessions / counselors.length, 2);
                } else {
                    expect(allStats.averageSessionsPerCounselor).toBe(0);
                }

                expect(allStats.workloadDistribution).toEqual(workloadDistribution);
            }
        ), { numRuns: 50 });
    });
});