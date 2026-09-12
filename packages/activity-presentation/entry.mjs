import katex from 'katex';
import autoRender from 'katex/contrib/auto-render';
import mermaid from 'mermaid';
import SmilesDrawer from 'smiles-drawer';
import {renderScientificSupports} from '../../ui/scientific-support.mjs';
const style = document.createElement('style'); style.textContent = STUDIUM_MATH_CSS; document.head.append(style);
window.StudiumSupport = {
  render: (container, assets) => renderScientificSupports(container, assets, {katex, mermaid, SmilesDrawer}),
  renderMath: element => {
    if (!element) return;
    autoRender(element, {delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'\\(',right:'\\)',display:false}],
      trust:false, throwOnError:false, maxExpand:500, maxSize:20,
      ignoredTags:['script','noscript','style','textarea','pre','code','option'], ignoredClasses:['katex','scientific-support']});
  },
};
