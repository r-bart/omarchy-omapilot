# Community demo: selected-text actions

## Goal

Show the complete value in 35–45 seconds: select imperfect text in another
application, describe a custom transformation in OmaPilot, inspect Before and
After, and explicitly choose whether to replace the source.

## Recording setup

- Use workspace 2 with the text-action lab and OmaPilot sidebar already open.
- Record at 1920×1080 or 2560×1440 without microphone or desktop audio.
- Hide notifications and close windows containing personal information.
- Use a short, legible source sentence such as:
  `this release note are too long and dont explain the benefit`
- Use this custom instruction:
  `Turn this into one concise release-note bullet.`

Start and stop with Omarchy's native recorder:

```sh
omarchy screenrecord --fullscreen --resolution=1920x1080
omarchy screenrecord --stop-recording
```

## Shot list

1. Select the imperfect sentence in the lab.
2. Open OmaPilot's selected-text action.
3. Pause briefly on Fix, Rewrite, Translate, and its language selector.
4. Expand **Custom instruction**, type the instruction, and run it.
5. Hold on the Before / After preview long enough to read both versions.
6. Press **Replace** and show the changed sentence in the source application.

Keep the pointer movement direct and avoid waiting on the model in the final
cut; trim the generation pause to roughly one second. Do not show provider
keys, settings, terminal output, or chat history.

## Suggested community copy

> OmaPilot can now transform text directly where you're working. Select text,
> choose Fix, Rewrite, Translate, or describe your own transformation, review
> Before and After, then replace only when you're happy with the result.

Export H.264 MP4 at 1080p, 30 or 60 fps, with the text readable on a phone.
