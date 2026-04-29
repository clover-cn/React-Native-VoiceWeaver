module.exports = {
  preset: 'react-native',
  maxWorkers: 1,
  testMatch: ['<rootDir>/src/**/__tests__/**/*.[jt]s?(x)'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/harmony/',
    '/build/',
    '/multibundle/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/harmony/'],
};
