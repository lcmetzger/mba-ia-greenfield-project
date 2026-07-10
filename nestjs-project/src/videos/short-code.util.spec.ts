import { generateShortCode } from './short-code.util';

describe('generateShortCode', () => {
  it('generates a 12-character code', () => {
    expect(generateShortCode()).toHaveLength(12);
  });

  it('only uses alphanumeric characters', () => {
    expect(generateShortCode()).toMatch(/^[0-9a-zA-Z]{12}$/);
  });

  it('generates distinct codes across calls', () => {
    const codes = new Set(
      Array.from({ length: 50 }, () => generateShortCode()),
    );
    expect(codes.size).toBe(50);
  });
});
