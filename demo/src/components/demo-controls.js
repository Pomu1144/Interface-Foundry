// "Demo controls" disclosure in the footer: tools for exercising session
// recovery and the keyboard test page. Purely synthetic.
import { html, toElement, qs } from '../dom.js';
import { icon } from '../icons.js';
import { sessionTimeoutSeconds } from '../session.js';

export function DemoControls({ onSimulateTimeout }) {
  const timeout = sessionTimeoutSeconds();
  const root = toElement(html`
    <details class="demo-controls" data-testid="demo-controls" data-ifdy-component="DemoControls" data-ifdy-source="demo/src/components/demo-controls.js:7">
      <summary class="demo-controls__summary" data-testid="demo-controls-toggle">
        ${icon('flask')}<span>Demo controls</span>${icon('chevronDown')}
      </summary>
      <div class="demo-controls__body">
        <p>Test helpers for this synthetic app. They never touch real accounts.</p>
        <div>
          <button type="button" class="btn btn--secondary btn--sm" data-testid="simulate-session-timeout">
            ${icon('clock')}<span>Simulate session timeout</span>
          </button>
        </div>
        <p class="demo-controls__status small" role="status" data-testid="demo-controls-status"></p>
        <ul class="small">
          <li><a href="#/keyboard" data-testid="link-keyboard-lab">Keyboard navigation lab</a></li>
          <li><a href="#/session-expired" data-testid="link-session-expired">Signed-out page</a></li>
          <li><a href="?sessionTimeout=30#/payment" data-testid="link-auto-timeout">Reload with a 30-second session</a></li>
        </ul>
        <p class="small muted">
          ${timeout
            ? html`Automatic timeout is on: sessions expire after ${timeout} seconds.`
            : html`Add <code>?sessionTimeout=60</code> to the address to expire sessions automatically.`}
        </p>
      </div>
    </details>
  `);

  const status = qs(root, '[data-testid="demo-controls-status"]');
  qs(root, '[data-testid="simulate-session-timeout"]').addEventListener('click', () => {
    status.textContent = '';
    const expired = onSimulateTimeout();
    if (!expired) status.textContent = 'There is no active session to time out. Sign in first.';
  });

  return root;
}
