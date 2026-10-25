import { DomTree } from './DomTree';

/** Figma-style layers over the actual rendered DOM (body subtree, visual elements only). */
export function LayersPanel() {
  return <DomTree mode="layers" />;
}
