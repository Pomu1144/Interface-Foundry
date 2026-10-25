// Account maintenance route: contact details form plus guidance.
import { html, toElement, qs, setContent } from '../dom.js';
import { icon } from '../icons.js';
import { loadJSON } from '../api.js';
import { ProfileForm } from './profile-form.js';

export function ProfilePage() {
  const root = toElement(html`
    <div class="page profile" data-ifdy-component="ProfilePage" data-ifdy-source="demo/src/components/profile-page.js:7">
      <header class="page__header">
        <div>
          <p class="page__eyebrow">Account maintenance</p>
          <h1 class="page__title" id="profile-title">Profile and contact details</h1>
          <p class="page__lede">Keep your details current so you receive statements, escrow notices and security alerts.</p>
        </div>
      </header>
      <div class="split">
        <div class="stack" data-slot="form">
          <div class="card"><span class="skeleton" style="width: 40%"></span><span class="skeleton" style="width: 100%; height: 3rem; margin-top: 1rem"></span></div>
        </div>
        <aside class="stack" aria-label="About your details">
          <section class="card profile-aside" aria-labelledby="profile-why-title">
            <h2 class="card__title" id="profile-why-title">Why we ask</h2>
            <ul class="good-to-know__list">
              <li>${icon('mail')}<span>Your mailing address receives year-end tax forms (Form 1098) and escrow analyses.</span></li>
              <li>${icon('phone')}<span>We text one-time passcodes to your mobile phone when you sign in from a new device.</span></li>
              <li>${icon('shield')}<span>Changes trigger a confirmation to both your old and new email addresses.</span></li>
            </ul>
          </section>
          <section class="card profile-aside" aria-labelledby="profile-property-title">
            <h2 class="card__title" id="profile-property-title">Property address</h2>
            <p class="muted">18 Lantern Point Road, Port Harbor, ME 04999</p>
            <p class="small muted">The property address on your loan can't be changed online.</p>
          </section>
        </aside>
      </div>
    </div>
  `);

  loadJSON('profile.json')
    .then((fixture) => {
      setContent(qs(root, '[data-slot="form"]'), ProfileForm({ saved: fixture.profile, states: fixture.states }));
    })
    .catch((error) => {
      console.error('[harborline] could not load profile', error);
      setContent(
        qs(root, '[data-slot="form"]'),
        html`<div class="alert alert--danger" role="alert">${icon('alert')}<p>We couldn't load your profile. Refresh the page to try again.</p></div>`,
      );
    });

  return root;
}
