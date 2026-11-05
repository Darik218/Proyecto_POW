export class DuplicateEmailError extends Error {
  constructor() {
    super('Duplicate account email.');
    this.name = 'DuplicateEmailError';
  }
}
