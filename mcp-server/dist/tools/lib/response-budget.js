const MAX_RESPONSE_BYTES = 3800;
export function buildResponse(sections) {
    const sorted = [...sections].sort((a, b) => a.priority - b.priority);
    const parts = [];
    let totalLength = 0;
    for (const section of sorted) {
        const block = section.label
            ? `${section.label}:\n${section.content}`
            : section.content;
        const blockLength = Buffer.byteLength(block, 'utf8');
        if (totalLength + blockLength + 2 <= MAX_RESPONSE_BYTES) {
            parts.push(block);
            totalLength += blockLength + 1; // +1 for newline separator
        }
        else {
            // Truncate to fit remaining budget
            const remaining = MAX_RESPONSE_BYTES - totalLength - 20; // room for truncation marker
            if (remaining > 50) {
                const truncated = block.slice(0, remaining) + '\n  ... (truncated)';
                parts.push(truncated);
            }
            break;
        }
    }
    return parts.join('\n\n');
}
