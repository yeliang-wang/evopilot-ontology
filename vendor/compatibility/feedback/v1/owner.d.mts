import type { FeedbackStore, FeedbackOwner, FeedbackOwnerProviders, FeedbackEnvelope } from './feedback.mjs';
export declare const OWNER_FEEDBACK_OPERATIONS: readonly ["feedback.inspect", "feedback.list", "feedback.read", "feedback.ingest", "feedback.propose", "feedback.decide"];
export declare function createOwnerFeedback(store: FeedbackStore, owner: FeedbackOwner, providers: FeedbackOwnerProviders): {
    feedback: (request: FeedbackEnvelope) => Promise<unknown>;
};
