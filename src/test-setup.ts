// Global test setup for Jest

// Extend Jest timeout for property-based tests
jest.setTimeout(30000);

beforeAll(async () => {
    // Set up test environment variables
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test-db';
    process.env.MONGODB_DB_NAME = 'test-db';
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ123456789';
    process.env.NODE_ENV = 'test';
});

// Mock console methods in tests to reduce noise
global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};