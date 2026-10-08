# Changelog

## Unreleased — v2.4 (BSSMNT-Stable05)
Built on branch `v2.4`. Installs beside the alpha with its own settings.

### Added
- **BSSMNT Stable05** installs next to the alpha (demoV2) with its own shortcuts, settings, recent list and crash recordings. The label shows in the window title and the help panel.
- **Fast pass:** a loaded song is analysed in a few seconds (progress and Cancel in the Status overlay). The whole song gets motion and cuts before you press play; what you play replaces them as you go. **Refill from fast pass** (TEMPO menu) replaces what you played.
- **Amount used:** click a clip card's time to choose the part of the clip the Auto-Editor may use (e.g. 0:20–0:32). Locked clips play exactly that part.
- **Sections:** split a clip on bar markers in a filmstrip editor (click to add, drag to snap to bars, right-click to delete). The sections show as a strip on the clip's card; click one to give it its own pace, band, speed and lock. The video isn't copied, and at most two players per video are used live (like A / B decks).
- **Speed:** ¼× to 4× per clip or section (presets or a number), with the clip's sound changing pitch to match, live and in the export. **Fit to bars** sets the speed so the used part fills exactly N bars.
- **Band-coloured cards** (readable in both skins) with band member tags (B1, M2 …).
- **Resizable workspace:** drag between the viewport and the editor, between the timeline and the Action Editor, or a lane's lower edge; double-click to reset. Sizes are remembered.
- **Band strip:** the clip lane is a compact strip of every cut in its band colour and tag, with a row for clips over the video; ▸ shows the full lane.
- **Auto-Editor:** "Global edit" folds away; **Band members** shows each band's clips and lights the band behind the cut on air (click a chip to select the clip). With Clip order = By band, the Action Editor groups clips by band; drag between groups to change a clip's band.
- **Placement** for Media Layers and images: anchor, position, size, rotation, opacity, fit, blend and music reaction, with a separate layout per display shape. Drag it on the viewport. Existing layers look exactly as before.
- **Images over video:** an image can play *over* the video (new images do by default) while the videos keep cutting underneath; one at a time, faded in and out. A locked image (Hook / Result / CTA) can sit over the video too.
- **Titles:** Screen lock (anchor + offset, drag it on the viewport), optional 9:16 safe areas (shown faintly while editing), and a lock that makes a title follow the Hook, Result or CTA. **Trend presets:** Bold stack, Word by word (on the beat), Highlight word, Lower third, Track-in, Mask reveal; they export exactly as seen.
- **Visual per clip:** a clip or section can show a visual mode (Galaxy, Mandala, Spectrum Bars …) over the video or instead of it while it's on air, with a clear, trailing or solid background and an optional colour tint — live and in the export.
- **Mandala** draws faster (about 3× quicker to export).
- **Timeline selection:** drag on the ruler to select (snaps to beats; Shift extends, Esc clears), L loops it, and Export can export just the Selection, with optional edge fades.
- **Scrubbing:** drag on the timeline to see what was recorded at any point. It no longer changes the cut list.
- **Master fade in / out** (F on the Master lane): Linear, Smooth or Snap, in bars or seconds; heard live and in the export.
- **Repeats:** set how many times a clip (image or video) may appear on the timeline; 0 = no limit.
- **Ctrl+Space:** full screen with every editing shelf hidden; Esc or Ctrl+Space brings them back.
- **Shelves** (02 Input, 03 Sound, 04 Effects, Auto-Editor) are laid out like 01 File: rows with fold-outs.
- **One main drag** for the bottom shelf; each lane and the Action Editor have their own grip.
- **Fixed tempo grid:** in track mode, cuts follow one grid from 0:00, the same every time the song loads — no more "Listening for tempo…". The header shows the tempo ("97 BPM · median"). Use ÷2, ×2, type a tempo, Tap (or **T**), Detected, or Live clock (the old behaviour).

### Changed
- Songs that were never played export with full motion and cuts instead of a still picture.
- Projects are saved in a new format (version 2) that the alpha can't open. Alpha projects open as before, and the first Save over one offers **Save as a copy**.

## BASSMNTalphaV1 — bug-fix update (2026-10-06)
Same version (alpha V1); fixes and one import addition.

### Fixed
- **The desktop app couldn't be closed** when a project had unsaved changes. It now asks *Close without saving / Cancel*.
- **Linked projects lost media on reopening** (e.g. 9 of 22 videos). The desktop app now remembers where each file is (including the original .asf of converted recordings) and reopens it from there.
- **Reopened projects had no audio** when they were saved with SRC on Live: the parked track is now saved with the project.
- **Choose file did nothing** inside VS Code's preview; it now uses the standard file dialog there.
- **Re-choosing the same song** after using live mode did nothing; it now loads.
- **Open recent didn't list projects** opened or saved in browsers without file handles (Firefox, VS Code's preview). Every project is now logged; where needed a copy (up to 300 MB) is kept so it reopens.
- **Voice recording's REC timer** drove the live-input REC badge in the header (two controls shared an id); each badge is now separate.
- **Pack / Link** radio clicks were undone by the unsaved-changes tracker; fixed. A reopened project now takes its file's name.
- **Dark skin lines** were heavy: thinner (0.5 px / 1 px) and a softer tone.
- **Export stopped with "Decoder error."** when any frame of any clip couldn't be decoded. It now retries, holds that clip's last good picture where it can't, finishes the export, and names the clip.
- **A long clip locked as CTA (or Hook / Result) took over the whole project** — e.g. a screen recording longer than the song made the CTA start at 0:00 and squeezed out Result. A locked clip now plays at most a quarter of the song (30 s live); the clip's options say when it's cut short.

### Added
- **File menu** (01 File, now the first tab): New project, Open…, Open recent, Save with Pack / Link and the file size, Save as…, Export video (options in dropdowns), Output window — a list like traditional software, with the project name on top. Tabs are now 01 File, 02 Input, 03 Sound, 04 Effects (was Overlays); Ctrl / Alt + 1–4 follow that order.
- **New project** (Ctrl+N in the desktop app, Alt+N in a browser) — asks first if there are unsaved changes.
- **Effects** (was Overlays) is a list too, and every option is a dropdown instead of rows of buttons.
- A reopened project takes its file's name.
- **Screen recordings (.asf / .wmv / .wma)** are converted on import in the desktop app (bundled FFmpeg), instead of arriving blank. The browser version explains why it can't play them.
- **README-BSSMNT.txt** with controls and shortcuts, included with every download.

## BASSMNTalphaV1 (2026-10-03)
First alpha for testers: Windows launcher, offline export, projects with packed or linked media, live input recording (untested), dark skin, text and credits, display sizes.
