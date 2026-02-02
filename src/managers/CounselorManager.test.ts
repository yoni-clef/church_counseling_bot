import { CounselorManager } from './CounselorManager';
import { Collections } from '../database/Collections';
import { DatabaseManager } from '../database';
import { Counselor } from '../types/Counselor';
import { Session } from '../types/Session';
import fc from 'fast-check';
import { MongoMemoryServer } from 'mongodb-memory-server';

describe('CounselorManager Property Tests', () => {
    jest.setTimeout(120000);

    let dbManager: DatabaseManager;
    let collections: Collections;
    let counselorManager: CounselorManager;
    let mongoServer: MongoMemoryServer;
    let originalMongoUri: string | undefined;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        originalMongoUri = process.env.MONGODB_URI;
        process.env.MONGODB_URI = mongoServer.getUri();
        const connectionString = process.env.MONGODB_URI;
        const databaseName = 'telegram_counseling_test';

        dbManager = new DatabaseManager(connectionString, databaseName);
        collections = await dbManager.initialize();
        counselorManager = new CounselorManager(collections);
    });

    afterAll(async () => {
        await dbManager.disconnect();
        if (mongoServer) {
            await mongoServer.stop();
        }
        if (originalMongoUri === undefined) {
            delete process.env.MONGODB_URI;
        } else {
            process.env.MONGODB_URI = originalMongoUri;
        }
    });

    beforeEach(async () => {
        // Clean up collections before each test
        await collections.counselors.deleteMany({});
        await collections.sessions.deleteMany({});
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
                await collections.counselors.deleteMany({});
                await collections.sessions.deleteMany({});

                // Create a counselor first
                const counselor: Counselor = {
                    id: counselorId,
                    telegramChatId,
                    status: 'away',
                    isApproved: true,
                    strikes: 0,
                    isSuspended: false,
                    sessionsHandled: 0,
                    createdAt: new Date(),
                    lastActive: new Date()
                };
                await collections.counselors.insertOne(counselor);

                const validStatuses = ['available', 'busy', 'away'];

                if (validStatuses.includes(status as any)) {
                    // Valid status should succeed
                    await expect(counselorManager.setAvailability(counselorId, status as any))
                        .resolves.not.toThrow();

                    // Verify status was updated
                    const updatedCounselor = await collections.counselors.findOne({ id: counselorId });
                    expect(updatedCounselor?.status).toBe(status);
                } else {
                    // Invalid status should throw error
                    await expect(counselorManager.setAvailability(counselorId, status as any))
                        .rejects.toThrow();
                }
            }
        ), { numRuns: 100 });
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
            }), { minLength: 1, maxLength: 10 }),
            async (counselorData) => {
                await collections.counselors.deleteMany({});
                await collections.sessions.deleteMany({});

                // Insert counselors
                const counselors: Counselor[] = counselorData.map((data, index) => ({
                    ...data,
                    id: `${data.id}-${index}`,
                    telegramChatId: data.telegramChatId + index,
                    status: data.status as 'available' | 'busy' | 'away',
                    strikes: 0,
                    sessionsHandled: 0,
                    createdAt: new Date(),
                    lastActive: new Date()
                }));

                await collections.counselors.insertMany(counselors);

                const assignedCounselorId = await counselorManager.getAvailableCounselor();

                if (assignedCounselorId) {
                    // If a counselor was assigned, they must be available, approved, and not suspended
                    const assignedCounselor = await collections.counselors.findOne({ id: assignedCounselorId });
                    expect(assignedCounselor).toBeTruthy();
                    expect(assignedCounselor!.status).toBe('available');
                    expect(assignedCounselor!.isApproved).toBe(true);
                    expect(assignedCounselor!.isSuspended).toBe(false);
                } else {
                    // If no counselor was assigned, there should be no available, approved, non-suspended counselors
                    const availableCounselors = await collections.counselors.find({
                        status: 'available',
                        isApproved: true,
                        isSuspended: false
                    }).toArray();
                    expect(availableCounselors.length).toBe(0);
                }
            }
        ), { numRuns: 100 });
    });

    /**
     * Property 10: Admin status override
     * Feature: telegram-counseling-bot, Property 10: Admin status override
     * Validates: Requirements 3.3
     */
    test('Property 10: Admin status override', async () => {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1 }), // counselorId
            fc.integer({ min: 1000000, max: 9999999999 }), // telegramChatId
            fc.string({ minLength: 1 }), // adminId
            fc.oneof(fc.constant('available'), fc.constant('busy'), fc.constant('away')), // initial status
            fc.oneof(fc.constant('available'), fc.constant('busy'), fc.constant('away')), // new status
            async (counselorId, telegramChatId, adminId, initialStatus, newStatus) => {
                await collections.counselors.deleteMany({});
                await collections.sessions.deleteMany({});

                // Create a counselor with initial status
                const counselor: Counselor = {
                    id: counselorId,
                    telegramChatId,
                    status: initialStatus as 'available' | 'busy' | 'away',
                    isApproved: true,
                    strikes: 0,
                    isSuspended: false,
                    sessionsHandled: 0,
                    createdAt: new Date(),
                    lastActive: new Date()
                };
                await collections.counselors.insertOne(counselor);

                // Admin overrides status
                await counselorManager.setAvailability(counselorId, newStatus as 'available' | 'busy' | 'away', adminId);

                // Verify status was updated to admin's specification
                const updatedCounselor = await collections.counselors.findOne({ id: counselorId });
                expect(updatedCounselor?.status).toBe(newStatus);
            }
        ), { numRuns: 100 });
    });

    /**
     * Property 11: Status change audit trail
     * Feature: telegram-counseling-bot, Property 11: Status change audit trail
     * Validates: Requirements 3.4
     */
    test('Property 11: Status change audit trail', async () => {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1 }), // counselorId
            fc.integer({ min: 1000000, max: 9999999999 }), // telegramChatId
            fc.oneof(fc.constant('available'), fc.constant('busy'), fc.constant('away')), // initial status
            fc.oneof(fc.constant('available'), fc.constant('busy'), fc.constant('away')), // new status
            async (counselorId, telegramChatId, initialStatus, newStatus) => {
                await collections.counselors.deleteMany({});
                await collections.sessions.deleteMany({});

                // Create a counselor with initial status
                const counselor: Counselor = {
                    id: counselorId,
                    telegramChatId,
                    status: initialStatus as 'available' | 'busy' | 'away',
                    isApproved: true,
                    strikes: 0,
                    isSuspended: false,
                    sessionsHandled: 0,
                    createdAt: new Date(),
                    lastActive: new Date()
                };
                await collections.counselors.insertOne(counselor);

                const beforeChangeTime = new Date();

                // Change status
                await counselorManager.setAvailability(counselorId, newStatus as 'available' | 'busy' | 'away');

                const afterChangeTime = new Date();

                // Check audit trail
                const auditTrail = counselorManager.getStatusAuditTrail(counselorId);
                expect(auditTrail.length).toBeGreaterThan(0);

                const latestEntry = auditTrail[auditTrail.length - 1];
                expect(latestEntry.counselorId).toBe(counselorId);
                expect(latestEntry.previousStatus).toBe(initialStatus);
                expect(latestEntry.newStatus).toBe(newStatus);
                expect(latestEntry.timestamp.getTime()).toBeGreaterThanOrEqual(beforeChangeTime.getTime());
                expect(latestEntry.timestamp.getTime()).toBeLessThanOrEqual(afterChangeTime.getTime());
            }
        ), { numRuns: 100 });
    });

    /**
     * Property 19: Counselor approval access
     * Feature: telegram-counseling-bot, Property 19: Counselor approval access
     * Validates: Requirements 6.1
     */
    test('Property 19: Counselor approval access', async () => {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1 }), // counselorId
            fc.integer({ min: 1000000, max: 9999999999 }), // telegramChatId
            fc.string({ minLength: 1 }), // adminId
            fc.boolean(), // initial approval status
            fc.boolean(), // initial suspension status
            async (counselorId, telegramChatId, adminId, initialApproval, initialSuspension) => {
                await collections.counselors.deleteMany({});
                await collections.sessions.deleteMany({});

                // Create a counselor
                const counselor: Counselor = {
                    id: counselorId,
                    telegramChatId,
                    status: 'away',
                    isApproved: initialApproval,
                    strikes: 0,
                    isSuspended: initialSuspension,
                    sessionsHandled: 0,
                    createdAt: new Date(),
                    lastActive: new Date()
                };
                await collections.counselors.insertOne(counselor);

                // Check initial access
                const initialAccess = await counselorManager.hasAccess(counselorId);
                expect(initialAccess).toBe(initialApproval && !initialSuspension);

                // Admin approves counselor
                await counselorManager.approveCounselor(adminId, counselorId);

                // Check access after approval
                const finalAccess = await counselorManager.hasAccess(counselorId);
                expect(finalAccess).toBe(!initialSuspension); // Should have access if not suspended

                // Verify counselor is approved
                const updatedCounselor = await collections.counselors.findOne({ id: counselorId });
                expect(updatedCounselor?.isApproved).toBe(true);
            }
        ), { numRuns: 100 });
    });

    /**
     * Property 20: Counselor removal cleanup
     * Feature: telegram-counseling-bot, Property 20: Counselor removal cleanup
     * Validates: Requirements 6.2
     */
    test('Property 20: Counselor removal cleanup', async () => {
        await fc.assert(fc.asyncProperty(
            fc.string({ minLength: 1 }), // counselorId
            fc.integer({ min: 1000000, max: 9999999999 }), // telegramChatId
            fc.string({ minLength: 1 }), // adminId
            fc.array(fc.record({
                sessionId: fc.string({ minLength: 1 }),
                userId: fc.string({ minLength: 1 })
            }), { maxLength: 5 }), // active sessions
            async (counselorId, telegramChatId, adminId, sessionData) => {
                await collections.counselors.deleteMany({});
                await collections.sessions.deleteMany({});

                // Create a counselor
                const counselor: Counselor = {
                    id: counselorId,
                    telegramChatId,
                    status: 'available',
                    isApproved: true,
                    strikes: 0,
                    isSuspended: false,
                    sessionsHandled: 0,
                    createdAt: new Date(),
                    lastActive: new Date()
                };
                await collections.counselors.insertOne(counselor);

                // Create active sessions for the counselor
                const sessions: Session[] = sessionData.map(data => ({
                    sessionId: data.sessionId,
                    userId: data.userId,
                    counselorId: counselorId,
                    startTime: new Date(),
                    isActive: true
                }));

                if (sessions.length > 0) {
                    await collections.sessions.insertMany(sessions);
                }

                // Admin removes counselor
                await counselorManager.removeCounselor(adminId, counselorId);

                // Verify counselor access is revoked
                const hasAccess = await counselorManager.hasAccess(counselorId);
                expect(hasAccess).toBe(false);

                // Verify counselor is marked as not approved and suspended
                const updatedCounselor = await collections.counselors.findOne({ id: counselorId });
                expect(updatedCounselor?.isApproved).toBe(false);
                expect(updatedCounselor?.isSuspended).toBe(true);
                expect(updatedCounselor?.status).toBe('away');

                // Verify all active sessions are terminated
                const activeSessions = await collections.sessions.find({
                    counselorId: counselorId,
                    isActive: true
                }).toArray();
                expect(activeSessions.length).toBe(0);

                // Verify sessions have end times and durations
                const terminatedSessions = await collections.sessions.find({
                    counselorId: counselorId,
                    isActive: false
                }).toArray();

                for (const session of terminatedSessions) {
                    expect(session.endTime).toBeTruthy();
                    expect(session.duration).toBeGreaterThanOrEqual(0);
                }
            }
        ), { numRuns: 100 });
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
            }), { minLength: 1, maxLength: 10 }),
            async (counselorData) => {
                await collections.counselors.deleteMany({});
                await collections.sessions.deleteMany({});

                // Insert counselors
                const counselors: Counselor[] = counselorData.map((data, index) => ({
                    ...data,
                    id: `${data.id}-${index}`,
                    telegramChatId: data.telegramChatId + index,
                    status: data.status as 'available' | 'busy' | 'away',
                    createdAt: new Date(),
                    lastActive: new Date()
                }));

                await collections.counselors.insertMany(counselors);

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
        ), { numRuns: 100 });
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
            }), { minLength: 1, maxLength: 10 }),
            async (counselorData) => {
                await collections.counselors.deleteMany({});
                await collections.sessions.deleteMany({});

                // Insert counselors
                const counselors: Counselor[] = counselorData.map((data, index) => ({
                    ...data,
                    id: `${data.id}-${index}`,
                    telegramChatId: data.telegramChatId + index,
                    status: data.status as 'available' | 'busy' | 'away',
                    createdAt: new Date(),
                    lastActive: new Date()
                }));

                await collections.counselors.insertMany(counselors);

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
        ), { numRuns: 100 });
    });
});