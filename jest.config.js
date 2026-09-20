module.exports = {
  preset: 'react-native',
  moduleNameMapper: {'^.*[/\\\\]turboModules$': '<rootDir>/turboModules/src/index.ts'},
  maxWorkers: 1,
  testMatch: ['<rootDir>/src/**/__tests__/**/*.[jt]s?(x)'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.cache/',
    '/harmony/',
    '/build/',
    '/multibundle/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/.cache/', '<rootDir>/harmony/'],
};
