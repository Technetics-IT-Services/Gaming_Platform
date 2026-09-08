import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus, DocumentType, KycLevel, KycStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../security/audit.service';

/**
 * KYC — the real submission and review lifecycle.
 *
 * WHAT EXISTED: `KycVerification` and `Document` models with the complete status enum
 * (`NOT_STARTED / PENDING / IN_REVIEW / APPROVED / REJECTED / EXPIRED`), zero rows, and a single
 * read-only status projection in `UsersService.verification()`. No submission, no review, no admin
 * surface. **No schema change was needed** — the existing models carry the whole lifecycle.
 *
 * DOCUMENTS ARE METADATA ONLY, DELIBERATELY.
 * There is no object storage in this deployment: `StorageProvider` and `FileStorage` exist in the
 * schema but have zero rows and no writer, and no S3/GCS SDK or multer is installed. Rather than
 * fabricate a cloud upload, this module records the document's *metadata* (type, file name, MIME
 * type, size, checksum) and its review state. `fileUrl` holds an opaque internal reference, never a
 * credential, bucket path or signed URL. Binary upload is the ONE part of this requirement that is
 * genuinely blocked on infrastructure, and it is marked as such rather than faked.
 *
 * THE RULE: verification status is decided ONLY by an authorised reviewer. Nothing a player sends
 * can set, hint at, or influence it.
 */

/** Document types a player may submit. Anything else is rejected at the DTO. */
export const ALLOWED_DOCUMENT_TYPES: DocumentType[] = [
  DocumentType.PASSPORT,
  DocumentType.NATIONAL_ID,
  DocumentType.DRIVERS_LICENSE,
  DocumentType.UTILITY_BILL,
  DocumentType.BANK_STATEMENT,
  DocumentType.PROOF_OF_ADDRESS,
  DocumentType.SELFIE,
];

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** 10 MB. An operational safeguard on declared size, not a business rule. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Statuses from which a player may (re)submit. */
const RESUBMITTABLE: KycStatus[] = [KycStatus.NOT_STARTED, KycStatus.REJECTED, KycStatus.EXPIRED];

export interface DocumentInput {
  type: DocumentType;
  fileName: string;
  mimeType: string;
  size: number;
  checksum?: string;
}

export interface KycDocumentView {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  fileName: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface KycView {
  status: KycStatus;
  level: KycLevel | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** Only surfaced when the application was REJECTED — a player is entitled to know why. */
  rejectionReason: string | null;
  canSubmit: boolean;
  documents: KycDocumentView[];
  /** Honest statement of what this deployment cannot do. */
  unavailable: { capability: string; reason: string }[];
}

const UPLOAD_UNAVAILABLE = {
  capability: 'documentFileUpload',
  reason:
    'NOT AVAILABLE — NO STORAGE CONFIGURED: this deployment has no object storage (storage_providers ' +
    'and file_storage are empty and have no writer, and no storage SDK is installed). Document ' +
    'METADATA is recorded and reviewed; the file itself must be supplied through an out-of-band ' +
    'channel until storage is configured.',
};

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ player */

  /** The caller's own latest application. Never takes a user id from the client. */
  async myStatus(userId: string): Promise<KycView> {
    const kyc = await this.prisma.kycVerification.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, type: true, status: true, fileName: true, mimeType: true, createdAt: true },
        },
      },
    });

    if (!kyc) {
      return {
        status: KycStatus.NOT_STARTED,
        level: null,
        submittedAt: null,
        reviewedAt: null,
        rejectionReason: null,
        canSubmit: true,
        documents: [],
        unavailable: [UPLOAD_UNAVAILABLE],
      };
    }

    return {
      status: kyc.status,
      level: kyc.level,
      submittedAt: kyc.submittedAt?.toISOString() ?? null,
      reviewedAt: kyc.reviewedAt?.toISOString() ?? null,
      // A reason is only meaningful — and only disclosed — for a rejection.
      rejectionReason: kyc.status === KycStatus.REJECTED ? kyc.rejectionReason : null,
      canSubmit: RESUBMITTABLE.includes(kyc.status),
      documents: kyc.documents.map((d) => ({
        id: d.id,
        type: d.type,
        status: d.status,
        fileName: d.fileName,
        mimeType: d.mimeType,
        createdAt: d.createdAt.toISOString(),
      })),
      unavailable: [UPLOAD_UNAVAILABLE],
    };
  }

  /**
   * Submit (or resubmit) an application.
   *
   * Deterministic on duplicates: while an application is PENDING or IN_REVIEW a further submission
   * is REFUSED with 400 rather than silently creating a second one or overwriting the first. A
   * REJECTED or EXPIRED application may be resubmitted, which supersedes the old one.
   */
  async submit(userId: string, level: KycLevel, documents: DocumentInput[]): Promise<KycView> {
    if (documents.length === 0) {
      throw new BadRequestException('At least one document is required.');
    }
    this.validateDocuments(documents);

    const existing = await this.prisma.kycVerification.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      if (existing.status === KycStatus.APPROVED) {
        throw new BadRequestException('Your identity is already verified.');
      }
      if (!RESUBMITTABLE.includes(existing.status)) {
        throw new BadRequestException(
          `A verification is already ${existing.status}. You cannot submit another while it is in progress.`,
        );
      }
    }

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      // Supersede a prior rejected/expired application so exactly one is current.
      if (existing) {
        await tx.kycVerification.update({ where: { id: existing.id }, data: { deletedAt: now } });
      }
      const kyc = await tx.kycVerification.create({
        data: {
          userId,
          level,
          // The player's submission ALWAYS lands as PENDING. A client cannot propose any other state.
          status: KycStatus.PENDING,
          submittedAt: now,
        },
      });
      await tx.document.createMany({
        data: documents.map((d) => ({
          userId,
          kycId: kyc.id,
          type: d.type,
          status: DocumentStatus.PENDING,
          // Opaque internal reference. NOT a URL, bucket path, signed link or credential.
          fileUrl: `kyc:${kyc.id}:${d.type}`,
          fileName: d.fileName,
          mimeType: d.mimeType,
          storageKey: d.checksum ?? null,
        })),
      });
      return kyc;
    });

    await this.audit.record({
      userId,
      action: 'CREATE',
      entityType: 'kyc_verification',
      entityId: created.id,
      // Document METADATA only — never the contents of an identity document.
      changes: {
        subjectUserId: userId,
        level,
        documentTypes: documents.map((d) => d.type),
        documentCount: documents.length,
        resubmission: !!existing,
      },
    });

    return this.myStatus(userId);
  }

  private validateDocuments(documents: DocumentInput[]): void {
    const seen = new Set<DocumentType>();
    for (const d of documents) {
      if (!ALLOWED_DOCUMENT_TYPES.includes(d.type)) {
        throw new BadRequestException(`Unsupported document type: ${d.type}`);
      }
      if (seen.has(d.type)) {
        throw new BadRequestException(`Duplicate document type in one submission: ${d.type}`);
      }
      seen.add(d.type);

      if (!ALLOWED_MIME_TYPES.includes(d.mimeType)) {
        throw new BadRequestException(
          `Unsupported file type: ${d.mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
        );
      }
      if (!Number.isFinite(d.size) || d.size <= 0 || d.size > MAX_DOCUMENT_BYTES) {
        throw new BadRequestException(`File size must be between 1 byte and ${MAX_DOCUMENT_BYTES} bytes.`);
      }
      // A file name is metadata, not a path. Reject anything that looks like traversal.
      if (/[/\\]|\.\./.test(d.fileName)) {
        throw new BadRequestException('File name must not contain a path.');
      }
    }
  }

  /* ------------------------------------------------------------------- admin */

  /** Operator queue. Filterable by status, paginated. */
  async list(query: { status?: KycStatus; page?: number; limit?: number }): Promise<{
    items: {
      id: string; userId: string; status: KycStatus; level: KycLevel;
      submittedAt: string | null; reviewedAt: string | null; documentCount: number;
    }[];
    total: number; page: number; limit: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.KycVerificationWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.kycVerification.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { documents: true } } },
      }),
      this.prisma.kycVerification.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        status: r.status,
        level: r.level,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        documentCount: r._count.documents,
      })),
      total,
      page,
      limit,
    };
  }

  /** One application, for a reviewer. */
  async getForReview(id: string) {
    const kyc = await this.prisma.kycVerification.findFirst({
      where: { id, deletedAt: null },
      include: {
        documents: {
          where: { deletedAt: null },
          select: { id: true, type: true, status: true, fileName: true, mimeType: true, createdAt: true },
        },
      },
    });
    if (!kyc) throw new NotFoundException('KYC application not found.');
    return {
      id: kyc.id,
      userId: kyc.userId,
      status: kyc.status,
      level: kyc.level,
      submittedAt: kyc.submittedAt?.toISOString() ?? null,
      reviewedAt: kyc.reviewedAt?.toISOString() ?? null,
      rejectionReason: kyc.rejectionReason,
      documents: kyc.documents.map((d) => ({
        id: d.id, type: d.type, status: d.status,
        fileName: d.fileName, mimeType: d.mimeType, createdAt: d.createdAt.toISOString(),
      })),
      unavailable: [UPLOAD_UNAVAILABLE],
    };
  }

  /**
   * Record a review decision.
   *
   * CONCURRENCY: the update is conditional on the application still being in a reviewable state
   * (`updateMany` with the expected statuses in the WHERE). Two reviewers acting at once cannot
   * both win — the loser gets a 400 rather than silently overwriting the first decision.
   */
  async review(input: {
    id: string;
    reviewerUserId: string;
    decision: 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
    reason?: string;
  }) {
    const target =
      input.decision === 'APPROVED' ? KycStatus.APPROVED
        : input.decision === 'REJECTED' ? KycStatus.REJECTED
          : KycStatus.IN_REVIEW;

    if (target === KycStatus.REJECTED && !input.reason?.trim()) {
      throw new BadRequestException('A rejection must state a reason.');
    }

    const before = await this.prisma.kycVerification.findFirst({ where: { id: input.id, deletedAt: null } });
    if (!before) throw new NotFoundException('KYC application not found.');

    // Only an application that is still open may be decided.
    const openStatuses: KycStatus[] = [KycStatus.PENDING, KycStatus.IN_REVIEW];
    if (!openStatuses.includes(before.status)) {
      throw new BadRequestException(`This application is already ${before.status} and cannot be reviewed again.`);
    }

    const now = new Date();
    const { count } = await this.prisma.kycVerification.updateMany({
      where: { id: input.id, deletedAt: null, status: { in: openStatuses } },
      data: {
        status: target,
        rejectionReason: target === KycStatus.REJECTED ? input.reason!.trim() : null,
        reviewedAt: target === KycStatus.IN_REVIEW ? null : now,
      },
    });
    if (count === 0) {
      throw new BadRequestException('This application was decided by another reviewer. Reload and try again.');
    }

    // Document states follow the application decision.
    if (target !== KycStatus.IN_REVIEW) {
      await this.prisma.document.updateMany({
        where: { kycId: input.id, deletedAt: null },
        data: {
          status: target === KycStatus.APPROVED ? DocumentStatus.APPROVED : DocumentStatus.REJECTED,
          reviewedAt: now,
        },
      });
    }

    await this.audit.record({
      userId: input.reviewerUserId,
      action: target === KycStatus.APPROVED ? 'APPROVE' : target === KycStatus.REJECTED ? 'REJECT' : 'UPDATE',
      entityType: 'kyc_verification',
      entityId: input.id,
      changes: {
        subjectUserId: before.userId,
        from: before.status,
        to: target,
        // The reason is operational text, not document content.
        reason: input.reason?.trim() ?? null,
      },
    });

    return this.getForReview(input.id);
  }

  /**
   * Guard used by callers that must not act on someone else's application.
   *
   * Player routes never pass an id, so this exists for defence in depth on any future route that
   * does. It throws `ForbiddenException`, never leaking whether the id exists.
   */
  async assertOwnedBy(id: string, userId: string): Promise<void> {
    const owned = await this.prisma.kycVerification.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
    if (!owned) throw new ForbiddenException('You cannot access this verification.');
  }
}
