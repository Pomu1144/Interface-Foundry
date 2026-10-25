import { ArrowRight, ChevronRight, FolderOpen, Globe, Laptop, Server, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArtIcon, Badge, Button, Kbd, Spinner } from '@/ui';
import { studio, useStudio } from '@/store';
import { art } from '@/app/art';
import { runAction } from '@/app/actions';
import { openDemoProject, openUrl, DEMO_PROJECT_ID, openProject, ensureVfs } from '@/modules/project-adapter/projects';
import { deleteProject, listProjects, loadProject } from '@/modules/project-storage/storage';
import type { ProjectMeta } from '@/store';
import s from './welcome.module.css';

const FEATURES = [
  { icon: art.design, title: 'Design', text: 'Edit live layouts with CSS-aware handles, tokens and reversible history.' },
  { icon: art.inspect, title: 'Inspect', text: 'DOM, cascade, computed styles, box model, console and network.' },
  { icon: art.foldable, title: 'Simulate', text: 'Foldables, phones, tablets and desktops with real reflow.' },
  { icon: art.test, title: 'Test', text: 'Responsive diffs, accessibility, recordings and replay.' },
  { icon: art.ai, title: 'Diagnose', text: 'Evidence-grounded debugging with approval before every fix.' },
  { icon: art.ship, title: 'Ship', text: 'CSS patches, source diffs, QA reports and Git hand-off.' },
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

  const start = [
    {
      key: 'demo',
      icon: art.foldable,
      title: 'Open the Harborline demo',
      text: 'A synthetic mortgage app with seeded responsive and accessibility bugs.',
      run: () => go('demo', openDemoProject),
    },
    {
      key: 'import',
      icon: art.folderPlus,
      title: 'Import static project',
      text: 'A folder, zip or single HTML file. Files stay on this machine.',
      shortcut: 'Mod+O',
      run: () => runAction('project.import'),
    },
    {
      key: 'local',
      icon: art.code,
      title: 'Connect localhost',
      text: 'Proxy a running dev server with hot reload passthrough.',
      run: () => runAction('project.connectLocal'),
    },
  ];

  return (
    <div className={s.root}>
      <div className={s.backdrop} aria-hidden />
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

        <div className={s.hero}>
          <section className={s.intro}>
            <h1 className={s.title}>
              Build interfaces against the real browser.
              <span className={s.titleSub}> On every screen they fold into.</span>
            </h1>
            <p className={s.lede}>Design, inspect, simulate, test, diagnose and ship from one workspace. Every edit is live CSS on the real rendering engine, never a screenshot.</p>

            <div className={s.start} role="group" aria-label="Start">
              {start.map((item) => (
                <button key={item.key} className={s.startItem} onClick={item.run} disabled={busy !== null}>
                  <span className={s.startTile}>{busy === item.key ? <Spinner size={14} /> : <ArtIcon src={item.icon} size={20} />}</span>
                  <span className={s.startText}>
                    <span className={s.startTitle}>{item.title}</span>
                    <span className={s.startDesc}>{item.text}</span>
                  </span>
                  {item.shortcut ? <Kbd keys={item.shortcut} /> : <ChevronRight size={14} className={s.startChevron} />}
                </button>
              ))}
            </div>

            <form
              className={s.urlForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (!url.trim()) return;
                void go('url', async () => {
                  await openUrl(url.trim());
                  runAction('view.wall');
                });
              }}
            >
              <label className={s.urlLabel} htmlFor="ifdy-welcome-url">
                Simulate a website across devices
              </label>
              <div className={s.urlBox}>
                <Globe size={15} className={s.urlIcon} />
                <input
                  id="ifdy-welcome-url"
                  className={s.urlInput}
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  spellCheck={false}
                  aria-label="Website URL"
                />
                <span className={s.urlDevices} aria-hidden>
                  {[art.phone, art.foldable, art.tablet, art.desktop].map((src) => (
                    <ArtIcon key={src} src={src} size={15} />
                  ))}
                </span>
                <Button type="submit" variant="primary" trailing={busy === 'url' ? <Spinner /> : <ArrowRight size={14} />} disabled={!url.trim()}>
                  Simulate
                </Button>
              </div>
              <p className={s.urlNote}>
                {server.capabilities?.browser.available
                  ? 'Public sites run in an isolated, controlled Chromium: fully interactive, with real device emulation and DevTools data.'
                  : 'Public sites open as read-only embeds where the site allows framing. Install Chromium (npm run browsers:install) for full simulation.'}
              </p>
            </form>
          </section>

          <figure className={s.shot}>
            <div className={s.shotBar}>
              <span className={s.shotDots} aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className={s.shotTitle}>Harborline Mortgage · Surface Duo · expanded</span>
            </div>
            <img src={art.productShot} alt="The IFDY workspace inspecting a page on an unfolded Surface Duo" className={s.shotImg} draggable={false} />
          </figure>
        </div>

        <section className={s.features} aria-label="Capabilities">
          {FEATURES.map((f) => (
            <div key={f.title} className={s.feature}>
              <ArtIcon src={f.icon} size={18} className={s.featureIcon} />
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
