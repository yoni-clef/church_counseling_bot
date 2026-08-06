import { UserManager } from './UserManager';
import { Collections } from '../database/Collections';
import { User } from '../types/User';
import { PrayerRequest } from '../types/PrayerRequest';
import * as fc from 'fast-check';

describe('UserManager', () => {
    let userManager: UserManager;
    let mockCollections: Collections;
    let mockUsers: Map<string, User>;
    let mockPrayers: Map<string, PrayerRequest>;

    beforeAll(() => {
        // Create mock collections
        mockUsers = new Map();
        mockPrayers = new Map();

        mockCollections = {
            users: {
                insertOne: jest.fn().mockImplementation(async (user: User) => {
                    if (mockUsers.has(user.telegramChatId.toString()) ||
                        Array.from(mockUsers.values()).some(u => u.uuid === user.uuid)) {
                        throw new Error('Duplicate key error');
                    }
                    mockUsers.set(user.telegramChatId.toString(), user);
                    return { insertedId: user.uuid };
                }),
                findOne: jest.fn().mockImplementation(async (query: any) => {
                    if (query.telegramChatId) {
                        return mockUsers.get(query.telegramChatId.toString()) || null;
                    }
                    if (query.uuid) {
                        return Array.from(mockUsers.values()).find(u => u.uuid === query.uuid) || null;
                    }
                    return null;
                }),
                updateOne: jest.fn().mockImplementation(async (query: any, update: any) => {
                    const user = query.telegramChatId ?
                        mockUsers.get(query.telegramChatId.toString()) :
                        Array.from(mockUsers.values()).find(u => u.uuid === query.uuid);
                    if (user && update.$set) {
                        Object.assign(user, update.$set);
                    }
                    return { modifiedCount: user ? 1 : 0 };
                })
            },
            prayers: {
                insertOne: jest.fn().mockImplementation(async (prayer: PrayerRequest) => {
                    if (mockPrayers.has(prayer.prayerId)) {
                        throw new Error('Duplicate key error');
                    }
                    mockPrayers.set(prayer.prayerId, prayer);
                    return { insertedId: prayer.prayerId };
                }),
                find: jest.fn().mockImplementation((query: any) => ({
                    sort: jest.fn().mockReturnThis(),
                    toArray: jest.fn().mockImplementation(async () => {
                        const prayers = Array.from(mockPrayers.values());
                        if (query.userId) {
                            return prayers.filter(p => p.userId === query.userId);
                        }
                        return prayers;
                    })
                }))
            }
        } as any;

        userManager = new UserManager(mockCollections);
    });

    beforeEach(() => {
        // Clear mock data before each test
        mockUsers.clear();
        mockPrayers.clear();
        jest.clearAllMocks();
    });

    describe('Property Tests', () => {
        /**
         * Feature: telegram-counseling-bot, Property 1: Anonymous user registration
         * For any telegram chat ID, registering a new user should assign a unique UUID 
         * without requiring or storing any personal information
         * Validates: Requirements 1.1, 1.2
         */
        test('Property 1: Anonymous user registration', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 2147483647 }), // Valid Telegram chat ID range
                    async (telegramChatId) => {
                        // Register user
                        const uuid = await userManager.registerUser(telegramChatId);

                        // Verify UUID is generated and valid
                        expect(uuid).toBeDefined();
                        expect(typeof uuid).toBe('string');
                        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

                        // Verify user is stored in database
                        const storedUser = await userManager.getUserByTelegramId(telegramChatId);
                        expect(storedUser).toBeDefined();
                        expect(storedUser!.uuid).toBe(uuid);
                        expect(storedUser!.telegramChatId).toBe(telegramChatId);

                        // Verify only required fields are stored (no personal information)
                        const userKeys = Object.keys(storedUser!);
                        expect(userKeys).toEqual(expect.arrayContaining(['uuid', 'telegramChatId', 'createdAt', 'lastActive']));
                        expect(userKeys).not.toEqual(expect.arrayContaining(['username', 'firstName', 'lastName', 'phoneNumber', 'email']));

                        // Verify registering same user returns same UUID
                        const secondUuid = await userManager.registerUser(telegramChatId);
                        expect(secondUuid).toBe(uuid);
                    }
                ),
                { numRuns: 100 }
            );
        }, 30000);

        /**
         * Feature: telegram-counseling-bot, Property 2: User identification consistency
         * For any user interaction, the system should identify users only by their anonymous UUID 
         * and never expose other identifiers
         * Validates: Requirements 1.3
         */
        test('Property 2: User identification consistency', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 2147483647 }), // Valid Telegram chat ID range
                    async (telegramChatId) => {
                        // Register user
                        const uuid = await userManager.registerUser(telegramChatId);

                        // Test retrieval by Telegram ID
                        const userByTelegramId = await userManager.getUserByTelegramId(telegramChatId);
                        expect(userByTelegramId).toBeDefined();
                        expect(userByTelegramId!.uuid).toBe(uuid);

                        // Test retrieval by UUID
                        const userByUuid = await userManager.getUserById(uuid);
                        expect(userByUuid).toBeDefined();
                        expect(userByUuid!.uuid).toBe(uuid);
                        expect(userByUuid!.telegramChatId).toBe(telegramChatId);

                        // Verify both methods return the same user object
                        expect(userByTelegramId!.uuid).toBe(userByUuid!.uuid);
                        expect(userByTelegramId!.telegramChatId).toBe(userByUuid!.telegramChatId);

                        // Verify UUID is the primary identifier (consistent across all operations)
                        expect(userByTelegramId!.uuid).toBe(uuid);
                        expect(userByUuid!.uuid).toBe(uuid);

                        // Verify no other identifying information is exposed
                        expect(userByTelegramId).not.toHaveProperty('username');
                        expect(userByTelegramId).not.toHaveProperty('firstName');
                        expect(userByTelegramId).not.toHaveProperty('lastName');
                        expect(userByTelegramId).not.toHaveProperty('phoneNumber');
                        expect(userByTelegramId).not.toHaveProperty('email');
                    }
                ),
                { numRuns: 100 }
            );
        }, 30000);

        /**
         * Feature: telegram-counseling-bot, Property 4: Prayer request data minimization
         * For any prayer request submission, the stored record should contain only 
         * prayer title, unique prayer ID, and timestamp
         * Validates: Requirements 2.1
         */
        test('Property 4: Prayer request data minimization', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 2147483647 }), // Valid Telegram chat ID
                    fc.string({ minLength: 1, maxLength: 500 }), // Prayer title
                    async (telegramChatId, prayerTitle) => {
                        // Create fresh mock collections for this iteration
                        const iterationUsers = new Map<string, User>();
                        const iterationPrayers = new Map<string, PrayerRequest>();

                        // Create isolated mock collections for this iteration
                        const iterationCollections = {
                            users: {
                                insertOne: jest.fn().mockImplementation(async (user: User) => {
                                    if (iterationUsers.has(user.telegramChatId.toString()) ||
                                        Array.from(iterationUsers.values()).some(u => u.uuid === user.uuid)) {
                                        throw new Error('Duplicate key error');
                                    }
                                    iterationUsers.set(user.telegramChatId.toString(), user);
                                    return { insertedId: user.uuid };
                                }),
                                findOne: jest.fn().mockImplementation(async (query: any) => {
                                    if (query.telegramChatId) {
                                        return iterationUsers.get(query.telegramChatId.toString()) || null;
                                    }
                                    if (query.uuid) {
                                        return Array.from(iterationUsers.values()).find(u => u.uuid === query.uuid) || null;
                                    }
                                    return null;
                                }),
                                updateOne: jest.fn().mockImplementation(async (query: any, update: any) => {
                                    const user = query.telegramChatId ?
                                        iterationUsers.get(query.telegramChatId.toString()) :
                                        Array.from(iterationUsers.values()).find(u => u.uuid === query.uuid);
                                    if (user && update.$set) {
                                        Object.assign(user, update.$set);
                                    }
                                    return { modifiedCount: user ? 1 : 0 };
                                })
                            },
                            prayers: {
                                insertOne: jest.fn().mockImplementation(async (prayer: PrayerRequest) => {
                                    if (iterationPrayers.has(prayer.prayerId)) {
                                        throw new Error('Duplicate key error');
                                    }
                                    iterationPrayers.set(prayer.prayerId, prayer);
                                    return { insertedId: prayer.prayerId };
                                }),
                                find: jest.fn().mockImplementation((query: any) => ({
                                    sort: jest.fn().mockReturnThis(),
                                    toArray: jest.fn().mockImplementation(async () => {
                                        const prayers = Array.from(iterationPrayers.values());
                                        if (query.userId) {
                                            return prayers.filter(p => p.userId === query.userId);
                                        }
                                        return prayers;
                                    })
                                }))
                            }
                        } as any;

                        const iterationUserManager = new UserManager(iterationCollections);

                        // Register user first
                        const userId = await iterationUserManager.registerUser(telegramChatId);

                        // Submit prayer request
                        const prayerId = await iterationUserManager.submitPrayerRequest(userId, prayerTitle);

                        // Verify prayer ID is generated and valid
                        expect(prayerId).toBeDefined();
                        expect(typeof prayerId).toBe('string');
                        expect(prayerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

                        // Get user's prayer requests to verify storage
                        const userPrayers = await iterationUserManager.getUserPrayerRequests(userId);
                        expect(userPrayers).toHaveLength(1);

                        const storedPrayer = userPrayers[0];

                        // Verify only required fields are stored
                        const prayerKeys = Object.keys(storedPrayer);
                        expect(prayerKeys).toEqual(expect.arrayContaining(['prayerId', 'userId', 'title', 'createdAt']));
                        expect(prayerKeys).toHaveLength(4); // Exactly 4 fields, no more

                        // Verify field values
                        expect(storedPrayer.prayerId).toBe(prayerId);
                        expect(storedPrayer.userId).toBe(userId);
                        expect(storedPrayer.title).toBe(prayerTitle.trim());
                        expect(storedPrayer.createdAt).toBeInstanceOf(Date);
                    }
                ),
                { numRuns: 100 }
            );
        }, 30000);

        /**
         * Feature: telegram-counseling-bot, Property 5: Prayer request privacy
         * For any prayer request display to counselors, the output should contain 
         * prayer content but no user identifying information
         * Validates: Requirements 2.2
         */
        test('Property 5: Prayer request privacy', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 2147483647 }), // Valid Telegram chat ID
                    fc.string({ minLength: 1, maxLength: 500 }), // Prayer title
                    async (telegramChatId, prayerTitle) => {
                        // Create fresh mock collections for this iteration
                        const iterationUsers = new Map<string, User>();
                        const iterationPrayers = new Map<string, PrayerRequest>();

                        // Create isolated mock collections for this iteration
                        const iterationCollections = {
                            users: {
                                insertOne: jest.fn().mockImplementation(async (user: User) => {
                                    if (iterationUsers.has(user.telegramChatId.toString()) ||
                                        Array.from(iterationUsers.values()).some(u => u.uuid === user.uuid)) {
                                        throw new Error('Duplicate key error');
                                    }
                                    iterationUsers.set(user.telegramChatId.toString(), user);
                                    return { insertedId: user.uuid };
                                }),
                                findOne: jest.fn().mockImplementation(async (query: any) => {
                                    if (query.telegramChatId) {
                                        return iterationUsers.get(query.telegramChatId.toString()) || null;
                                    }
                                    if (query.uuid) {
                                        return Array.from(iterationUsers.values()).find(u => u.uuid === query.uuid) || null;
                                    }
                                    return null;
                                }),
                                updateOne: jest.fn().mockImplementation(async (query: any, update: any) => {
                                    const user = query.telegramChatId ?
                                        iterationUsers.get(query.telegramChatId.toString()) :
                                        Array.from(iterationUsers.values()).find(u => u.uuid === query.uuid);
                                    if (user && update.$set) {
                                        Object.assign(user, update.$set);
                                    }
                                    return { modifiedCount: user ? 1 : 0 };
                                })
                            },
                            prayers: {
                                insertOne: jest.fn().mockImplementation(async (prayer: PrayerRequest) => {
                                    if (iterationPrayers.has(prayer.prayerId)) {
                                        throw new Error('Duplicate key error');
                                    }
                                    iterationPrayers.set(prayer.prayerId, prayer);
                                    return { insertedId: prayer.prayerId };
                                }),
                                find: jest.fn().mockImplementation((query: any) => ({
                                    sort: jest.fn().mockReturnThis(),
                                    toArray: jest.fn().mockImplementation(async () => {
                                        const prayers = Array.from(iterationPrayers.values());
                                        if (query.userId) {
                                            return prayers.filter(p => p.userId === query.userId);
                                        }
                                        return prayers;
                                    })
                                }))
                            }
                        } as any;

                        const iterationUserManager = new UserManager(iterationCollections);

                        // Register user and submit prayer request
                        const userId = await iterationUserManager.registerUser(telegramChatId);
                        const prayerId = await iterationUserManager.submitPrayerRequest(userId, prayerTitle);

                        // Get prayer requests for counselors
                        const counselorPrayers = await iterationUserManager.getPrayerRequestsForCounselors();
                        expect(counselorPrayers).toHaveLength(1);

                        const counselorPrayer = counselorPrayers[0];

                        // Verify only non-identifying information is included
                        const counselorPrayerKeys = Object.keys(counselorPrayer);
                        expect(counselorPrayerKeys).toEqual(expect.arrayContaining(['prayerId', 'title', 'createdAt']));
                        expect(counselorPrayerKeys).toHaveLength(3); // Exactly 3 fields

                        // Verify no user identifying information
                        expect(counselorPrayer).not.toHaveProperty('userId');
                        expect(counselorPrayer).not.toHaveProperty('telegramChatId');
                        expect(counselorPrayer).not.toHaveProperty('uuid');

                        // Verify prayer content is preserved
                        expect(counselorPrayer.prayerId).toBe(prayerId);
                        expect(counselorPrayer.title).toBe(prayerTitle.trim());
                        expect(counselorPrayer.createdAt).toBeInstanceOf(Date);
                    }
                ),
                { numRuns: 100 }
            );
        }, 30000);

        /**
         * Feature: telegram-counseling-bot, Property 6: Prayer ID uniqueness
         * For any set of prayer requests, all prayer IDs should be unique across the entire system
         * Validates: Requirements 2.3
         */
        test('Property 6: Prayer ID uniqueness', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(
                        fc.record({
                            telegramChatId: fc.integer({ min: 1, max: 2147483647 }),
                            prayerTitle: fc.string({ minLength: 1, maxLength: 500 })
                        }),
                        { minLength: 2, maxLength: 10 }
                    ),
                    async (prayerData) => {
                        const prayerIds: string[] = [];

                        // Submit multiple prayer requests
                        for (const data of prayerData) {
                            const userId = await userManager.registerUser(data.telegramChatId);
                            const prayerId = await userManager.submitPrayerRequest(userId, data.prayerTitle);
                            prayerIds.push(prayerId);
                        }

                        // Verify all prayer IDs are unique
                        const uniquePrayerIds = new Set(prayerIds);
                        expect(uniquePrayerIds.size).toBe(prayerIds.length);

                        // Verify all prayer IDs are valid UUIDs
                        for (const prayerId of prayerIds) {
                            expect(prayerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
                        }
                    }
                ),
                { numRuns: 50 } // Reduced runs due to complexity
            );
        }, 30000);

        /**
         * Feature: telegram-counseling-bot, Property 7: Unlimited prayer submissions
         * For any user, the system should accept multiple prayer request submissions without imposing artificial limits
         * Validates: Requirements 2.4
         */
        test('Property 7: Unlimited prayer submissions', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 2147483647 }), // Valid Telegram chat ID
                    fc.array(fc.string({ minLength: 1, maxLength: 500 }), { minLength: 1, maxLength: 5 }), // Multiple prayer titles
                    async (telegramChatId, prayerTitles) => {
                        // Create fresh mock collections for this iteration
                        const iterationUsers = new Map<string, User>();
                        const iterationPrayers = new Map<string, PrayerRequest>();

                        // Create isolated mock collections for this iteration
                        const iterationCollections = {
                            users: {
                                insertOne: jest.fn().mockImplementation(async (user: User) => {
                                    if (iterationUsers.has(user.telegramChatId.toString()) ||
                                        Array.from(iterationUsers.values()).some(u => u.uuid === user.uuid)) {
                                        throw new Error('Duplicate key error');
                                    }
                                    iterationUsers.set(user.telegramChatId.toString(), user);
                                    return { insertedId: user.uuid };
                                }),
                                findOne: jest.fn().mockImplementation(async (query: any) => {
                                    if (query.telegramChatId) {
                                        return iterationUsers.get(query.telegramChatId.toString()) || null;
                                    }
                                    if (query.uuid) {
                                        return Array.from(iterationUsers.values()).find(u => u.uuid === query.uuid) || null;
                                    }
                                    return null;
                                }),
                                updateOne: jest.fn().mockImplementation(async (query: any, update: any) => {
                                    const user = query.telegramChatId ?
                                        iterationUsers.get(query.telegramChatId.toString()) :
                                        Array.from(iterationUsers.values()).find(u => u.uuid === query.uuid);
                                    if (user && update.$set) {
                                        Object.assign(user, update.$set);
                                    }
                                    return { modifiedCount: user ? 1 : 0 };
                                })
                            },
                            prayers: {
                                insertOne: jest.fn().mockImplementation(async (prayer: PrayerRequest) => {
                                    if (iterationPrayers.has(prayer.prayerId)) {
                                        throw new Error('Duplicate key error');
                                    }
                                    iterationPrayers.set(prayer.prayerId, prayer);
                                    return { insertedId: prayer.prayerId };
                                }),
                                find: jest.fn().mockImplementation((query: any) => ({
                                    sort: jest.fn().mockReturnThis(),
                                    toArray: jest.fn().mockImplementation(async () => {
                                        const prayers = Array.from(iterationPrayers.values());
                                        if (query.userId) {
                                            return prayers.filter(p => p.userId === query.userId);
                                        }
                                        return prayers;
                                    })
                                }))
                            }
                        } as any;

                        const iterationUserManager = new UserManager(iterationCollections);

                        // Register user
                        const userId = await iterationUserManager.registerUser(telegramChatId);
                        const submittedPrayerIds: string[] = [];

                        // Submit multiple prayer requests from same user
                        for (const title of prayerTitles) {
                            const prayerId = await iterationUserManager.submitPrayerRequest(userId, title);
                            submittedPrayerIds.push(prayerId);
                        }

                        // Verify all prayers were accepted
                        expect(submittedPrayerIds).toHaveLength(prayerTitles.length);

                        // Verify user can retrieve all their prayers
                        const userPrayers = await iterationUserManager.getUserPrayerRequests(userId);
                        expect(userPrayers).toHaveLength(prayerTitles.length);

                        // Verify all submitted prayers are stored
                        const storedPrayerIds = userPrayers.map(p => p.prayerId);
                        for (const submittedId of submittedPrayerIds) {
                            expect(storedPrayerIds).toContain(submittedId);
                        }

                        // Verify no artificial limits were imposed
                        expect(userPrayers.length).toBe(prayerTitles.length);
                    }
                ),
                { numRuns: 100 }
            );
        }, 30000);
    });
});