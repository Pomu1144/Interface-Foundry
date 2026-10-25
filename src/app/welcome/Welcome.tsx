import { ArrowRight, FolderOpen, Globe, Laptop, Plug, Server, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Spinner } from '@/ui';
import { studio, useStudio } from '@/store';
import { art } from '@/app/art';
import { runAction } from '@/app/actions';
import { openDemoProject, openUrl, DEMO_PROJECT_ID, openProject, ensureVfs } from '@/modules/project-adapter/projects';
import { deleteProject, listProjects, loadProject } from '@/modules/project-storage/storage';
import type { ProjectMeta } from '@/store';
import s from './welcome.module.css';

const FEATURES = [
  { img: art.design, title: 'Design', text: 'Edit live layouts with CSS-aware handles, tokens and reversible history.' },
  { img: art.inspect, title: 'Inspect', text: 'DOM, cascade, computed styles, box model, console and network.' },
  { img: art.simulate, title: 'Simulate', text: 'Foldables, phones, tablets and desktops with real reflow.' },
  { img: art.test, title: 'Test', text: 'Responsive diffs, accessibility, recordings and replay.' },
  { img: art.ai, title: 'Diagnose', text: 'Evidence-grounded AI debugging with approval before every fix.' },
  { img: art.ship, title: 'Ship', text: 'CSS patches, source diffs, QA reports and Git hand-off.' },
];

export function Welcome() {
  const server = useStudio((st) => st.server);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [recent, setRecent] = useState<ProjectMeta[]>([]);
  useEffect(() => {
    listProjects().then(setRecent).catch(() => setRecent([]));
  }, []);

  const go = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={s.root}>
      <div className={s.hero} style={{ backgroundImage: `url(${art.welcomeHero})` }} />
      <div className={s.heroShade} />
      <div className={s.content}>
        <header className={s.top}>
          <div className={s.brand}>
            <img src={art.appIcon} alt="" className={s.brandIcon} />
            <div>
              <div className={s.brandName}>IFDY</div>
              <div className={s.brandSub}>Interface Foundry</div>
            </div>
          </div>
          <div className={s.serverStatus} data-status={server.status}>
            <Server size={13} />
            {server.status === 'online' ? 'Companion connected' : server.status === 'offline' ? 'Companion offline' : 'Connecting…'}
            {server.capabilities?.browser.available && <Badge tone="success">Chromium ready</Badge>}
            {server.capabilities?.ai.anthropic && <Badge tone="violet">AI ready</Badge>}
          </div>
        </header>

        <section className={s.intro}>
          <h1 className={s.title}>
            Shape real interfaces.
            <br />
            <span className={s.titleAccent}>On every screen they’ll ever fold into.</span>
          </h1>
          <p className={s.lede}>Design, inspect, simulate, test, diagnose and ship from one workspace — against the real rendering engine, never a screenshot.</p>

          <div className={s.actions}>
            <Button size="lg" variant="molten" icon={busy === 'demo' ? <Spinner /> : <img src={art.crucible} alt="" style={{ width: 18, height: 18 }} />} onClick={() => go('demo', openDemoProject)}>
              Open the Harborline demo
            </Button>
            <Button size="lg" variant="secondary" icon={<FolderOpen size={15} />} onClick={() => runAction('project.import')}>
              Import static project
            </Button>
            <Button size="lg" variant="secondary" icon={<Plug size={15} />} onClick={() => runAction('project.connectLocal')}>
              Connect localhost
            </Button>
          </div>

          <form
            className={s.urlBox}
            onSubmit={(e) => {
              e.preventDefault();
              if (!url.trim()) return;
              void go('url', async () => {
                await openUrl(url.trim());
                runAction('view.wall');
              });
            }}
          >
            <Globe size={16} className={s.urlIcon} />
            <input className={s.urlInput} placeholder="Paste any website link to simulate it across devices — e.g. https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} aria-label="Website URL" />
            <div className={s.urlDevices}>
              {[art.phone, art.foldable, art.tablet, art.desktop].map((src, i) => (
                <img key={i} src={src} alt="" />
              ))}
            </div>
            <Button type="submit" variant="primary" trailing={busy === 'url' ? <Spinner /> : <ArrowRight size={14} />} disabled={!url.trim()}>
              Simulate
            </Button>
          </form>
          <p className={s.urlNote}>
            {server.capabilities?.browser.available
              ? 'Public sites run in an isolated, controlled Chromium — fully interactive, with real device emulation and DevTools data.'
              : 'Public sites open as read-only embeds where the site allows framing. Install Chromium (npm run browsers:install) for full simulation.'}
          </p>
        </section>

        <section className={s.features}>
          {FEATURES.map((f) => (
            <div key={f.title} className={s.feature}>
              <img src={f.img} alt="" className={s.featureArt} draggable={false} />
              <div className={s.featureTitle}>{f.title}</div>
              <div className={s.featureText}>{f.text}</div>
            </div>
          ))}
        </section>

        {recent.length > 0 && (
          <section className={s.recent}>
            <div className={s.recentHead}>Recent projects</div>
            <div className={s.recentList}>
              {recent.slice(0, 6).map((p) => (
                <div key={p.id} className={s.recentItem}>
                  <button
                    className={s.recentOpen}
                    onClick={() =>
                      go(p.id, async () => {
                        if (p.id === DEMO_PROJECT_ID) return openDemoProject();
                        const saved = await loadProject(p.id);
                        if (!saved) throw new Error('Project not found');
                        if (saved.project.source.kind === 'vfs') {
                          if (!(await ensureVfs(saved.project.source.projectId))) throw new Error('Project files are no longer available. Import the project again.');
                        }
                        await openProject(saved.project, saved.routes, saved.currentRoute);
                      })
                    }
                  >
                    <span className={s.recentIcon}>{p.source.kind === 'url' ? <Globe size={14} /> : p.source.kind === 'proxy' ? <Laptop size={14} /> : <FolderOpen size={14} />}</span>
                    <span className={s.recentName}>{p.name}</span>
                    <span className={s.recentMeta}>{new Date(p.updatedAt).toLocaleString()}</span>
                  </button>
                  <button
                    className={s.recentDelete}
                    aria-label={`Forget ${p.name}`}
                    onClick={async () => {
                      await deleteProject(p.id);
                      setRecent((r) => r.filter((x) => x.id !== p.id));
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        <footer className={s.footer}>
          All demo data is synthetic. Projects are stored locally in this browser · <button onClick={() => studio().setDialog('settings', true)}>Privacy & data</button>
        </footer>
      </div>
    </div>
  );
}
