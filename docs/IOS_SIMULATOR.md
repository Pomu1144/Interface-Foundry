# iOS Simulator engine (real Mobile Safari)

Boards can render with **Safari (iOS Simulator)** from the engine picker on the
board label. The page then runs in real Mobile Safari, inside one of Xcode's
iOS Simulators on the machine that runs the IFDY companion, and is streamed
into the board like a Chromium board.

> **Verified on:** nothing yet. This engine was written and unit-tested on Linux,
> without macOS, Xcode, Simulator, `safaridriver` or `idb`. Every process and HTTP
> boundary is mocked in `tests/unit/ios-simulator.test.ts`, following Apple's
> documented tools. It **must be validated on a Mac** before anyone relies on it.
> The studio says so too: the engine picker details and the board badge tooltip read "Not yet
> verified on real hardware".

## Requirements

The companion (`npm run dev` / `npm start`) has to run **on a Mac**. A studio
opened from another machine works as long as the companion runs on the Mac.
On Linux and Windows the engine is listed but unavailable.

1. **Xcode** with its command-line tools selected:

   ```sh
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   xcodebuild -runFirstLaunch
   xcrun simctl list runtimes   # must print at least one iOS runtime
   ```

2. **An iOS Simulator runtime**: Xcode › Settings › Components, or
   `xcodebuild -downloadPlatform iOS`.

3. **Safari WebDriver**, enabled once (asks for an administrator password):

   ```sh
   safaridriver --enable
   ```

   `safaridriver` ships with macOS at `/usr/bin/safaridriver`. Set
   `IFDY_SAFARIDRIVER` to use another path, such as Safari Technology Preview's driver.

4. **Remote Automation inside the simulator**: Settings › Safari › Advanced ›
   Remote Automation. Apple documents this switch for iOS devices. Whether a
   simulator needs it too is not yet verified. If session creation fails with a
   remote-automation error, open IFDY's simulator (named `IFDY <model>`, see below)
   in Simulator.app, turn the switch on, and reload the board.

5. **Optional: [idb](https://fbidb.io)**. It is only used when no safaridriver
   session can be created (see *Fallback*), and gives that mode touch and typing:

   ```sh
   brew tap facebook/fb && brew install idb-companion
   pip3 install fb-idb
   ```

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `IFDY_IOS_MAX_PAGES` | `3` (max 6) | Live iOS Simulator boards at once, across all studio tabs. |
| `IFDY_SAFARIDRIVER` | `/usr/bin/safaridriver` | safaridriver binary. |

## How it works

Code: `server/ios/`. `simulator-page.ts` implements the same `LivePage`
interface as the Chromium and WebKit engines.

### Devices

- `xcrun simctl list -j devices runtimes devicetypes` is read to find the newest
  available iOS runtime and the device type that matches the board's profile.
  For example, `iphone-16-pro` is "iPhone 16 Pro" and `ipad-pro-13` is
  "iPad Pro 13-inch (M4)". When a model is not installed, a close substitute is
  used and the board's details say so.
- IFDY **never boots, changes or deletes your own simulators**. It creates its
  own, named `IFDY <model>` (`simctl create`), and reuses them afterwards. This
  keeps your simulators' Safari history, cookies and settings untouched. Light
  and dark appearance (`simctl ui … appearance`) is only changed on these IFDY
  simulators.
- Simulators boot lazily (`simctl boot` + `simctl bootstatus -b`) when a board
  opens. The first boot of a new simulator can take a minute or more.
- One live board per simulator, because Mobile Safari shows one foreground page.
  A second board with the same device gets a clear error. Use another device for it.
- Simulators that **IFDY booted** are shut down after 3 minutes without a board,
  and when the companion exits. A simulator that was already running is left
  running.
- Every child process is started with `execFile` and an argument array (never
  through a shell), and every call has a timeout.

### Preferred path: safaridriver (W3C WebDriver)

Each board starts its own `safaridriver --port <free port>`, then creates a
session with:

```json
{
  "browserName": "Safari",
  "platformName": "iOS",
  "safari:useSimulator": true,
  "safari:deviceUDID": "<IFDY simulator>",
  "safari:deviceType": "iPhone",
  "safari:deviceName": "iPhone 16 Pro",
  "safari:platformVersion": "18.2",
  "unhandledPromptBehavior": "dismiss and notify"
}
```

- **Navigation**: `POST /url`, `/back`, `/forward`, `/refresh`. URLs are checked
  with `isAllowedRemoteUrl` (http and https only) and the studio-recursion guard.
  The simulator shares the Mac's network, so `localhost` URLs, including IFDY's
  preview host, load as they do on the Mac.
- **Frames**: `GET /screenshot`, which returns PNG images of the viewport. They are
  forwarded unchanged, and the studio decodes PNG as well as JPEG. Unchanged screens
  are not resent. Polling is paced by the session's shared frame budget, the same
  one Chromium's screencast uses. Expect a few frames per second, not 60.
- **Viewport**: the simulator's screen *is* the device, so the viewport cannot be
  resized. IFDY measures `innerWidth`, `innerHeight`, `devicePixelRatio` and
  `visualViewport` in Safari and reports them (`emulated` and `metrics`). Safari's
  address bar and toolbars take part of the screen, so the viewport is smaller
  than the board's device profile.
- **Input**: W3C Actions with `pointerType: "touch"`. A mouse drag is sent as a
  touch, and a hover is dropped because iOS has no hover. Each gesture is sent as
  one Perform Actions call **when the finger lifts**, so a drag scrolls when you
  release it, not while you move. Long presses keep their length. Wheel scrolling
  scrolls the nearest scrollable element under the pointer with a script. Keys and
  typed text are WebDriver key actions.
- **Inspection**: WebDriver has no "run before page scripts" hook. Once each
  document has parsed, IFDY installs the inspection agent with Execute Script,
  through a bridge that queues the agent's messages in the page. The companion
  drains that queue every ~150 ms. Studio-to-agent messages are delivered with
  Execute Script. axe-core loads on demand the same way. A page served by IFDY's
  preview host already contains the agent's `<script>` tag, but in a top-level
  Safari window that copy finds no studio to talk to and stays inert, so the late
  install is the copy that runs.
- **Dialogs**: `alert()`, `confirm()` and `prompt()` are dismissed and reported in
  the console. **New windows and tabs** are closed and reported, as with Chromium.
- **Rotation**: IFDY tries `POST /orientation`. This is a JSON Wire / Appium
  extension, not W3C. If safaridriver refuses it, the board says rotation is
  unsupported and stays portrait.

### Fallback: simctl mirroring

When safaridriver is missing, or no session can be created (for example, remote
automation is off), the board still works, with less:

- The page opens with `xcrun simctl openurl`.
- Frames come from `xcrun simctl io <udid> screenshot --type=jpeg`. They show the
  **whole screen**, including the status bar and Safari's address bar, and the
  board says so.
- Input goes through `idb ui tap/swipe/text/key` when idb is installed.
  Otherwise the board is **view-only** and is labelled that way.
- No inspection, console, network, history or load events. The page is reported
  loaded about 1.5 s after it opens. The board's details include the reason
  safaridriver could not be used.

## Limitations

- Not verified on real hardware (see the top of this page).
- Frame rate is limited by WebDriver screenshots (an estimated 2–8 fps).
- Viewport screenshots are PNG at device resolution, which uses more bandwidth than
  Chromium's JPEG. That is fine on the same machine; on a remote studio, keep fewer
  iOS boards open.
- The agent is installed after the document parses. Console messages, errors and
  event listeners from before that point are not captured. Network timings come from
  the agent's Resource Timing data, not from Safari's network stack.
- One finger only, so no pinch. Gestures are sent on release.
- No fold emulation (iOS has no foldables), and no custom viewport sizes.
- No per-board reduced-motion or text-size emulation. Light and dark appearance
  applies to the whole simulator.
- At most 3 boards by default. Each one runs a whole simulator, which is
  1–2 GB of RAM.

## Assumptions to validate on a Mac

These are the riskiest points, in rough order:

1. **Remote Automation** in simulator Safari: whether it is required, and whether
   `safaridriver --enable` is enough on its own.
2. Capability names and the per-board-driver model: `safari:deviceUDID` together
   with `safari:deviceName`, `safari:deviceType` and `safari:platformVersion`, and
   whether several `safaridriver` processes can drive different simulators at once.
3. Whether `GET /screenshot` on iOS returns only the **web viewport**, at device
   pixel ratio. If it returns the whole screen, IFDY sizes the frame from the image
   and warns that overlays may be offset. Measure how fast it is.
4. Whether safaridriver for iOS supports W3C **touch pointer actions**, and whether
   viewport-origin coordinates match CSS layout pixels when the page is zoomed.
5. Whether Execute Script bodies of several hundred KB (the agent bundle) are
   accepted, and whether they run under strict Content-Security-Policies.
6. Whether `POST /orientation` is supported at all.
7. `simctl ui <udid> appearance`, `simctl io … screenshot --type=jpeg` and the
   `simctl list -j` JSON layout on the Xcode version in use.
8. The flags of `idb ui tap`, `swipe`, `text` and `key` (`--duration`, `--udid`, `--`).

## Troubleshooting

- *"Needs the IFDY companion running on a Mac with Xcode"*: the companion is not
  running on macOS.
- *"Xcode's simctl did not respond"*: run the `xcode-select` and license commands
  above.
- *"Safari remote automation is turned off"*: run `safaridriver --enable`, then
  turn on the simulator's Remote Automation switch.
- *"Another board is already showing the … simulator"*: one board per simulator
  model. Pick another device.
- To remove IFDY's simulators: `xcrun simctl delete <udid>` for each device named
  `IFDY …` (`xcrun simctl list devices | grep IFDY`).
