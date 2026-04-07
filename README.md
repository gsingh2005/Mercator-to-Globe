# Mercator Globe Studio

A lightweight browser tool for:

- uploading a Mercator world map
- generating a high-resolution Equirectangular texture from it
- using that texture as the source for an interactive 3D globe

The globe is the primary interface. The flat Equirectangular map is available as a preview and PNG download.

## Publish It

The easiest public deployment is GitHub Pages because this app is fully static.

1. Create a new GitHub repository.
2. Push the contents of this folder to that repository.
3. On GitHub, open `Settings` > `Pages`.
4. Under `Build and deployment`, choose `Deploy from a branch`.
5. Select the `main` branch and the `/ (root)` folder.
6. Save, then wait for GitHub Pages to publish the site.

After it finishes, the app will be available at:

`https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY_NAME/`

## Push It

From inside this folder:

```bash
cd /path/to/Map-to-Globe
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY_NAME.git
git push -u origin main
```

If you prefer GitHub CLI:

```bash
cd /path/to/Map-to-Globe
git init
git add .
git commit -m "Initial commit"
gh repo create YOUR_REPOSITORY_NAME --public --source=. --remote=origin --push
```

## Before Making It Public

- Add a license so other people know how they are allowed to use the project. `MIT` is the simplest common choice for a small browser tool.
- Replace `YOUR_GITHUB_USERNAME` and `YOUR_REPOSITORY_NAME` in the examples above.
- Test the published Pages URL once after deployment to confirm the worker and downloads behave correctly in production.

## Files

- `index.html`: globe-first app shell
- `styles.css`: layout and visual styling
- `projection-core.js`: shared projection math and image resampling
- `converter-worker.js`: optional worker-backed conversion path
- `globe-renderer.js`: dependency-free interactive globe renderer
- `app.js`: browser UI wiring and export flow

## Usage

Open `index.html` in a browser, or serve the folder with a simple static server if you want the worker path to behave more consistently across browsers.

Example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## Assumptions

- The uploaded image spans the full globe horizontally from `-180°` to `180°`.
- The uploaded image is a Mercator world map.
- Polar regions outside the source Mercator span are filled by extending the nearest valid source latitude to avoid visible holes on the globe.

## Notes

- Output size is derived from the source width and the selected scale factor, then capped to stay within safer browser memory limits.
- The main control for unusual maps is the Mercator latitude span. The app can infer it from the image aspect ratio, but the user can override it manually.
