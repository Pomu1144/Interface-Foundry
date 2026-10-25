import { DomTree } from './DomTree';

/** Chrome-style Elements tree of the full rendered document. */
export function DomTab() {
  return <DomTree mode="dom" />;
}
