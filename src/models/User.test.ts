/**
 * Property-based tests for User data model validation
 * Feature: telegram-counseling-bot, Property 32: User data persistence structure
 * Validates: Requirements 9.1
 */

import * as fc from 'fast-check';
import { User, validateUser, validateUserDataMinimization, CreateUserInput } from './User';
import { v4 as uuidv4 } from 'uuid';

describe('User Model Property Tests', () => {
    describe('Property 32: User data persistence structure', () => {
        /**
         * Feature: telegram-counseling-bot, Property 32: User data persistence structure
         * For any user data storage operation, the MongoDB record should contain only anonymous UUID and telegram chat ID
         * Validates: Requirements 9.1
         */
        it('should ensure user data contains only allowed fields for data minimization', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        uuid: fc.string({ minLength: 1 }),
                        telegramChatId: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
                        createdAt: fc.date(),
                        lastActive: fc.date()
                    }),
                    (userData) => {
                        // The user data should only contain the allowed fields
                        const result = validateUserDataMinimization(userData);
                        expect(result).toBe(true);

                        // Verify that the data structure matches exactly what should be persisted
                        const allowedFields = ['uuid', 'telegramChatId', 'createdAt', 'lastActive'];
                        const userFields = Object.keys(userData);

                        // All fields should be in the allowed list
                        expect(userFields.every(field => allowedFields.includes(field))).toBe(true);

                        // Should contain the required anonymous identifier and telegram chat ID
                        expect(userData).toHaveProperty('uuid');
                        expect(userData).toHaveProperty('telegramChatId');
                        expect(typeof userData.uuid).toBe('string');
                        expect(typeof userData.telegramChatId).toBe('number');
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property test to ensure user data never contains personal information
         * Validates data minimization principle from Requirements 9.1
         */
        it('should reject user data containing personal information fields', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        uuid: fc.string({ minLength: 1 }),
                        telegramChatId: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
                        createdAt: fc.date(),
                        lastActive: fc.date(),
                        // Add forbidden personal information fields
                        username: fc.string(),
                        realName: fc.string(),
                        phoneNumber: fc.string(),
                        ipAddress: fc.string()
                    }),
                    (userDataWithPersonalInfo) => {
                        // Data with personal information should fail validation
                        const result = validateUserDataMinimization(userDataWithPersonalInfo);
                        expect(result).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property test to ensure valid user objects always pass validation
         */
        it('should validate properly structured user objects', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        uuid: fc.string({ minLength: 36, maxLength: 36 }), // UUID format
                        telegramChatId: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
                        createdAt: fc.date(),
                        lastActive: fc.date()
                    }),
                    (userData) => {
                        // Valid user data should pass validation
                        const result = validateUser(userData);
                        expect(result).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property test for user creation input validation
         */
        it('should validate user creation input contains only telegram chat ID', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
                    (telegramChatId) => {
                        const createUserInput: CreateUserInput = { telegramChatId };

                        // Creation input should only contain telegram chat ID
                        const inputFields = Object.keys(createUserInput);
                        expect(inputFields).toEqual(['telegramChatId']);
                        expect(typeof createUserInput.telegramChatId).toBe('number');
                        expect(createUserInput.telegramChatId).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Unit Tests for User Model', () => {
        it('should validate a proper user object', () => {
            const user: User = {
                uuid: uuidv4(),
                telegramChatId: 123456789,
                createdAt: new Date(),
                lastActive: new Date()
            };

            expect(validateUser(user)).toBe(true);
        });

        it('should reject user object with missing fields', () => {
            const invalidUser = {
                uuid: uuidv4(),
                telegramChatId: 123456789
                // Missing createdAt and lastActive
            };

            expect(validateUser(invalidUser)).toBe(false);
        });

        it('should reject user object with invalid field types', () => {
            const invalidUser = {
                uuid: 123, // Should be string
                telegramChatId: "invalid", // Should be number
                createdAt: new Date(),
                lastActive: new Date()
            };

            expect(validateUser(invalidUser)).toBe(false);
        });
    });
});