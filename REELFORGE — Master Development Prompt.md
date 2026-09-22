# REELFORGE — Master Development Prompt

## 1. Project Overview

Build a **Windows desktop application** called **ReelForge**.

ReelForge is a local-first AI video clipping and editing application designed to take a long-form video of up to approximately **1 hour**, automatically identify the most interesting/high-value moments, turn them into short-form vertical videos, and provide a full editor for refining the results.

The primary purpose is personal use.

The application must operate **locally on the user's Windows PC** wherever technically possible.

The user should be able to:

1. Import a complete video.
2. Analyze the video with AI.
3. Automatically identify highlights.
4. Automatically determine how many clips should be created.
5. Automatically determine appropriate clip durations.
6. Remove unnecessary beginnings/endings and dead space.
7. Convert landscape footage into 9:16 vertical content.
8. Track and reframe people intelligently.
9. Generate large short-form captions.
10. Generate titles, hooks, descriptions/captions, and hashtags.
11. Preview the generated clips.
12. Manually edit the generated clips.
13. Add text, images, music, transitions, zooms, effects, and captions.
14. Save projects locally.
15. Export clips for Instagram Reels, TikTok, YouTube Shorts, and Facebook Reels.
16. Export without watermarks.

The application should feel like a **modern AI-powered desktop video editor**, not a simple command-line video clipping utility.

---

# 2. Core Product Philosophy

The application should follow these principles:

### Local-first

Video files should remain on the user's computer.

Do not require uploading the user's videos to a remote server.

AI processing should use local models where practical.

### Non-destructive editing

Never modify the original imported video.

The original source must remain untouched.

All edits should be represented as project metadata/timeline operations until final export.

### AI-assisted, not AI-controlled

The AI should perform the difficult work automatically, but the user must always be able to change its decisions.

The user should be able to:

* change clip start/end
* change crop
* change captions
* change text
* change music
* change effects
* change transitions
* change AI-generated metadata
* regenerate a clip

### Fast feedback

Long-running operations must provide progress information.

Never make the application appear frozen.

---

# 3. Target Platform

Primary platform:

**Windows 10/11**

The application should be optimized for modern Windows PCs.

The application should be able to take advantage of:

* NVIDIA GPUs
* CUDA where supported
* GPU video encoding where available
* CPU fallback
* hardware acceleration

The application must still function on systems without a supported NVIDIA GPU whenever possible.

---

# 4. Local Processing Requirement

The application must prioritize local processing.

Do not build the MVP around:

* OpenAI API video uploads
* cloud video processing
* remote rendering
* cloud storage
* mandatory accounts
* remote AI services

The application should instead use local processing technologies/models where appropriate.

Potential technologies may include:

* FFmpeg
* Whisper-compatible local speech recognition
* ONNX Runtime
* PyTorch
* CUDA
* OpenCV
* MediaPipe
* local LLMs
* local vision models
* local embedding models

Choose the most practical technologies based on performance and maintainability.

Do not add unnecessary AI models.

Prefer a small number of well-integrated models over a complicated collection of models.

---

# 5. Input Video

The application should support common video formats such as:

* MP4
* MOV
* MKV
* AVI
* WebM

Target maximum source duration:

**approximately 1 hour**

The application should inspect the source before processing.

Extract:

* duration
* width
* height
* FPS
* codec
* audio streams
* audio sample rate
* file size
* orientation
* frame rate

Display basic source information to the user.

---

# 6. Main User Workflow

The primary workflow should be:

```text
Import Video
      ↓
Analyze Source
      ↓
Extract Audio
      ↓
Transcribe Speech
      ↓
Analyze Video
      ↓
Detect Potential Highlights
      ↓
Rank Highlights
      ↓
Determine Clip Boundaries
      ↓
Remove Dead Space
      ↓
Determine Vertical Framing
      ↓
Generate Captions
      ↓
Generate Title / Hook / Description / Hashtags
      ↓
Generate Draft Clips
      ↓
Show Results
      ↓
User Reviews
      ↓
User Edits
      ↓
Render Final Video
      ↓
Export
```

---

# 7. Upload Experience

The main screen should provide a clear drag-and-drop interface.

Example:

```text
┌───────────────────────────────────────┐
│                                       │
│          Drop your video here         │
│                                       │
│             or Browse                 │
│                                       │
│       MP4 • MOV • MKV • AVI           │
│                                       │
└───────────────────────────────────────┘
```

After selecting a video, show:

* filename
* duration
* resolution
* file size
* thumbnail
* estimated processing requirements

Provide a clear **Analyze Video** action.

---

# 8. Video Analysis

The analysis system should extract as much useful information as practical.

Analyze:

### Audio

* speech
* silence
* volume
* speaker changes
* laughter where detectable
* emphasis
* pauses
* significant audio events

### Speech

Generate a timestamped transcript.

Example:

```text
00:13.2
"You don't actually need more motivation."

00:16.8
"You need a system."

00:20.4
"That's the mistake most people make."
```

### Video

Detect:

* faces
* people
* scene changes
* camera changes
* important visual events
* significant movement
* speaker position

---

# 9. Highlight Detection

The AI should automatically determine the best sections of the source video.

Do not simply divide the video into equal segments.

Highlights should be identified using multiple signals.

Potential highlight signals include:

### Strong hooks

Examples:

* surprising statements
* questions
* controversial statements
* direct advice
* curiosity gaps

### Information

Identify sections containing:

* useful information
* explanations
* tutorials
* insights
* facts
* lessons

### Emotion

Identify:

* excitement
* humor
* sadness
* surprise
* anger
* enthusiasm
* emotional storytelling

### Stories

Prefer sections containing:

* setup
* event
* development
* conclusion

### Reactions

Look for:

* strong facial reactions
* laughter
* surprise
* unexpected events

### Strong statements

Examples:

* opinions
* conclusions
* lessons
* memorable statements

### Context

Prefer clips that can stand on their own.

Avoid clips that begin in the middle of an unexplained conversation.

---

# 10. Highlight Scoring

Each potential highlight should receive an internal score.

Example conceptual scoring:

```text
Hook
Emotion
Information
Story completeness
Context independence
Visual quality
Audio quality
Ending strength
Engagement potential
```

Do not expose unnecessary technical scoring to the user.

The system should use these scores to rank candidate clips.

---

# 11. Automatic Clip Count

The user does not manually select the number of clips during the normal workflow.

The AI should determine the appropriate number.

For example:

```text
30-minute video
→ 4 clips

60-minute video
→ 7 clips
```

The exact number must depend on the content.

Avoid generating multiple nearly identical clips.

Avoid artificially forcing a specific number of clips.

---

# 12. Automatic Clip Duration

The AI determines the appropriate duration.

The target is short-form content, but duration should depend on the story.

A clip can be:

* short
* medium
* relatively long

Do not cut a useful explanation simply because it reached an arbitrary duration.

The clip must preserve the complete thought whenever possible.

---

# 13. Automatic Start/End Editing

The AI should automatically identify the best starting and ending points.

Remove unnecessary:

* silence
* filler
* greetings
* repeated words
* awkward pauses
* irrelevant setup
* unfinished thoughts

However, do not aggressively remove words if doing so changes the speaker's meaning.

The system must preserve natural speech.

---

# 14. Vertical Reframing

Every generated short-form clip should support:

**1080 × 1920**

with a **9:16 aspect ratio**.

The application should automatically convert landscape footage into vertical framing.

Do not simply stretch the video.

Use intelligent cropping/reframing.

---

# 15. Face and Speaker Tracking

When people are visible, automatically track the relevant speaker.

For one person:

```text
┌─────────┐
│         │
│   👤    │
│         │
│         │
└─────────┘
```

Keep the person appropriately framed.

For two or more people, dynamically determine the relevant subject.

The framing may change during the clip when appropriate.

Avoid excessive camera movement.

The result should feel intentional rather than algorithmically shaky.

---

# 16. Captions

Automatically generate captions from the transcript.

Default style:

**Large TikTok/Reels-style captions**

Captions should:

* be highly readable
* work on mobile screens
* use appropriate contrast
* avoid covering important faces
* synchronize accurately with speech
* support word/phrase timing
* automatically wrap text
* remain inside safe areas

Provide caption customization.

Possible controls:

* font
* size
* position
* color
* outline/shadow
* background
* animation
* word highlighting
* alignment

---

# 17. AI-Generated Metadata

For every generated clip, automatically create:

### Title

Example:

```text
The Biggest Mistake Beginners Make
```

### Hook

Example:

```text
You're probably doing this wrong.
```

### Social caption

Generate a short description suitable for social media.

### Hashtags

Generate relevant hashtags.

Do not generate random hashtags.

Base them on the actual video content.

All generated text must remain editable.

---

# 18. Generated Clip Results

After processing, show a results page.

Example:

```text
Your Highlights

┌────────────┐ ┌────────────┐ ┌────────────┐
│            │ │            │ │            │
│   CLIP 1   │ │   CLIP 2   │ │   CLIP 3   │
│            │ │            │ │            │
│ 00:13-00:47│ │ 02:15-02:58│ │ 05:42-06:21│
│            │ │            │ │            │
└────────────┘ └────────────┘ └────────────┘
```

Each clip should show:

* preview
* duration
* generated title
* edit button
* export button
* regenerate button
* delete button

---

# 19. Full Video Editor

The application must include a timeline-based editor.

The editor should support:

### Timeline

* video tracks
* audio tracks
* text tracks
* caption tracks
* image tracks
* effect tracks

### Basic editing

* trim
* split
* delete
* move
* duplicate
* undo
* redo

### Text

* add text
* edit text
* font
* size
* position
* animation
* timing

### Captions

* edit transcript
* modify timing
* change style
* change position

### Zoom

Support:

* manual zoom
* animated zoom
* keyframes if practical

### Images

Allow users to add images over the video.

### Music

Allow users to add background music.

### Transitions

Support basic transitions.

### Effects

Support practical visual effects without making the editor unnecessarily complicated.

---

# 20. Built-in Music Library

The application should have a built-in music library.

Music must be stored locally.

Organize tracks by categories such as:

* energetic
* chill
* cinematic
* emotional
* funny
* dramatic
* motivational
* gaming
* vlog
* podcast

Each track should include metadata.

Example:

```text
Track
Title
Artist/Creator
Category
Duration
BPM
License
File path
```

Only include music that is legally permitted for the intended application.

Do not bundle copyrighted commercial music without appropriate rights.

---

# 21. Audio Controls

Provide:

* video volume
* music volume
* mute
* fade in
* fade out
* audio trimming
* music ducking

When speech is detected, background music should automatically reduce in volume when appropriate.

---

# 22. Export

The application should support exports suitable for:

* Instagram Reels
* TikTok
* YouTube Shorts
* Facebook Reels

Primary output:

```text
1080 × 1920
9:16
```

Preserve source quality where practical.

If the source is already higher quality, maintain the highest sensible quality supported by the target.

Do not unnecessarily reduce quality.

Provide export settings for advanced users.

---

# 23. No Watermark

The application must not add a watermark to exported videos.

There should be no:

```text
ReelForge
```

logo automatically added to exported content.

---

# 24. Project Storage

Users should be able to save projects locally.

Example:

```text
ReelForge Projects/

├── Podcast Episode 01/
├── Gaming Session/
├── Interview/
└── Vlog/
```

A project should preserve:

* original video reference
* transcript
* detected highlights
* clips
* timeline
* captions
* text
* images
* music
* effects
* export settings
* generated metadata

Do not duplicate huge source video files unnecessarily.

---

# 25. Project Recovery

If the application closes unexpectedly, the project should be recoverable.

Use:

* autosave
* project checkpoints
* temporary render files
* recovery metadata

The application should avoid losing hours of editing work.

---

# 26. Undo / Redo

The editor must have reliable:

```text
Ctrl + Z
Ctrl + Shift + Z
```

or an equivalent redo shortcut.

Major editing operations should be undoable.

---

# 27. Processing Architecture

Use an asynchronous processing architecture.

Do not freeze the UI during:

* transcription
* AI analysis
* rendering
* exporting

Conceptually:

```text
UI
 │
 ├── Project Manager
 │
 ├── Processing Manager
 │
 └── Editor
        │
        ↓
   Local Worker
        │
        ├── FFmpeg
        ├── Speech Recognition
        ├── Vision Analysis
        ├── Highlight Analysis
        └── Rendering
```

---

# 28. Processing Queue

Long-running tasks should be handled through jobs.

Example:

```text
Job 1
Transcription

Job 2
Highlight analysis

Job 3
Clip generation

Job 4
Caption rendering

Job 5
Final export
```

The user should be able to see the current operation.

Example:

```text
Analyzing video

████████████████░░░░ 82%

Finding potential highlights...
```

---

# 29. Error Handling

Errors must be understandable.

Do not show raw stack traces to normal users.

Instead:

```text
We couldn't process this video.

The source file may be corrupted or use an unsupported codec.

[Try Again]
```

Provide a technical details section for debugging.

---

# 30. Performance

The application should be optimized for large videos.

Avoid loading the entire video into RAM.

Use:

* streaming
* temporary files
* proxy media when appropriate
* hardware decoding
* hardware encoding
* background workers
* cached analysis

Generate low-resolution preview/proxy files when useful.

The editor should remain responsive.

---

# 31. GPU Acceleration

Detect available hardware.

If supported, use:

* NVIDIA CUDA
* NVENC
* hardware decoding

Provide CPU fallback.

The application should never crash simply because GPU acceleration is unavailable.

---

# 32. Local AI

AI components should preferably run locally.

Potential components:

### Speech-to-text

Use a Whisper-compatible local model.

### Vision

Use an appropriate local vision/person/face detection system.

### Text analysis

Use a local LLM capable of analyzing timestamped transcripts.

The architecture should allow AI models to be replaced later without rewriting the entire application.

Create a clear AI abstraction layer.

Example:

```text
AIProvider
├── TranscriptionProvider
├── HighlightProvider
├── VisionProvider
└── MetadataProvider
```

---

# 33. AI Provider Abstraction

Do not hard-code the entire application around one AI model.

Use interfaces such as:

```text
transcribe(video)
analyzeTranscript(transcript)
findHighlights(transcript, videoMetadata)
generateMetadata(highlight)
analyzeFaces(video)
```

This allows future support for different local models.

---

# 34. Suggested Technology Direction

Use a technology stack appropriate for a Windows desktop application.

A strong candidate architecture is:

```text
Desktop Shell
Electron or Tauri

Frontend
React + TypeScript

Desktop/backend layer
Rust or Node.js depending on selected shell

Video Processing
FFmpeg

Local AI
Python/local model workers

Database
SQLite

Project files
Local filesystem

Rendering
FFmpeg + GPU acceleration
```

Prefer **Tauri** if its ecosystem and implementation complexity remain manageable.

Use Electron if it substantially simplifies required functionality.

Do not choose a technology simply because it is popular.

Choose based on:

* Windows compatibility
* video processing integration
* local filesystem access
* performance
* AI integration
* maintainability
* development speed

---

# 35. Suggested Folder Structure

Create a clean modular architecture.

Example:

```text
reelforge/
│
├── src/
│   ├── app/
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── video/
│   │   ├── editor/
│   │   ├── timeline/
│   │   ├── captions/
│   │   └── projects/
│   │
│   ├── features/
│   │   ├── import/
│   │   ├── analysis/
│   │   ├── highlights/
│   │   ├── captions/
│   │   ├── reframing/
│   │   ├── editor/
│   │   ├── music/
│   │   └── export/
│   │
│   ├── ai/
│   │   ├── transcription/
│   │   ├── highlights/
│   │   ├── vision/
│   │   └── metadata/
│   │
│   ├── video/
│   │   ├── ffmpeg/
│   │   ├── rendering/
│   │   ├── encoding/
│   │   └── thumbnails/
│   │
│   ├── projects/
│   ├── database/
│   ├── workers/
│   ├── storage/
│   ├── settings/
│   └── utils/
│
├── ai/
│   ├── models/
│   └── workers/
│
├── assets/
│   ├── music/
│   ├── fonts/
│   └── presets/
│
├── projects/
│
└── README.md
```

Adapt this structure to the actual chosen framework.

Do not create unnecessary files merely to follow the example.

---

# 36. UI Design Direction

The UI should be:

* modern
* clean
* premium
* minimal
* desktop-oriented
* dark-mode friendly
* visually clear
* easy to understand

Avoid making it look like an old professional video editor.

Do not overwhelm the user with buttons.

The AI workflow should feel simple.

Primary navigation could be:

```text
Home
Projects
Editor
Settings
```

---

# 37. Home Screen

The home screen should focus on the primary action:

```text
Create a Reel

Drop a video here
or
Browse Files
```

Below that:

```text
Recent Projects
```

with project thumbnails.

---

# 38. Analysis Screen

Show an attractive progress experience.

Example:

```text
Analyzing your video

✓ Reading video
✓ Extracting audio
✓ Transcribing
● Finding highlights
○ Preparing clips
○ Generating captions
```

Do not display meaningless percentage changes.

The status should communicate what the application is actually doing.

---

# 39. Highlights Screen

Show generated clips in a visual grid.

Each card should contain:

* vertical preview
* duration
* title
* edit button
* export button

Allow:

* select
* delete
* regenerate
* edit

---

# 40. Editor Screen

Use a familiar layout:

```text
┌──────────────────────────────────────────────┐
│ Toolbar                                      │
├──────────────┬───────────────────────────────┤
│              │                               │
│ Tools        │       Video Preview           │
│              │                               │
│ Text         │                               │
│ Captions     │                               │
│ Music        │                               │
│ Images       │                               │
│ Effects      │                               │
│              │                               │
├──────────────┴───────────────────────────────┤
│ Timeline                                     │
│                                              │
│ ████████████████████████████████████████     │
│                                              │
│ ─────────────── Audio ────────────────       │
└──────────────────────────────────────────────┘
```

The editor should support keyboard shortcuts.

---

# 41. Smart Editing

The application should eventually support AI-assisted editing actions such as:

```text
"Remove the silence."

"Make this more energetic."

"Move the captions higher."

"Make the clip shorter."

"Focus on the speaker."

"Add a dramatic zoom here."

"Generate another version."
```

These should be implemented later rather than blocking the MVP.

---

# 42. Regeneration

The user should be able to ask the AI for another version of a clip.

For example:

```text
Clip 1

[ Regenerate ]

Options:

○ Stronger hook
○ Shorter
○ More context
○ More emotional
○ Focus on information
○ Let AI decide
```

The original version should remain available.

---

# 43. Multiple Versions

Allow multiple versions of the same highlight.

Example:

```text
Highlight #3

Version A
Original AI edit

Version B
Shorter edit

Version C
Stronger hook
```

This is useful for comparing different short-form edits.

---

# 44. Safety and Content Integrity

The AI should not invent words that were never spoken when generating captions.

Captions must match the source audio.

AI-generated titles and descriptions may be creative, but they must accurately represent the clip.

Do not alter the speaker's meaning.

Do not fabricate quotes.

---

# 45. Privacy

Since this is a local application:

* do not upload videos automatically
* do not transmit private videos to third parties
* do not collect unnecessary personal information
* do not require accounts
* do not require cloud storage

If an optional future cloud feature is added, it must be explicitly enabled by the user.

---

# 46. MVP Scope

The first working version should NOT attempt to implement every advanced feature.

The MVP should focus on:

```text
1. Import video
2. Read video metadata
3. Extract audio
4. Local transcription
5. AI highlight detection
6. Automatic clip boundaries
7. Automatic clip count
8. 9:16 conversion
9. Face/speaker tracking
10. Large captions
11. AI title
12. AI hook
13. AI social caption
14. AI hashtags
15. Preview clips
16. Basic timeline editing
17. Music
18. Export
19. Local project saving
20. No watermark
```

---

# 47. Development Phases

## Phase 1 — Foundation

Build:

* Windows desktop shell
* React interface
* project system
* SQLite
* filesystem integration
* video import
* FFmpeg integration

Goal:

```text
Import video
→ inspect video
→ create project
```

---

## Phase 2 — Transcription

Implement local speech-to-text.

Goal:

```text
Video
→ Audio
→ Timestamped transcript
```

Display the transcript for debugging.

---

## Phase 3 — Highlight Detection

Implement AI analysis.

Goal:

```text
Transcript
→ candidate highlights
→ ranked highlights
```

Do not render final videos yet.

Show timestamps and reasons.

---

## Phase 4 — Automatic Clip Generation

Implement:

* start/end selection
* silence trimming
* FFmpeg cutting
* preview generation

Goal:

```text
Video
→ 3–10 candidate clips
```

---

## Phase 5 — Vertical Reframing

Implement:

* 9:16 conversion
* face detection
* speaker tracking
* automatic crop

Goal:

```text
Landscape video
→ professional vertical clip
```

---

## Phase 6 — Captions

Implement:

* transcript synchronization
* large captions
* caption styling
* caption positioning
* caption rendering

---

## Phase 7 — AI Metadata

Generate:

* title
* hook
* social caption
* hashtags

Make everything editable.

---

## Phase 8 — Editor

Implement:

* timeline
* trimming
* splitting
* text
* captions
* images
* zoom
* music
* transitions
* effects

---

## Phase 9 — Music

Add:

* local music library
* categories
* previews
* volume controls
* fade
* ducking

---

## Phase 10 — Export

Implement:

* Reels
* TikTok
* Shorts
* Facebook Reels

Support high-quality 9:16 exports.

---

## Phase 11 — Optimization

Optimize:

* GPU acceleration
* caching
* proxy media
* background workers
* memory usage
* rendering speed

---

# 48. Important Development Rules

Do not over-engineer the first version.

Do not implement cloud infrastructure.

Do not implement accounts.

Do not implement payments.

Do not implement unnecessary analytics.

Do not implement social media posting APIs initially.

Do not sacrifice stability for unnecessary AI features.

Prioritize:

```text
Reliable video processing
>
Good highlight detection
>
Good vertical framing
>
Good captions
>
Good editing experience
>
Advanced AI features
```

---

# 49. Definition of Success

The MVP is successful when a user can take a normal long-form video such as:

```text
60-minute podcast.mp4
```

and perform:

```text
Import
   ↓
Analyze
   ↓
Wait
   ↓
Receive several high-quality highlights
   ↓
Review
   ↓
Edit
   ↓
Export
```

without manually searching through the entire one-hour video.

The generated clips should feel like intentional short-form content rather than random sections of the original video.

---

# 50. Final Product Goal

ReelForge should ultimately feel like:

> "Give me the video, and I'll find the moments worth turning into Reels."

The user should not need to understand:

* FFmpeg
* transcription
* video codecs
* AI models
* face detection
* timeline rendering
* aspect ratios
* caption synchronization

All of that should happen behind the scenes.

The user experience should remain simple:

```text
VIDEO
  ↓
AI ANALYSIS
  ↓
HIGHLIGHTS
  ↓
EDIT
  ↓
EXPORT
```

Build the application incrementally.

At every phase, keep the application runnable.

Do not implement placeholder functionality and pretend it works.

When a feature depends on a real AI model, video-processing engine, or local worker, integrate the actual system or clearly mark the feature as incomplete.

The final application must be a functional Windows desktop application, not merely a UI prototype.
