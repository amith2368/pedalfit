# Contributing

Thanks for helping make pedalfit better!

## Setup

No build step and no dependencies to install: it's plain ES modules.

```sh
python3 server.py   # run the app at http://localhost:8766
npm test            # run the test suite (Node 20+)
```

## Where things live

| File | What it does |
|---|---|
| `pose.js` | Loads MediaPipe Pose and steps through the video frame by frame |
| `analysis.js` | Landmarks → joint angles, pedal phase, stroke detection, per-stroke metrics |
| `fit.js` | Target windows per bike type / goal / mobility, recommendations in mm, stem calculator |
| `app.js` | UI flow and report rendering |
| `tests/` | `node:test` suites driven by a synthetic rider with known geometry |

## Guidelines

- **Keep it offline.** No network calls at runtime; vendor anything the app needs.
- **Test the maths.** Changes to `analysis.js` or `fit.js` should come with a test in `tests/`.
  `tests/synthetic-rider.js` can generate a rider with any knee angle, back angle, cadence or camera side.
- **Cite ranges.** If you change a target window, say where the new numbers come from in the PR.
- **Real videos help.** If tracking fails on your footage, open an issue with a description of the camera setup.
  Please don't attach videos of other people without their consent.
