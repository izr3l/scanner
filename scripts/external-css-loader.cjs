module.exports = function externalCSS(source) {
  const transformed = source
    .replace(/function __insertCSS\(code\)\s*\{[\s\S]*?\n\}/, '')
    .replace(/__insertCSS\(("(?:[^"\\]|\\.)*")\);?/g, '');
  if (transformed.includes('__insertCSS')) throw new Error('Review pinned library CSS extraction.');
  return transformed;
};
