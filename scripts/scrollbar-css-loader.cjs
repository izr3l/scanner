module.exports = function externalScrollbarCSS(source) {
  const target = "return React.createElement(Style, { styles: getStyles(gap, !noRelative, gapMode, !noImportant ? '!important' : '') });";
  if (!source.includes(target)) throw new Error('Review pinned scrollbar library CSP adapter.');
  return source.replace(target, `React.useEffect(function () {
    var previous = document.body.style.getPropertyValue(removedBarSizeVariable);
    document.body.style.setProperty(removedBarSizeVariable, gap.gap + 'px');
    return function () {
      if (previous) document.body.style.setProperty(removedBarSizeVariable, previous);
      else document.body.style.removeProperty(removedBarSizeVariable);
    };
  }, [gap.gap]);
  return null;`);
};
