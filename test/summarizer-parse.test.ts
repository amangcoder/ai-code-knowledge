import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseResponse } from '../scripts/lib/summarizer.js';

describe('parseResponse', () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        stderrSpy.mockRestore();
    });

    it('parses valid JSON from code fences', () => {
        const raw = '```json\n{"purpose": "test module", "exports": ["foo"]}\n```';
        const result = parseResponse(raw);
        expect(result.purpose).toBe('test module');
        expect(result.exports).toEqual(['foo']);
    });

    it('parses valid JSON without code fences', () => {
        const raw = '{"purpose": "test", "exports": [], "dependencies": []}';
        const result = parseResponse(raw);
        expect(result.purpose).toBe('test');
    });

    it('returns empty object for completely malformed input', () => {
        const result = parseResponse('this is not json at all', 'test.ts');
        expect(result).toEqual({});
    });

    it('logs warning for malformed input', () => {
        parseResponse('not json', 'test.ts');
        expect(stderrSpy).toHaveBeenCalled();
        const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(output).toContain('[summarizer]');
        expect(output).toContain('test.ts');
    });

    it('does not log warning for empty input', () => {
        parseResponse('', 'test.ts');
        expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('handles JSON with extra fields gracefully', () => {
        const raw = '{"purpose": "test", "exports": [], "extraField": true}';
        const result = parseResponse(raw);
        expect(result.purpose).toBe('test');
    });

    it('handles JSON with missing fields', () => {
        const raw = '{"purpose": "test"}';
        const result = parseResponse(raw);
        expect(result.purpose).toBe('test');
        expect(result.exports).toBeUndefined();
    });

    it('logs warning when field types are wrong', () => {
        // purpose should be string, not number
        const raw = '{"purpose": 123, "exports": "not-an-array"}';
        parseResponse(raw, 'bad-types.ts');
        expect(stderrSpy).toHaveBeenCalled();
        const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(output).toContain('bad-types.ts');
    });

    it('handles code fences without json label', () => {
        const raw = '```\n{"purpose": "test"}\n```';
        const result = parseResponse(raw);
        expect(result.purpose).toBe('test');
    });

    it('truncates long raw responses in warnings', () => {
        const longResponse = 'x'.repeat(300);
        parseResponse(longResponse, 'long.ts');
        expect(stderrSpy).toHaveBeenCalled();
        const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(output).toContain('...');
    });

    it('includes filePath as "unknown" when not provided', () => {
        parseResponse('bad json');
        expect(stderrSpy).toHaveBeenCalled();
        const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(output).toContain('unknown');
    });

    it('parses all valid summary fields', () => {
        const raw = JSON.stringify({
            purpose: 'handles auth',
            exports: ['login', 'logout'],
            dependencies: ['express', './db'],
            sideEffects: ['writes to database'],
            throws: ['AuthError'],
        });
        const result = parseResponse(raw);
        expect(result.purpose).toBe('handles auth');
        expect(result.exports).toEqual(['login', 'logout']);
        expect(result.dependencies).toEqual(['express', './db']);
        expect(result.sideEffects).toEqual(['writes to database']);
        expect(result.throws).toEqual(['AuthError']);
    });
});
