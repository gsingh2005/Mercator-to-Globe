# Mercator Globe Studio

Mercator Globe Studio is a small browser app that turns a flat Mercator world map into a globe-ready Equirectangular texture and previews the result on an interactive globe.

It is built as a static client-side tool:

- no framework
- no build step
- no backend
- no upload to a server

Everything runs in the browser using plain HTML, CSS, and JavaScript.

## What It Does

- Accepts a user-supplied Mercator world map image
- Reprojects that image into an Equirectangular texture
- Uses the generated texture as the source for an interactive globe preview
- Lets the user preview and download the flat texture
- Lets the user download the current globe view as a PNG

## Who It Is For

This tool is meant for people working with custom world maps, including:

- alternate history maps
- alternate geography maps
- fictional planet maps
- stylized world maps that still follow Mercator horizontally

## How It Works

1. The user uploads a Mercator world map image.
2. The app infers a reasonable Mercator latitude span from the image aspect ratio.
3. The user can keep that inferred span or override it manually.
4. The app generates a new Equirectangular texture at the selected output scale.
5. The generated texture is applied to the interactive globe.

Polar regions outside the source Mercator span are filled by extending the nearest valid source latitude so the globe does not show transparent holes at the poles.

## Quick Start

Open `index.html` directly in a browser, or serve it locally.

Serving it locally is the more reliable option across browsers because some browsers apply stricter `file://` restrictions to worker-based code paths:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000/](http://localhost:8000/).

## Using The App

1. Upload a Mercator map image.
2. Check the inferred `Min latitude` and `Max latitude`.
3. Adjust the latitude span if the source image is vertically cropped or non-standard.
4. Adjust `Texture resolution` to control output size.
5. Use the globe preview to inspect the result.
6. Click `Preview flat map` to inspect the generated Equirectangular texture.
7. Download either the Equirectangular texture or the current globe view.

## Input Assumptions

For the conversion to look correct, the source image should follow these assumptions:

- it is a Mercator projection
- it spans the full globe horizontally
- the left edge corresponds to `-180°`
- the right edge corresponds to `180°`

The app does not try to auto-detect arbitrary projections. It is specifically tuned for Mercator input and Equirectangular output.

## Supported Image Formats

The upload control accepts:

- PNG
- JPG / JPEG
- WebP
- AVIF
- GIF

## Browser Notes

- The app uses a Web Worker when available so the reprojection step does not block the UI as much.
- If worker setup fails, conversion falls back to the main thread automatically.
- Output resolution is capped to stay within safer browser memory limits.
- The globe preview uses a dependency-free canvas renderer and is intended to run in a regular desktop browser.

## Project Structure

- `index.html`: app shell and UI
- `styles.css`: layout and styling
- `app.js`: UI behavior, file loading, conversion flow, downloads
- `projection-core.js`: projection math and image reprojection
- `converter-worker.js`: worker-backed conversion path
- `globe-renderer.js`: interactive globe renderer

## Running It Privately

If you only want the project visible to you on GitHub:

- create the repository as `Private`
- push the code there
- do not enable GitHub Pages

That keeps the code private. For a normal personal GitHub setup, GitHub Pages is not the right choice for a live site that only you can access.

## Publishing It Publicly Later

Because this is a static app, GitHub Pages is the simplest public deployment option.

Typical flow:

1. Create a public repository.
2. Push this project to the repository.
3. In GitHub, open `Settings` > `Pages`.
4. Choose `Deploy from a branch`.
5. Select the `main` branch and `/(root)`.
6. Save and wait for the site to publish.

## Limitations

- Mercator input only
- Full-world horizontal coverage expected
- No automatic projection detection
- No georeferencing metadata import
- No tiled or streaming rendering pipeline

## License

No license has been added yet. If you want other people to reuse or redistribute the project, add one before making the repository public. `MIT` is the simplest common choice for a small browser tool.
