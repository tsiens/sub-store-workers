// Apply at build time so upstream syncs do not overwrite the Workers adaptation.
function patchFileUsage(source) {
    const entry = 'export async function applyResponseTransformers({';
    const anchor = '    const currentHeaders = getCurrentHeaders(res);';
    if (!source.includes(entry) || source.split(anchor).length !== 2) {
        throw new Error('Upstream file response entry changed; refusing to build without automatic file usage');
    }
    return [
        "import $ from '@/core/app';",
        "import { getFlowHeaders, normalizeFlowHeader } from '@/utils/flow';",
        "import { prepareFileUsage } from '@/utils/file-usage';",
        source.replace(anchor, `${anchor}
    await prepareFileUsage({ headers: currentHeaders }, { source }, $, {
        getFlowHeaders,
        normalizeFlowHeader,
    });`),
    ].join('\n');
}

module.exports = { patchFileUsage };
