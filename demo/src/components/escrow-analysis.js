// Annual escrow analysis panel. The fixture it requests does not exist yet
// (HTTP 404), so it degrades to an inline "temporarily unavailable" message.
import { html, toElement, setContent, qs } from '../dom.js';
import { icon } from '../icons.js';
import { loadJSON } from '../api.js';
import { money } from '../format.js';

export function EscrowAnalysis() {
  const root = toElement(html`
    <section class="card escrow-analysis" aria-labelledby="escrow-analysis-title" aria-busy="true" data-testid="escrow-analysis" data-ifdy-component="EscrowAnalysis" data-ifdy-source="demo/src/components/escrow-analysis.js:8">
      <h2 class="card__title" id="escrow-analysis-title" tabindex="-1">2026 escrow analysis</h2>
      <div data-slot="body"></div>
    </section>
  `);
  const body = qs(root, '[data-slot="body"]');

  function load({ refocus = false } = {}) {
    root.setAttribute('aria-busy', 'true');
    if (refocus) root.querySelector('h2').focus();
    setContent(body, html`<span class="skeleton" style="width: 80%"></span><span class="skeleton" style="width: 60%; margin-top: 0.5rem"></span>`);
    loadJSON('escrow-analysis.json', { cache: false })
      .then((analysis) => {
        setContent(
          body,
          html`
            <dl class="kv">
              <div class="kv__row"><dt>Projected disbursements</dt><dd>${money(analysis.projectedDisbursements)}</dd></div>
              <div class="kv__row"><dt>Required cushion</dt><dd>${money(analysis.cushion)}</dd></div>
              <div class="kv__row kv__row--total"><dt>Surplus / shortage</dt><dd>${money(analysis.difference)}</dd></div>
            </dl>
          `,
        );
      })
      .catch((error) => {
        console.error(`[harborline] Failed to load escrow analysis (${error.status ? `HTTP ${error.status}` : error.message})`, error.url ?? error);
        if (!root.isConnected) return;
        setContent(
          body,
          html`
            <div class="alert alert--warning" role="status" data-testid="escrow-analysis-unavailable">
              ${icon('alert')}
              <div>
                <strong class="alert__title">Escrow analysis is temporarily unavailable</strong>
                <p>
                  We couldn't load your escrow analysis right now. Your escrow payments and scheduled tax and insurance
                  disbursements are not affected.
                </p>
                <button type="button" class="btn btn--secondary btn--sm escrow-analysis__retry" data-testid="escrow-analysis-retry">
                  ${icon('refresh')}<span>Try again</span>
                </button>
              </div>
            </div>
          `,
        );
        const retry = qs(body, '[data-testid="escrow-analysis-retry"]');
        retry.addEventListener('click', () => load({ refocus: true }));
        if (refocus) retry.focus();
      })
      .finally(() => root.setAttribute('aria-busy', 'false'));
  }

  load();
  return root;
}
