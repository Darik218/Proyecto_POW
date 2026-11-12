import { AutomaticProgressionError } from '../models/progression/automatic-progression.model';
import { ProgressionSettingError } from '../models/progression/progression-setting.model';
import { AutomationConsentError } from '../models/progression/automation-consent.model';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Response } from 'express';
import { RecommendationError } from '../models/progression/recommendation-draft.model';
import { RecommendationPersistenceError } from '../models/progression/persisted-recommendation.model';
import { RecommendationReviewError } from '../models/progression/recommendation-review.model';
import { RecommendationApplicationError } from '../models/progression/recommendation-application.model';
import { PerformanceError } from '../models/progression/performance-analysis.model';
import { AssessmentError } from '../models/progression/prescription-assessment.model';
import { ProgressionRequestError } from '../models/progression/progression-http.model';
@Injectable()
export class ProgressionPrivateResponse implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}
@Catch()
export class ProgressionHttpFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let status = 500,
      code = 'INTERNAL_ERROR',
      reasons: readonly string[] = [];
    if (error instanceof HttpException) {
      status = error.getStatus();
      code =
        status === 401
          ? 'AUTHENTICATION_REQUIRED'
          : status === 403
            ? 'ORIGIN_NOT_ALLOWED'
            : 'VALIDATION_ERROR';
    } else if (
      error instanceof AutomaticProgressionError ||
      error instanceof ProgressionSettingError ||
      error instanceof AutomationConsentError ||
      error instanceof RecommendationError ||
      error instanceof RecommendationPersistenceError ||
      error instanceof RecommendationReviewError ||
      error instanceof RecommendationApplicationError ||
      error instanceof PerformanceError ||
      error instanceof AssessmentError ||
      error instanceof ProgressionRequestError
    ) {
      code = error.code;
      reasons =
        'reasons' in error
          ? error.reasons
          : 'changedDependencies' in error
            ? error.changedDependencies
            : [];
      status =
        code === 'AUTHENTICATION_REQUIRED'
          ? 401
          : ['SOURCE_NOT_FOUND', 'RESOURCE_NOT_FOUND'].includes(code)
            ? 404
            : ['SOURCE_BUSY'].includes(code)
              ? 503
              : [
                    'INTENT_REUSED',
                    'STALE_GRANT',
                    'GRANT_REVOKED',
                    'ALREADY_APPLIED',
                    'STALE_APPLICATION',
                    'STALE_PROPOSAL',
                    'IDENTITY_CONFLICT',
                    'REQUEST_MISMATCH',
                    'CYCLE_CONFLICT',
                    'REVIEW_CONFLICT',
                    'STALE_CONSENT',
                    'STALE_SETTING',
                    'SETTING_SCOPE_EXISTS',
                    'CONSENT_ALREADY_ACCEPTED',
                    'ACCEPTANCE_CHALLENGE_INVALID',
                    'CONSENT_REVOKED',
                    'AMBIGUOUS_AUTOMATION_CONSENT',
                  ].includes(code)
                ? 409
                : 422;
    }
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({
      code,
      reasons: [...reasons].slice(0, 100),
      message:
        status === 500
          ? 'No se pudo completar la operación.'
          : status === 401
            ? 'La sesión no está disponible.'
            : status === 404
              ? 'El recurso no está disponible.'
              : 'La operación requiere revisión.',
    });
  }
}
