BSSMNT — Video Composer  ·  BSSMNT-Stable05
============================================

A beat-locked video composer and DJ visualizer. Load a song (or go live
from a mic / line in), add your clips, and the Auto-Editor cuts them on
the beat. Add titles and credits, then export an MP4. Everything runs on
your computer, offline.


GETTING STARTED
---------------
1. 02 Input: choose LIVE INPUT (mic / line in) or TRACK FILE (a song).
2. 03 Sound › Assets: drop in videos and images (or click to choose).
   Screen recordings (.asf / .wmv) are converted automatically.
3. MODE (top bar): pick Clip Auto-Editor (key 0), then press Space to play.
   Cuts start once the tempo is found ("Listening for tempo…").
4. Play the song through once — what you see is recorded for the export.
5. 01 File › Export video: pick the options and press Export MP4.
6. 01 File › Save (Ctrl+S). Next to Save choose PACK (media inside the file,
   opens anywhere) or LINK (small file, media stays where it is); the
   file size is shown underneath. New project, Open, Open recent and
   Save as are in the same list.


KEYBOARD SHORTCUTS
------------------
Space              Play / pause (track) · start / stop (live)
F                  Fullscreen
Ctrl+Space         Full screen with the editing shelves hidden (only the
                   picture); Esc or Ctrl+Space brings them back
1 – 9              Visual modes in menu order:
                     1 Spectrum Bars   2 Floating Particles   3 Frequency Rings
                     4 Wave Forms      5 Mandala              6 Tunnel Vision
                     7 Galaxy          8 Polygon Collage      9 Media Layers
0                  Clip Auto-Editor
Ctrl+1             01 File panel         (Alt+1 also works)
Ctrl+2             02 Input panel        (live / track, voice)
Ctrl+3             03 Sound panel        (EQ, assets, asset timing)
Ctrl+4             04 Effects panel      (titles, credits, text)
Shift+A            Auto-Editor controls (right side)
Ctrl+S             Save project
Ctrl+Shift+S       Save project as…
Ctrl+O             Open project
Ctrl+N             New project (desktop app; in a browser Alt+N)
R                  Reset the bass / mid / high sensitivity to 1.0
L                  Loop the timeline selection (drag on the ruler to
                   select; Shift extends; Esc clears)
T                  Tap tempo (track mode, 4 taps or more). The TEMPO readout in the
                   header also has ÷2, ×2, type a tempo, Detected and Live clock.
?                  Show / hide help
Esc                Close help
Clicking a panel tab a second time closes it.


CONTROLS AT A GLANCE
--------------------
Top bar      SRC (Live / Track) · MODE (visual mode) · SIZE (frame shape:
             Original, 16:9, 9:16, 1:1) · half-moon = dark / light skin · ?
Timeline     Play / pause, stop, back to start. Click a lane to jump; drag
             on the ruler to select a range (L loops it, Export can render
             just the selection). M on Master / Voice mutes that track
             (muted = left out of exports). F on Master: fade in / out.
             Drag text blocks on the Text lane to retime them.
Master       Start [0:00]: where the music starts. Type a time, or
             double-click the Master lane, move, click to drop (snaps to
             bars, Alt = free, Esc cancels). Before it the clips still cut
             on the beat and the voice plays. The time beside Start is the
             music's length: click it to shorten the song (30 s at least).
Drawers      Master, Clips, Voice, Text and Action clips share the bottom
             shelf. Drag the white line (pill in the middle) between two
             to resize them; the main divider resizes them all evenly.
Action       The clip stack: drag to reorder. Top = most important (shown
clips        most often). Cards are coloured by their band. A clip with
             sections shows them as a strip on its card (click one to edit
             it); the card grows when there are many.
01 File      New project · Open… · Open recent · Save (+ Pack / Link and the
             file size) · Save as… · Export video (options in dropdowns) ·
             Output window (pop-out for a projector).
03 Sound     EQ (Sensitivity / Dynamic), the asset list, and the selected
             asset's options: Pace (how long it holds), Repeats (how many
             times it may appear, 0 = no limit), Position lock (Hook /
             Result / CTA, three in total) with Auto fade music, the
             amount used, Speed (¼–4×), Fit to bars, a visual mode of its
             own, and where it sits on screen (images can play Over video).
Sections     On a video's card, Sections opens the slicer: Slice every
             1/2 · 1 · 4 · 8 · 16 bars cuts it for you; click to add a
             marker, drag to move, × or right-click to delete, select one
             and press Delete or ←/→, Ctrl+Z undoes. A section can be made
             its own clip (↗) with its own card; ↩ Back puts it back.
TEMPO        The song is analysed when it loads and cuts follow one beat
             grid from 0:00. If the tempo is off: ÷2, ×2, type it, or tap
             T; Live clock goes back to the alpha's behaviour.
04 Effects   Add title, Add credits, Add text; every option is a dropdown.
             Lock to Start / At time / End.
             Drag the dashed box on screen to place text. Layout can
             differ per frame shape (Base / Vertical / Square).
Live mode    "Record input for export" keeps the sound of a live set for
             the export (untested in real-world use).


GOOD TO KNOW
------------
- Windows may say "Windows protected your PC": click More info → Run anyway
  (the app isn't code-signed yet).
- Stable05 installs beside the alpha with its own settings. Projects saved
  in Stable05 don't open in the alpha; the first Save over an alpha
  project offers to save a copy instead.
- The whole song is analysed when it loads, so parts you haven't played
  still get cuts and motion in the export. If the detected tempo is off,
  fix it in TEMPO (÷2, ×2, type, tap).
- The pop-out output window doesn't show the Clip Auto-Editor yet — use
  Fullscreen (F) or Ctrl+Space instead.
- Closing with unsaved changes asks before closing.

LICENCE AND CREDITS
-------------------
BSS MNT is MIT-licensed — see LICENSE.txt next to the app.
Original JS DJ Audio Visualizer: Waskar Paulino (traksaw), 2025.
BSS MNT fork (v2 and later): Omar (TheTyrant), 2026.
Third-party software keeps its own licence: p5.js, Mediabunny (+ AAC
encoder), fflate, the fonts, and FFmpeg (GPL-3.0, desktop app only) —
notes in resources/ffmpeg and in vendor/licenses in the source.
