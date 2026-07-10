export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super(
      'CHANNEL_NOT_FOUND',
      404,
      'No channel associated with the authenticated user',
    );
  }
}

export class FileTooLargeException extends DomainException {
  constructor() {
    super('FILE_TOO_LARGE', 400, 'Declared file size exceeds the 10GB limit');
  }
}

export class UploadInitiationFailedException extends DomainException {
  constructor() {
    super(
      'UPLOAD_INITIATION_FAILED',
      502,
      'Failed to initiate multipart upload on the object storage',
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoNotOwnedException extends DomainException {
  constructor() {
    super(
      'VIDEO_NOT_OWNED',
      403,
      'Video does not belong to the authenticated user channel',
    );
  }
}

export class VideoNotDraftException extends DomainException {
  constructor() {
    super('VIDEO_NOT_DRAFT', 409, 'Video is not in draft status');
  }
}

export class UploadCompletionFailedException extends DomainException {
  constructor() {
    super(
      'UPLOAD_COMPLETION_FAILED',
      502,
      'Failed to complete multipart upload on the object storage',
    );
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready');
  }
}

export class VideoNotErrorException extends DomainException {
  constructor() {
    super('VIDEO_NOT_ERROR', 409, 'Video is not in error status');
  }
}
