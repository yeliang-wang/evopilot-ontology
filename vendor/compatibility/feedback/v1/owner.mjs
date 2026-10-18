import { nativeAssertJSON, nativeExact, nativeText, nativeDigest, nativeSha256, validateNativeReference } from '../../v1/native.mjs';
import { verifyDecisionEvidence } from '../../v1/decision-evidence.mjs';
import { createFeedbackStore, feedbackEqual as same, feedbackFail as fail, feedbackScope, feedbackBounded, validateFeedbackEvent } from './feedback.mjs';
export const OWNER_FEEDBACK_OPERATIONS = ['feedback.inspect', 'feedback.list', 'feedback.read', 'feedback.ingest', 'feedback.propose', 'feedback.decide'];
export function createOwnerFeedback(store, owner, providers) {
    const state = createFeedbackStore(store, owner);
    function inbox(scope, id) { nativeDigest(id); const r = state.get(scope, 'inbox', id); if (!r)
        fail('NOT_FOUND', 'Feedback not received'); validateFeedbackEvent(r.event); if (r.event.workspaceId !== store.identity.id || !same(r.event.scope, scope))
        fail('SCOPE_MISMATCH'); return r; }
    async function source(scope, id) {
        if (!providers.readFeedback)
            fail('UNTRUSTED_FEEDBACK', 'Trusted Runtime reader required');
        const event = await feedbackBounded(() => providers.readFeedback({ scope, id }));
        validateFeedbackEvent(event);
        if (event.workspaceId !== store.identity.id || !same(event.scope, scope) || event.id !== id)
            fail('SCOPE_MISMATCH');
        return event;
    }
    async function material(reference, scope) {
        validateNativeReference(reference, { visibility: scope.visibility });
        if (!providers.resolveFeedbackMaterial)
            fail('MISSING_RESOLVER');
        const m = await feedbackBounded(() => providers.resolveFeedbackMaterial({ scope, reference }));
        if (!m.published || m.workspaceId !== store.identity.id || !same(m.reference, reference) || reference.visibility === 'private' && !same(m.scope, scope))
            fail('MATERIAL_SCOPE');
        return m;
    }
    function proposalCheck(value) {
        nativeExact(value, ['mode', 'reference', 'rationale', 'changes']);
        if (!['REUSE', 'DELIVER'].includes(value.mode))
            fail('INVALID_INPUT');
        nativeText(value.rationale);
        validateNativeReference(value.reference, { product: owner });
        if (!Array.isArray(value.changes) || value.changes.length > 256)
            fail('INVALID_INPUT');
        for (const c of value.changes) {
            nativeExact(c, ['kind', 'identifiers', 'sourcePaths', 'explanation']);
            if (!['relation', 'cardinality', 'deprecation', 'rule', 'source', 'other'].includes(c.kind))
                fail('INVALID_INPUT');
            nativeText(c.explanation);
            for (const k of ['identifiers', 'sourcePaths']) {
                if (!Array.isArray(c[k]) || !c[k].length || c[k].length > 256)
                    fail('INVALID_INPUT');
                for (const s of c[k])
                    nativeText(s);
            }
        }
    }
    async function review(event, proposal) {
        const baseline = event.pins[owner], before = await material(baseline, event.scope), after = await material(proposal.reference, event.scope);
        const changedFiles = [...new Set([...Object.keys(before.package.files), ...Object.keys(after.package.files)])].filter(p => before.package.files[p] !== after.package.files[p]).sort();
        if (proposal.mode === 'REUSE' && (!same(proposal.reference, baseline) || proposal.changes.length || changedFiles.length))
            fail('REUSE_MISMATCH', 'Reuse must keep the exact published reference with no declared semantic changes');
        if (proposal.mode === 'DELIVER' && (same(proposal.reference, baseline) || !changedFiles.length || !proposal.changes.length))
            fail('EMPTY_CHANGE', 'New delivery requires changed bytes and source-linked explanation');
        if (proposal.reference.id !== baseline.id || proposal.reference.visibility !== baseline.visibility)
            fail('MATERIAL_SCOPE', 'Feedback updates the bound asset identity');
        if (proposal.mode === 'DELIVER') {
            const source = JSON.parse(after.package.files[after.package.manifest.sourceBindingRef]);
            nativeExact(source, ['schema', 'direction', 'sources', 'requirements', 'mappings'], ['extensions']);
            if (source.schema !== 'evopilot-source-bindings/v1' || source.direction !== event.source.direction || !Array.isArray(source.sources) || !source.sources.length)
                fail('STALE_SOURCE');
            const paths = new Set();
            for (const s of source.sources) {
                nativeExact(s, ['id', 'locator', 'revision', 'digest', 'status', 'visibility', 'contentPath']);
                nativeText(s.contentPath);
                if (s.revision !== event.source.revision || s.visibility !== event.scope.visibility)
                    fail('STALE_SOURCE', 'Every delivered source must bind the event revision and visibility');
                paths.add(s.contentPath);
            }
            for (const change of proposal.changes)
                for (const path of change.sourcePaths)
                    if (!paths.has(path))
                        fail('SOURCE_MAPPING_REQUIRED', 'Change must identify a packaged source path');
        }
        const dependency = owner === 'ontology' ? await material(event.pins.harness, event.scope) : null;
        const dependentHarness = dependency && dependency.package.manifest.dependencies.some(r => r.product === 'ontology' && r.id === baseline.id) ? [dependency.reference] : [];
        const body = { ...proposal, eventId: event.id, eventDigest: event.digest, owner, workspaceId: event.workspaceId, scope: event.scope, sourceDigest: nativeSha256(event.source), baseline, changedFiles, dependentHarness };
        return { ...body, reviewDigest: nativeSha256(body) };
    }
    async function feedback(request) {
        nativeAssertJSON(request);
        feedbackScope(request.scope);
        const write = ['feedback.ingest', 'feedback.propose', 'feedback.decide'].includes(request.operation);
        nativeExact(request, ['operation', 'scope', 'input', ...(write ? ['requestId', 'expectedRevision'] : [])]);
        if (!OWNER_FEEDBACK_OPERATIONS.includes(request.operation))
            fail('INVALID_OPERATION');
        if (request.operation === 'feedback.inspect') {
            nativeExact(request.input, []);
            return state.inspect(request.scope);
        }
        if (request.operation === 'feedback.list') {
            nativeExact(request.input, []);
            return state.list(request.scope, 'inbox');
        }
        if (request.operation === 'feedback.read') {
            nativeExact(request.input, ['id']);
            nativeDigest(request.input.id);
            return inbox(request.scope, request.input.id);
        }
        if (request.operation === 'feedback.ingest') {
            nativeExact(request.input, ['id', 'digest']);
            nativeDigest(request.input.id);
            nativeDigest(request.input.digest);
            const event = await source(request.scope, request.input.id);
            if (event.digest !== request.input.digest)
                fail('EVENT_CONFLICT');
            return state.mutate(request, () => {
                const old = state.get(request.scope, 'inbox', event.id);
                if (old) {
                    if (!same(old.event, event))
                        fail('EVENT_CONFLICT');
                    return old.receipt;
                }
                const subject = { eventId: event.id, eventDigest: event.digest, owner, workspaceId: store.identity.id, scope: request.scope, candidateId: event.id + ':' + owner };
                const receipt = { ...subject, digest: nativeSha256(subject) };
                const record = { event, receipt, candidate: { id: receipt.candidateId, kind: owner === 'harness' ? 'regression' : 'semantic-impact', evidenceDigest: event.receiptDigest, status: 'REVIEW_REQUIRED' }, review: null, disposition: null };
                state.put(request.scope, 'inbox', event.id, record);
                return receipt;
            });
        }
        nativeExact(request.input, request.operation === 'feedback.propose' ? ['id', 'proposal'] : ['id', 'reviewDigest', 'decision', 'humanEvidenceRef']);
        nativeDigest(request.input.id);
        const id = request.input.id, before = inbox(request.scope, id), event = await source(request.scope, id);
        if (!same(before.event, event))
            fail('EVENT_CONFLICT');
        if (request.operation === 'feedback.propose') {
            proposalCheck(request.input.proposal);
            const proposed = await review(event, request.input.proposal);
            return state.mutate(request, () => { const current = inbox(request.scope, id); if (current.disposition)
                fail('IMMUTABLE_DISPOSITION'); current.review = proposed; state.put(request.scope, 'inbox', id, current); return proposed; });
        }
        nativeText(request.input.humanEvidenceRef);
        nativeDigest(request.input.reviewDigest);
        if (!['APPROVE', 'REJECT'].includes(request.input.decision))
            fail('INVALID_INPUT');
        if (!before.review || before.review.reviewDigest !== request.input.reviewDigest)
            fail('REVIEW_REQUIRED');
        const { mode, reference, rationale, changes } = before.review;
        const currentReview = await review(event, { mode, reference, rationale, changes });
        if (!same(currentReview, before.review))
            fail('STALE_REVIEW');
        const decision = request.input.decision, humanEvidenceRef = request.input.humanEvidenceRef;
        verifyDecisionEvidence(humanEvidenceRef, { owner, operation: 'feedback.decide', workspaceId: store.identity.id, scope: request.scope, reviewDigest: currentReview.reviewDigest, decision });
        return state.mutate(request, () => { const current = inbox(request.scope, id); if (current.disposition)
            fail('IMMUTABLE_DISPOSITION'); if (!same(current.review, currentReview))
            fail('STALE_REVIEW'); const subject = { review: currentReview, decision, humanEvidenceRef }; const disposition = { ...subject, digest: nativeSha256(subject) }; current.disposition = disposition; state.put(request.scope, 'inbox', id, current); return disposition; });
    }
    return { feedback };
}
