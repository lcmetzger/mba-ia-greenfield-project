import { customAlphabet } from 'nanoid';

const SHORT_CODE_ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHORT_CODE_LENGTH = 12;

export const generateShortCode = customAlphabet(
  SHORT_CODE_ALPHABET,
  SHORT_CODE_LENGTH,
);
