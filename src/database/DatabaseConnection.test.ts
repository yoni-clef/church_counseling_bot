import { DatabaseConnection } from './DatabaseConnection';
import { Collections } from './Collections';
import { DatabaseManager } from './index';
import * as fc from 'fast-check';

// Mock MongoDB for testing
jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
        db: jest.fn().mockReturnValue({
            admin: () => ({
                ping: jest.fn().mockResolvedValue(true)
            }),
            collection: jest.fn().mockImplementation((name: string) => ({
                createIndex: jest.fn().mockResolvedValue(undefined),
                countDocuments: jest.fn().mockResolvedValue(0),
                collectionName: name
            })),
            listCollections: () => ({
                toArray: jest.fn().mockResolvedValue([
                    { name: 'users' },
                    { name: 'counselors' },
                    { name: 'sessions' },
                    { name: 'messages' },
                    { name: 'prayers' },
                    { name: 'reports' },
                    { name: 'audit_logs' }
                ])
            }),
            createCollection: jest.fn().mockResolvedValue(undefined)
        })
    }))
}));

describe('Database Connection and Collections', () => {
    describe('DatabaseConnection', () => {
        it('should create a database connection instance', () => {
            const connection = new DatabaseConnection('mongodb://localhost:27017', 'test');
            expect(connection).toBeInstanceOf(DatabaseConnection);
        });

        it('should connect to database successfully', async () => {
            const connection = new DatabaseConnection('mongodb://localhost:27017', 'test');
            await expect(connection.connect()).resolves.not.toThrow();
            expect(connection.isConnected()).toBe(true);
        });

        it('should disconnect from database', async () => {
            const connection = new DatabaseConnection('mongodb://localhost:27017', 'test');
            await connection.connect();
            await connection.disconnect();
            expect(connection.isConnected()).toBe(false);
        });

        it('should throw error when getting database before connection', () => {
            const connection = new DatabaseConnection('mongodb://localhost:27017', 'test');
            expect(() => connection.getDatabase()).toThrow('Database connection not established');
        });
    });

    describe('Collections', () => {
        it('should initialize collections with proper structure', async () => {
            const connection = new DatabaseConnection('mongodb://localhost:27017', 'test');
            await connection.connect();
            const db = connection.getDatabase();

            const collections = new Collections(db);
            await expect(collections.initializeCollections()).resolves.not.toThrow();
        });

        it('should ensure all required collections exist', async () => {
            const connection = new DatabaseConnection('mongodb://localhost:27017', 'test');
            await connection.connect();
            const db = connection.getDatabase();

            const collections = new Collections(db);
            await expect(collections.ensureCollectionsExist()).resolves.not.toThrow();
        });

        it('should get collection statistics', async () => {
            const connection = new DatabaseConnection('mongodb://localhost:27017', 'test');
            await connection.connect();
            const db = connection.getDatabase();

            const collections = new Collections(db);
            const stats = await collections.getCollectionStats();

            expect(stats).toHaveProperty('users');
            expect(stats).toHaveProperty('counselors');
            expect(stats).toHaveProperty('sessions');
            expect(stats).toHaveProperty('messages');
            expect(stats).toHaveProperty('prayers');
            expect(stats).toHaveProperty('reports');
        });
    });

    describe('DatabaseManager', () => {
        it('should initialize database manager successfully', async () => {
            const manager = new DatabaseManager('mongodb://localhost:27017', 'test');
            const collections = await manager.initialize();

            expect(collections).toBeInstanceOf(Collections);
            expect(manager.isConnected()).toBe(true);
        });

        it('should throw error when getting collections before initialization', () => {
            const manager = new DatabaseManager('mongodb://localhost:27017', 'test');
            expect(() => manager.getCollections()).toThrow('Database not initialized');
        });

        it('should disconnect properly', async () => {
            const manager = new DatabaseManager('mongodb://localhost:27017', 'test');
            await manager.initialize();
            await manager.disconnect();
            expect(manager.isConnected()).toBe(false);
        });
    });

    describe('Property-Based Tests', () => {
        /**
         * Property 36: Database collection structure
         * Feature: telegram-counseling-bot, Property 36: Database collection structure
         * Validates: Requirements 9.5
         * 
         * For any database inspection, the system should maintain separate collections 
         * for users, counselors, sessions, messages, prayer requests, and reports
         */
        it('should maintain separate collections for all required entity types', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        connectionString: fc.constant('mongodb://localhost:27017'),
                        databaseName: fc.string({ minLength: 1, maxLength: 50 }).filter(name =>
                            /^[a-zA-Z0-9_-]+$/.test(name) // Valid MongoDB database name
                        )
                    }),
                    async ({ connectionString, databaseName }) => {
                        const connection = new DatabaseConnection(connectionString, databaseName);
                        await connection.connect();
                        const db = connection.getDatabase();

                        const collections = new Collections(db);

                        // Verify all required collections exist as separate entities
                        const requiredCollections = [
                            'users',
                            'counselors',
                            'sessions',
                            'messages',
                            'prayers',
                            'reports'
                        ];

                        // Test that Collections class maintains separate collection references
                        expect(collections.users).toBeDefined();
                        expect(collections.counselors).toBeDefined();
                        expect(collections.sessions).toBeDefined();
                        expect(collections.messages).toBeDefined();
                        expect(collections.prayers).toBeDefined();
                        expect(collections.reports).toBeDefined();

                        // Verify each collection is a distinct object (not the same reference)
                        const collectionRefs = [
                            collections.users,
                            collections.counselors,
                            collections.sessions,
                            collections.messages,
                            collections.prayers,
                            collections.reports
                        ];

                        // All collection references should be unique objects
                        const uniqueRefs = new Set(collectionRefs);
                        expect(uniqueRefs.size).toBe(requiredCollections.length);

                        // Test that the database maintains the collections after initialization
                        await collections.ensureCollectionsExist();
                        const existingCollections = await db.listCollections().toArray();
                        const existingNames = existingCollections.map(col => col.name);

                        // Each required collection should exist as a separate collection
                        for (const requiredCollection of requiredCollections) {
                            expect(existingNames).toContain(requiredCollection);
                        }

                        // Verify collections are separate (not merged into one)
                        expect(existingNames.length).toBeGreaterThanOrEqual(requiredCollections.length);

                        await connection.disconnect();
                    }
                ),
                { numRuns: 100 } // Run 100 iterations as specified in design
            );
        });
    });
});