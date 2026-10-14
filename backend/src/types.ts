export type AcademicYear = "First Year" | "Second Year" | "Third Year" | "Fourth Year";
export type VerificationStatus = "pending" | "verified" | "not_verified" | "delayed" | "error";

export interface Profile { id: string; name: string; handle: string; academicYear: AcademicYear; points: number; streak: number; longestStreak: number; }
export interface Challenge { id: string; day: number; title: string; slug: string; difficulty: "Easy" | "Medium" | "Hard"; topic: string; points: number; publishedAt: string; deadlineAt: string; verificationQueuedAt?: string; }
export interface Completion { id: string; profileId: string; challengeId: string; status: VerificationStatus; attemptedAt: string; verifiedAt?: string; submissionAt?: string; evidence?: Record<string, unknown>; }
export interface VerificationJob { id: string; profileId: string; challengeId: string; status: "queued" | "processing" | "complete" | "retry" | "failed"; attempts: number; availableAt: number; lockedAt?: number; lastError?: string; }
export interface AdminAlert { id: string; createdAt: string; severity: "warning" | "error"; message: string; challengeId?: string; resolvedAt?: string; }
