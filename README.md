# POLYBOUND

A competitive creature-strategy game on a floating medieval-fantasy island. You start with no creatures. Find yellow triangles, red squares, and blue spheres hidden in the wild, then throw them, whistle them back, and race treasures home against Vesper, a local rival.

Vesper is an autonomous opponent using the same rules. There is no online multiplayer.

## Play

The game is a static page of ES modules. Serve this folder and open it in a desktop browser:

```bash
python3 -m http.server 8734
```

Then visit http://127.0.0.1:8734/

## Controls

- WASD move, Shift run
- 1 yellow triangles, 2 red squares, 3 blue spheres, F all
- Left click throws toward the cursor. Hold to throw several.
- Right click whistles at the cursor. Carriers stay on the job.
- Scroll zooms. Q and E turn the view.
- Esc pauses. M mutes. Sound starts after you set out.

A match lasts seven minutes, or ends early at 480 points. Deliver treasures to your heartstone. Restart from the results screen resets the whole island.
